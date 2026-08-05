-- ============================================================================
-- nearby_models: make "Any" mean EVERYONE, and work with no location at all.
-- Run in the Supabase SQL editor.
--
-- ── THE PROBLEM ────────────────────────────────────────────────────────────
-- The previous definition required coordinates on BOTH sides:
--
--     and u.latitude is not null and u.longitude is not null
--
-- so a model who never granted location was invisible to every stylist, at every
-- radius, including "Any". And the dashboard never even called the RPC when the
-- stylist's own location was denied — it short-circuited to an empty "turn on
-- location" card.
--
-- Net effect: a stylist who declines the location prompt sees NO models at all,
-- and a stylist abroad (an app reviewer) sees none either. The browse screen for
-- models has no server-side geo filter, so the two sides disagreed about what
-- "Any" means.
--
-- ── THE RULE NOW ───────────────────────────────────────────────────────────
--   * p_radius_mi IS NULL ("Any")  → every model, coordinates or not.
--   * p_radius_mi given            → only models we can actually place within it.
--   * distance_mi is NULL whenever either side lacks coordinates, so the client
--     can simply omit the distance chip rather than invent a number.
--
-- Distance is computed ONCE in a lateral join instead of three times, so the
-- select, the filter and the sort can never disagree.
--
-- CREATE OR REPLACE can't change a function's return type, so drop first.
-- Dropping also drops privileges — hence the re-grant at the end.
--
-- NOTE: LEFT JOIN on model_attributes stays deliberate. An inner join would drop
-- every model who hasn't filled in their attributes (most of them at launch).
-- ============================================================================

drop function if exists public.nearby_models(double precision, double precision, double precision);

CREATE FUNCTION public.nearby_models(
  p_lat       double precision DEFAULT NULL::double precision,
  p_lng       double precision DEFAULT NULL::double precision,
  p_radius_mi double precision DEFAULT NULL::double precision
)
 RETURNS TABLE(id uuid, first_name text, last_initial text, profile_pic_url text, is_verified boolean, distance_mi double precision, hair_colour text, hair_type text, hair_length text, skin_tone text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    u.id, u.first_name, u.last_initial, u.profile_pic_url, u.is_verified,
    dist.d as distance_mi,
    ma.hair_colour, ma.hair_type, ma.hair_length, ma.skin_tone
  from public.users u
  left join public.model_attributes ma on ma.user_id = u.id
  cross join lateral (
    select case
      when p_lat is null or p_lng is null
        or u.latitude is null or u.longitude is null
      then null::double precision
      else 3959 * acos(
        -- Clamp BOTH ends: acos() errors outside [-1, 1], and floating-point
        -- drift can push near-antipodal pairs past -1. The old version clamped
        -- only the upper bound.
        greatest(-1.0, least(1.0,
          cos(radians(p_lat)) * cos(radians(u.latitude)) *
          cos(radians(u.longitude) - radians(p_lng)) +
          sin(radians(p_lat)) * sin(radians(u.latitude))
        ))
      )
    end as d
  ) dist
  where u.role = 'model'
    and (
      p_radius_mi is null            -- "Any" → everyone, coordinates or not
      or (dist.d is not null and dist.d <= p_radius_mi)
    )
  -- Nearest first when we know; unplaceable models last rather than dropped.
  order by dist.d asc nulls last, u.created_at desc nulls last, u.id
  limit 200;
$function$;

grant execute on function public.nearby_models(double precision, double precision, double precision) to authenticated;

-- Verify (expect: a row count > 0 for BOTH, and the second >= the first):
--   select count(*) from public.nearby_models(51.2787, 0.5217, 10);   -- Maidstone, 10 mi
--   select count(*) from public.nearby_models(null, null, null);      -- no location, Any
