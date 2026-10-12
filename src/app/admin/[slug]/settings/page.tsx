import { Settings } from "@/components/admin/settings";
import { adminBusiness } from "@/lib/admin/page";

// Blocking on purpose: one cached business lookup, then the page.
export const instant = false;

export default async function SettingsPage({ params }: PageProps<"/admin/[slug]/settings">) {
  const business = await adminBusiness(params);
  return <Settings slug={business.slug} />;
}
