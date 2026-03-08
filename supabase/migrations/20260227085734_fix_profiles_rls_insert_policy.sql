-- Fix: Add INSERT RLS policy on profiles so that the authenticated user can
-- insert their own row, and so that the service role (adminDb) can always bypass.
-- Without this, the fallback profile creation in auth.me was silently failing.

CREATE POLICY "Users can insert own profile"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK ((auth.uid() = id));
