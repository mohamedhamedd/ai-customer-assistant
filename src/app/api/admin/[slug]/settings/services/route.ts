import { suggestServices } from "@/lib/admin/services";
import { withBusiness } from "@/lib/admin/respond";
import { enforce, LIMITS } from "@/lib/rate-limit";

// POST /api/admin/[slug]/settings/services -> { services }
// A suggested list from the business's documents, for the Settings form to
// show. Nothing is saved: staff review it and save the form.
export function POST(_request: Request, ctx: RouteContext<"/api/admin/[slug]/settings/services">) {
  return withBusiness(ctx.params, "suggest services", async (business) => {
    await enforce([[LIMITS.suggestServices(business.id)]], "Too many suggestions in a short time. Please wait a few minutes.");
    return Response.json({ services: await suggestServices(business.id) });
  });
}
