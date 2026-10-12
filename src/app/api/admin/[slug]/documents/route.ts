import { z } from "zod";
import { ChatHttpError } from "@/lib/chat/turn";
import { listDocuments, uploadDocument } from "@/lib/admin/knowledge";
import { withBusiness } from "@/lib/admin/respond";
import { readFormCapped } from "@/lib/http";
import { enforce, LIMITS } from "@/lib/rate-limit";
import { MAX_UPLOAD_BYTES } from "@/lib/rag/file-types";

// GET  /api/admin/[slug]/documents -> { documents }
// POST /api/admin/[slug]/documents (multipart: "file", optional "replaces" id) -> IngestResult

export function GET(_request: Request, ctx: RouteContext<"/api/admin/[slug]/documents">) {
  return withBusiness(ctx.params, "list documents", async (business) =>
    Response.json({ documents: await listDocuments(business.id) }, { headers: { "cache-control": "no-store" } }),
  );
}

// Multipart overhead on top of the file itself.
const MAX_BODY_BYTES = MAX_UPLOAD_BYTES + 64 * 1024;

export function POST(request: Request, ctx: RouteContext<"/api/admin/[slug]/documents">) {
  return withBusiness(ctx.params, "upload", async (business) => {
    await enforce([LIMITS.uploadBusiness(business.slug)], "Too many uploads in a short time. Please wait a few minutes.");
    // Capped while reading: a request without content-length can't make the
    // server buffer more than this.
    const form = await readFormCapped(request, MAX_BODY_BYTES, "The file is larger than 10 MB.");
    if (!form.ok) throw new ChatHttpError(form.status, form.error);
    const file = form.value.get("file");
    if (!(file instanceof File)) throw new ChatHttpError(400, "Choose a file to upload.");
    const replaces = form.value.get("replaces");
    if (replaces !== null && (typeof replaces !== "string" || !z.uuid().safeParse(replaces).success)) {
      throw new ChatHttpError(400, "Invalid document to replace.");
    }
    return Response.json(await uploadDocument(business.id, file, replaces ?? undefined));
  });
}
