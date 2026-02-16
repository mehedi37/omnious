'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { GitGraph, Activity, AlertTriangle, Bot, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

const tabs = [
  { label: 'Graph', segment: 'graph', icon: GitGraph },
  { label: 'Traces', segment: 'traces', icon: Activity },
  { label: 'Errors', segment: 'errors', icon: AlertTriangle },
  { label: 'AI', segment: 'ai', icon: Bot },
  { label: 'Settings', segment: 'settings', icon: Settings },
];

export function ProjectNav() {
  const params = useParams<{ workspaceSlug: string; projectSlug: string }>();
  const pathname = usePathname();
  const base = `/dashboard/${params.workspaceSlug}/${params.projectSlug}`;

  return (
    <nav className="flex gap-1 border-b px-4">
      {tabs.map((tab) => {
        const href = `${base}/${tab.segment}`;
        const isActive = pathname.startsWith(href);

        return (
          <Link
            key={tab.segment}
            href={href}
            className={cn(
              'flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <tab.icon className="size-4" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
