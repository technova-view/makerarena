-- Phase 2A: battles/voting/Elo. There is no persistent "battle" entity - a
-- battle *is* one vote. Pairings are generated on the fly (get_random_pairing)
-- and only become a row once someone actually votes (cast_vote). This keeps
-- the atomic unit for both the Elo update and battle history to a single
-- table, rather than juggling a battle lifecycle (scheduled/open/resolved)
-- that doesn't actually match "one visitor picks one winner, instantly."

-- Denormalized battle counter, maintained only by cast_vote(). Drives the
-- provisional-K Elo scheme below and is cheaper to read than COUNT(*) over
-- votes on every vote cast.
alter table public.products
  add column battles_count integer not null default 0 check (battles_count >= 0);

-- Pre-existing gap, closed here: RLS's "maker can update own product" policy
-- is row-level only (maker_id = auth.uid()), so without this a maker could
-- PATCH /rest/v1/products with {"rating": 9999} directly and RLS would allow
-- it - the row is theirs, RLS never looked at which columns changed. Doesn't
-- matter much while rating is a placeholder, matters a lot now that it's
-- about to become a real competitive score. SECURITY DEFINER functions
-- (cast_vote, increment_product_views) are unaffected - they run as the
-- function owner, not as the authenticated/anon role the REST API uses.
--
-- A column-level REVOKE alone does NOT work here: Supabase grants a broad
-- table-level UPDATE to authenticated/anon by default, and table-level and
-- column-level privileges are independent grant paths in Postgres - a
-- column-level REVOKE only undoes a column-level GRANT, it can't narrow a
-- table-level one that already permits the same column (confirmed by
-- testing directly against the live project: the naive column-level revoke
-- alone let a maker PATCH their own rating anyway). The actual fix is to
-- revoke the table-level grant entirely, then re-grant UPDATE only on the
-- specific columns the app is meant to let makers edit directly - matching
-- exactly the field list createProduct/lib/types/database.types.ts already
-- treats as user-editable.
revoke update on public.products from authenticated, anon;

grant update (
  category_slug, name, tagline, description, website_url,
  logo_url, screenshots, status
) on public.products to authenticated;

-- One row per resolved 1v1 vote - the atomic unit for both Elo updates and
-- battle history. Before/after snapshots are stored now (cheap) so a future
-- ranking-history chart never needs a backfill or has to replay the Elo
-- formula under whatever K/version happened to be live at vote time.
create table public.votes (
  id                   uuid primary key default gen_random_uuid(),
  -- Nullable + on delete set null (not cascade): a vote is a permanent
  -- record of a rating change that already happened. If a voter's account
  -- is ever removed, that history shouldn't vanish along with them - only
  -- the identity of who cast it should.
  voter_id             uuid references public.makers(id) on delete set null,
  -- No cascade: products are never hard-deleted, only archived.
  winner_product_id    uuid not null references public.products(id),
  loser_product_id     uuid not null references public.products(id),
  winner_rating_before integer not null check (winner_rating_before >= 0),
  loser_rating_before  integer not null check (loser_rating_before >= 0),
  winner_rating_after  integer not null check (winner_rating_after >= 0),
  loser_rating_after   integer not null check (loser_rating_after >= 0),
  created_at           timestamptz not null default now(),
  check (winner_product_id <> loser_product_id)
);

-- Supports: rate-limit + pair-cooldown lookups in cast_vote (voter_id +
-- created_at), and "battle history for product X" queries (Postgres
-- bitmap-ORs the two single-column indexes for the "either side" case).
create index votes_voter_created_idx on public.votes (voter_id, created_at desc);
create index votes_winner_idx on public.votes (winner_product_id, created_at desc);
create index votes_loser_idx on public.votes (loser_product_id, created_at desc);

alter table public.votes enable row level security;

