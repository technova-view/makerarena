-- Phase 2B.2: Divisions. Global, percentile-based competitive tiers,
-- computed fresh on every read from the current live rating distribution -
-- deliberately NOT a products.division column and NOT materialized. A
-- single vote can move the percentile cutoffs for the whole eligible
-- population, not just the two products in that vote, so any cached/
-- stored division would need invalidation logic touching the entire
-- products table on every vote - premature complexity this project's
-- established "don't overbuild" posture doesn't justify yet at this
-- population size (see get_random_pairing's accepted order-by-random()
-- full scan for the same kind of call).
--
-- Scope: GLOBAL across all categories, not per-category - matches how
-- get_random_pairing already mixes categories by default in battles, so a
-- product's rating reflects overall competitive strength, not
-- category-specific strength. Category-specific standing is already
-- covered separately by season_results.category_rank - divisions don't
-- duplicate that.
--
-- Population = published products with battles_count >= 10 - the exact
-- same threshold that already gates the Elo K-factor in cast_vote().
-- Excluded entirely from the population (not merely hidden from their own
-- division): a rating that's still converging (K=48) shouldn't help set
-- the percentile cutoffs other, established products are judged against,
-- any more than it's trusted for its own Elo accuracy yet. This also
-- keeps `population` in this function's own output exactly equal to
-- count(*) of the rows it returns - no second query needed anywhere to
-- know what a percentile was computed against.
--
-- Tie-break: rating desc, created_at asc - identical to every existing
-- leaderboard/pairing query in this app - applied via row_number() (a
-- strict, gap-free ordinal), NOT rank()/dense_rank(). This is
-- deliberately different from season_results.category_rank/overall_rank,
-- which use rank() (ties share a displayed position - a display concept:
-- "you tied for #1"). Percentile-cutoff arithmetic needs an unambiguous
-- row position to divide the population at exact counts; row_number()
-- gives that cleanly, rank() would leave gaps that make cutoff arithmetic
-- ambiguous at ties. Different ranking concepts for different purposes,
-- kept intentionally separate.
--
-- Cutoffs: ceil(population * fraction) for strictly increasing fractions
-- (0.05, 0.20, 0.40, 0.70, 1.0). This is provably monotonic for any
-- population - multiplying by a positive constant preserves strict
-- ordering, and ceil() is a monotonically non-decreasing function, so
-- composing them can never produce a cutoff smaller than the previous
-- one. No band is ever empty once population >= 6; below that, at least
-- one band is mathematically unavoidable to leave empty (can't split
-- fewer than 5 items into 5 non-empty groups). MIN_RANKED_POPULATION=20
-- below guards against a different problem: a statistically thin,
-- flickering Elite tier (exactly 1 product for the whole 6-20 range,
-- which would flip to a different product on a single vote), not against
-- mathematically empty bands.
create or replace function public.product_divisions()
returns table (
  product_id    uuid,
  division      text,
  population    integer,
  rank_position integer
)
language sql
stable
security invoker
as $$
  with eligible as (
    select
      p.id,
      (row_number() over (order by p.rating desc, p.created_at asc))::integer as rank_position,
      (count(*) over ())::integer as population
    from public.products p
    where p.status = 'published'
      and p.battles_count >= 10
  )
  select
    e.id,
    case
      when e.rank_position <= ceil(e.population * 0.05) then 'elite'
      when e.rank_position <= ceil(e.population * 0.20) then 'diamond'
      when e.rank_position <= ceil(e.population * 0.40) then 'gold'
      when e.rank_position <= ceil(e.population * 0.70) then 'silver'
      else 'bronze'
    end as division,
    e.population,
    e.rank_position
  from eligible e
  where e.population >= 20; -- MIN_RANKED_POPULATION, tunable literal
$$;

-- No REVOKE needed here, unlike cast_vote/run_season_transition. Those
-- functions needed an explicit revoke because Postgres's default EXECUTE
-- grant to PUBLIC was *more permissive than intended* (cast_vote requires
-- auth; run_season_transition is ops-only). This function has no such
-- gap: it only ever surfaces rating/battles_count for already-published
-- products, which are already fully public via a direct SELECT against
-- products today - the default posture already matches the intended one,
-- exactly like get_random_pairing (which also needed no revoke).
grant execute on function public.product_divisions() to anon, authenticated;
