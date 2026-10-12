import { test } from "node:test";
import assert from "node:assert/strict";
import { readBodyCapped, readFormCapped } from "./http";

// A body sent in chunks, with no content-length header to check up front.
function chunkedRequest(chunks: number, chunkBytes: number, contentType = "application/octet-stream") {
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent++ >= chunks) return controller.close();
      controller.enqueue(new Uint8Array(chunkBytes));
    },
  });
  return new Request("http://x/upload", { method: "POST", body, headers: { "content-type": contentType }, duplex: "half" } as RequestInit);
}

test("a chunked body is cut off at the cap while reading, not after", async () => {
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled++;
      controller.enqueue(new Uint8Array(1024));
    },
  });
  // Endless stream: only the cap can stop it.
  const request = new Request("http://x/upload", { method: "POST", body, duplex: "half" } as RequestInit);
  const result = await readBodyCapped(request, 10 * 1024, "Too big.");
  assert.deepEqual(result, { ok: false, status: 413, error: "Too big." });
  assert.ok(pulled <= 12, "stopped reading just past the cap");
});

test("a body under the cap is read whole", async () => {
  const result = await readBodyCapped(chunkedRequest(3, 1000), 10_000);
  assert.ok(result.ok && result.value.length === 3000);
});

test("a multipart form is parsed after the capped read", async () => {
  const form = new FormData();
  form.append("file", new File(["# Hello"], "hello.md"));
  const encoded = new Response(form);
  const request = new Request("http://x/upload", { method: "POST", body: await encoded.arrayBuffer(), headers: { "content-type": encoded.headers.get("content-type")! } });
  const result = await readFormCapped(request, 64 * 1024);
  assert.ok(result.ok);
  const file = result.value.get("file") as File;
  assert.equal(file.name, "hello.md");
  assert.equal(await file.text(), "# Hello");
});
