import { test } from "node:test";
import assert from "node:assert/strict";
import type { ChatCompletionChunk, ChatCompletionCreateParamsStreaming } from "openai/resources/chat/completions";
import { EMPTY_REPLY, MAX_TOOL_ROUNDS, runAgentTurn, TurnDeadlineError, type AgentDeps, type TurnEvent, type TurnInput } from "./loop";
import type { ToolOutcome } from "./execute";

// ---------------------------------------------------------------------------
// A scripted fake model that streams like the real API: text in pieces, tool
// calls as fragments (id + name first, arguments split across chunks).
// ---------------------------------------------------------------------------

type Step = { text?: string; calls?: { id: string; name: string; args: string }[]; hang?: boolean };

function chunk(delta: ChatCompletionChunk["choices"][0]["delta"]): ChatCompletionChunk {
  return { id: "c", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta, finish_reason: null }] };
}

function toChunks(step: Step): ChatCompletionChunk[] {
  const out: ChatCompletionChunk[] = [];
  if (step.text) for (const piece of step.text.match(/[\s\S]{1,7}/g) ?? []) out.push(chunk({ content: piece }));
  step.calls?.forEach((c, index) => {
    out.push(chunk({ tool_calls: [{ index, id: c.id, type: "function", function: { name: c.name, arguments: "" } }] }));
    for (const piece of c.args.match(/[\s\S]{1,5}/g) ?? []) out.push(chunk({ tool_calls: [{ index, function: { arguments: piece } }] }));
  });
  out.push({ ...chunk({}), choices: [], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110, prompt_tokens_details: { cached_tokens: 64 } } });
  return out;
}

function fakeModel(steps: Step[]) {
  const calls: ChatCompletionCreateParamsStreaming[] = [];
  const complete: AgentDeps["complete"] = async (params, signal) => {
    // Snapshot: the loop keeps appending to the same messages array.
    calls.push({ ...params, messages: [...params.messages] });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    return (async function* () {
      if (step.hang) {
        await new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
      }
      yield* toChunks(step);
    })();
  };
  return { complete, calls };
}

function fakeTools(outputs: Record<string, ToolOutcome["output"]>, sources: ToolOutcome["sources"] = []) {
  const ran: { name: string; args: string }[] = [];
  const executeTool: AgentDeps["executeTool"] = async (name, args) => {
    ran.push({ name, args });
    const output = outputs[name] ?? { ok: true };
    return { name, ok: output.ok, output, sources: name === "search_knowledge" ? sources : [] };
  };
  return { executeTool, ran };
}

function baseInput(events: TurnEvent[], overrides: Partial<TurnInput> = {}): TurnInput {
  return {
    model: "test-model",
    system: "SYSTEM",
    history: [
      { role: "user", content: "earlier question" },
      { role: "assistant", content: "earlier answer" },
    ],
    userText: "How much is whitening?",
    tools: [{ name: "search_knowledge", description: "d", parameters: { type: "object", properties: {} } }],
    toolCtx: { businessId: "b", conversationId: "c", channel: "text", timeZone: "America/Los_Angeles", now: () => new Date() },
    emit: (e) => void events.push(e),
    deadlineMs: 60_000,
    ...overrides,
  };
}

const SOURCE = { documentId: "d1", title: "Pricing", heading: "Cosmetic", excerpt: "$349", similarity: 0.6 };

// ---------------------------------------------------------------------------

test("a plain answer streams as deltas and costs one model call", async () => {
  const events: TurnEvent[] = [];
  const model = fakeModel([{ text: "Hello! How can I help you today?" }]);
  const result = await runAgentTurn(baseInput(events), { complete: model.complete, executeTool: fakeTools({}).executeTool });

  assert.equal(result.text, "Hello! How can I help you today?");
  assert.equal(model.calls.length, 1);
  const streamed = events.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text);
  assert.ok(streamed.length > 1, "streamed in several pieces");
  assert.equal(streamed.join(""), result.text);
});

