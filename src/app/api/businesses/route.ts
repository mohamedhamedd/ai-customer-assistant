import { createBusiness, listBusinesses } from "@/lib/admin/businesses";
import { jsonBody, respond } from "@/lib/admin/respond";
import { enforce, ipLimit, LIMITS } from "@/lib/rate-limit";

// GET  /api/businesses -> { businesses } (the home page and the admin switcher)
// POST /api/businesses { name, slug, description, timezone, guidelines } -> { business }
//      400 / 409 with { error, fields } when a field needs fixing.
// Not under /api/admin/[slug]: it isn't about one business, and a business
// slugged "businesses" would collide with it there.

export function GET() {
  return respond("list businesses", async () => Response.json({ businesses: await listBusinesses() }, { headers: { "cache-control": "no-store" } }));
}

export function POST(request: Request) {
  return respond("create business", async () => {
    await enforce([[...ipLimit(request, LIMITS.createBusinessIp), LIMITS.createBusiness()]], "Too many businesses created in a short time. Please try again later.");
    const business = await createBusiness(await jsonBody(request, 16 * 1024));
    return Response.json({ business }, { status: 201 });
  });
}
