'use client';

import type { QueryClient } from '@tanstack/react-query';
import { QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { createTRPCReact } from '@trpc/react-query';
import { useState } from 'react';
import superjson from 'superjson';
import { createClient as createBrowserClient } from '@/lib/supabase/client';
import type { AppRouter } from './init';
import { makeQueryClient } from './query-client';

export const trpc = createTRPCReact<AppRouter>();

let clientQueryClientSingleton: QueryClient | undefined;
function getQueryClient() {
  if (typeof window === 'undefined') {
    return makeQueryClient();
  }
  if (!clientQueryClientSingleton) {
    clientQueryClientSingleton = makeQueryClient();
  }
  return clientQueryClientSingleton;
}

function getApiUrl() {
  return `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/trpc`;
}

export function TRPCProvider(props: Readonly<{ children: React.ReactNode }>) {
  const queryClient = getQueryClient();
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          transformer: superjson,
          url: getApiUrl(),
          async headers() {
            const supabase = createBrowserClient();
            const { data } = await supabase.auth.getSession();
            return {
              Authorization: data.session ? `Bearer ${data.session.access_token}` : '',
            };
          },
        }),
      ],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {props.children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
