import { Consultations } from "@/components/admin/consultations";
import { adminBusiness } from "@/lib/admin/page";

// Blocking on purpose: one cached business lookup, then the page.
export const instant = false;

export default async function ConsultationsPage({ params }: PageProps<"/admin/[slug]/consultations">) {
  const business = await adminBusiness(params);
  return <Consultations slug={business.slug} timeZone={business.timeZone} />;
}
