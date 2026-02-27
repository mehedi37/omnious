'use client';

import {
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  FileCode,
  GitBranch,
  Github,
  Terminal,
  Upload,
  Workflow,
} from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-6 w-6 shrink-0"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}

function CodeBlock({ code, language = 'bash', copyText }: { code: string; language?: string; copyText?: string }) {
  return (
    <div className="relative group">
      <pre className="bg-zinc-950 dark:bg-zinc-900 text-zinc-100 rounded-lg p-4 text-sm font-mono overflow-x-auto border border-zinc-800">
        <code>{code}</code>
      </pre>
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <CopyButton text={copyText ?? code} />
      </div>
    </div>
  );
}

interface EmptyProjectStateProps {
  projectName: string;
  projectSlug: string;
  apiKey?: string | null;
  workspaceSlug: string;
}

export function EmptyProjectState({
  projectName,
  projectSlug,
  apiKey,
  workspaceSlug,
}: EmptyProjectStateProps) {
  const maskedKey = apiKey ? `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}` : 'kp_your_project_key';

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-3xl space-y-8">
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 border border-primary/20">
            <FileCode className="h-8 w-8 text-primary" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight">Index your codebase</h2>
          <p className="text-muted-foreground max-w-md mx-auto">
            <strong>{projectName}</strong> is ready. Push your code graph using the CLI or GitHub
            Actions to see the visualization.
          </p>
        </div>

        {/* Steps */}
        <div className="grid gap-4 md:grid-cols-3">
          <StepCard
            step={1}
            icon={Terminal}
            title="Install CLI"
            description="One command to get started"
          />
          <StepCard
            step={2}
            icon={GitBranch}
            title="Index your code"
            description="Parse AST & build the graph"
          />
          <StepCard
            step={3}
            icon={Upload}
            title="Push to Omnious"
            description="See your code come alive"
          />
        </div>

        {/* Method tabs */}
        <Tabs defaultValue="cli" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="cli" className="gap-2">
              <Terminal className="h-4 w-4" />
              CLI (Local)
            </TabsTrigger>
            <TabsTrigger value="github" className="gap-2">
              <Github className="h-4 w-4" />
              GitHub Actions
            </TabsTrigger>
          </TabsList>

          <TabsContent value="cli" className="space-y-4 mt-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Quick Start</CardTitle>
                <CardDescription>
                  Run these commands in your project root. Your source code never leaves your
                  machine — only the graph metadata is uploaded.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Badge
                      variant="outline"
                      className="h-5 w-5 rounded-full p-0 text-[10px] flex items-center justify-center"
                    >
                      1
                    </Badge>
                    Initialize your project
                  </div>
                  <CodeBlock
                    code={apiKey
                      ? `npx @omnious/cli init --link ${maskedKey}`
                      : 'npx @omnious/cli init -i'}
                    copyText={apiKey
                      ? `npx @omnious/cli init --link ${apiKey}`
                      : undefined}
                  />
                  {apiKey && (
                    <p className="text-xs text-muted-foreground pl-1">
                      The copy button above includes your full API key.{' '}
                      <span className="font-mono">{maskedKey}</span>
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Badge
                      variant="outline"
                      className="h-5 w-5 rounded-full p-0 text-[10px] flex items-center justify-center"
                    >
                      2
                    </Badge>
                    Parse & push your codebase
                  </div>
                  <CodeBlock code="npx @omnious/cli sync" />
                  <p className="text-xs text-muted-foreground pl-1">
                    Parses your AST locally, builds the OIR graph, and uploads metadata. Source code never leaves your machine.
                  </p>
                </div>

                <Separator />

                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    <strong>Check sync status</strong> — see what's been indexed:
                  </p>
                  <CodeBlock code="npx @omnious/cli status" />
                </div>
              </CardContent>
            </Card>

            {/* Config file */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileCode className="h-4 w-4" />
                  .omnious.yml
                </CardTitle>
                <CardDescription>
                  Created by{' '}
                  <code className="text-xs bg-muted px-1 py-0.5 rounded">omnious init</code> in your
                  project root
                </CardDescription>
              </CardHeader>
              <CardContent>
                <CodeBlock
                  language="yaml"
                  code={`# .omnious.yml
workspace: ${workspaceSlug}
project: ${projectSlug}
api_key: ${maskedKey}

# Parser settings
include:
  - "src/**/*.{ts,tsx,js,jsx}"
exclude:
  - "node_modules/**"
  - "**/*.test.*"
  - "**/*.spec.*"

# CI enforcement (optional)
ci:
  fail_on_error: false`}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="github" className="space-y-4 mt-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Workflow className="h-4 w-4" />
                  GitHub Actions Workflow
                </CardTitle>
                <CardDescription>
                  Add this workflow to your repository. Indexes automatically on every push to main.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Badge
                      variant="outline"
                      className="h-5 w-5 rounded-full p-0 text-[10px] flex items-center justify-center"
                    >
                      1
                    </Badge>
                    Add your project API key as a GitHub Secret
                  </div>
                  <p className="text-sm text-muted-foreground pl-7">
                    Go to <strong>Settings → Secrets → Actions</strong> and add{' '}
                    <code className="text-xs bg-muted px-1 py-0.5 rounded">
                      OMNIOUS_PROJECT_KEY
                    </code>
                  </p>
                  {apiKey && (
                    <div className="pl-7 flex items-center gap-2">
                      <code className="text-xs bg-muted px-2 py-1 rounded font-mono">
                        {maskedKey}
                      </code>
                      <CopyButton text={apiKey} />
                      <span className="text-xs text-muted-foreground">Copy full key</span>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Badge
                      variant="outline"
                      className="h-5 w-5 rounded-full p-0 text-[10px] flex items-center justify-center"
                    >
                      2
                    </Badge>
                    Create workflow file
                  </div>
                  <CodeBlock
                    language="yaml"
                    code={`# .github/workflows/omnious.yml
name: Omnious Index
on:
  push:
    branches: [main]

jobs:
  index:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Parse & Push to Omnious
        run: npx @omnious/cli sync
        env:
          OMNIOUS_PROJECT_KEY: \${{ secrets.OMNIOUS_PROJECT_KEY }}`}
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardContent className="pt-4">
                <div className="flex gap-3">
                  <CheckCircle2 className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium">No source code leaves your CI</p>
                    <p className="text-sm text-muted-foreground">
                      The CLI parses your AST locally and uploads only the graph structure (function
                      names, file paths, relationships). Raw source code is never transmitted.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* What happens next */}
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="pt-4">
            <div className="flex gap-3">
              <ArrowRight className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium">What happens after you push?</p>
                <p className="text-sm text-muted-foreground">
                  Your code graph will appear here automatically. You'll be able to explore function
                  relationships, replay traces through the graph, identify error hotspots, and ask
                  AI to analyze your architecture.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StepCard({
  step,
  icon: Icon,
  title,
  description,
}: {
  step: number;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <Card className="text-center">
      <CardContent className="pt-6 pb-4 space-y-2">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 border border-primary/20">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <Badge variant="secondary" className="text-[10px]">
          Step {step}
        </Badge>
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}