-- No INSERT/UPDATE/DELETE policy at all - the only write path is
-- cast_vote(), which is SECURITY DEFINER and bypasses RLS, exactly
-- mirroring handle_new_user() and increment_product_views(). A raw client
-- write against votes is always denied by RLS's default-deny.
--
-- Public SELECT, consistent with every other table in this app being fully
-- public. voter_id is technically queryable via the REST API even though
-- the UI never displays "who voted" (battle history shows opponent, result,
-- and rating delta only).
create policy "votes are publicly readable" on public.votes
  for select using (true);

-- Elo update + vote record, atomically. Reads+locks both product rows,
-- computes standard Elo with a provisional-K tier, writes both ratings and
-- inserts the vote row in one function invocation (one transaction).
create or replace function public.cast_vote(
  p_winner_product_id uuid,
  p_loser_product_id uuid
)
returns table (
  winner_rating_before integer,
  loser_rating_before integer,
  winner_rating_after integer,
  loser_rating_after integer
)
language plpgsql
security definer set search_path = public
as $$
declare
  v_voter_id      uuid := auth.uid();
  v_first_id      uuid;
  v_second_id     uuid;
  v_first         record;
  v_second        record;
  v_winner        record;
  v_loser         record;
  v_expected_win  numeric;
  v_k_winner      integer;
  v_k_loser       integer;
  v_new_winner    integer;
  v_new_loser     integer;
  v_recent_votes  integer;
