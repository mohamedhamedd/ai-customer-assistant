import { z } from "zod";
import { listConsultations, statusCounts } from "@/lib/admin/crm";
import { withBusiness } from "@/lib/admin/respond";
import { CONSULTATION_STATUSES } from "@/lib/db/enums";

// GET /api/admin/[slug]/consultations?status=pending|confirmed|cancelled|all -> { requests, counts }
// GET /api/admin/[slug]/consultations?counts=1 -> { counts } (the sidebar badge)
const filter = z.enum([...CONSULTATION_STATUSES, "all"]).catch("pending");

export function GET(request: Request, ctx: RouteContext<"/api/admin/[slug]/consultations">) {
  return withBusiness(ctx.params, "list consultations", async (business) => {
    const params = new URL(request.url).searchParams;
    const headers = { "cache-control": "no-store" };
    if (params.get("counts")) return Response.json({ counts: await statusCounts(business.id) }, { headers });
    return Response.json(await listConsultations(business.id, filter.parse(params.get("status") ?? "pending")), { headers });
  });
}
