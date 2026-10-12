import { businessProfile, updateBusiness } from "@/lib/admin/businesses";
import { jsonBody, withBusiness } from "@/lib/admin/respond";
import { enforce, LIMITS } from "@/lib/rate-limit";

// GET   /api/admin/[slug]/settings -> { profile }
// PATCH /api/admin/[slug]/settings { name, slug, description, timezone, guidelines } -> { profile }
//       400 / 409 with { error, fields }. A new slug moves the chat to /b/<new slug>.

export function GET(_request: Request, ctx: RouteContext<"/api/admin/[slug]/settings">) {
  return withBusiness(ctx.params, "load profile", async (business) =>
    Response.json({ profile: await businessProfile(business.id) }, { headers: { "cache-control": "no-store" } }),
  );
}

export function PATCH(request: Request, ctx: RouteContext<"/api/admin/[slug]/settings">) {
  return withBusiness(ctx.params, "save profile", async (business) => {
    await enforce([[LIMITS.saveProfile(business.id)]], "Too many changes in a short time. Please wait a few minutes.");
    return Response.json({ profile: await updateBusiness(business, await jsonBody(request, 16 * 1024)) });
  });
}
