import { redirect } from "next/navigation";

// The admin's landing page is the knowledge base until Overview lands (PR-11).
export default async function BusinessAdminHome({ params }: PageProps<"/admin/[slug]">) {
  redirect(`/admin/${(await params).slug}/knowledge-base`);
}
