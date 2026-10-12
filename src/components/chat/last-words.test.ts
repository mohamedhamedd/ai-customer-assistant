import { test } from "node:test";
import assert from "node:assert/strict";
import { lastWords } from "./last-words";

// Settles within `ms`, or reports that it didn't.
const settles = (p: Promise<void>, ms = 20) => Promise.race([p.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), ms))]);

test("a tool call waits for the latest item's transcript, then goes", async () => {
  const words = lastWords(1000);
  words.spoken("item_1");
  const ready = words.ready();
  assert.equal(await settles(ready), false, "still waiting for the transcript");
  words.transcribed("item_1");
  assert.equal(await settles(ready), true);
});

test("a transcript that arrives before its item doesn't make tool calls wait", async () => {
  const words = lastWords(1000);
  words.transcribed("item_1");
  words.spoken("item_1");
  assert.equal(await settles(words.ready()), true);
});

test("no transcript: the tool call goes after waitMs anyway (the server then asks to confirm again)", async () => {
  const words = lastWords(30);
  words.spoken("item_1");
  assert.equal(await settles(words.ready(), 10), false);
  assert.equal(await settles(words.ready(), 60), true);
});

test("nothing said yet, or after a reset: no wait", async () => {
  const words = lastWords(1000);
  assert.equal(await settles(words.ready()), true);
  words.spoken("item_1");
  words.reset();
  assert.equal(await settles(words.ready()), true);
});

test("only the latest item counts, and tool calls keep their order", async () => {
  const words = lastWords(1000);
  words.spoken("item_1");
  words.spoken("item_2");
  words.transcribed("item_1");
  assert.equal(await settles(words.ready()), false, "an older item's transcript doesn't release the wait");

  const order: string[] = [];
  const first = words.ready().then(() => order.push("save_lead"));
  const second = words.ready().then(() => order.push("create_consultation_request"));
  words.transcribed("item_2");
  await Promise.all([first, second]);
  assert.deepEqual(order, ["save_lead", "create_consultation_request"]);
});
