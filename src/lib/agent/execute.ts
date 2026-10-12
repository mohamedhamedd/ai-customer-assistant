import "server-only";
import type { z } from "zod";
import { db } from "@/lib/db/supabase";
import type { Json } from "@/lib/db/database.types";
import type { Channel } from "@/lib/db/enums";
import type { Source } from "@/lib/rag/retrieve";
import { TOOLS, type Tool, type ToolContext, type ToolOutput } from "./tools";

// Runs one tool call from the model. The contract (design D-09): it NEVER
// throws. Every failure becomes { ok: false, error, message } so the model can
// recover (ask for a corrected email, apologise for an outage) and can never
// mistake a failure for success. Every call, successful or not, is written to
// tool_calls (US-9.2).

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
  timeoutMs: number;
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

const defaultDeps: ExecuteDeps = {
  tools: TOOLS,
  audit: auditToDb,
  log: (message, err) => console.error(`[tools] ${message}`, err ?? ""),
  timeoutMs: TOOL_TIMEOUT_MS,
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
      try {
        const result = await withTimeout(tool.run(parsed.data, ctx), d.timeoutMs);
        output = result.output;
        sources = result.sources ?? [];
      } catch (err) {
        d.log(`${name} failed (conversation ${ctx.conversationId})`, err);
        output = err instanceof ToolTimeout && tool.writes ? OUTCOME_UNKNOWN : UNAVAILABLE;
      }
    }
  }

  const outcome: ToolOutcome = { name, ok: output.ok, output, sources };
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
