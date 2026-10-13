import { listHours, saveHours } from "@/lib/admin/hours";
import { jsonBody, withBusiness } from "@/lib/admin/respond";
import { enforce, LIMITS } from "@/lib/rate-limit";

// GET /api/admin/[slug]/hours -> { hours, lastStartBeforeClose }
// PUT /api/admin/[slug]/hours { hours, lastStartBeforeClose } -> the same
//     400 with { error, rows: [{ row, message }] }. The whole week is
//     replaced.

export function GET(_request: Request, ctx: RouteContext<"/api/admin/[slug]/hours">) {
  return withBusiness(ctx.params, "list opening hours", async (business) => Response.json(await listHours(business.id), { headers: { "cache-control": "no-store" } }));
}

export function PUT(request: Request, ctx: RouteContext<"/api/admin/[slug]/hours">) {
  return withBusiness(ctx.params, "save opening hours", async (business) => {
    await enforce([[LIMITS.saveHours(business.id)]], "Too many changes in a short time. Please wait a few minutes.");
    return Response.json(await saveHours(business.id, await jsonBody(request, 16 * 1024)));
  });
}
