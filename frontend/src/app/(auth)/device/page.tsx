'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2, Terminal, Loader2, XCircle } from 'lucide-react';
import { trpc } from '@/trpc/client';

type AuthPageState = 'input' | 'authorizing' | 'success' | 'error';

function DeviceAuthForm() {
  const searchParams = useSearchParams();
  const prefillCode = searchParams.get('code') ?? '';

  const [userCode, setUserCode] = useState(prefillCode);
  const [state, setState] = useState<AuthPageState>('input');
  const [errorMessage, setErrorMessage] = useState('');

  const authorizeMutation = trpc.auth.deviceAuthorize.useMutation({
    onSuccess: () => {
      setState('success');
    },
    onError: (err) => {
      setState('error');
      setErrorMessage(err.message);
    },
  });

  const handleAuthorize = useCallback(() => {
    if (!userCode.trim()) return;
    setState('authorizing');
    authorizeMutation.mutate({ userCode: userCode.trim().toUpperCase() });
  }, [userCode, authorizeMutation]);

  // Auto-submit if code came from URL
  useEffect(() => {
    if (prefillCode && prefillCode.length >= 8) {
      handleAuthorize();
    }
    // Only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader className="text-center">
        <div className="flex justify-center mb-4">
          <div className="rounded-full bg-primary/10 p-3">
            <Terminal className="h-6 w-6 text-primary" />
          </div>
        </div>
        <CardTitle className="text-xl">Authorize CLI</CardTitle>
        <CardDescription>
          Enter the code shown in your terminal to authorize the Omnious CLI.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {state === 'input' && (
          <>
            <Input
              placeholder="ABCD-1234"
              value={userCode}
              onChange={(e) => setUserCode(e.target.value.toUpperCase())}
              className="text-center text-lg font-mono tracking-widest"
              maxLength={9}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAuthorize();
              }}
            />
            <Button
              onClick={handleAuthorize}
              className="w-full"
              disabled={userCode.trim().length < 8}
            >
              Authorize
            </Button>
          </>
        )}

        {state === 'authorizing' && (
          <div className="flex flex-col items-center gap-3 py-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Authorizing…</p>
          </div>
        )}

        {state === 'success' && (
          <div className="flex flex-col items-center gap-3 py-4">
            <CheckCircle2 className="h-10 w-10 text-green-500" />
            <p className="text-sm font-medium">CLI authorized successfully!</p>
            <p className="text-sm text-muted-foreground">
              You can close this tab and return to your terminal.
            </p>
          </div>
        )}

        {state === 'error' && (
          <div className="flex flex-col items-center gap-3 py-4">
            <XCircle className="h-10 w-10 text-destructive" />
            <p className="text-sm font-medium">Authorization failed</p>
            <p className="text-sm text-muted-foreground">{errorMessage}</p>
            <Button
              variant="outline"
              onClick={() => {
                setState('input');
                setErrorMessage('');
              }}
            >
              Try Again
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function DeviceAuthPage() {
  return (
    <Suspense fallback={
      <Card className="w-full max-w-md mx-auto">
        <CardContent className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </CardContent>
      </Card>
    }>
      <DeviceAuthForm />
    </Suspense>
  );
}
