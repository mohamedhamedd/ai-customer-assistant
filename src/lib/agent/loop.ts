// The agent loop (design D-01): a hand-written tool-calling loop over the
// Chat Completions API. One turn = one customer message:
//
//   model -> (tool calls -> run tools -> results back to the model)* -> reply
//
// Kept free of I/O decisions: the model call and the tool executor are
// injected, so the loop is unit-tested with a scripted fake model.
import type {
  ChatCompletionChunk,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import type { Source } from "@/lib/rag/retrieve";
import { TOOL_TIMEOUT_MS, type ToolOutcome } from "./execute";
import type { ToolContext, ToolDefinition } from "./tools";

// Tool rounds per customer message (US-11.4). After this many, the model
// gets one more call with tools disabled, so it must answer with what it has.
export const MAX_TOOL_ROUNDS = 5;

// Whole-turn budget (design §7.1): every model call and tool call included.
// Shorter than the 60 s retry window, so a retry after 60 s can safely assume
// the original turn is dead.
export const TURN_DEADLINE_MS = 45_000;

export type Action =
  | { kind: "lead_saved"; details: Record<string, unknown> }
  | {
      kind: "consultation_requested";
      requestId: string;
      service: string;
      preferredTime: string;
      status: string;
      alreadyRequested: boolean;
      // A change to a request already made: what it was.
      changedFrom?: { service: string; preferredTime: string };
      // The customer cancelled it.
      cancelled?: boolean;
    }
  | { kind: "follow_up_requested"; reason: string; updated: boolean }
  | { kind: "action_failed"; tool: string; message: string };

export type TurnEvent =
  | { type: "delta"; text: string }
  | { type: "tool"; name: string; status: "started" }
  | { type: "tool"; name: string; status: "finished"; ok: boolean }
  | { type: "action"; action: Action };

export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface TurnInput {
  model: string;
  system: string;
  history: HistoryMessage[];
  userText: string;
  tools: ToolDefinition[];
  toolCtx: ToolContext;
  emit: (event: TurnEvent) => void;
  deadlineMs?: number;
}

export interface TurnResult {
  text: string;
  sources: Source[];
  actions: Action[];
  toolCalls: { name: string; ok: boolean }[];
  // What the tools returned, as the model saw it: the evidence the answer's
  // figures are checked against (answer-check.ts).
  evidence: string[];
  rounds: number;
  usage: { input: number; output: number; cachedInput: number };
}

export interface AgentDeps {
  complete(params: ChatCompletionCreateParamsStreaming, signal: AbortSignal): Promise<AsyncIterable<ChatCompletionChunk>>;
  executeTool(name: string, rawArgs: string, ctx: ToolContext): Promise<ToolOutcome>;
}

export class TurnDeadlineError extends Error {
  constructor() {
    super("The turn exceeded its time budget.");
    this.name = "TurnDeadlineError";
  }
}

export const EMPTY_REPLY = "Sorry, I couldn't put an answer together. Could you rephrase that?";

export async function runAgentTurn(input: TurnInput, deps: AgentDeps): Promise<TurnResult> {
  const budget = input.deadlineMs ?? TURN_DEADLINE_MS;
  const deadlineAt = Date.now() + budget;
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new TurnDeadlineError()), budget);

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: input.system },
    ...input.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: input.userText },
  ];
  const tools: ChatCompletionTool[] = input.tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

  const texts: string[] = [];
  const sources: Source[] = [];
  const actions: Action[] = [];
  const toolCalls: TurnResult["toolCalls"] = [];
  const evidence: string[] = [];
  const usage = { input: 0, output: 0, cachedInput: 0 };
  let rounds = 0;

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      rounds = round + 1;
      const step = await streamStep(
        deps,
        {
          model: input.model,
          messages,
          tools,
          tool_choice: round < MAX_TOOL_ROUNDS ? "auto" : "none",
          temperature: 0.3,
          max_completion_tokens: 800,
          stream: true,
          stream_options: { include_usage: true },
        },
        deadline.signal,
        // A new round's text starts as a new paragraph.
        (text, first) => input.emit({ type: "delta", text: first && texts.length > 0 ? `\n\n${text}` : text }),
        usage,
      );
      if (step.content) texts.push(step.content);
      // The last round runs with tools switched off; never execute calls from it.
      if (step.toolCalls.length === 0 || round === MAX_TOOL_ROUNDS) break;

      messages.push({ role: "assistant", content: step.content || null, tool_calls: step.toolCalls });
      // Sequential, in the model's order: a save_lead must land before the
      // create_consultation_request that depends on it.
      for (const call of step.toolCalls) {
        // A tool can't be cancelled once started, so only start one whose full
        // timeout fits in the remaining budget: the turn really ends by its deadline.
        if (deadline.signal.aborted || deadlineAt - Date.now() < TOOL_TIMEOUT_MS) throw new TurnDeadlineError();
        input.emit({ type: "tool", name: call.function.name, status: "started" });
        const outcome = await deps.executeTool(call.function.name, call.function.arguments, input.toolCtx);
        input.emit({ type: "tool", name: call.function.name, status: "finished", ok: outcome.ok });
        toolCalls.push({ name: call.function.name, ok: outcome.ok });
        sources.push(...outcome.sources);
        const action = toAction(outcome);
        if (action && !repeatsAction(actions, action)) {
          actions.push(action);
          input.emit({ type: "action", action });
        }
        const output = JSON.stringify(outcome.output);
        evidence.push(output);
        messages.push({ role: "tool", tool_call_id: call.id, content: output });
      }
    }
  } catch (err) {
    if (deadline.signal.aborted) throw deadline.signal.reason;
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const text = texts.join("\n\n").trim();
  if (!text) input.emit({ type: "delta", text: EMPTY_REPLY });
  return { text: text || EMPTY_REPLY, sources: dedupeSources(sources), actions, toolCalls, evidence, rounds, usage };
}

