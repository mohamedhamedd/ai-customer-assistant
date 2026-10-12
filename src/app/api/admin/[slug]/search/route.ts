import { z } from "zod";
import { ChatHttpError } from "@/lib/chat/turn";
import { testSearch } from "@/lib/admin/knowledge";
import { withBusiness } from "@/lib/admin/respond";
import { readJsonCapped } from "@/lib/http";
import { enforce, LIMITS } from "@/lib/rate-limit";

// POST /api/admin/[slug]/search { query } -> { found, results }
// What the assistant's search_knowledge would find for a question.

const searchRequest = z.object({ query: z.string().trim().min(1, "Type a question to test.").max(500) });

export function POST(request: Request, ctx: RouteContext<"/api/admin/[slug]/search">) {
  return withBusiness(ctx.params, "test search", async (business) => {
    await enforce([LIMITS.searchBusiness(business.slug)], "Too many test searches in a short time. Please wait a moment.");
    const body = await readJsonCapped(request, 4 * 1024);
    if (!body.ok) throw new ChatHttpError(body.status, body.error);
    const parsed = searchRequest.safeParse(body.value);
    if (!parsed.success) throw new ChatHttpError(400, parsed.error.issues[0]?.message ?? "Invalid request.");
    return Response.json(await testSearch(business.id, parsed.data.query));
  });
}
