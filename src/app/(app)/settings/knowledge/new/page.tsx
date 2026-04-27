import { requireFounder } from "@/lib/auth/require-founder";
import { KnowledgeEditor } from "@/components/settings/knowledge/knowledge-editor";

export const metadata = { title: "New knowledge doc · BLIPS" };

/**
 * Create a new knowledge document. Server component pre-checks that
 * the user is a founder; the form posts to a server action that
 * re-checks (defense-in-depth).
 */
export default async function NewKnowledgeDocPage() {
  await requireFounder();
  return (
    <div className="max-w-4xl mx-auto px-6 md:px-10 pt-10 pb-16">
      <KnowledgeEditor mode="new" />
    </div>
  );
}