interface StepResult {
  content: string;
  toolCalls: ChatCompletionMessageFunctionToolCall[];
}

// One streamed model call. Text deltas go to the customer as they arrive;
// tool calls arrive as fragments (id and name once, arguments in pieces) and
// are reassembled by index.
async function streamStep(
  deps: AgentDeps,
  params: ChatCompletionCreateParamsStreaming,
  signal: AbortSignal,
  onText: (text: string, first: boolean) => void,
  usage: TurnResult["usage"],
): Promise<StepResult> {
  let content = "";
  const calls = new Map<number, { id: string; name: string; args: string }>();

  for await (const chunk of await deps.complete(params, signal)) {
    if (chunk.usage) {
      usage.input += chunk.usage.prompt_tokens;
      usage.output += chunk.usage.completion_tokens;
      usage.cachedInput += chunk.usage.prompt_tokens_details?.cached_tokens ?? 0;
    }
    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;
    if (delta.content) {
      onText(delta.content, content.length === 0);
      content += delta.content;
    }
    for (const tc of delta.tool_calls ?? []) {
      const call = calls.get(tc.index) ?? { id: "", name: "", args: "" };
      if (tc.id) call.id = tc.id;
      if (tc.function?.name) call.name += tc.function.name;
      if (tc.function?.arguments) call.args += tc.function.arguments;
      calls.set(tc.index, call);
    }
  }

  const toolCalls = [...calls.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, c]) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: c.args } }));
  return { content, toolCalls };
}

// The model sometimes calls save_lead again with the same details. The save
// is harmless (it matches the same lead), but a second "details saved"
// action would be stored, shown and audited as if something new happened.
export function repeatsAction(actions: Action[], action: Action): boolean {
  if (action.kind !== "lead_saved") return false;
  const details = JSON.stringify(action.details);
  return actions.some((a) => a.kind === "lead_saved" && JSON.stringify(a.details) === details);
}

// Cards shown in the thread come from tool results, never from model text.
const WRITE_TOOLS = ["save_lead", "create_consultation_request", "change_consultation_request", "cancel_consultation_request", "request_follow_up"];

export function toAction(outcome: Pick<ToolOutcome, "name" | "output">): Action | null {
  const o = outcome.output as Record<string, unknown>;
  if (outcome.name === "save_lead" && o.ok) {
    return { kind: "lead_saved", details: (o.details as Record<string, unknown>) ?? {} };
  }
  if (outcome.name === "create_consultation_request" && o.ok) {
    return {
      kind: "consultation_requested",
      requestId: String(o.request_id),
      service: String(o.service),
      preferredTime: String(o.preferred_time),
      status: String(o.status),
      alreadyRequested: Boolean(o.already_requested),
    };
  }
  if (outcome.name === "change_consultation_request" && o.ok) {
    const from = o.changed_from as { service?: unknown; preferred_time?: unknown } | undefined;
    return {
      kind: "consultation_requested",
      requestId: String(o.request_id),
      service: String(o.service),
      preferredTime: String(o.preferred_time),
      status: String(o.status),
      alreadyRequested: Boolean(o.already_changed),
      changedFrom: { service: String(from?.service ?? o.service), preferredTime: String(from?.preferred_time ?? "") },
    };
  }
  if (outcome.name === "cancel_consultation_request" && o.ok) {
    return {
      kind: "consultation_requested",
      requestId: String(o.request_id ?? ""),
      service: String(o.service),
      preferredTime: String(o.preferred_time),
      status: "cancelled",
      alreadyRequested: Boolean(o.already_cancelled),
      cancelled: true,
    };
  }
  if (outcome.name === "request_follow_up" && o.ok) {
    return { kind: "follow_up_requested", reason: String(o.reason), updated: Boolean(o.updated) };
  }
  // An outage gets a visible card. Invalid input and an unknown outcome are
  // handled in conversation (the model asks again or retries once).
  if (WRITE_TOOLS.includes(outcome.name) && o.error === "temporarily_unavailable") {
    return { kind: "action_failed", tool: outcome.name, message: "This couldn't be saved just now." };
  }
  return null;
}

function dedupeSources(sources: Source[]): Source[] {
  const seen = new Set<string>();
  return sources.filter((s) => {
    const key = `${s.documentId}:${s.heading}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
