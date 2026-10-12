// Request helpers shared by the API routes.

// Reads at most maxBytes, whatever the headers say: a chunked request has no
// content-length, and request.json() would buffer an unlimited body.
type JsonBody = { ok: true; value: unknown } | { ok: false; status: 400 | 413; error: string };
export async function readJsonCapped(request: Request, maxBytes: number): Promise<JsonBody> {
  const tooLarge: JsonBody = { ok: false, status: 413, error: "Request is too large." };
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) return tooLarge;
  const reader = request.body?.getReader();
  if (!reader) return { ok: false, status: 400, error: "Request body must be JSON." };
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return tooLarge;
    }
    chunks.push(value);
  }
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { ok: false, status: 400, error: "Request body must be JSON." };
  }
}
