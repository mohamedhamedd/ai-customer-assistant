import { overview } from "@/lib/admin/crm";
import { withBusiness } from "@/lib/admin/respond";

// GET /api/admin/[slug]/overview -> KPIs + recent requests and leads
export function GET(_request: Request, ctx: RouteContext<"/api/admin/[slug]/overview">) {
  return withBusiness(ctx.params, "overview", async (business) => Response.json(await overview(business.id), { headers: { "cache-control": "no-store" } }));
}
