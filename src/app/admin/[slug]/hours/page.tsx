import { OpeningHours } from "@/components/admin/hours";
import { listHours } from "@/lib/admin/hours";
import { adminBusiness } from "@/lib/admin/page";
import { findBusiness } from "@/lib/chat/turn";
import { formatLocal } from "@/lib/agent/time";

// Blocking on purpose: the week is loaded here, so the form renders filled.
export const instant = false;

export default async function HoursPage({ params }: PageProps<"/admin/[slug]/hours">) {
  const { slug, timeZone } = await adminBusiness(params);
  const business = (await findBusiness(slug))!;
  // The business's local date, so past closed dates are marked the same on the server and in the browser.
  const today = formatLocal(new Date(), timeZone).slice(0, 10);
  return <OpeningHours slug={slug} timeZone={timeZone} today={today} initial={await listHours(business.id)} />;
}
