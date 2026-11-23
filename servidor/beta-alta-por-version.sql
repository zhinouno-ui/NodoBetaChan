-- Canales nuevos según la versión de NODO (Juan, 15/11: "el switch de los nuevos canales debería ser una traba de
-- versión de nodo ... si el servidor detecta la versión ya cambia la pc automática"; 23/11: "el archivo de los nuevos
-- canales debe de estar en la aplicación posterior a la versión 2.1.5").
--
-- Hasta acá una PC usaba los canales nuevos sólo si alguien le copiaba a mano un archivo con la clave de su oficina
-- (hoy sólo P1). Ahora NODO, al elegir la oficina, pide su clave con el secreto del panel y su versión:
--   · versión 2.1.5 o anterior → no hay clave: sigue por los canales viejos (las versiones viejas ni la piden);
--   · versión mayor → el servidor le da una clave propia para esa PC. Se guarda sólo el hash, en
--     nodo_beta.beta_clientes, igual que la de P1. NODO la guarda en la PC y no la vuelve a pedir.
-- La clave se arma con dos UUID al azar (64 caracteres hexadecimales, el formato que pide nodo_beta.autorizar).
-- Vuelta atrás: beta-alta-por-version.vuelta-atras.sql.

create or replace function public.panel_beta_alta_v1(p_secret text, p_pc_codigo text, p_version text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pc text := regexp_replace(upper(btrim(coalesce(p_pc_codigo, ''))), '^PC(\d+)$', 'P\1');
  v_m text[] := regexp_match(coalesce(p_version, ''), '^(\d+)\.(\d+)\.(\d+)');
  v_token text;
begin
  if not public._panel_data_auth(p_secret) then raise exception 'no-auth'; end if;
  if v_pc = '' or v_pc !~ '^[A-Z0-9][A-Z0-9_-]{0,63}$' then
    return jsonb_build_object('ok', false, 'motivo', 'OFICINA');
  end if;
  if v_m is null then
    return jsonb_build_object('ok', false, 'motivo', 'VERSION');
  end if;
  if (v_m[1]::int, v_m[2]::int, v_m[3]::int) <= (2, 1, 5) then
    return jsonb_build_object('ok', true, 'nuevos_canales', false);
  end if;
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into nodo_beta.beta_clientes (token_hash, pc_codigo, enabled, active_build)
  values (encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_pc, true, left('nodo-' || btrim(p_version), 128));
  return jsonb_build_object('ok', true, 'nuevos_canales', true, 'pc_codigo', v_pc, 'token', v_token);
end
$function$;

revoke all on function public.panel_beta_alta_v1(text, text, text) from public;
grant execute on function public.panel_beta_alta_v1(text, text, text) to anon, authenticated;
