alter table public.makers enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.subscriptions enable row level security;
alter table public.payments enable row level security;
alter table public.featured_campaigns enable row level security;

-- makers: public read, owner update, no delete (deletion happens via
-- auth.users cascade only). No INSERT policy - the only row creation path
-- is handle_new_user()'s trigger, which runs SECURITY DEFINER and bypasses
-- RLS entirely, so a general-purpose insert policy would be unused surface.
create policy "makers are publicly readable" on public.makers
  for select using (true);
create policy "user can update own maker row" on public.makers
  for update using (auth.uid() = id);

-- categories: public read only, seeded via migration, no app writes
create policy "categories are publicly readable" on public.categories
  for select using (true);

-- products: published rows are public, owners can see/write all of their
-- own (including drafts); no delete policy - use status='archived' instead
create policy "published products are public" on public.products
  for select using (status = 'published' or maker_id = auth.uid());
create policy "maker can insert own product" on public.products
  for insert with check (maker_id = auth.uid());
create policy "maker can update own product" on public.products
  for update using (maker_id = auth.uid());

-- commercial tables: owner-only reads; nothing writes via these policies yet
-- (a future payment webhook will use the service-role key, which bypasses
-- RLS entirely and is separate, explicitly-written code)
create policy "maker reads own subscriptions" on public.subscriptions
  for select using (maker_id = auth.uid());
create policy "maker reads own payments" on public.payments
  for select using (maker_id = auth.uid());
create policy "maker reads own featured campaigns" on public.featured_campaigns
  for select using (
    product_id in (select id from public.products where maker_id = auth.uid())
  );
