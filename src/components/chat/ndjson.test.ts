import { test } from "node:test";
import assert from "node:assert/strict";
import { readNdjson } from "./ndjson";

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

test("a line split across chunks is parsed once, whole", async () => {
  const lines: unknown[] = [];
  await readNdjson(streamOf(['{"type":"del', 'ta","text":"Hi"}\n{"type":"done",', '"messageId":1}\n']), (l) => lines.push(l));
  assert.deepEqual(lines, [
    { type: "delta", text: "Hi" },
    { type: "done", messageId: 1 },
  ]);
});

test("a multi-byte character split across chunks survives", async () => {
  const bytes = new TextEncoder().encode('{"text":"café"}\n');
  const cut = bytes.length - 4; // inside the two bytes of "é"
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, cut));
      controller.enqueue(bytes.slice(cut));
      controller.close();
    },
  });
  const lines: unknown[] = [];
  await readNdjson(stream, (l) => lines.push(l));
  assert.deepEqual(lines, [{ text: "café" }]);
});
