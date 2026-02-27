import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/dashboard';

  if (code) {
    const cookiesToSet: { name: string; value: string; options?: object }[] = [];

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookies) {
            // Collect cookies to set on the response later
            cookiesToSet.push(
              ...cookies.map(({ name, value, options }) => ({ name, value, options })),
            );
          },
        },
      },
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const forwardedHost = request.headers.get('x-forwarded-host');
      // Treat as local if running via Next.js dev server OR if origin/host is
      // localhost / 127.0.0.1 (covers Docker with NODE_ENV=production).
      const isLocalOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(origin);
      const isLocalHost = forwardedHost
        ? /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(forwardedHost)
        : false;
      const isLocalEnv =
        process.env.NODE_ENV === 'development' || isLocalOrigin || isLocalHost;

      let redirectUrl: string;
      if (isLocalEnv) {
        // Always use http:// locally — Next.js dev / Docker doesn't have TLS.
        // Using https:// causes SSL_ERROR_RX_RECORD_TOO_LONG in Firefox/Zen.
        const base = forwardedHost ? `http://${forwardedHost}` : origin.replace(/^https:\/\//, 'http://');
        redirectUrl = `${base}${next}`;
      } else if (forwardedHost) {
        redirectUrl = `https://${forwardedHost}${next}`;
      } else {
        redirectUrl = `${origin}${next}`;
      }

      const response = NextResponse.redirect(redirectUrl);

      // Set auth cookies on the redirect response so the session persists
      for (const { name, value, options } of cookiesToSet) {
        response.cookies.set(name, value, options as any);
      }

      return response;
    }
  }

  // Auth code exchange failed — redirect to login with error
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
