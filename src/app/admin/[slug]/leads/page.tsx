import { Leads } from "@/components/admin/leads";
import { adminBusiness } from "@/lib/admin/page";

// Blocking on purpose: one cached business lookup, then the page.
export const instant = false;

export default async function LeadsPage({ params }: PageProps<"/admin/[slug]/leads">) {
  const business = await adminBusiness(params);
  return <Leads slug={business.slug} timeZone={business.timeZone} />;
}
