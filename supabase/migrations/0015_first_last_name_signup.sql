-- Signup now collects first name + last name (see lib/actions/auth.ts)
-- instead of a single email-derived placeholder. Build the placeholder
-- username from the first name + the same 6-hex-char id suffix as before
-- (e.g. "wali_76ae6c"), and the display name as "First Last". Falls back
-- to the email local-part when first_name is missing (e.g. a user created
-- outside this signup form), matching the old behavior.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_first_name text := nullif(trim(new.raw_user_meta_data->>'first_name'), '');
  v_last_name text := nullif(trim(new.raw_user_meta_data->>'last_name'), '');
begin
  insert into public.makers (id, username, display_name)
  values (
    new.id,
    substr(
      regexp_replace(
        lower(coalesce(v_first_name, split_part(new.email, '@', 1))),
        '[^a-z0-9_]+', '_', 'g'
      ),
      1, 20
    ) || '_' || substr(new.id::text, 1, 6),
    coalesce(
      nullif(trim(both ' ' from concat(v_first_name, ' ', v_last_name)), ''),
      split_part(new.email, '@', 1)
    )
  );
  return new;
end;
$$;
