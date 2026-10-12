import { z } from "zod";
import { reviewFlag } from "@/lib/admin/flags";
import { jsonBody, withBusiness } from "@/lib/admin/respond";
import { ChatHttpError } from "@/lib/chat/turn";

// PATCH /api/admin/[slug]/flags/[id] { status: "confirmed" | "dismissed" } -> { id, status }
const body = z.object({ status: z.enum(["confirmed", "dismissed"]) });

export function PATCH(request: Request, ctx: RouteContext<"/api/admin/[slug]/flags/[id]">) {
  return withBusiness(ctx.params, "review flag", async (business) => {
    const { id } = await ctx.params;
    const flagId = Number(id);
    if (!Number.isSafeInteger(flagId) || flagId <= 0) throw new ChatHttpError(404, "That flag doesn't exist.");
    const parsed = body.safeParse(await jsonBody(request, 1024));
    if (!parsed.success) throw new ChatHttpError(400, "Status must be confirmed or dismissed.");
    return Response.json(await reviewFlag(business.id, flagId, parsed.data.status));
  });
}
