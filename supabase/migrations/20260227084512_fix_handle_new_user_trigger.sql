-- Migration: Fix missing on_auth_user_created trigger
--
-- The handle_new_user() function existed but was never attached to auth.users.
-- Without this trigger, OAuth sign-ups (Google, GitHub) do NOT auto-create a
-- profile row, causing auth.me to return NOT_FOUND on first login.

-- Re-create handle_new_user with better robustness:
--   - ON CONFLICT DO NOTHING to handle retries / race conditions
--   - Checks both 'full_name' (Google) and 'name' (GitHub) in raw_user_meta_data
--   - Falls back to email if no display name available
--   - Checks both 'avatar_url' (GitHub) and 'picture' (Google) for avatar
CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
AS $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      new.email
    ),
    coalesce(
      new.raw_user_meta_data ->> 'avatar_url',
      new.raw_user_meta_data ->> 'picture'
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Create the trigger (idempotent — drop first if it exists from a previous partial run)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill: create profiles for any existing auth users who don't have one
INSERT INTO public.profiles (id, display_name, avatar_url)
SELECT
  u.id,
  coalesce(
    u.raw_user_meta_data ->> 'full_name',
    u.raw_user_meta_data ->> 'name',
    u.email
  ),
  coalesce(
    u.raw_user_meta_data ->> 'avatar_url',
    u.raw_user_meta_data ->> 'picture'
  )
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;
