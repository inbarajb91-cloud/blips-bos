import { notFound } from "next/navigation";
import {
  getKnowledgeDocument,
  listKnowledgeDocumentVersions,
} from "@/lib/actions/knowledge";
import { KnowledgeEditor } from "@/components/settings/knowledge/knowledge-editor";

export const metadata = { title: "Edit knowledge doc · BLIPS" };

/**
 * Edit an existing knowledge document. Loads the current state +
 * version list. The editor component handles save / archive /
 * rollback flows via server actions.
 */
export default async function EditKnowledgeDocPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [doc, versions] = await Promise.all([
    getKnowledgeDocument(id),
    listKnowledgeDocumentVersions(id),
  ]);
  if (!doc) notFound();

  return (
    <div className="max-w-6xl mx-auto px-6 md:px-10 pt-10 pb-16">
      <KnowledgeEditor mode="edit" doc={doc} versions={versions} />
    </div>
  );
}
