-- Shorten the placeholder username generated on signup. The email
-- local-part portion was capped at 23 chars, producing usernames like
-- "waliurrahman957_76ae6c" (22 chars) - unwieldy in the navbar, leaderboard,
-- and profile header. Drop any trailing digit run first (e.g. "957") so the
-- placeholder is just the name part, then cap at 20 chars as a safety net;
-- the trailing 6-hex-char suffix from the user's id still keeps it unique.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.makers (id, username, display_name)
  values (
    new.id,
    substr(
      regexp_replace(
        lower(regexp_replace(
          coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
          '[0-9]+$', ''
        )),
        '[^a-z0-9_]+', '_', 'g'
      ),
      1, 20
    ) || '_' || substr(new.id::text, 1, 6),
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;