test("the model receives system prompt, history and the new message, in order", async () => {
  const model = fakeModel([{ text: "ok" }]);
  await runAgentTurn(baseInput([]), { complete: model.complete, executeTool: fakeTools({}).executeTool });
  assert.deepEqual(
    model.calls[0].messages.map((m) => [m.role, m.content]),
    [
      ["system", "SYSTEM"],
      ["user", "earlier question"],
      ["assistant", "earlier answer"],
      ["user", "How much is whitening?"],
    ],
  );
});

test("tool call: fragmented arguments are reassembled, the result goes back to the model, sources are collected", async () => {
  const events: TurnEvent[] = [];
  const model = fakeModel([
    { calls: [{ id: "call_1", name: "search_knowledge", args: '{"query":"teeth whitening price"}' }] },
    { text: "In-office whitening is $349." },
  ]);
  const tools = fakeTools({ search_knowledge: { ok: true, found: true, results: [] } }, [SOURCE, SOURCE]);
  const result = await runAgentTurn(baseInput(events), { complete: model.complete, executeTool: tools.executeTool });

  assert.deepEqual(tools.ran, [{ name: "search_knowledge", args: '{"query":"teeth whitening price"}' }]);
  assert.equal(model.calls.length, 2);
  const second = model.calls[1].messages;
  const assistantTurn = second.at(-2) as { role: string; tool_calls: { id: string; function: { name: string } }[] };
  assert.equal(assistantTurn.role, "assistant");
  assert.equal(assistantTurn.tool_calls[0].function.name, "search_knowledge");
  assert.deepEqual(second.at(-1), { role: "tool", tool_call_id: "call_1", content: JSON.stringify({ ok: true, found: true, results: [] }) });

  assert.equal(result.text, "In-office whitening is $349.");
  assert.deepEqual(result.sources, [SOURCE], "duplicate sources are removed");
  assert.deepEqual(
    events.filter((e) => e.type === "tool"),
    [
      { type: "tool", name: "search_knowledge", status: "started" },
      { type: "tool", name: "search_knowledge", status: "finished", ok: true },
    ],
  );
  assert.deepEqual(result.usage, { input: 200, output: 20, cachedInput: 128 });
});

test("several tool calls in one step run sequentially in the model's order", async () => {
  const model = fakeModel([
    {
      calls: [
        { id: "a", name: "save_lead", args: '{"name":"Sara","email":"s@x.com"}' },
        { id: "b", name: "create_consultation_request", args: '{"service":"whitening","preferred_datetime":"2026-10-20T15:00"}' },
      ],
    },
    { text: "Done." },
  ]);
  const outputs = {
    save_lead: { ok: true as const, saved: true, details: { name: "Sara" } },
    create_consultation_request: { ok: true as const, request_id: "r1", status: "pending", service: "whitening", preferred_time: "Tue 3 PM", already_requested: false },
  };
  const tools = fakeTools(outputs);
  const events: TurnEvent[] = [];
  const result = await runAgentTurn(baseInput(events), { complete: model.complete, executeTool: tools.executeTool });

  assert.deepEqual(tools.ran.map((r) => r.name), ["save_lead", "create_consultation_request"]);
  assert.deepEqual(result.actions.map((a) => a.kind), ["lead_saved", "consultation_requested"]);
  assert.equal(events.filter((e) => e.type === "action").length, 2);
  // What the tools returned is the evidence the answer's figures are checked against (PR-16).
  assert.deepEqual(result.evidence, [JSON.stringify(outputs.save_lead), JSON.stringify(outputs.create_consultation_request)]);
});

test("saving the same details twice in one turn gives one action", async () => {
  const model = fakeModel([
    { calls: [{ id: "a", name: "save_lead", args: '{"name":"Sara","email":"s@x.com"}' }] },
    { calls: [{ id: "b", name: "save_lead", args: '{"name":"Sara","email":"s@x.com"}' }] },
    { text: "Saved." },
  ]);
  const tools = fakeTools({ save_lead: { ok: true, saved: true, details: { name: "Sara", email: "s@x.com" } } });
  const events: TurnEvent[] = [];
  const result = await runAgentTurn(baseInput(events), { complete: model.complete, executeTool: tools.executeTool });

  assert.equal(tools.ran.length, 2, "both calls still run");
  assert.equal(result.actions.length, 1);
  assert.equal(events.filter((e) => e.type === "action").length, 1);
});

