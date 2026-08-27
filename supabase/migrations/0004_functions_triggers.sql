-- Auto-create a makers row whenever a new auth user signs up. Runs in the
-- DB so there's no race between "auth user created" and "profile row
-- exists" even if the client crashes mid-signup. The username is a
-- placeholder; app/settings/profile prompts the user to pick a real one.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- Email local-parts can contain characters (+, ., !, etc.) that are valid
  -- in an email address but break as a literal path segment in
  -- /makers/[username] - strip anything outside [a-z0-9_] so the
  -- placeholder is always a safe, working profile URL. lower() first (not
  -- just a case-insensitive regexp flag) so surviving letters are guaranteed
  -- lowercase - matches makers.username's format check and
  -- makerProfileSchema's lowercase-only rule, otherwise a mixed-case email
  -- local-part (e.g. "John.Doe@...") would produce a placeholder that
  -- violates both and blocks the user from saving their profile. Also cap
  -- the length to stay under the 30-char limit both of those enforce -
  -- otherwise a long email does the same thing.
  insert into public.makers (id, username, display_name)
  values (
    new.id,
    substr(
      regexp_replace(
        lower(coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1))),
        '[^a-z0-9_]+', '_', 'g'
      ),
      1, 23
    ) || '_' || substr(new.id::text, 1, 6),
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- View counter. SECURITY DEFINER so anonymous visitors can increment it
-- despite the owner-only UPDATE policy on products. Only counts views on
-- published products - a draft/archived product shouldn't accumulate a
-- public view count even if someone still has its URL.
create or replace function public.increment_product_views(p_product_id uuid)
returns void
language sql
security definer set search_path = public
as $$
  update public.products
  set views = views + 1
  where id = p_product_id and status = 'published';
$$;

grant execute on function public.increment_product_views(uuid) to anon, authenticated;

-- Keep updated_at honest on UPDATE - without this it only ever reflects
-- INSERT time (the column default), never the actual last edit.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger makers_set_updated_at
  before update on public.makers
  for each row execute function public.set_updated_at();

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();
