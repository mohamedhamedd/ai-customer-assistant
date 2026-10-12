import { listConversations } from "@/lib/admin/conversations";
import { withBusiness } from "@/lib/admin/respond";

// GET /api/admin/[slug]/conversations -> { conversations } (newest activity first)
export function GET(_request: Request, ctx: RouteContext<"/api/admin/[slug]/conversations">) {
  return withBusiness(ctx.params, "list conversations", async (business) =>
    Response.json({ conversations: await listConversations(business.id) }, { headers: { "cache-control": "no-store" } }),
  );
}
