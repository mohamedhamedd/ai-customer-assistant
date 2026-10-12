import { Overview } from "@/components/admin/overview";
import { adminBusiness } from "@/lib/admin/page";

// Blocking on purpose: one cached business lookup, then the page.
export const instant = false;

export default async function OverviewPage({ params }: PageProps<"/admin/[slug]/overview">) {
  const business = await adminBusiness(params);
  return <Overview slug={business.slug} timeZone={business.timeZone} />;
}
