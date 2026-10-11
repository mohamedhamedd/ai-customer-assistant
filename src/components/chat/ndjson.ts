// Reads an NDJSON body (one JSON object per line) and calls onLine for each.
// A line can arrive split across network chunks, so text is buffered until
// its newline.
export async function readNdjson(body: ReadableStream<Uint8Array>, onLine: (value: unknown) => void): Promise<void> {
  const reader = body.getReader();
  // stream: true keeps a character split across chunks whole.
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) onLine(JSON.parse(line));
    }
  }
  if (buffer.trim()) onLine(JSON.parse(buffer));
}
