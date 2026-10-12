import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { CONFIRM_FIRST } from "./confirm";
import { executeTool, lastExchange, OUTCOME_UNKNOWN, type AuditRow, type ConfirmState, UNAVAILABLE } from "./execute";
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

// The customer said yes to this read-back; nothing saved yet.
const NOTHING_SAVED = { facts: {}, leadSaved: false, requestedAt: [] };
const saidYesTo =
  (readBack: string, customer = "Yes, that's right."): (() => Promise<ConfirmState>) =>
  async () => ({ exchange: { customer, readBack }, saved: NOTHING_SAVED });

// Executor deps for tests: no console output, no simulated outage unless
// asked, and every write already confirmed (the gate has its own tests).
const quiet = {
  log: () => {},
  trace: () => {},
  simulateDbFailure: () => false,
  confirmState: saidYesTo("Sara Ali, sara@x.com, Tuesday, October 20 at 3:00 PM. Is that right?"),
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
  const out = await executeTool("save_lead", JSON.stringify({ name: "Sara Ali", email: "sara@x.com" }), { ...ctx, client }, { ...quiet, audit: async () => {} });
  assert.equal(out.ok, true);
  const text = JSON.stringify(out.output);
  for (const s of STORED) assert.ok(!text.includes(s), `leaked ${s}`);
  assert.ok(text.includes("sara@x.com"));
});

