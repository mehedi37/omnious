'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Box, FileCode, FunctionSquare, Hash } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import type { AIMessageAttachment } from '@/lib/stores/ai-store';
import { trpc } from '@/trpc/client';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MentionEntry {
  kind: AIMessageAttachment['kind'];
  id: string;
  label: string;
  subtype?: string;
}

type MentionKind = AIMessageAttachment['kind'];

interface MentionToken {
  raw: string;
  kind: MentionKind;
  term: string;
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

/** Matches a `#[kind:]term` token immediately before the cursor */
const MENTION_PATTERN = /#([a-z_]+:)?([\w./-]{2,})$/i;

/** Find a `#token` immediately before the cursor position */
function getMentionToken(value: string, cursorPos: number): MentionToken | null {
  const beforeCursor = value.slice(0, cursorPos);
  const match = MENTION_PATTERN.exec(beforeCursor);
  if (!match) return null;

  const rawPrefix = (match[1] ?? '').toLowerCase();
  const term = match[2] ?? '';
  let kind: MentionKind = 'node';
  if (rawPrefix === 'module:') kind = 'module';
  else if (rawPrefix === 'function:') kind = 'function';
  else if (rawPrefix === 'file:') kind = 'file';
  else if (rawPrefix === 'error:') kind = 'error';
  else if (rawPrefix === 'node:') kind = 'node';

  return {
    raw: `${rawPrefix}${term}`,
    kind,
    term,
  };
}

/** Replace the trailing `#token` with `#name` at cursorPos */
function replaceMentionToken(value: string, cursorPos: number, name: string, kind: MentionKind): string {
  const beforeCursor = value.slice(0, cursorPos);
  const prefix = kind === 'node' ? '' : `${kind}:`;
  const replaced = beforeCursor.replace(MENTION_PATTERN, `#${prefix}${name}`);
  return replaced + value.slice(cursorPos);
}

const NODE_TYPE_TO_KIND: Record<string, MentionKind> = {
  module: 'module',
  package: 'module',
  namespace: 'module',
  function: 'function',
  class: 'function',
  route: 'function',
  middleware: 'function',
};

function inferKindFromNodeType(type: string): MentionKind {
  return NODE_TYPE_TO_KIND[type.toLowerCase()] ?? 'node';
}

function nodeMatchesKind(type: string, kind: MentionKind): boolean {
  if (kind === 'node' || kind === 'file') return true;
  return inferKindFromNodeType(type) === kind;
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

  const [mentionToken, setMentionToken] = useState<MentionToken | null>(null);
  const [popupOpen, setPopupOpen] = useState(false);
  const [debouncedToken, setDebouncedToken] = useState<MentionToken | null>(null);
  const [mentions, setMentions] = useState<MentionEntry[]>([]);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);

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
    { projectId: projectId ?? '', search: debouncedToken?.term ?? '', limit: 20 },
    { enabled: !!projectId && !!debouncedToken && debouncedToken.kind !== 'error', staleTime: 5_000 },
  );

  const { data: errorResults } = trpc.error.list.useQuery(
    {
      projectId: projectId ?? '',
      resolved: false,
      limit: 50,
      offset: 0,
    },
    { enabled: !!projectId && !!debouncedToken && debouncedToken.kind === 'error', staleTime: 5_000 },
  );

  const currentKind = debouncedToken?.kind ?? 'node';

  const suggestions: MentionEntry[] =
    currentKind === 'error'
      ? (errorResults?.errors ?? [])
          .filter((error) => {
            const term = debouncedToken?.term.toLowerCase() ?? '';
            if (!term) return true;
            return (
              (error.error_type ?? '').toLowerCase().includes(term) ||
              (error.error_message ?? '').toLowerCase().includes(term)
            );
          })
          .slice(0, 8)
          .map((error) => ({
            kind: 'error' as const,
            id: error.id,
            label: error.error_type || 'Error',
            subtype: error.severity ?? undefined,
          }))
      : (() => {
          const nodes = searchResults?.nodes ?? [];
          if (currentKind === 'file') {
            const term = (debouncedToken?.term ?? '').toLowerCase();
            const files = new Map<string, string>();
            for (const node of nodes) {
              if (!node.file_path) continue;
              if (term && !node.file_path.toLowerCase().includes(term)) continue;
              if (!files.has(node.file_path)) {
                const parts = node.file_path.split('/');
                files.set(node.file_path, parts.slice(-2).join('/'));
              }
              if (files.size >= 8) break;
            }
            return Array.from(files.entries()).map(([filePath, label]) => ({
              kind: 'file' as const,
              id: filePath,
              label,
              subtype: filePath,
            }));
          }

          return nodes
            .filter((node) => nodeMatchesKind(node.type, currentKind))
            .slice(0, 8)
            .map((node) => ({
              kind: inferKindFromNodeType(node.type),
              id: node.id,
              label: node.name,
              subtype: node.type,
            }));
        })();

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
    (entry: MentionEntry) => {
      const el = ref.current;
      const cursor = el?.selectionStart ?? value.length;
      const newValue = replaceMentionToken(value, cursor, entry.label, mentionToken?.kind ?? entry.kind);
      onChange(newValue);

      const updated = [...mentions.filter((m) => !(m.kind === entry.kind && m.id === entry.id)), entry];
      setMentions(updated);
      onMentionsChange(updated);

      setPopupOpen(false);
      setMentionToken(null);
      setDebouncedToken(null);
      // Restore focus
      setTimeout(() => el?.focus(), 0);
    },
    [value, onChange, mentions, onMentionsChange, ref, mentionToken],
  );

  // Close popup when clicking outside (but not when clicking inside the popup itself)
  useEffect(() => {
    if (!popupOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current?.contains(e.target as Node)) return;
      if (popupRef.current?.contains(e.target as Node)) return;
      setPopupOpen(false);
      setMentionToken(null);
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
        <div ref={popupRef} className="absolute bottom-full mb-1 left-0 z-50 w-full min-w-65 max-w-100 rounded-md border bg-popover shadow-lg">
          <Command>
            <CommandList>
              <CommandEmpty>No matching results</CommandEmpty>
              <CommandGroup heading={`Matches for "#${mentionToken?.raw ?? ''}"`}>
                {suggestions.map((entry) => (
                  <CommandItem
                    key={`${entry.kind}:${entry.id}`}
                    value={`${entry.label} ${entry.subtype ?? ''}`}
                    onSelect={() => selectSuggestion(entry)}
                    className="gap-2 cursor-pointer flex-col items-start"
                  >
                    <div className="flex w-full items-center gap-2">
                      {entry.kind === 'error' ? (
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      ) : entry.kind === 'module' ? (
                        <Box className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      ) : entry.kind === 'function' ? (
                        <FunctionSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      ) : entry.kind === 'file' ? (
                        <FileCode className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <Hash className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="flex-1 truncate font-medium text-sm">{entry.label}</span>
                      <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                        {entry.kind}
                      </span>
                    </div>
                    {entry.subtype && (
                      <span className="pl-5 text-[10px] text-muted-foreground/70 font-mono truncate w-full">
                        {entry.subtype}
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
