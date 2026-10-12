import { z } from "zod";
import { conversationTranscript } from "@/lib/admin/conversations";
import { withBusiness } from "@/lib/admin/respond";
import { ChatHttpError } from "@/lib/chat/turn";

// GET /api/admin/[slug]/conversations/[id] -> { conversation, items, earlierOmitted }
// The messages with the tool calls between them (the AI audit trail).
export function GET(_request: Request, ctx: RouteContext<"/api/admin/[slug]/conversations/[id]">) {
  return withBusiness(ctx.params, "conversation transcript", async (business) => {
    const { id } = await ctx.params;
    if (!z.uuid().safeParse(id).success) throw new ChatHttpError(404, "That conversation doesn't exist.");
    return Response.json(await conversationTranscript(business.id, id), { headers: { "cache-control": "no-store" } });
  });
}