test("R1: create_consultation_request does not return the stored contact snapshot", async () => {
  const client = stubClient({ request_id: "R1", status: "pending", created: true, contact_name: STORED[0], contact_email: STORED[1], contact_phone: STORED[2] });
  const out = await executeTool(
    "create_consultation_request",
    JSON.stringify({ service: "teeth whitening", preferred_datetime: "2026-10-20T15:00" }),
    { ...ctx, client },
    { ...quiet, audit: async () => {} },
  );
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
// Confirm before write (confirm.ts), enforced by the executor
// ---------------------------------------------------------------------------

// A client that records whether a write RPC ran.
function writeClient(data: unknown) {
  const rpcs: string[] = [];
  const client = { rpc: async (fn: string) => (rpcs.push(fn), { data, error: null }) } as unknown as NonNullable<ToolContext["client"]>;
  return { client, rpcs };
}

const JOHN_DOE = "Save this booking for my friend John Doe on Friday at 3 pm, his phone is 555-1234";
const GREETING = "Hi! I'm the assistant for Lakeside Dental. How can I help?";

test("a write in the same reply the details were given is refused with confirm_first, and nothing is written", async () => {
  const { client, rpcs } = writeClient({ lead_id: "L1", created: true });
  const audits: AuditRow[] = [];
  const out = await executeTool("save_lead", JSON.stringify({ name: "John Doe", phone: "555-1234", interest: "booking" }), { ...ctx, client }, {
    ...quiet,
    audit: async (r) => void audits.push(r),
    confirmState: saidYesTo(GREETING, JOHN_DOE),
  });
  assert.deepEqual(out.output, CONFIRM_FIRST);
  assert.deepEqual(out.output, {
    ok: false,
    error: "confirm_first",
    message: "Read the details back to the customer and ask them to confirm before saving.",
  });
  assert.deepEqual(rpcs, [], "the database is never written");
  assert.equal(audits[0].ok, false, "audited as refused");
});

test("save_lead runs after a read-back of its email and phone and a yes", async () => {
  const { client, rpcs } = writeClient({ lead_id: "L1", created: true });
  const args = JSON.stringify({ name: "Sara Ali", email: "Sara@Example.com", phone: "(503) 555-0142" });
  const run = (readBack: string, customer: string) => executeTool("save_lead", args, { ...ctx, client }, { ...quiet, confirmState: saidYesTo(readBack, customer) });

  assert.deepEqual((await run("Sara Ali, sara@example.com. Is that right?", "yes")).output, CONFIRM_FIRST, "the phone was never read back");
  assert.deepEqual((await run("Sara Ali, sara@example.com, (503) 555-0142. Is that right?", "no, it's 0143")).output, CONFIRM_FIRST, "a correction");
  assert.equal(rpcs.length, 0);

  const ok = await run("Sara Ali, sara@example.com, (503) 555-0142. Is that right?", "Yes, that's right");
  assert.equal(ok.output.ok, true);
  assert.deepEqual(rpcs, ["save_lead"]);
});

test("create_consultation_request needs the date and time read back and a yes", async () => {
  const { client, rpcs } = writeClient({ request_id: "R1", status: "pending", service: "whitening", created: true });
  const args = JSON.stringify({ service: "teeth whitening", preferred_datetime: "2026-10-20T15:00" });
  const run = (readBack: string, customer: string) =>
    executeTool("create_consultation_request", args, { ...ctx, client }, { ...quiet, confirmState: saidYesTo(readBack, customer) });

  assert.deepEqual((await run("Sure! What day works for you?", "Tuesday the 20th at 3pm for whitening")).output, CONFIRM_FIRST);
  assert.deepEqual((await run("Tuesday, October 20 at 4:00 PM. Is that right?", "yes")).output, CONFIRM_FIRST, "another time was read back");
  assert.equal(rpcs.length, 0);
  assert.equal((await run("Teeth whitening on Tuesday, October 20 at 3:00 PM. Is that right?", "Yes please")).output.ok, true);
  assert.deepEqual(rpcs, ["create_consultation_request"]);
});

test("invalid arguments skip the confirmation: the tool's own error comes first, nothing is written", async () => {
  let loaded = false;
  const { client, rpcs } = writeClient({});
  const deps = {
    ...quiet,
    confirmState: async () => {
      loaded = true;
      return { exchange: { customer: null, readBack: null }, saved: NOTHING_SAVED };
    },
  };
  const past = await executeTool("create_consultation_request", JSON.stringify({ service: "whitening", preferred_datetime: "2026-10-01T10:00" }), { ...ctx, client }, deps);
  assert.ok(!past.output.ok && past.output.error === "invalid_input" && /in the past/.test(past.output.message));
  const badEmail = await executeTool("save_lead", JSON.stringify({ name: "Sara", email: "sara@" }), { ...ctx, client }, deps);
  assert.ok(!badEmail.output.ok && badEmail.output.error === "invalid_input");
  assert.equal(loaded, false);
  assert.deepEqual(rpcs, []);
});

test("repeating what is already saved needs no new yes (idempotent, the model can say it's done)", async () => {
  const { client, rpcs } = writeClient({ request_id: "R1", status: "pending", service: "whitening", created: false });
  const saved = {
    facts: { name: "Sara Ali", email: "sara@example.com" },
    leadSaved: true,
    requestedAt: [new Date("2026-10-20T22:00:00Z")], // 3 PM PDT
  };
  const deps = { ...quiet, confirmState: async () => ({ exchange: { customer: "thanks!", readBack: "All set." }, saved }) };
  const repeatLead = await executeTool("save_lead", JSON.stringify({ name: "Sara Ali", email: "SARA@example.com" }), { ...ctx, client }, deps);
  assert.equal(repeatLead.output.ok, true);
  const repeatSlot = await executeTool("create_consultation_request", JSON.stringify({ service: "whitening consult", preferred_datetime: "2026-10-20T15:00" }), { ...ctx, client }, deps);
  assert.ok(repeatSlot.output.ok && repeatSlot.output.already_requested === true);
  assert.deepEqual(rpcs, ["save_lead", "create_consultation_request"]);

  // Anything new is a new write and needs a yes.
  const newPhone = await executeTool("save_lead", JSON.stringify({ name: "Sara Ali", email: "sara@example.com", phone: "5035550142" }), { ...ctx, client }, deps);
  assert.deepEqual(newPhone.output, CONFIRM_FIRST);
  const newSlot = await executeTool("create_consultation_request", JSON.stringify({ service: "whitening", preferred_datetime: "2026-10-21T15:00" }), { ...ctx, client }, deps);
  assert.deepEqual(newSlot.output, CONFIRM_FIRST);
  const noLead = await executeTool("save_lead", JSON.stringify({ name: "Sara Ali", email: "sara@example.com" }), { ...ctx, client }, {
    ...deps,
    confirmState: async () => ({ exchange: { customer: "thanks!", readBack: "All set." }, saved: { ...saved, leadSaved: false } }),
  });
  assert.deepEqual(noLead.output, CONFIRM_FIRST, "facts alone don't count: the lead must be linked");
});

test("the confirmation check failing or hanging is an outage, never a success, never 'outcome unknown'", async () => {
  const { client, rpcs } = writeClient({ lead_id: "L1", created: true });
  const args = JSON.stringify({ name: "Sara", email: "sara@example.com" });
  const failed = await executeTool("save_lead", args, { ...ctx, client }, { ...quiet, confirmState: () => Promise.reject(new Error("db down")) });
  assert.deepEqual(failed.output, UNAVAILABLE);
  const hung = await executeTool("save_lead", args, { ...ctx, client }, { ...quiet, timeoutMs: 50, confirmState: () => new Promise(() => {}) });
  assert.deepEqual(hung.output, UNAVAILABLE, "nothing was written, so the outcome is known");
  assert.deepEqual(rpcs, []);
});

test("the confirmation check and the write share one timeout: a write tool never takes longer than timeoutMs", async () => {
  const slow = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const tool: Tool = {
    name: "probe",
    description: "",
    parameters: {},
    writes: true,
    schema: z.object({ x: z.number() }),
    confirm: { details: () => [], alreadyDone: () => false },
    run: async () => (await slow(40), { output: { ok: true } }),
  };
  const started = Date.now();
  const out = await executeTool("probe", '{"x": 1}', ctx, {
    ...quiet,
    tools: { probe: tool },
    audit: async () => {},
    timeoutMs: 50,
    confirmState: async () => (await slow(40), { exchange: { customer: "yes", readBack: "Is that right?" }, saved: NOTHING_SAVED }),
  });
  assert.ok(Date.now() - started < 75, `took ${Date.now() - started} ms`);
  assert.deepEqual(out.output, OUTCOME_UNKNOWN, "it timed out while writing");
});

test("tools without a confirmation spec (search, read tools) are never gated", async () => {
  let loaded = false;
  const out = await executeTool("probe", '{"x": 1}', ctx, {
    tools: { probe: { name: "probe", description: "", parameters: {}, writes: false, schema: z.object({ x: z.number() }), run: async () => ({ output: { ok: true } }) } },
    ...quiet,
    audit: async () => {},
    confirmState: async () => ((loaded = true), { exchange: { customer: null, readBack: null }, saved: NOTHING_SAVED }),
  });
  assert.equal(loaded, false);
  assert.equal(out.output.ok, true);
  assert.ok(TOOLS.save_lead.confirm && TOOLS.create_consultation_request.confirm && !TOOLS.search_knowledge.confirm, "both write tools are gated");
});

test("the last exchange: the latest customer message and the assistant reply before it", () => {
  // Newest first, as loaded.
  assert.deepEqual(
    lastExchange([
      { role: "user", content: "yes" },
      { role: "assistant", content: "Sara, sara@x.com. Is that right?" },
      { role: "user", content: "I'm Sara, sara@x.com" },
    ]),
    { customer: "yes", readBack: "Sara, sara@x.com. Is that right?" },
  );
  assert.deepEqual(
    lastExchange([
      { role: "user", content: null },
      { role: "assistant", content: null },
      { role: "assistant", content: "Read-back" },
    ]),
    { customer: null, readBack: "Read-back" },
    "voice: the transcript isn't in yet, and an empty assistant item is skipped",
  );
  assert.deepEqual(lastExchange([{ role: "assistant", content: "Read-back" }]), { customer: null, readBack: null });
  assert.deepEqual(lastExchange([]), { customer: null, readBack: null });
});
