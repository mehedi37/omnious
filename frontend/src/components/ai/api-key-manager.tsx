'use client';

import { Key, Loader2, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { trpc } from '@/trpc/client';

const PROVIDERS = [
  { value: 'openai', label: 'OpenAI', prefix: 'sk-' },
  { value: 'anthropic', label: 'Anthropic', prefix: 'sk-ant-' },
  { value: 'groq', label: 'Groq', prefix: 'gsk_' },
] as const;

type Provider = (typeof PROVIDERS)[number]['value'];

const PROVIDER_COLORS: Record<string, string> = {
  openai: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20',
  anthropic: 'bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20',
  groq: 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20',
};

export function ApiKeyManager() {
  const utils = trpc.useUtils();
  const keysQuery = trpc.ai.listApiKeys.useQuery();
  const keys = keysQuery.data ?? [];

  const [provider, setProvider] = useState<Provider>('groq');
  const [label, setLabel] = useState('Default');
  const [apiKey, setApiKey] = useState('');
  const [showForm, setShowForm] = useState(false);

  const addMutation = trpc.ai.addApiKey.useMutation({
    onSuccess: () => {
      toast.success('API key added');
      utils.ai.listApiKeys.invalidate();
      setApiKey('');
      setLabel('Default');
      setShowForm(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.ai.deleteApiKey.useMutation({
    onSuccess: () => {
      toast.success('API key deleted');
      utils.ai.listApiKeys.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const handleAdd = () => {
    if (!apiKey.trim()) {
      toast.error('Please enter an API key');
      return;
    }
    const keyPrefix = apiKey.slice(0, Math.min(8, apiKey.length)) + '…';
    addMutation.mutate({
      provider,
      label: label.trim() || 'Default',
      rawKey: apiKey.trim(),
      keyPrefix,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Key className="size-5" />
          AI Provider Keys
        </CardTitle>
        <CardDescription>
          Add your own API keys for AI features. Supports OpenAI, Anthropic, and Groq (free tier available).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Existing keys */}
        {keys.length > 0 ? (
          <div className="space-y-2">
            {keys.map((k) => (
              <div
                key={k.id}
                className="flex items-center justify-between rounded-lg border px-3 py-2"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Badge
                    variant="outline"
                    className={PROVIDER_COLORS[k.provider] ?? ''}
                  >
                    {k.provider}
                  </Badge>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{k.label}</p>
                    <p className="text-xs text-muted-foreground font-mono">
                      {k.key_prefix ? `${k.key_prefix}••••••` : '••••••••'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {k.is_active && (
                    <Badge variant="secondary" className="text-[10px]">
                      Active
                    </Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => deleteMutation.mutate({ keyId: k.id })}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border-2 border-dashed p-4 text-center text-sm text-muted-foreground">
            No API keys configured. AI features require at least one provider key.
          </div>
        )}

        <Separator />

        {/* Add key form */}
        {showForm ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ai-provider">Provider</Label>
                <Select value={provider} onValueChange={(v) => setProvider(v as Provider)}>
                  <SelectTrigger id="ai-provider">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDERS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ai-label">Label</Label>
                <Input
                  id="ai-label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Default"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-key">API Key</Label>
              <Input
                id="ai-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={PROVIDERS.find((p) => p.value === provider)?.prefix + '••••••••'}
              />
              {provider === 'groq' && (
                <p className="text-[11px] text-muted-foreground">
                  Get a free key at{' '}
                  <a
                    href="https://console.groq.com/keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    console.groq.com/keys
                  </a>
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Button onClick={handleAdd} disabled={addMutation.isPending} size="sm">
                {addMutation.isPending ? (
                  <Loader2 className="size-4 mr-1.5 animate-spin" />
                ) : (
                  <Plus className="size-4 mr-1.5" />
                )}
                Save Key
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowForm(false);
                  setApiKey('');
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setShowForm(true)}>
            <Plus className="size-4 mr-1.5" />
            Add API Key
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
