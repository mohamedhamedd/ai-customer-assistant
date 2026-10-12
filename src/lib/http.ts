// Request helpers shared by the API routes.

// Reads at most maxBytes, whatever the headers say: a chunked request has no
// content-length, and request.json() / request.formData() would buffer an
// unlimited body before anything could check its size.
type Capped<T> = { ok: true; value: T } | { ok: false; status: 400 | 413; error: string };

export async function readBodyCapped(request: Request, maxBytes: number, tooLargeMessage = "Request is too large."): Promise<Capped<Buffer>> {
  const tooLarge = { ok: false as const, status: 413 as const, error: tooLargeMessage };
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) return tooLarge;
  const reader = request.body?.getReader();
  if (!reader) return { ok: true, value: Buffer.alloc(0) };
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
  return { ok: true, value: Buffer.concat(chunks) };
}

export async function readJsonCapped(request: Request, maxBytes: number): Promise<Capped<unknown>> {
  const body = await readBodyCapped(request, maxBytes);
  if (!body.ok) return body;
  try {
    return { ok: true, value: JSON.parse(body.value.toString("utf8")) };
  } catch {
    return { ok: false, status: 400, error: "Request body must be JSON." };
  }
}

// A multipart form, parsed only after the capped read.
export async function readFormCapped(request: Request, maxBytes: number, tooLargeMessage?: string): Promise<Capped<FormData>> {
  const body = await readBodyCapped(request, maxBytes, tooLargeMessage);
  if (!body.ok) return body;
  try {
    const parsed = new Response(new Uint8Array(body.value), { headers: { "content-type": request.headers.get("content-type") ?? "" } });
    return { ok: true, value: await parsed.formData() };
  } catch {
    return { ok: false, status: 400, error: "Request body must be a multipart form." };
  }
}
