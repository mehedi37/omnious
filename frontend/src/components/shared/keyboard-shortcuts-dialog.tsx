'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useUIStore } from '@/lib/stores/ui-store';

interface ShortcutEntry {
  keys: string[];
  description: string;
}

interface ShortcutSection {
  title: string;
  shortcuts: ShortcutEntry[];
}

const SHORTCUT_SECTIONS: ShortcutSection[] = [
  {
    title: 'Navigation',
    shortcuts: [
      { keys: ['Arrow keys'], description: 'Pan canvas' },
      { keys: ['Shift', 'Arrow keys'], description: 'Pan canvas (large jump)' },
      { keys: ['+', '='], description: 'Zoom in' },
      { keys: ['-'], description: 'Zoom out' },
      { keys: ['0', 'Home'], description: 'Fit view (reset camera)' },
      { keys: ['F'], description: 'Fit view' },
      { keys: ['Shift', 'F'], description: 'Fit to selected nodes' },
      { keys: ['Shift', 'Scroll'], description: 'Horizontal pan' },
    ],
  },
  {
    title: 'Selection',
    shortcuts: [
      { keys: ['Ctrl', 'A'], description: 'Select all visible nodes' },
      { keys: ['Tab'], description: 'Cycle focus to next node' },
      { keys: ['Shift', 'Tab'], description: 'Cycle focus to previous node' },
      { keys: ['Enter'], description: 'Confirm focused node' },
      { keys: ['Escape'], description: 'Dismiss (search → focus → deselect)' },
    ],
  },
  {
    title: 'Layout',
    shortcuts: [
      { keys: ['1'], description: 'Layout: Top → Bottom' },
      { keys: ['2'], description: 'Layout: Left → Right' },
    ],
  },
  {
    title: 'Features',
    shortcuts: [
      { keys: ['Ctrl', 'F'], description: 'Open node search' },
      { keys: ['N'], description: 'Focus mode on selected node' },
      { keys: ['H'], description: 'Toggle error heatmap' },
      { keys: ['Space'], description: 'Play / pause trace replay' },
      { keys: ['?'], description: 'Show this dialog' },
    ],
  },
];

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
      {children}
    </kbd>
  );
}

export function KeyboardShortcutsDialog() {
  const open = useUIStore((s) => s.keyboardShortcutsOpen);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => useUIStore.getState().setKeyboardShortcutsOpen(o)}
    >
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          {SHORTCUT_SECTIONS.map((section) => (
            <div key={section.title}>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                {section.title}
              </h4>
              <div className="space-y-1.5">
                {section.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.description}
                    className="flex items-center justify-between py-1"
                  >
                    <span className="text-sm">{shortcut.description}</span>
                    <div className="flex items-center gap-1 shrink-0 ml-4">
                      {shortcut.keys.map((key, i) => (
                        <span key={key} className="flex items-center gap-1">
                          {i > 0 && (
                            <span className="text-xs text-muted-foreground">+</span>
                          )}
                          <Kbd>{key}</Kbd>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
