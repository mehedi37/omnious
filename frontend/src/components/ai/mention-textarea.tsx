'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FileCode } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { trpc } from '@/trpc/client';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MentionEntry {
  nodeId: string;
  oirId: string;
  name: string;
  type: string;
}

interface MentionTextareaProps {
  value: string;
  onChange: (value: string) => void;
  onMentionsChange: (mentions: MentionEntry[]) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  disabled?: boolean;
  rows?: number;
  className?: string;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Find a `#token` immediately before the cursor position */
function getMentionToken(value: string, cursorPos: number): string | null {
  const beforeCursor = value.slice(0, cursorPos);
  const match = /#(\w{2,})$/.exec(beforeCursor);
  return match ? match[1] : null;
}

/** Replace the trailing `#token` with `#name` at cursorPos */
function replaceMentionToken(value: string, cursorPos: number, name: string): string {
  const beforeCursor = value.slice(0, cursorPos);
  const replaced = beforeCursor.replace(/#(\w{2,})$/, `#${name}`);
  return replaced + value.slice(cursorPos);
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * A textarea that intercepts `#token` patterns and shows a floating
 * autocomplete popup using `trpc.graph.listNodes` with debounce.
 */
export function MentionTextarea({
  value,
  onChange,
  onMentionsChange,
  onKeyDown,
  placeholder,
  disabled,
  rows = 1,
  className,
  textareaRef: externalRef,
}: MentionTextareaProps) {
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const ref = externalRef ?? internalRef;

  const [mentionToken, setMentionToken] = useState<string | null>(null);
  const [popupOpen, setPopupOpen] = useState(false);
  const [debouncedToken, setDebouncedToken] = useState<string | null>(null);
  const [mentions, setMentions] = useState<MentionEntry[]>([]);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const projectId = useWorkspaceStore((s) => s.currentProjectId);

  // Debounce the search token
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (!mentionToken) {
      setDebouncedToken(null);
      return;
    }
    debounceTimer.current = setTimeout(() => setDebouncedToken(mentionToken), 200);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [mentionToken]);

  const { data: searchResults } = trpc.graph.listNodes.useQuery(
    { projectId: projectId ?? '', search: debouncedToken ?? '', limit: 8 },
    { enabled: !!projectId && !!debouncedToken, staleTime: 5_000 },
  );

  const suggestions = searchResults?.nodes ?? [];

  // Detect `#token` on every change
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      onChange(newValue);

      const cursor = e.target.selectionStart ?? newValue.length;
      const token = getMentionToken(newValue, cursor);
      setMentionToken(token);
      setPopupOpen(!!token);
    },
    [onChange],
  );

  // Keyboard nav inside the popup + pass-through to parent
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (popupOpen && (e.key === 'Escape')) {
        e.preventDefault();
        setPopupOpen(false);
        setMentionToken(null);
        return;
      }
      // ArrowUp/Down/Enter/Tab are handled by cmdk inside the Command component
      // when it steals focus — here we just close on Escape and let parent handle Enter
      onKeyDown?.(e);
    },
    [popupOpen, onKeyDown],
  );

  const selectSuggestion = useCallback(
    (node: { id: string; oir_id: string; name: string; type: string }) => {
      const el = ref.current;
      const cursor = el?.selectionStart ?? value.length;
      const newValue = replaceMentionToken(value, cursor, node.name);
      onChange(newValue);

      const newMention: MentionEntry = {
        nodeId: node.id,
        oirId: node.oir_id,
        name: node.name,
        type: node.type,
      };
      const updated = [...mentions.filter((m) => m.nodeId !== node.id), newMention];
      setMentions(updated);
      onMentionsChange(updated);

      setPopupOpen(false);
      setMentionToken(null);
      setDebouncedToken(null);
      // Restore focus
      setTimeout(() => el?.focus(), 0);
    },
    [value, onChange, mentions, onMentionsChange, ref],
  );

  // Close popup when clicking outside
  useEffect(() => {
    if (!popupOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setPopupOpen(false);
        setMentionToken(null);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [popupOpen, ref]);

  return (
    <div className="relative w-full">
      <Textarea
        ref={ref}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={className}
        rows={rows}
        disabled={disabled}
      />

      {/* Floating autocomplete popup */}
      {popupOpen && suggestions.length > 0 && (
        <div className="absolute bottom-full mb-1 left-0 z-50 w-full min-w-65 max-w-100 rounded-md border bg-popover shadow-lg">
          <Command>
            <CommandList>
              <CommandEmpty>No matching nodes</CommandEmpty>
              <CommandGroup heading={`Nodes matching "#${mentionToken}"`}>
                {suggestions.map((node) => (
                  <CommandItem
                    key={node.id}
                    value={`${node.name} ${node.file_path}`}
                    onSelect={() =>
                      selectSuggestion({
                        id: node.id,
                        oir_id: node.oir_id,
                        name: node.name,
                        type: node.type,
                      })
                    }
                    className="gap-2 cursor-pointer flex-col items-start"
                  >
                    <div className="flex w-full items-center gap-2">
                      <FileCode className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate font-medium text-sm">{node.name}</span>
                      <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                        {node.type}
                      </span>
                    </div>
                    {node.file_path && (
                      <span className="pl-5 text-[10px] text-muted-foreground/70 font-mono truncate w-full">
                        {node.file_path.split('/').slice(-3).join('/')}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </div>
      )}
    </div>
  );
}
