import { listConversations } from "@/lib/admin/conversations";
import { withBusiness } from "@/lib/admin/respond";

// GET /api/admin/[slug]/conversations[?issues=1] -> { conversations } (newest activity first)
// issues=1: only conversations with an issue (a replaced answer, a failed tool call).
export function GET(request: Request, ctx: RouteContext<"/api/admin/[slug]/conversations">) {
  const issuesOnly = new URL(request.url).searchParams.get("issues") === "1";
  return withBusiness(ctx.params, "list conversations", async (business) =>
    Response.json({ conversations: await listConversations(business.id, { issuesOnly }) }, { headers: { "cache-control": "no-store" } }),
  );
}
