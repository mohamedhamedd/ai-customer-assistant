import "server-only";
import type { z } from "zod";
import { db } from "@/lib/db/supabase";
import type { Json } from "@/lib/db/database.types";
import type { Channel } from "@/lib/db/enums";
import { env } from "@/lib/env";
import type { Source } from "@/lib/rag/retrieve";
import { CONFIRM_FIRST, isConfirmed, type LastExchange } from "./confirm";
import { TOOLS, type ConfirmSpec, type SavedLookup, type Tool, type ToolContext, type ToolOutput, type ToolRunResult } from "./tools";

// Runs one tool call from the model. The contract (design D-09): it NEVER
// throws. Every failure becomes { ok: false, error, message } so the model can
// recover (ask for a corrected email, apologise for an outage) and can never
// mistake a failure for success. Every call, successful or not, is written to
// tool_calls (US-9.2).
//
// A write tool also runs only after the customer confirmed it (confirm.ts):
// the last exchange is read from the messages table, the same for text and
// voice, so a model that skips the read-back can't save details the
// customer never said yes to.

// Inside the 45 s turn deadline (design §7.1), with room for the model.
export const TOOL_TIMEOUT_MS = 15_000;

export interface ToolOutcome {
  name: string;
  ok: boolean;
  output: ToolOutput;
  sources: Source[];
}

export interface AuditRow {
  conversation_id: string;
  channel: Channel;
  name: string;
  arguments: unknown;
  result: ToolOutput;
  ok: boolean;
  duration_ms: number;
  // Citations (search_knowledge), so a voice answer can take them from here.
  sources: Source[];
  voice_call_id?: string;
  realtime_call_id?: string;
}

export interface ExecuteDeps {
  tools: Record<string, Tool>;
  audit: (row: AuditRow) => Promise<void>;
  log: (message: string, err?: unknown) => void;
  // One structured line per call (no arguments: they hold customer details,
  // which stay in the tool_calls audit table).
  trace: (fields: Record<string, unknown>) => void;
  timeoutMs: number;
  // SIMULATE_DB_FAILURE: write tools fail as if the database were down.
  simulateDbFailure: () => boolean;
  // What a write tool's confirmation is checked against: the last exchange,
  // and (only for a call that isn't confirmed) what's already saved.
  lastExchange: (ctx: ToolContext) => Promise<LastExchange>;
  saved: (ctx: ToolContext) => SavedLookup;
}

export const UNAVAILABLE: ToolOutput = {
  ok: false,
  error: "temporarily_unavailable",
  message:
    "The system couldn't complete this right now. Tell the customer it didn't go through, and suggest trying again in a moment or contacting the business directly.",
};

// A write that timed out may still commit after we stop waiting (the
// database call can't be cancelled). Both write tools are idempotent, so the
// honest answer is "unknown, safe to retry": a retry returns the existing
// lead or request instead of creating a second one.
export const OUTCOME_UNKNOWN: ToolOutput = {
  ok: false,
  error: "outcome_unknown",
  message:
    "It is not certain whether this went through. Call the tool again once with the same details: if it already succeeded, the result will say so. Do not tell the customer it failed unless the retry also fails.",
};

class ToolTimeout extends Error {}

async function auditToDb(row: AuditRow): Promise<void> {
  const { error } = await db()
    .from("tool_calls")
    .insert({
      ...row,
      arguments: row.arguments as NonNullable<Json>,
      result: row.result as NonNullable<Json>,
      sources: row.sources as unknown as NonNullable<Json>,
    });
  if (error) throw new Error(error.message);
}

// Enough rows to get past a few voice items still waiting for a transcript.
const RECENT_MESSAGES = 10;

// The customer's latest message and the assistant message before it.
async function lastExchangeFromDb(ctx: ToolContext): Promise<LastExchange> {
  const { data, error } = await (ctx.client ?? db())
    .from("messages")
    .select("role, content")
    .eq("conversation_id", ctx.conversationId)
    .order("id", { ascending: false })
    .limit(RECENT_MESSAGES);
  if (error) throw new Error(`Loading the last exchange failed: ${error.message}`);
  return lastExchange(data ?? []);
}

// One small indexed read each, made only when a tool asks.
function savedFromDb(ctx: ToolContext): SavedLookup {
  const client = ctx.client ?? db();
  return {
    async lead() {
      const { data, error } = await client.from("conversations").select("customer_facts, lead_id").eq("id", ctx.conversationId).single();
      if (error) throw new Error(`Loading saved contact failed: ${error.message}`);
      return { facts: (data.customer_facts ?? {}) as Record<string, unknown>, linked: data.lead_id !== null };
    },
    async requestedAt() {
      const { data, error } = await client.from("consultation_requests").select("preferred_at").eq("conversation_id", ctx.conversationId).neq("status", "cancelled");
      if (error) throw new Error(`Loading saved requests failed: ${error.message}`);
      return data.map((r) => new Date(r.preferred_at));
    },
  };
}

