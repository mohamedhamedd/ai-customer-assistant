import { Overview } from "@/components/admin/overview";
import { adminBusiness } from "@/lib/admin/page";

export default async function OverviewPage({ params }: PageProps<"/admin/[slug]/overview">) {
  const business = await adminBusiness(params);
  return <Overview slug={business.slug} timeZone={business.timeZone} />;
}
