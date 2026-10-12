import { Settings } from "@/components/admin/settings";
import { adminProfile } from "@/lib/admin/page";

// Blocking on purpose: the profile is loaded here, so the form renders filled.
export const instant = false;

export default async function SettingsPage({ params }: PageProps<"/admin/[slug]/settings">) {
  const { slug, profile } = await adminProfile(params);
  return <Settings slug={slug} initial={profile} />;
}
