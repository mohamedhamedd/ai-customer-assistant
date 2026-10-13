import { z } from "zod";
import { CONSULTATION_SORTS, listConsultations, statusCounts } from "@/lib/admin/crm";
import { withBusiness } from "@/lib/admin/respond";
import { CONSULTATION_STATUSES } from "@/lib/db/enums";

// GET /api/admin/[slug]/consultations?status=pending|confirmed|cancelled|all
//       [&sort=upcoming|requested_desc|requested_asc|date_asc|date_desc]
//       [&from=YYYY-MM-DD][&to=YYYY-MM-DD]  (preferred date, the business's local dates, both included)
//       [&page=2]
//     -> { requests, total, page, pageSize, counts }
// GET /api/admin/[slug]/consultations?counts=1 -> { counts } (the sidebar badge)
const query = z.object({
  status: z.enum([...CONSULTATION_STATUSES, "all"]).catch("pending"),
  sort: z.enum(CONSULTATION_SORTS).catch("upcoming"),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

export function GET(request: Request, ctx: RouteContext<"/api/admin/[slug]/consultations">) {
  return withBusiness(ctx.params, "list consultations", async (business) => {
    const params = new URL(request.url).searchParams;
    const headers = { "cache-control": "no-store" };
    if (params.get("counts")) return Response.json({ counts: await statusCounts(business.id) }, { headers });
    const q = query.parse(Object.fromEntries(params));
    return Response.json(await listConsultations(business.id, business.timezone, q), { headers });
  });
}
