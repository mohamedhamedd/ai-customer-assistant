import { z } from "zod";
import { ChatHttpError } from "@/lib/chat/turn";
import { deleteDocument, documentSections } from "@/lib/admin/knowledge";
import { withBusiness } from "@/lib/admin/respond";

// GET    /api/admin/[slug]/documents/[id] -> the document and its sections
// DELETE /api/admin/[slug]/documents/[id] -> 204

async function documentId(params: Promise<{ id: string }>) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) throw new ChatHttpError(404, "That document doesn't exist.");
  return id;
}

export function GET(_request: Request, ctx: RouteContext<"/api/admin/[slug]/documents/[id]">) {
  return withBusiness(ctx.params, "document sections", async (business) =>
    Response.json(await documentSections(business.id, await documentId(ctx.params)), { headers: { "cache-control": "no-store" } }),
  );
}

export function DELETE(_request: Request, ctx: RouteContext<"/api/admin/[slug]/documents/[id]">) {
  return withBusiness(ctx.params, "delete document", async (business) => {
    await deleteDocument(business.id, await documentId(ctx.params));
    return new Response(null, { status: 204 });
  });
}
