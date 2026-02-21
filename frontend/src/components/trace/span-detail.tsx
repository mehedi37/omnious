'use client';

import { AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { TRACE_STATUS_STYLES } from '@/lib/oir/constants';
import type { Span } from '@/lib/oir/types';
import { formatDuration } from '@/lib/utils/format';

interface SpanDetailProps {
  span: Span;
  leftPercent: number;
  widthPercent: number;
}

export function SpanDetail({ span, leftPercent, widthPercent }: SpanDetailProps) {
  const [expanded, setExpanded] = useState(false);
  const isError = span.status === 'error';

  return (
    <div className="group">
      {/* Span row */}
      <button
        type="button"
        className={`
          flex items-center w-full hover:bg-muted/50 rounded-md px-2 py-1.5 text-left
          transition-colors
          ${isError ? 'bg-red-500/5' : ''}
        `}
        onClick={() => setExpanded(!expanded)}
      >
        {/* Expand toggle */}
        <div className="w-5 shrink-0">
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </div>

        {/* Operation name */}
        <div className="w-[200px] shrink-0 truncate">
          <span className="text-sm font-medium">{span.operation}</span>
          {span.service_name && (
            <span className="text-[11px] text-muted-foreground ml-1">({span.service_name})</span>
          )}
        </div>

        {/* Status */}
        <div className="w-[60px] shrink-0">
          <Badge
            variant="outline"
            className={`text-[10px] ${TRACE_STATUS_STYLES[span.status] ?? ''}`}
          >
            {span.status}
          </Badge>
        </div>

        {/* Waterfall bar */}
        <div className="flex-1 mx-4 h-5 relative">
          <div
            className={`
              absolute top-0.5 h-4 rounded-sm transition-all
              ${isError ? 'bg-red-500/60' : 'bg-primary/40'}
            `}
            style={{
              left: `${Math.min(leftPercent, 99)}%`,
              width: `${Math.min(widthPercent, 100 - leftPercent)}%`,
              minWidth: '4px',
            }}
          />
        </div>

        {/* Duration */}
        <div className="w-[80px] shrink-0 text-right">
          <span className="font-mono text-xs text-muted-foreground">
            {span.duration_ms != null ? formatDuration(span.duration_ms) : '—'}
          </span>
        </div>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="ml-7 mr-2 mb-2 p-3 rounded-md bg-muted/50 space-y-2 text-sm">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1">
            <div>
              <span className="text-xs text-muted-foreground">Span ID</span>
              <p className="font-mono text-xs">{span.span_id}</p>
            </div>
            {span.parent_span_id && (
              <div>
                <span className="text-xs text-muted-foreground">Parent Span</span>
                <p className="font-mono text-xs">{span.parent_span_id}</p>
              </div>
            )}
            {span.kind && (
              <div>
                <span className="text-xs text-muted-foreground">Kind</span>
                <p className="text-xs capitalize">{span.kind}</p>
              </div>
            )}
            {span.code_node_id && (
              <div>
                <span className="text-xs text-muted-foreground">Code Node</span>
                <p className="font-mono text-xs truncate">{span.code_node_id}</p>
              </div>
            )}
          </div>

          {/* Error info */}
          {span.error_message && (
            <div className="flex items-start gap-2 p-2 rounded bg-red-500/10 border border-red-500/20">
              <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
              <div className="space-y-1 min-w-0">
                <p className="text-sm text-red-600 dark:text-red-400">{span.error_message}</p>
                {span.error_stack && (
                  <pre className="text-[11px] font-mono text-muted-foreground whitespace-pre-wrap overflow-x-auto">
                    {span.error_stack}
                  </pre>
                )}
              </div>
            </div>
          )}

          {/* Attributes */}
          {Object.keys(span.attributes ?? {}).length > 0 && (
            <div>
              <span className="text-xs text-muted-foreground">Attributes</span>
              <div className="rounded-md bg-background p-2 mt-1 space-y-0.5">
                {Object.entries(span.attributes ?? {}).map(([key, value]) => (
                  <div key={key} className="flex justify-between text-xs">
                    <span className="font-mono text-muted-foreground">{key}</span>
                    <span className="font-mono truncate ml-2 max-w-[60%] text-right">
                      {String(value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
