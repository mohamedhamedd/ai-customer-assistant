import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { ANSWER_WINDOW_MS } from "./confirm";
import { executeTool, OUTCOME_UNKNOWN, type AuditRow, type ExecuteDeps, type Proposals, UNAVAILABLE } from "./execute";
import {
  consultationSchema,
  resolvePreferredTime,
  saveLeadSchema,
  searchKnowledgeSchema,
  TOOLS,
  toolDefinitions,
  type Tool,
  type ToolContext,
} from "./tools";

const LA = "America/Los_Angeles";
const NOW = new Date("2026-10-11T23:30:00Z"); // Sun Oct 11, 4:30 PM PDT

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test("save_lead: normalises valid input", () => {
  const r = saveLeadSchema.safeParse({ name: "  Sara   Ali ", email: " Sara@Example.COM ", phone: "(503) 555-0142", interest: "" });
  assert.ok(r.success);
  assert.deepEqual(r.data, { name: "Sara Ali", email: "sara@example.com", phone: "5035550142", interest: undefined });
  const intl = saveLeadSchema.safeParse({ name: "Ali", phone: "+44 20 7946 0958" });
  assert.ok(intl.success && intl.data.phone === "+442079460958");
});

test("save_lead: rejects bad email, bad phone, missing contact and missing name, with relayable messages", () => {
  const cases: Array<[unknown, RegExp]> = [
    [{ name: "Sara", email: "sara@gmail" }, /email.*doesn't look valid/],
    [{ name: "Sara", phone: "12ab" }, /phone.*doesn't look valid/],
    [{ name: "Sara", phone: "123" }, /phone.*doesn't look valid/],
    [{ name: "Sara" }, /email or a phone number is required/],
    [{ name: "Sara", email: null, phone: "" }, /email or a phone number is required/],
    [{ name: "   ", email: "s@x.com" }, /name is required/],
    [{ email: "s@x.com" }, /name/],
  ];
  for (const [input, expected] of cases) {
    const r = saveLeadSchema.safeParse(input);
    assert.equal(r.success, false, JSON.stringify(input));
    if (!r.success) assert.match(r.error.issues.map((i) => i.message).join("; "), expected, JSON.stringify(input));
  }
});

test("search_knowledge and consultation schemas", () => {
  assert.equal(searchKnowledgeSchema.safeParse({ query: "x" }).success, false);
  assert.equal(searchKnowledgeSchema.safeParse({ query: "whitening price" }).success, true);
  assert.equal(consultationSchema.safeParse({ service: "whitening", preferred_datetime: "2026-10-20T15:00" }).success, true);
  assert.equal(consultationSchema.safeParse({ preferred_datetime: "2026-10-20T15:00" }).success, false);
});

test("preferred time: future, within 6 months, valid local format", () => {
  const ok = resolvePreferredTime("2026-10-20T15:00", LA, NOW);
  assert.ok(ok.ok && ok.at.toISOString() === "2026-10-20T22:00:00.000Z");

  const past = resolvePreferredTime("2026-10-11T09:00", LA, NOW);
  assert.ok(!past.ok && /in the past/.test(past.message));
  const far = resolvePreferredTime("2027-06-01T10:00", LA, NOW);
  assert.ok(!far.ok && /more than 6 months/.test(far.message));
  const fmt = resolvePreferredTime("Tuesday 3pm", LA, NOW);
  assert.ok(!fmt.ok && /YYYY-MM-DDTHH:mm/.test(fmt.message));
  const gap = resolvePreferredTime("2027-03-14T02:30", LA, new Date("2027-03-01T00:00:00Z"));
  assert.ok(!gap.ok && /does not exist/.test(gap.message));
});

test("tool definitions match the validation schemas (no drift)", () => {
  for (const def of toolDefinitions()) {
    const schema = TOOLS[def.name].schema as z.ZodObject;
    const props = Object.keys((def.parameters as { properties: object }).properties).sort();
    assert.deepEqual(props, Object.keys(schema.shape).sort(), def.name);
  }
  assert.deepEqual(toolDefinitions().map((d) => d.name).sort(), ["create_consultation_request", "save_lead", "search_knowledge"]);
});

// ---------------------------------------------------------------------------
// Executor: never throws, always audits
// ---------------------------------------------------------------------------

const ctx: ToolContext = { businessId: "b", conversationId: "c", channel: "text", timeZone: LA, now: () => NOW };

const t = (ms: number) => new Date(NOW.getTime() + ms);

// These arguments were proposed, read back, and the customer answered.
const proposed =
  (args: object): ExecuteDeps["proposals"] =>
  async () => ({ latest: { arguments: args, at: t(1) }, readBack: { at: t(2), delivered: true }, answerAt: t(3) });
const NO_PROPOSAL: Proposals = { latest: null, readBack: null, answerAt: null };

// Executor deps for tests: no console output, no simulated outage unless
// asked, and no proposals (the confirm-before-write tests are below).
const quiet = {
  log: () => {},
  trace: () => {},
  simulateDbFailure: () => false,
  proposals: async () => NO_PROPOSAL,
};

function harness(run: Tool["run"], schema: z.ZodType = z.object({ x: z.number() }), writes = false) {
  const audits: AuditRow[] = [];
  const logs: string[] = [];
  const traces: Record<string, unknown>[] = [];
  const tool: Tool = { name: "probe", description: "", parameters: {}, writes, schema, run };
  return {
    audits,
    logs,
    traces,
    exec: (args: string, extra: { audit?: (r: AuditRow) => Promise<void>; timeoutMs?: number; simulateDbFailure?: boolean } = {}) =>
      executeTool("probe", args, ctx, {
        tools: { probe: tool },
        audit: extra.audit ?? (async (r) => void audits.push(r)),
        log: (m) => void logs.push(m),
        trace: (f) => void traces.push(f),
        timeoutMs: extra.timeoutMs ?? 1000,
        simulateDbFailure: () => extra.simulateDbFailure ?? false,
      }),
  };
}

test("success: the tool's output and sources are returned and audited", async () => {
  const h = harness(async () => ({ output: { ok: true, value: 1 }, sources: [{ documentId: "d", title: "T", heading: "H", excerpt: "e", similarity: 0.5 }] }));
  const out = await h.exec('{"x": 1}');
  assert.deepEqual(out.output, { ok: true, value: 1 });
  assert.equal(out.sources.length, 1);
  assert.equal(h.audits.length, 1);
  assert.equal(h.audits[0].ok, true);
  assert.deepEqual(h.audits[0].arguments, { x: 1 });
});

test("invalid input never reaches the tool; the reason is returned and audited", async () => {
  let ran = false;
  const h = harness(async () => ((ran = true), { output: { ok: true } }));
  const out = await h.exec('{"x": "one"}');
  assert.equal(ran, false);
  assert.equal(out.ok, false);
  assert.ok(!out.output.ok && out.output.error === "invalid_input" && /x:/.test(out.output.message));
  assert.equal(h.audits[0].ok, false);
});

test("unparseable JSON and unknown tool names are reported, not thrown", async () => {
  const h = harness(async () => ({ output: { ok: true } }));
  const bad = await h.exec("{not json");
  assert.ok(!bad.output.ok && bad.output.error === "invalid_input");
  assert.deepEqual(h.audits[0].arguments, { _unparseable: "{not json" });

  const unknown = await executeTool("nope", "{}", ctx, { ...quiet, tools: {}, audit: async () => {} });
  assert.ok(!unknown.output.ok && unknown.output.error === "unknown_tool");
});

test("a tool that throws (e.g. database down) becomes temporarily_unavailable, never a success", async () => {
  const h = harness(async () => {
    throw new Error("connection refused");
  });
  const out = await h.exec('{"x": 1}');
  assert.deepEqual(out.output, UNAVAILABLE);
  assert.equal(h.audits[0].ok, false);
  assert.match(h.logs[0], /probe failed/);
});

test("a read tool that hangs is cut off by the timeout and reported unavailable", async () => {
  const h = harness(() => new Promise(() => {}));
  const started = Date.now();
  const out = await h.exec('{"x": 1}', { timeoutMs: 50 });
  assert.ok(Date.now() - started < 1000);
  assert.deepEqual(out.output, UNAVAILABLE);
});

test("a WRITE tool that times out is reported as outcome unknown, not failed (it may still commit)", async () => {
  const h = harness(() => new Promise(() => {}), undefined, true);
  const out = await h.exec('{"x": 1}', { timeoutMs: 50 });
  assert.deepEqual(out.output, OUTCOME_UNKNOWN);
  assert.equal(h.audits[0].ok, false);
});

test("a write tool that errors (not a timeout) is still reported unavailable: the transaction rolled back", async () => {
  const h = harness(async () => {
    throw new Error("permission denied");
  }, undefined, true);
  const out = await h.exec('{"x": 1}');
  assert.deepEqual(out.output, UNAVAILABLE);
});

test("an audit failure is logged but does not change the result", async () => {
  const h = harness(async () => ({ output: { ok: true } }));
  const out = await h.exec('{"x": 1}', { audit: async () => Promise.reject(new Error("db down")) });
  assert.equal(out.ok, true);
  assert.match(h.logs[0], /audit write failed/);
});

// ---------------------------------------------------------------------------
// Rule R1: results never contain stored data
// ---------------------------------------------------------------------------

// A stub client whose RPCs return rows full of STORED values that differ from
// what the customer typed. None of them may appear in the model's output.
const STORED = ["STORED NAME", "stored@example.com", "9999999999", "stored interest"];
function stubClient(data: unknown) {
  return { rpc: async () => ({ data, error: null }) } as unknown as NonNullable<ToolContext["client"]>;
}

test("R1: save_lead echoes only what the customer gave, even if the database returns a stored lead", async () => {
  const client = stubClient({ lead_id: "L1", created: false, name: STORED[0], email: STORED[1], phone: STORED[2], interest: STORED[3] });
  const args = { name: "Sara Ali", email: "sara@x.com" };
  const out = await executeTool("save_lead", JSON.stringify(args), { ...ctx, client }, { ...quiet, proposals: proposed(args), audit: async () => {} });
  assert.equal(out.ok, true);
  const text = JSON.stringify(out.output);
  for (const s of STORED) assert.ok(!text.includes(s), `leaked ${s}`);
  assert.ok(text.includes("sara@x.com"));
});

test("R1: create_consultation_request does not return the stored contact snapshot", async () => {
  const client = stubClient({ request_id: "R1", status: "pending", created: true, contact_name: STORED[0], contact_email: STORED[1], contact_phone: STORED[2] });
  const args = { service: "teeth whitening", preferred_datetime: "2026-10-20T15:00" };
  const out = await executeTool("create_consultation_request", JSON.stringify(args), { ...ctx, client }, { ...quiet, proposals: proposed(args), audit: async () => {} });
  assert.equal(out.ok, true);
  const text = JSON.stringify(out.output);
  for (const s of STORED) assert.ok(!text.includes(s), `leaked ${s}`);
});

test("SIMULATE_DB_FAILURE: a write tool fails like a real outage, a read tool still works", async () => {
  let ran = false;
  const write = harness(async () => ((ran = true), { output: { ok: true } }), z.object({ x: z.number() }), true);
  const out = await write.exec('{"x": 1}', { simulateDbFailure: true });
  assert.equal(ran, false, "the database is never touched");
  assert.equal(out.output.ok, false);
  assert.equal((out.output as { error: string }).error, "temporarily_unavailable", "the same answer as a real outage");
  assert.equal(write.audits[0].ok, false, "audited as a failure");

  const read = harness(async () => ({ output: { ok: true } }));
  assert.equal((await read.exec('{"x": 1}', { simulateDbFailure: true })).output.ok, true);
});

test("every call leaves one structured log line, without the arguments", async () => {
  const h = harness(async () => ({ output: { ok: false, error: "invalid_input", message: "bad email" } }));
  await h.exec('{"x": 1}');
  assert.equal(h.traces.length, 1);
  assert.deepEqual(Object.keys(h.traces[0]).sort(), ["channel", "conversationId", "error", "ms", "ok", "tool"]);
  assert.equal(h.traces[0].error, "invalid_input");
});

// ---------------------------------------------------------------------------
// Confirm before write (confirm.ts): propose, then commit
// ---------------------------------------------------------------------------

// A conversation in memory, kept like the database keeps it: every call is
// audited (a confirm_first call is the proposal), and messages are stamped on
// the same clock. proposals() reads them like execute.ts reads the tables.
function conversation(opts: { auditFails?: boolean } = {}) {
  let clock = 0;
  const tick = (ms = 1) => t((clock += ms));
  const audits: (AuditRow & { at: Date })[] = [];
  const messages: { role: "user" | "assistant"; at: Date; delivered: boolean }[] = [];
  const rpcs: string[] = [];
  const client = { rpc: async (fn: string) => (rpcs.push(fn), { data: { request_id: "R1", status: "pending", created: true }, error: null }) } as unknown as NonNullable<ToolContext["client"]>;
  const deps: Partial<ExecuteDeps> = {
    ...quiet,
    audit: async (row) => {
      if (opts.auditFails) throw new Error("tool_calls insert failed");
      audits.push({ ...row, at: tick() });
    },
    proposals: async (_ctx, tool) => {
      const latest = audits.findLast((a) => a.name === tool && !a.result.ok && a.result.error === "confirm_first");
      if (!latest) return NO_PROPOSAL;
      const readBack = messages.find((m) => m.role === "assistant" && m.at > latest.at);
      const answer = readBack && messages.find((m) => m.role === "user" && m.at > readBack.at);
      return { latest: { arguments: latest.arguments, at: latest.at }, readBack: readBack ?? null, answerAt: answer?.at ?? null };
    },
  };
  return {
    rpcs,
    customerSays: (afterMs = 1) => void messages.push({ role: "user", at: tick(afterMs), delivered: true }),
    // delivered: false is a read-back an answer check replaced.
    assistantSays: (delivered = true) => void messages.push({ role: "assistant", at: tick(), delivered }),
    call: async (name: string, args: object) => (await executeTool(name, JSON.stringify(args), { ...ctx, client }, deps)).output,
  };
}

const JOHN_DOE = { name: "John Doe", phone: "555-1234", interest: "booking Friday 3 pm" };
const CONFIRM_FIRST_MESSAGE =
  "Nothing is saved yet. Read the details back to the customer and ask them to confirm before saving. When they say yes, call this tool again with the same details.";

// The usual exchange: details, proposal, read-back, the customer's answer.
async function proposeAndAnswer(c: ReturnType<typeof conversation>, name = "save_lead", args: object = JOHN_DOE) {
  c.customerSays();
  await c.call(name, args);
  c.assistantSays();
  c.customerSays();
}

test("the PR-16 case: a save in the same reply the details were given only proposes them; nothing is written", async () => {
  const c = conversation();
  c.customerSays(); // "Save this booking for my friend John Doe on Friday at 3 pm, his phone is 555-1234"
  const out = await c.call("save_lead", JOHN_DOE);
  assert.deepEqual(out, {
    ok: false,
    error: "confirm_first",
    message: CONFIRM_FIRST_MESSAGE,
    // What would be saved, normalised, for the read-back.
    details: { name: "John Doe", phone: "5551234", interest: "booking Friday 3 pm" },
  });
  assert.deepEqual(await c.call("save_lead", JOHN_DOE), out, "calling again in the same reply: still only a proposal");
  assert.deepEqual(c.rpcs, []);
});

test("after the read-back, the customer's answer lets the same details commit", async () => {
  const c = conversation();
  await proposeAndAnswer(c); // ... "Just to confirm: John Doe, 555-1234?" / "Yes, that's right"
  assert.equal((await c.call("save_lead", JOHN_DOE)).ok, true);
  assert.deepEqual(c.rpcs, ["save_lead"]);
});

test("no read-back reached the customer: the proposing turn failed, or an answer check replaced the read-back", async () => {
  const failed = conversation();
  failed.customerSays();
  await failed.call("save_lead", JOHN_DOE); // then the turn fails: no reply is stored
  failed.customerSays(); // "hello?"
  assert.equal((await failed.call("save_lead", JOHN_DOE)).ok, false);

  const replaced = conversation();
  replaced.customerSays();
  await replaced.call("save_lead", JOHN_DOE);
  replaced.assistantSays(false); // the customer saw a safe reply instead
  replaced.customerSays();
  assert.equal((await replaced.call("save_lead", JOHN_DOE)).ok, false);
  assert.deepEqual([...failed.rpcs, ...replaced.rpcs], []);
});

test("an answer long after the read-back doesn't confirm it", async () => {
  const c = conversation();
  c.customerSays();
  await c.call("save_lead", JOHN_DOE);
  c.assistantSays();
  c.customerSays(ANSWER_WINDOW_MS + 60_000); // back the next week: "hi"
  assert.equal((await c.call("save_lead", JOHN_DOE)).ok, false);
  assert.deepEqual(c.rpcs, []);
});

test("a correction is a new proposal: it is read back again, and only it can commit", async () => {
  const corrected = { ...JOHN_DOE, phone: "555-1243" };
  const corrects = async () => {
    const c = conversation();
    await proposeAndAnswer(c); // "No, it's 555-1243"
    const out = await c.call("save_lead", corrected);
    assert.ok(!out.ok && out.error === "confirm_first" && out.details?.phone === "5551243");
    c.assistantSays();
    c.customerSays(); // "Yes"
    return c;
  };
  const right = await corrects();
  assert.equal((await right.call("save_lead", corrected)).ok, true);
  assert.deepEqual(right.rpcs, ["save_lead"]);

  const wrong = await corrects();
  assert.equal((await wrong.call("save_lead", JOHN_DOE)).ok, false, "the old details are no longer what was read back");
  assert.deepEqual(wrong.rpcs, []);
});

test("only the details that identify the write must match; free text may be worded differently", async () => {
  const c = conversation();
  c.customerSays();
  await c.call("save_lead", JOHN_DOE);
  await c.call("create_consultation_request", { service: "teeth whitening", preferred_datetime: "2026-10-20T15:00" });
  c.assistantSays();
  c.customerSays();
  assert.equal((await c.call("save_lead", { name: "john doe", phone: "(555) 1234", interest: "a cleaning" })).ok, true);
  const request = await c.call("create_consultation_request", { service: "teeth whitening consultation", preferred_datetime: "2026-10-20T15:00" });
  assert.equal(request.ok, true);
  const otherTime = await c.call("create_consultation_request", { service: "teeth whitening", preferred_datetime: "2026-10-20T16:00" });
  assert.ok(!otherTime.ok && otherTime.error === "confirm_first" && otherTime.details?.preferred_time === "Tuesday, October 20, 2026 at 4:00 PM PDT");
  assert.deepEqual(c.rpcs, ["save_lead", "create_consultation_request"]);
});

test("repeating a committed write later needs no new read-back (the save is idempotent)", async () => {
  const c = conversation();
  await proposeAndAnswer(c);
  await c.call("save_lead", JOHN_DOE);
  c.assistantSays(); // "Saved!"
  c.customerSays(ANSWER_WINDOW_MS + 60_000); // "thanks!", much later
  assert.equal((await c.call("save_lead", JOHN_DOE)).ok, true, "the answer it relies on is still the first one");
  assert.deepEqual(c.rpcs, ["save_lead", "save_lead"]);
});

test("a proposal that couldn't be recorded is reported as an outage, not read back forever", async () => {
  const c = conversation({ auditFails: true });
  c.customerSays();
  assert.deepEqual(await c.call("save_lead", JOHN_DOE), UNAVAILABLE);
  assert.deepEqual(c.rpcs, []);
});

test("invalid arguments skip the proposal: the tool's own error comes first, nothing is written", async () => {
  let loaded = false;
  const { client, rpcs } = writeClient({});
  const deps = { ...quiet, proposals: async () => ((loaded = true), NO_PROPOSAL) };
  const past = await executeTool("create_consultation_request", JSON.stringify({ service: "whitening", preferred_datetime: "2026-10-01T10:00" }), { ...ctx, client }, deps);
  assert.ok(!past.output.ok && past.output.error === "invalid_input" && /in the past/.test(past.output.message));
  const badEmail = await executeTool("save_lead", JSON.stringify({ name: "Sara", email: "sara@" }), { ...ctx, client }, deps);
  assert.ok(!badEmail.output.ok && badEmail.output.error === "invalid_input");
  assert.equal(loaded, false);
  assert.deepEqual(rpcs, []);
});

// A client that records whether a write RPC ran.
function writeClient(data: unknown) {
  const rpcs: string[] = [];
  const client = { rpc: async (fn: string) => (rpcs.push(fn), { data, error: null }) } as unknown as NonNullable<ToolContext["client"]>;
  return { client, rpcs };
}

const slow = <T>(ms: number, value: T) => new Promise<T>((r) => setTimeout(() => r(value), ms));

test("the check failing or hanging is an outage, never a success; a late answer never writes", async () => {
  const { client, rpcs } = writeClient({ lead_id: "L1", created: true });
  const args = { name: "Sara", email: "sara@example.com" };
  const failed = await executeTool("save_lead", JSON.stringify(args), { ...ctx, client }, { ...quiet, proposals: () => Promise.reject(new Error("db down")) });
  assert.deepEqual(failed.output, UNAVAILABLE);

  // The check answers "confirmed" only after the timeout already reported the outage.
  const late = await executeTool("save_lead", JSON.stringify(args), { ...ctx, client }, { ...quiet, timeoutMs: 30, proposals: async (c, n) => slow(80, await proposed(args)(c, n)) });
  assert.deepEqual(late.output, UNAVAILABLE, "nothing was written, so the outcome is known");
  await slow(120, null);
  assert.deepEqual(rpcs, [], "and nothing is written afterwards either");
});

test("the check and the write share one timeout: a write tool never takes longer than timeoutMs", async () => {
  const tool: Tool = {
    name: "probe",
    description: "",
    parameters: {},
    writes: true,
    schema: z.object({ x: z.number() }),
    confirm: { propose: () => ({ key: "k", details: {} }) },
    run: () => slow(120, { output: { ok: true } }),
  };
  // Each step fits the timeout on its own; together they don't.
  const out = await executeTool("probe", '{"x": 1}', ctx, {
    ...quiet,
    tools: { probe: tool },
    audit: async () => {},
    timeoutMs: 200,
    proposals: async (c, n) => slow(120, await proposed({ x: 1 })(c, n)),
  });
  assert.deepEqual(out.output, OUTCOME_UNKNOWN, "it timed out while writing");
});

test("tools without a confirmation spec (search, read tools) are never gated", async () => {
  let loaded = false;
  const out = await executeTool("probe", '{"x": 1}', ctx, {
    tools: { probe: { name: "probe", description: "", parameters: {}, writes: false, schema: z.object({ x: z.number() }), run: async () => ({ output: { ok: true } }) } },
    ...quiet,
    audit: async () => {},
    proposals: async () => ((loaded = true), NO_PROPOSAL),
  });
  assert.equal(loaded, false);
  assert.equal(out.output.ok, true);
  assert.ok(TOOLS.save_lead.confirm && TOOLS.create_consultation_request.confirm && !TOOLS.search_knowledge.confirm, "both write tools are gated");
});
