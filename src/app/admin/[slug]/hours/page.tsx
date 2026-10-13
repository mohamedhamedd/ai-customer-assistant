import { OpeningHours } from "@/components/admin/hours";
import { listHours } from "@/lib/admin/hours";
import { adminBusiness } from "@/lib/admin/page";
import { findBusiness } from "@/lib/chat/turn";

// Blocking on purpose: the week is loaded here, so the form renders filled.
export const instant = false;

export default async function HoursPage({ params }: PageProps<"/admin/[slug]/hours">) {
  const { slug, timeZone } = await adminBusiness(params);
  const business = (await findBusiness(slug))!;
  return <OpeningHours slug={slug} timeZone={timeZone} initial={await listHours(business.id)} />;
}
