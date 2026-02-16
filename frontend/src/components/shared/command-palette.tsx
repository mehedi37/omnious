'use client';

import { useEffect, useCallback } from 'react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import {
  GitGraph,
  Activity,
  AlertTriangle,
  Bot,
  Settings,
  Sun,
  Moon,
  LayoutGrid,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useUIStore } from '@/lib/stores/ui-store';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';

export function CommandPalette() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const open = useUIStore((s) => s.commandPaletteOpen);
  const togglePalette = useUIStore((s) => s.toggleCommandPalette);
  const closePalette = useUIStore((s) => s.closeCommandPalette);
  const workspaceSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const projectSlug = useWorkspaceStore((s) => s.currentProjectSlug);

  const basePath =
    workspaceSlug && projectSlug
      ? `/dashboard/${workspaceSlug}/${projectSlug}`
      : '/dashboard';

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        togglePalette();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [togglePalette]);

  const navigate = useCallback(
    (path: string) => {
      closePalette();
      router.push(path);
    },
    [closePalette, router],
  );

  return (
    <CommandDialog open={open} onOpenChange={(val) => (val ? togglePalette() : closePalette())}>
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Navigation">
          <CommandItem onSelect={() => navigate('/dashboard')}>
            <LayoutGrid className="mr-2 size-4" />
            Dashboard
          </CommandItem>
          <CommandItem onSelect={() => navigate(`${basePath}/graph`)}>
            <GitGraph className="mr-2 size-4" />
            Graph
          </CommandItem>
          <CommandItem onSelect={() => navigate(`${basePath}/traces`)}>
            <Activity className="mr-2 size-4" />
            Traces
          </CommandItem>
          <CommandItem onSelect={() => navigate(`${basePath}/errors`)}>
            <AlertTriangle className="mr-2 size-4" />
            Errors
          </CommandItem>
          <CommandItem onSelect={() => navigate(`${basePath}/ai`)}>
            <Bot className="mr-2 size-4" />
            AI Sessions
          </CommandItem>
          <CommandItem onSelect={() => navigate(`${basePath}/settings`)}>
            <Settings className="mr-2 size-4" />
            Settings
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Actions">
          <CommandItem
            onSelect={() => {
              setTheme(theme === 'dark' ? 'light' : 'dark');
              closePalette();
            }}
          >
            {theme === 'dark' ? (
              <Sun className="mr-2 size-4" />
            ) : (
              <Moon className="mr-2 size-4" />
            )}
            Toggle theme
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
