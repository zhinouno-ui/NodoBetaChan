-- Vuelta atras de retiro-dni-portal-viejo.sql: contexto_v1 vuelve a contestar enabled = beta de la oficina
-- (los Portales viejos piden el DNI aunque pide_dni este apagado). v2 queda: el Portal nuevo la usa.
create or replace function public.landing_portal_retiro_contexto_v1(p_public_code text, p_usuario text, p_telefono text, p_host text default null::text)
returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $function$
begin
  return public.landing_portal_retiro_contexto_v2(p_public_code, p_usuario, p_telefono, p_host);
end $function$;