// Newest first in. The latest user message is the customer's current one
// (text: stored before the turn runs; voice: reported when spoken). The
// read-back is the last assistant message before it that has words (a voice
// item can be empty).
export function lastExchange(newestFirst: { role: string; content: string | null }[]): LastExchange {
  const at = newestFirst.findIndex((m) => m.role === "user");
  if (at < 0) return { customer: null, readBack: null };
  const readBack = newestFirst.slice(at + 1).find((m) => m.role === "assistant" && m.content);
  return { customer: newestFirst[at].content, readBack: readBack?.content ?? null };
}

const defaultDeps: ExecuteDeps = {
  tools: TOOLS,
  audit: auditToDb,
  log: (message, err) => console.error(`[tools] ${message}`, err ?? ""),
  trace: (fields) => console.log(JSON.stringify({ event: "tool_call", ...fields })),
  timeoutMs: TOOL_TIMEOUT_MS,
  simulateDbFailure: () => env().SIMULATE_DB_FAILURE,
  lastExchange: lastExchangeFromDb,
  saved: savedFromDb,
};

export async function executeTool(name: string, rawArgs: string, ctx: ToolContext, deps: Partial<ExecuteDeps> = {}): Promise<ToolOutcome> {
  const d = { ...defaultDeps, ...deps };
  const started = Date.now();

  let args: unknown;
  let output: ToolOutput;
  let sources: Source[] = [];

  try {
    args = JSON.parse(rawArgs || "{}");
  } catch {
    args = { _unparseable: rawArgs };
  }

  const tool = d.tools[name];
  if (!tool) {
    output = { ok: false, error: "unknown_tool", message: `There is no tool called ${name}.` };
  } else if (args && typeof args === "object" && "_unparseable" in args) {
    output = { ok: false, error: "invalid_input", message: "The tool arguments were not valid JSON." };
  } else {
    const parsed = tool.schema.safeParse(args);
    if (!parsed.success) {
      output = { ok: false, error: "invalid_input", message: describeIssues(parsed.error) };
    } else {
      // Only a write that started can have an unknown outcome.
      let writing = false;
      try {
        // Thrown where a real database error would be, so a simulated
        // outage takes exactly the real path below.
        if (tool.writes && d.simulateDbFailure()) throw new Error("SIMULATE_DB_FAILURE: database unavailable");
        // One timeout for the confirmation check and the tool together: the
        // turn only starts a tool when TOOL_TIMEOUT_MS still fits (loop.ts).
        const result = await withTimeout(
          (async (): Promise<ToolRunResult> => {
            if (tool.confirm && !(await confirmed(tool.confirm, parsed.data, ctx, d))) return { output: CONFIRM_FIRST };
            writing = tool.writes;
            return tool.run(parsed.data, ctx);
          })(),
          d.timeoutMs,
        );
        output = result.output;
        sources = result.sources ?? [];
      } catch (err) {
        d.log(`${name} failed (conversation ${ctx.conversationId})`, err);
        output = err instanceof ToolTimeout && writing ? OUTCOME_UNKNOWN : UNAVAILABLE;
      }
    }
  }

  const outcome: ToolOutcome = { name, ok: output.ok, output, sources };
  d.trace({
    conversationId: ctx.conversationId,
    channel: ctx.channel,
    tool: name,
    ok: output.ok,
    ...(output.ok ? {} : { error: output.error }),
    ms: Date.now() - started,
  });
  try {
    await d.audit({
      conversation_id: ctx.conversationId,
      channel: ctx.channel,
      name,
      arguments: args,
      result: output,
      ok: output.ok,
      duration_ms: Date.now() - started,
      sources,
      voice_call_id: ctx.voiceCallId,
      realtime_call_id: ctx.realtimeCallId,
    });
  } catch (err) {
    // The audit trail must never break the customer's conversation.
    d.log(`audit write failed for ${name}`, err);
  }
  return outcome;
}

async function confirmed(spec: ConfirmSpec<unknown>, args: unknown, ctx: ToolContext, d: ExecuteDeps): Promise<boolean> {
  const details = spec.details(args, ctx);
  // Invalid arguments: run() rejects them without writing.
  if (details === null) return true;
  // The usual case, a yes to a read-back, takes one read; what's already
  // saved is looked up only when the call isn't confirmed.
  if (isConfirmed(details, await d.lastExchange(ctx))) return true;
  return spec.alreadyDone(args, ctx, d.saved(ctx));
}

// "email: this email address doesn't look valid; ...; phone: ..." in words
// the model can relay to the customer.
function describeIssues(error: z.ZodError): string {
  return error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ");
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ToolTimeout(`timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
