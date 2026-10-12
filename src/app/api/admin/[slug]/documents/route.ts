import { ChatHttpError } from "@/lib/chat/turn";
import { listDocuments, uploadDocument } from "@/lib/admin/knowledge";
import { MAX_UPLOAD_BYTES } from "@/lib/rag/file-types";
import { withBusiness } from "@/lib/admin/respond";

// GET  /api/admin/[slug]/documents          -> { documents }
// POST /api/admin/[slug]/documents  (multipart, field "file") -> IngestResult

export function GET(_request: Request, ctx: RouteContext<"/api/admin/[slug]/documents">) {
  return withBusiness(ctx.params, "list documents", async (business) =>
    Response.json({ documents: await listDocuments(business.id) }, { headers: { "cache-control": "no-store" } }),
  );
}

// Multipart overhead on top of the file itself.
const MAX_BODY_BYTES = MAX_UPLOAD_BYTES + 64 * 1024;

export function POST(request: Request, ctx: RouteContext<"/api/admin/[slug]/documents">) {
  return withBusiness(ctx.params, "upload", async (business) => {
    // Refuse an oversized body before reading it into memory.
    if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) throw new ChatHttpError(413, "The file is larger than 10 MB.");
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) throw new ChatHttpError(400, "Choose a file to upload.");
    return Response.json(await uploadDocument(business.id, file));
  });
}
