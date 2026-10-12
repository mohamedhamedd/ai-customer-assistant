import { z } from "zod";
import { setConsultationStatus } from "@/lib/admin/crm";
import { withBusiness } from "@/lib/admin/respond";
import { ChatHttpError } from "@/lib/chat/turn";
import { CONSULTATION_STATUSES } from "@/lib/db/enums";
import { readJsonCapped } from "@/lib/http";

// PATCH /api/admin/[slug]/consultations/[id] { status } -> { request }
const body = z.object({ status: z.enum(CONSULTATION_STATUSES) });

export function PATCH(request: Request, ctx: RouteContext<"/api/admin/[slug]/consultations/[id]">) {
  return withBusiness(ctx.params, "update consultation", async (business) => {
    const { id } = await ctx.params;
    if (!z.uuid().safeParse(id).success) throw new ChatHttpError(404, "That request doesn't exist.");
    const json = await readJsonCapped(request, 1024);
    if (!json.ok) throw new ChatHttpError(json.status, json.error);
    const parsed = body.safeParse(json.value);
    if (!parsed.success) throw new ChatHttpError(400, "Status must be pending, confirmed or cancelled.");
    return Response.json({ request: await setConsultationStatus(business.id, id, parsed.data.status) });
  });
}