begin
  if v_voter_id is null then
    raise exception 'You must be signed in to vote.' using errcode = '28000';
  end if;

  if p_winner_product_id = p_loser_product_id then
    raise exception 'A product cannot be matched against itself.' using errcode = '22023';
  end if;

  -- Rate limit: cap per-voter volume in a rolling window. No external infra
  -- needed at this scale - a single indexed count query.
  select count(*) into v_recent_votes
  from public.votes
  where voter_id = v_voter_id and created_at > now() - interval '1 hour';

  if v_recent_votes >= 60 then
    raise exception 'You are voting too quickly - try again in a bit.' using errcode = '55006';
  end if;

  -- Pair-cooldown: the closest equivalent to "one vote per battle" once
  -- pairings are ephemeral rather than persistent rows. Blocks a voter from
  -- repeatedly farming the same matchup; does not block them from voting on
  -- other pairings, or on this same pairing again after the window.
  if exists (
    select 1 from public.votes
    where voter_id = v_voter_id
      and created_at > now() - interval '24 hours'
      and ((winner_product_id = p_winner_product_id and loser_product_id = p_loser_product_id)
        or (winner_product_id = p_loser_product_id and loser_product_id = p_winner_product_id))
  ) then
    raise exception 'You already voted on this matchup recently.' using errcode = '22023';
  end if;

  -- Lock both product rows in a stable (id-ordered) sequence, regardless of
  -- which one "won". This is the concurrency-safety load-bearing part: two
  -- concurrent cast_vote calls touching an overlapping pair of products
  -- always attempt their `for update` locks in the same global order, so
  -- (a) no deadlock, and (b) the second call blocks until the first
  -- commits, then reads the already-updated rating - a naive read-then-
  -- write from application code would instead race and silently lose one
  -- of the two updates.
  if p_winner_product_id < p_loser_product_id then
    v_first_id := p_winner_product_id; v_second_id := p_loser_product_id;
  else
    v_first_id := p_loser_product_id; v_second_id := p_winner_product_id;
  end if;

  select id, rating, battles_count, maker_id, status into v_first
    from public.products where id = v_first_id for update;
  select id, rating, battles_count, maker_id, status into v_second
    from public.products where id = v_second_id for update;

  if v_first.id is null or v_second.id is null then
    raise exception 'One of these products no longer exists.' using errcode = 'P0002';
  end if;

  if v_first.status <> 'published' or v_second.status <> 'published' then
    raise exception 'Both products must be published to be voted on.' using errcode = '22023';
  end if;

  if v_first.maker_id = v_voter_id or v_second.maker_id = v_voter_id then
    raise exception 'You cannot vote on a matchup that includes your own product.' using errcode = '42501';
  end if;

  if v_first.id = p_winner_product_id then
    v_winner := v_first; v_loser := v_second;
  else
    v_winner := v_second; v_loser := v_first;
  end if;

  -- Standard Elo. Provisional K (48 while a product has fewer than 10
  -- recorded battles, 24 after) captures "a new product's own rating swings
  -- more" independently of the upset itself - the expected-score term
  -- already makes upsets swing more for *both* sides regardless of K, since
  -- a big rating gap pushes the expected score toward the extremes; the
  -- provisional tier is the additional new-product-specific effect.
  v_expected_win := 1.0 / (1.0 + power(10.0, (v_loser.rating - v_winner.rating) / 400.0));
  v_k_winner := case when v_winner.battles_count < 10 then 48 else 24 end;
  v_k_loser  := case when v_loser.battles_count  < 10 then 48 else 24 end;

  -- greatest(0, ...) is a defensive clamp, not an expected code path: with
  -- K <= 48 a single vote can move a rating by at most 48, so reaching the
  -- rating >= 0 floor from a starting rating of 1500 would require dozens
  -- of consecutive maximum-magnitude losses against ever-higher-rated
  -- opponents, which is self-limiting (each loss lowers the loser's own
  -- rating, shrinking the gap and thus the next loss's magnitude). The
  -- clamp exists purely so a pathological sequence fails safe (rating
  -- floors at 0) instead of tripping the rating >= 0 CHECK constraint and
  -- aborting an otherwise-legitimate vote's transaction.
  v_new_winner := greatest(0, round(v_winner.rating + v_k_winner * (1 - v_expected_win))::integer);
  v_new_loser  := greatest(0, round(v_loser.rating  - v_k_loser  * (1 - v_expected_win))::integer);

  update public.products
    set rating = v_new_winner, battles_count = v_winner.battles_count + 1
    where id = v_winner.id;

  update public.products
    set rating = v_new_loser, battles_count = v_loser.battles_count + 1
    where id = v_loser.id;

  insert into public.votes (
    voter_id, winner_product_id, loser_product_id,
    winner_rating_before, loser_rating_before, winner_rating_after, loser_rating_after
  ) values (
    v_voter_id, v_winner.id, v_loser.id,
    v_winner.rating, v_loser.rating, v_new_winner, v_new_loser
  );

  return query select v_winner.rating, v_loser.rating, v_new_winner, v_new_loser;
end;
$$;

-- Not granted to anon - voting requires auth. The v_voter_id null check
-- above is defense in depth in case grants ever change.
grant execute on function public.cast_vote(uuid, uuid) to authenticated;

-- Pairing generator. security invoker (the default - deliberately NOT
-- definer), because it only ever needs to see what's already publicly
-- selectable under the existing "published products are public" RLS policy;
-- running as invoker means RLS stays a live second line of defense even if
-- this function's own WHERE clause ever has a bug. Not marked `stable`: it
-- calls random(), which is volatile, so claiming stability would be lying
-- to the query planner about a function whose result must differ on every
-- call. Exists only because PostgREST's query builder can't express
-- `order by random()`.
create or replace function public.get_random_pairing(
  p_viewer_id uuid default null,
  p_category_slug text default null
)
returns table (
  id uuid, name text, slug text, tagline text, logo_url text,
  rating integer, category_slug text
)
language sql
as $$
  select id, name, slug, tagline, logo_url, rating, category_slug
  from public.products
  where status = 'published'
    and (p_viewer_id is null or maker_id <> p_viewer_id)
    and (p_category_slug is null or category_slug = p_category_slug)
  order by random()
  limit 2;
$$;

grant execute on function public.get_random_pairing(uuid, text) to anon, authenticated;
