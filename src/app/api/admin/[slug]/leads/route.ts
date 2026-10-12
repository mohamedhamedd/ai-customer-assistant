import { listLeads } from "@/lib/admin/crm";
import { withBusiness } from "@/lib/admin/respond";

// GET /api/admin/[slug]/leads?q=… -> { leads } (newest first)
export function GET(request: Request, ctx: RouteContext<"/api/admin/[slug]/leads">) {
  return withBusiness(ctx.params, "list leads", async (business) => {
    const q = new URL(request.url).searchParams.get("q") ?? "";
    return Response.json({ leads: await listLeads(business.id, q) }, { headers: { "cache-control": "no-store" } });
  });
}
