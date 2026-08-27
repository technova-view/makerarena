insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true);
insert into storage.buckets (id, name, public) values ('products', 'products', true);

-- Path convention: avatars/{auth.uid()}/avatar.<ext>,
-- products/{auth.uid()}/{uuid}-{filename}. The folder-prefix check below is
-- what makes ownership enforcement work.
create policy "avatar images are publicly accessible" on storage.objects
  for select using (bucket_id = 'avatars');
create policy "users upload own avatar" on storage.objects
  for insert with check (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "product images are publicly accessible" on storage.objects
  for select using (bucket_id = 'products');
create policy "makers upload own product images" on storage.objects
  for insert with check (
    bucket_id = 'products' and (storage.foldername(name))[1] = auth.uid()::text
  );
