import { ProjectList } from '@/components/project/project-list';
import { HydrateClient, trpc } from '@/trpc/server';

export const metadata = { title: 'Projects' };

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  // We need the workspace ID for the project list query.
  // The list call will get the workspace from the slug via the client.
  // For now prefetch is skipped — the client component will fetch.

  return (
    <div className="p-6">
      <h1 className="mb-6 text-2xl font-bold">Projects</h1>
      <ProjectList workspaceSlug={workspaceSlug} />
    </div>
  );
}
