'use client';

import { KeyRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function ApiKeyManager() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-5" />
          AI Provider Keys
        </CardTitle>
        <CardDescription>
          Bring-your-own-provider keys are temporarily disabled while local Ollama testing is active.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border bg-muted/30 p-4 text-sm">
          <p className="font-medium">Local Ollama mode is enabled.</p>
          <p className="mt-1 text-muted-foreground">
            The app now uses the backend Ollama settings from environment variables
            for AI chat and embeddings.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge variant="secondary">OLLAMA_BASE_URL</Badge>
            <Badge variant="secondary">OLLAMA_MODEL</Badge>
            <Badge variant="secondary">OLLAMA_EMBEDDING_MODEL</Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
