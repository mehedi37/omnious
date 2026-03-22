'use client';

import { Check, Copy } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import 'highlight.js/styles/github-dark.css';
import type { Components } from 'react-markdown';

const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeHighlight];

function CodeCopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [code]);
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="absolute right-2 top-2 rounded p-1 text-muted-foreground/60 hover:text-muted-foreground transition-colors"
      title="Copy code"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

const COMPONENTS: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2 hover:opacity-80"
    >
      {children}
    </a>
  ),
  p: ({ children }) => <p className="leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="list-disc pl-5 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 space-y-1">{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
  pre: ({ children, ...props }) => {
    const codeEl = (
      props as {
        node?: {
          children?: Array<{
            tagName?: string;
            children?: Array<{ value?: string }>;
          }>;
        };
      }
    ).node?.children?.[0];
    const textContent =
      codeEl?.tagName === 'code' ? (codeEl.children?.map((c) => c.value ?? '').join('') ?? '') : '';
    const langClass = (
      codeEl as { properties?: { className?: string[] } }
    )?.properties?.className?.find((c: string) => c.startsWith('language-'));
    const lang = langClass?.replace('language-', '') ?? '';
    return (
      <div className="group relative">
        {lang && (
          <span className="absolute left-3 top-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/50">
            {lang}
          </span>
        )}
        <CodeCopyButton code={textContent} />
        <pre className={`overflow-x-auto rounded-md bg-[#0d1117] p-3 ${lang ? 'pt-7' : ''}`}>
          {children}
        </pre>
      </div>
    );
  },
  code: ({ className, children }) => {
    const isBlock = Boolean(className);
    if (!isBlock) {
      return (
        <code className="rounded bg-background/60 px-1 py-0.5 font-mono text-xs">{children}</code>
      );
    }
    return <code className={`font-mono text-xs ${className ?? ''}`}>{children}</code>;
  },
};

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  className,
}: MarkdownRendererProps) {
  return (
    <div className={className ?? 'prose prose-sm dark:prose-invert max-w-none text-sm'}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={COMPONENTS}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
