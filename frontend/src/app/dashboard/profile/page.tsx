'use client';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { ApiKeyManager } from '@/components/ai/api-key-manager';
import { trpc } from '@/trpc/client';

export default function ProfilePage() {
  const { data: profile } = trpc.auth.me.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  });

  const displayName = profile?.display_name ?? 'Account';
  const initials =
    displayName
      .split(' ')
      .map((w: string) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || 'U';

  return (
    <div className="max-w-2xl space-y-6 p-6">
      <div>
        <h2 className="text-lg font-semibold">Profile Settings</h2>
        <p className="text-sm text-muted-foreground">
          Manage your account and AI runtime settings
        </p>
      </div>

      {/* Profile Info */}
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Your account information</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <Avatar className="size-14">
              {profile?.avatar_url && (
                <AvatarImage src={profile.avatar_url} alt={displayName} />
              )}
              <AvatarFallback className="text-lg">{initials}</AvatarFallback>
            </Avatar>
            <div className="space-y-1">
              <p className="text-sm font-medium">{displayName}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* AI Runtime */}
      <div>
        <h3 className="text-sm font-semibold mb-3">AI Runtime</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Omnious is currently configured for local Ollama usage. BYOK provider key management is paused for this testing phase.
        </p>
      </div>
      <ApiKeyManager />
    </div>
  );
}
