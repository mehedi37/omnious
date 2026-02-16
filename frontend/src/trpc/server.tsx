import 'server-only';

import { cache } from 'react';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { createHydrationHelpers } from '@trpc/react-query/rsc';
import superjson from 'superjson';
import { makeQueryClient } from './query-client';
import type { AppRouter } from './init';
import { createClient as createServerSupabase } from '@/lib/supabase/server';

export const getQueryClient = cache(makeQueryClient);

const getApiUrl = () =>
  `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/trpc`;

const serverClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      transformer: superjson,
      url: getApiUrl(),
      async headers() {
        const supabase = await createServerSupabase();
        const { data } = await supabase.auth.getSession();
        return {
          Authorization: data.session
            ? `Bearer ${data.session.access_token}`
            : '',
        };
      },
    }),
  ],
});

export const { trpc, HydrateClient } = createHydrationHelpers<AppRouter>(
  serverClient as any,
  getQueryClient,
);
