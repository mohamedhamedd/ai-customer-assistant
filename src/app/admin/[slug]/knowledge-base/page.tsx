import { KnowledgeBase } from "@/components/admin/knowledge-base";
import { adminBusiness } from "@/lib/admin/page";

// Blocking on purpose: one cached business lookup, then the page.
export const instant = false;

export default async function KnowledgeBasePage({ params }: PageProps<"/admin/[slug]/knowledge-base">) {
  const business = await adminBusiness(params);
  return <KnowledgeBase slug={business.slug} />;
}
