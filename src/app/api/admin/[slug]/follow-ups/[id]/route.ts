import { z } from "zod";
import { setFollowUpStatus } from "@/lib/admin/crm";
import { withBusiness } from "@/lib/admin/respond";
import { ChatHttpError } from "@/lib/chat/turn";
import { readJsonCapped } from "@/lib/http";

// PATCH /api/admin/[slug]/follow-ups/[id] { status: "done" | "open" } -> { followUp }
const body = z.object({ status: z.enum(["open", "done"]) });

export function PATCH(request: Request, ctx: RouteContext<"/api/admin/[slug]/follow-ups/[id]">) {
  return withBusiness(ctx.params, "update follow-up", async (business) => {
    const { id } = await ctx.params;
    if (!z.uuid().safeParse(id).success) throw new ChatHttpError(404, "That follow-up doesn't exist.");
    const json = await readJsonCapped(request, 1024);
    if (!json.ok) throw new ChatHttpError(json.status, json.error);
    const parsed = body.safeParse(json.value);
    if (!parsed.success) throw new ChatHttpError(400, "Status must be open or done.");
    return Response.json({ followUp: await setFollowUpStatus(business.id, id, parsed.data.status) });
  });
}
