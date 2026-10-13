import { withBusiness } from "@/lib/admin/respond";
import { suggestServices } from "@/lib/admin/services";
import { enforce, LIMITS } from "@/lib/rate-limit";

// POST /api/admin/[slug]/services/suggest -> { services }
// Rows suggested from the business's documents, for the page to show.
// Nothing is saved: staff review them and save the table.
export function POST(_request: Request, ctx: RouteContext<"/api/admin/[slug]/services/suggest">) {
  return withBusiness(ctx.params, "suggest services", async (business) => {
    await enforce([[LIMITS.suggestServices(business.id)]], "Too many suggestions in a short time. Please wait a few minutes.");
    return Response.json({ services: await suggestServices(business.id) });
  });
}
