import { Conversations } from "@/components/admin/conversations";
import { adminBusiness } from "@/lib/admin/page";

// Blocking on purpose: one cached business lookup, then the page.
export const instant = false;

export default async function ConversationsPage({ params }: PageProps<"/admin/[slug]/conversations">) {
  const business = await adminBusiness(params);
  return <Conversations slug={business.slug} businessName={business.name} timeZone={business.timeZone} />;
}
