import { KnowledgeBase } from "@/components/admin/knowledge-base";

export default async function KnowledgeBasePage({ params }: PageProps<"/admin/[slug]/knowledge-base">) {
  return <KnowledgeBase slug={(await params).slug} />;
}
