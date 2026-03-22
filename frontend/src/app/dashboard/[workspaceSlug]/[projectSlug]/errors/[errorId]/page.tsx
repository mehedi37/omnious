import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { ErrorDetail } from '@/components/error/error-detail';
import { Button } from '@/components/ui/button';
import { HydrateClient } from '@/trpc/server';

interface Props {
  params: Promise<{ workspaceSlug: string; projectSlug: string; errorId: string }>;
}

export default async function ErrorDetailPage({ params }: Props) {
  const { workspaceSlug, projectSlug, errorId } = await params;

  return (
    <HydrateClient>
      <div className="flex h-full flex-col overflow-hidden">
        {/* Breadcrumb header */}
        <div className="flex items-center gap-3 border-b px-6 py-3 shrink-0">
          <Link href={`/dashboard/${workspaceSlug}/${projectSlug}/errors`}>
            <Button variant="ghost" size="icon" className="h-7 w-7">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="text-sm text-muted-foreground">
            <Link
              href={`/dashboard/${workspaceSlug}/${projectSlug}/errors`}
              className="hover:text-foreground"
            >
              Errors
            </Link>
            <span className="mx-2">/</span>
            <span className="text-foreground font-medium font-mono text-[12px]">
              {errorId.split('-')[0]}…
            </span>
          </div>
        </div>

        {/* Scrollable detail content */}
        <div className="flex-1 overflow-y-auto">
          <ErrorDetail errorId={errorId} />
        </div>
      </div>
    </HydrateClient>
  );
}
