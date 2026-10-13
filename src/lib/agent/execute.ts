import "server-only";
import type { z } from "zod";
import { db } from "@/lib/db/supabase";
import type { Json } from "@/lib/db/database.types";
import type { Channel } from "@/lib/db/enums";
import { env } from "@/lib/env";
import type { Source } from "@/lib/rag/retrieve";
import { confirmFirst, isConfirmed } from "./confirm";
import { TOOLS, type Tool, type ToolContext, type ToolOutput, type ToolRunResult } from "./tools";

// Runs one tool call from the model. The contract (design D-09): it NEVER
// throws. Every failure becomes { ok: false, error, message } so the model can
// recover (ask for a corrected email, apologise for an outage) and can never
// mistake a failure for success. Every call, successful or not, is written to
// tool_calls (US-9.2).
//
// A write tool's first call with new details only proposes them; the same
// details commit once the customer has answered (confirm.ts). Same for text
// and voice: the proposal is the call's own tool_calls row.

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
  // What a write tool's confirmation is checked against (confirm.ts).
  proposals: (ctx: ToolContext, tool: string) => Promise<Proposals>;
}

export interface Proposals {
  // This tool's latest proposal in the conversation (a confirm_first call):
  // its arguments as the model sent them, the details it read back, and when.
  latest: { arguments: unknown; details?: unknown; at: Date } | null;
  // What followed it: the read-back and the customer's answer (confirm.ts).
  readBack: { at: Date; delivered: boolean } | null;
  answerAt: Date | null;
}

const NO_PROPOSAL: Proposals = { latest: null, readBack: null, answerAt: null };

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

// Messages after a proposal to look through: the read-back and the answer
// come right after it.
const FOLLOWING = 20;

// The latest proposal, then what followed it. Both tables stamp rows with
// clock_timestamp(), so the times compare across them.
async function proposalsFromDb(ctx: ToolContext, tool: string): Promise<Proposals> {
  const client = ctx.client ?? db();
  const { data: proposal, error } = await client
    .from("tool_calls")
    .select("arguments, result, created_at")
    .eq("conversation_id", ctx.conversationId)
    .eq("name", tool)
    .eq("result->>error", "confirm_first")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Loading the proposal failed: ${error.message}`);
  if (!proposal) return NO_PROPOSAL;

  const { data: after, error: afterError } = await client
    .from("messages")
    .select("role, content, created_at, replaced_reason")
    .eq("conversation_id", ctx.conversationId)
    // The database's own timestamp string: a Date would drop the microseconds.
    .gt("created_at", proposal.created_at)
    .order("id")
    .limit(FOLLOWING);
  if (afterError) throw new Error(`Loading the read-back failed: ${afterError.message}`);
  // A voice item without words yet (still transcribing, or silence) isn't a read-back.
  const readBack = after.find((m) => m.role === "assistant" && m.content);
  const answer = readBack && after.find((m) => m.role === "user" && m.created_at > readBack.created_at);
  return {
    latest: { arguments: proposal.arguments, details: (proposal.result as { details?: unknown }).details, at: new Date(proposal.created_at) },
    readBack: readBack
      ? // An answer the answer check replaced never reached the customer.
        { at: new Date(readBack.created_at), delivered: readBack.replaced_reason === null }
      : null,
    answerAt: answer ? new Date(answer.created_at) : null,
  };
}

const defaultDeps: ExecuteDeps = {
  tools: TOOLS,
  audit: auditToDb,
  log: (message, err) => console.error(`[tools] ${message}`, err ?? ""),
  trace: (fields) => console.log(JSON.stringify({ event: "tool_call", ...fields })),
  timeoutMs: TOOL_TIMEOUT_MS,
  simulateDbFailure: () => env().SIMULATE_DB_FAILURE,
  proposals: proposalsFromDb,
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
      let expired = false;
      try {
        // Thrown where a real database error would be, so a simulated
        // outage takes exactly the real path below.
        if (tool.writes && d.simulateDbFailure()) throw new Error("SIMULATE_DB_FAILURE: database unavailable");
        // One timeout for the confirmation check and the tool together: the
        // turn only starts a tool when TOOL_TIMEOUT_MS still fits (loop.ts).
        const result = await withTimeout(
          (async (): Promise<ToolRunResult> => {
            let args: unknown = parsed.data;
            if (tool.prepare) {
              const prepared = await tool.prepare(args, ctx);
              if ("result" in prepared) return prepared.result;
              args = prepared.args;
            }
            const proposal = tool.confirm?.propose(args, ctx);
            // Null: invalid arguments, which run() rejects without writing.
            if (proposal && !(await confirmed(tool, proposal.key, ctx, d))) return { output: confirmFirst(proposal.details) };
            // A check that finished after the timeout answered must not write.
            if (expired) return { output: UNAVAILABLE };
            writing = tool.writes;
            return tool.run(args, ctx);
          })(),
          d.timeoutMs,
          () => (expired = true),
        );
        output = result.output;
        sources = result.sources ?? [];
      } catch (err) {
        d.log(`${name} failed (conversation ${ctx.conversationId})`, err);
        output = err instanceof ToolTimeout && writing ? OUTCOME_UNKNOWN : UNAVAILABLE;
      }
    }
  }

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
    // Except that a proposal lives in its audit row (confirm.ts): unrecorded,
    // it could never be confirmed, and the customer would be asked forever.
    // Nothing was saved, so it's reported like any write that failed.
    if (!output.ok && output.error === "confirm_first") output = UNAVAILABLE;
  }
  d.trace({
    conversationId: ctx.conversationId,
    channel: ctx.channel,
    tool: name,
    ok: output.ok,
    ...(output.ok ? {} : { error: output.error }),
    ms: Date.now() - started,
  });
  return { name, ok: output.ok, output, sources };
}

// The latest proposal's key comes from its stored arguments, parsed and
// keyed like the new call's, as read back: the details it returned (the
// service by its exact name, from prepare; for a change, the whole new
// state) over what the model sent.
async function confirmed(tool: Tool, key: string, ctx: ToolContext, d: ExecuteDeps): Promise<boolean> {
  const { latest, readBack, answerAt } = await d.proposals(ctx, tool.name);
  const parsed = latest ? tool.schema.safeParse(latest.arguments) : null;
  let proposed = null;
  if (parsed?.success) {
    const args = parsed.data as Record<string, unknown>;
    const details = latest?.details && typeof latest.details === "object" ? (latest.details as Record<string, unknown>) : {};
    proposed = tool.confirm?.propose({ ...args, ...details }, ctx);
  }
  return isConfirmed(key, { proposal: proposed && latest ? { key: proposed.key, at: latest.at } : null, readBack, answerAt });
}

// "email: this email address doesn't look valid; ...; phone: ..." in words
// the model can relay to the customer.
function describeIssues(error: z.ZodError): string {
  return error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ");
}

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout?.();
      reject(new ToolTimeout(`timed out after ${ms} ms`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
