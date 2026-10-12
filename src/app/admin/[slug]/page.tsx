import { redirect } from "next/navigation";

// The admin opens on the overview.
export default async function BusinessAdminHome({ params }: PageProps<"/admin/[slug]">) {
  redirect(`/admin/${(await params).slug}/overview`);
}
