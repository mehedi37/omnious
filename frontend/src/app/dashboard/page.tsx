import { WorkspaceSelector } from '@/components/workspace/workspace-selector';

export const metadata = { title: 'Dashboard' };

export default function DashboardPage() {
  return (
    <div className="p-6">
      <h1 className="mb-6 text-2xl font-bold">Select a Workspace</h1>
      <WorkspaceSelector />
    </div>
  );
}
