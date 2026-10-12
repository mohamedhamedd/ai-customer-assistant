import "server-only";
import { ChatHttpError, requireBusiness, type Business } from "@/lib/chat/turn";

// Shared shape of the admin routes: the business comes from the URL (an
// unknown slug is a 404 before anything runs); known errors keep their
// status, anything else is a logged 500.
//
// No login (assumption A1, "Demo mode"): these routes are open to anyone
// who can reach the server. See README, Security model.
export async function withBusiness(params: Promise<{ slug: string }>, label: string, run: (business: Business) => Promise<Response>) {
  try {
    const business = await requireBusiness((await params).slug);
    return await run(business);
  } catch (err) {
    if (err instanceof ChatHttpError) return Response.json({ error: err.message }, { status: err.status });
    console.error(`[admin] ${label} failed`, err);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
