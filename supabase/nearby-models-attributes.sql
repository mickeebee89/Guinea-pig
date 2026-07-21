-- ============================================================================
-- nearby_models: return model attributes so the stylist dashboard filters work.
-- Run in the Supabase SQL editor. (Already applied 21 Jul — kept for the record,
-- since the function definition lives only in the live DB.)
--
-- Before: the RPC returned only id/name/pic/verified/distance, so the dashboard
-- hardcoded hair_colour/hair_type/hair_length/skin_tone to null. That made all 26
-- attribute filter chips (Hair colour 11, Hair type 4, Hair length 4, Skin tone 7)
-- return zero results every time, and the nearby-model cards drop their attr chips.
-- The data already existed in model_attributes — it just wasn't selected.
--
-- NOTE: LEFT JOIN is deliberate. An inner join would drop every model who hasn't
-- filled in their attributes (most of them at launch), shrinking the nearby list
-- instead of enriching it.
--
-- CREATE OR REPLACE can't change a function's return type, so drop first.
-- Dropping also drops privileges — hence the re-grant at the end.
-- ============================================================================

drop function if exists public.nearby_models(double precision, double precision, double precision);

CREATE FUNCTION public.nearby_models(p_lat double precision, p_lng double precision, p_radius_mi double precision DEFAULT NULL::double precision)
 RETURNS TABLE(id uuid, first_name text, last_initial text, profile_pic_url text, is_verified boolean, distance_mi double precision, hair_colour text, hair_type text, hair_length text, skin_tone text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    u.id, u.first_name, u.last_initial, u.profile_pic_url, u.is_verified,
    3959 * acos(least(1.0,
      cos(radians(p_lat)) * cos(radians(u.latitude)) *
      cos(radians(u.longitude) - radians(p_lng)) +
      sin(radians(p_lat)) * sin(radians(u.latitude))
    )) as distance_mi,
    ma.hair_colour, ma.hair_type, ma.hair_length, ma.skin_tone
  from public.users u
  left join public.model_attributes ma on ma.user_id = u.id
  where u.role = 'model'
    and u.latitude is not null
    and u.longitude is not null
    and (
      p_radius_mi is null   -- null radius = no limit, show all
      or 3959 * acos(least(1.0,
           cos(radians(p_lat)) * cos(radians(u.latitude)) *
           cos(radians(u.longitude) - radians(p_lng)) +
           sin(radians(p_lat)) * sin(radians(u.latitude))
         )) <= p_radius_mi
    )
  order by distance_mi asc
  limit 200;
$function$;

grant execute on function public.nearby_models(double precision, double precision, double precision) to authenticated;

-- Verify (expect 10 columns ending in skin_tone text):
--   select pg_get_function_result(p.oid) from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where p.proname = 'nearby_models' and n.nspname = 'public';
