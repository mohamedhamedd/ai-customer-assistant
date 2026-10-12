import { Consultations } from "@/components/admin/consultations";
import { adminBusiness } from "@/lib/admin/page";

// Blocking on purpose: nothing renders before the sign-in check.
export const instant = false;

export default async function ConsultationsPage({ params }: PageProps<"/admin/[slug]/consultations">) {
  const business = await adminBusiness(params);
  return <Consultations slug={business.slug} timeZone={business.timeZone} />;
}