test("an outage on a write tool becomes a failed-action card; invalid input does not", async () => {
  const model = fakeModel([
    { calls: [{ id: "a", name: "save_lead", args: "{}" }] },
    { calls: [{ id: "b", name: "save_lead", args: "{}" }] },
    { text: "Sorry." },
  ]);
  let n = 0;
  const executeTool: AgentDeps["executeTool"] = async (name) => {
    n++;
    const output =
      n === 1
        ? { ok: false as const, error: "invalid_input", message: "bad email" }
        : { ok: false as const, error: "temporarily_unavailable", message: "down" };
    return { name, ok: false, output, sources: [] };
  };
  const result = await runAgentTurn(baseInput([]), { complete: model.complete, executeTool });
  assert.deepEqual(result.actions, [{ kind: "action_failed", tool: "save_lead", message: "This couldn't be saved just now." }]);
});

test(`after ${MAX_TOOL_ROUNDS} tool rounds the model must answer: tools are switched off`, async () => {
  const model = fakeModel([{ calls: [{ id: "x", name: "search_knowledge", args: '{"query":"again"}' }] }]);
  const tools = fakeTools({ search_knowledge: { ok: true, found: false } });
  const result = await runAgentTurn(baseInput([]), { complete: model.complete, executeTool: tools.executeTool });

  assert.equal(model.calls.length, MAX_TOOL_ROUNDS + 1);
  assert.deepEqual(model.calls.map((c) => c.tool_choice), [...Array(MAX_TOOL_ROUNDS).fill("auto"), "none"]);
  assert.equal(tools.ran.length, MAX_TOOL_ROUNDS, "calls returned by the tools-off round are never executed");
  assert.equal(result.rounds, MAX_TOOL_ROUNDS + 1);
});

test("text from a tool round and the final answer are joined as paragraphs", async () => {
  const events: TurnEvent[] = [];
  const model = fakeModel([
    { text: "Let me check.", calls: [{ id: "a", name: "search_knowledge", args: '{"query":"hours"}' }] },
    { text: "We're open until 5 PM." },
  ]);
  const result = await runAgentTurn(baseInput(events), { complete: model.complete, executeTool: fakeTools({}).executeTool });
  assert.equal(result.text, "Let me check.\n\nWe're open until 5 PM.");
  assert.equal(events.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text).join(""), result.text);
});

test("an empty reply is replaced by a fallback, never an empty message", async () => {
  const events: TurnEvent[] = [];
  const model = fakeModel([{ text: "" }]);
  const result = await runAgentTurn(baseInput(events), { complete: model.complete, executeTool: fakeTools({}).executeTool });
  assert.equal(result.text, EMPTY_REPLY);
  assert.deepEqual(events, [{ type: "delta", text: EMPTY_REPLY }]);
});

test("a hanging model call is cut off by the turn deadline", async () => {
  const model = fakeModel([{ hang: true }]);
  const started = Date.now();
  await assert.rejects(
    runAgentTurn(baseInput([], { deadlineMs: 50 }), { complete: model.complete, executeTool: fakeTools({}).executeTool }),
    (err: unknown) => err instanceof TurnDeadlineError,
  );
  assert.ok(Date.now() - started < 1000);
});

test("a tool is not started when its timeout no longer fits in the turn budget", async () => {
  const model = fakeModel([{ calls: [{ id: "a", name: "save_lead", args: "{}" }] }]);
  const tools = fakeTools({});
  // 10 s budget < 15 s tool timeout: starting the tool could overrun the deadline.
  await assert.rejects(
    runAgentTurn(baseInput([], { deadlineMs: 10_000 }), { complete: model.complete, executeTool: tools.executeTool }),
    (err: unknown) => err instanceof TurnDeadlineError,
  );
  assert.equal(tools.ran.length, 0);
});
