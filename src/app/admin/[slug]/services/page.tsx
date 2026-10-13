import { Services } from "@/components/admin/services";
import { adminBusiness } from "@/lib/admin/page";
import { findBusiness } from "@/lib/chat/turn";
import { listServices } from "@/lib/admin/services";

// Blocking on purpose: the list is loaded here, so the table renders filled.
export const instant = false;

export default async function ServicesPage({ params }: PageProps<"/admin/[slug]/services">) {
  const { slug } = await adminBusiness(params);
  const business = (await findBusiness(slug))!;
  return <Services slug={slug} initial={await listServices(business.id)} />;
}
