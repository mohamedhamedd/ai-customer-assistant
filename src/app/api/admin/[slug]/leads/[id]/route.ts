import { z } from "zod";
import { leadDetail } from "@/lib/admin/crm";
import { withBusiness } from "@/lib/admin/respond";
import { ChatHttpError } from "@/lib/chat/turn";

// GET /api/admin/[slug]/leads/[id] -> { lead, requests }
export function GET(_request: Request, ctx: RouteContext<"/api/admin/[slug]/leads/[id]">) {
  return withBusiness(ctx.params, "lead detail", async (business) => {
    const { id } = await ctx.params;
    if (!z.uuid().safeParse(id).success) throw new ChatHttpError(404, "That lead doesn't exist.");
    return Response.json(await leadDetail(business.id, id), { headers: { "cache-control": "no-store" } });
  });
}
