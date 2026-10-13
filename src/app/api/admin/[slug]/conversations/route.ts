import { listConversations } from "@/lib/admin/conversations";
import { withBusiness } from "@/lib/admin/respond";

// GET /api/admin/[slug]/conversations[?issues=1][&page=2] -> { items, total, page, pageSize } (newest activity first)
// issues=1: only conversations with an issue (a replaced answer, a failed tool call).
export function GET(request: Request, ctx: RouteContext<"/api/admin/[slug]/conversations">) {
  const params = new URL(request.url).searchParams;
  const issuesOnly = params.get("issues") === "1";
  const page = Math.min(Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1), 10_000);
  return withBusiness(ctx.params, "list conversations", async (business) =>
    Response.json(await listConversations(business.id, { issuesOnly, page }), { headers: { "cache-control": "no-store" } }),
  );
}
