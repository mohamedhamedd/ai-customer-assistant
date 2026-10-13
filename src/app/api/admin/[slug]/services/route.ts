import { jsonBody, withBusiness } from "@/lib/admin/respond";
import { listServices, saveServices } from "@/lib/admin/services";
import { enforce, LIMITS } from "@/lib/rate-limit";

// GET /api/admin/[slug]/services -> { services }
// PUT /api/admin/[slug]/services { services } -> { services }
//     400 with { error, rows: [{ row, field, message }] }. The whole list is
//     replaced, in the order given.

export function GET(_request: Request, ctx: RouteContext<"/api/admin/[slug]/services">) {
  return withBusiness(ctx.params, "list services", async (business) =>
    Response.json({ services: await listServices(business.id) }, { headers: { "cache-control": "no-store" } }),
  );
}

export function PUT(request: Request, ctx: RouteContext<"/api/admin/[slug]/services">) {
  return withBusiness(ctx.params, "save services", async (business) => {
    await enforce([[LIMITS.saveServices(business.id)]], "Too many changes in a short time. Please wait a few minutes.");
    const body = (await jsonBody(request, 256 * 1024)) as { services?: unknown };
    return Response.json({ services: await saveServices(business.id, body?.services) });
  });
}
