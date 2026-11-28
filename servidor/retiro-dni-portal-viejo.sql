-- El switch del DNI manda tambien sobre los Portales ya publicados (18/11/2026).
-- Juan: "si esta el switch apagado deberia de desaparecer y si esta prendido deberia de aparecer, no es algo
-- que deba cambiarse por actualizar o no el Portal". El Portal publicado (v2.1.21, en intento) no conoce
-- pide_dni: con enabled=true dibuja el campo del DNI siempre que la cuenta de cobro no este validada. La unica
-- llave que ese Portal lee es enabled, asi que:
--   * landing_portal_retiro_contexto_v2: la respuesta completa (enabled = beta de la oficina, pide_dni aparte).
--     La llama el Portal nuevo, que sabe hacer el retiro nuevo sin DNI.
--   * landing_portal_retiro_contexto_v1: la llaman los Portales viejos. Con el DNI apagado contesta
--     enabled=false: ese Portal hace el retiro de siempre (sin DNI, con los datos del ultimo retiro).
--     Con el DNI prendido contesta lo mismo que v2 y el Portal viejo pide el DNI como antes.
-- Corre despues de retiro-dni-aparte.sql. Vuelta atras: retiro-dni-portal-viejo-vuelta-atras.sql.

create or replace function public.landing_portal_retiro_contexto_v2(p_public_code text, p_usuario text, p_telefono text, p_host text default null::text)
returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $function$
declare v_pc text; v_u text := lower(trim(coalesce(p_usuario,''))); v_vinc jsonb; v_verdict text;
  v_inst public.retiro_instrumentos; v_last record; v_on boolean; v_dni_on boolean;
begin
  v_pc := public._retiro_inst_pc2(p_public_code, p_host);
  if v_pc is not null then
    select coalesce(o.habilitado, false), coalesce(o.pide_dni, false) into v_on, v_dni_on
      from public.retiro_instrumentos_oficinas o where o.pc_codigo = v_pc;
  end if;
  if v_u = '' or not coalesce(v_on, false) then
    return jsonb_build_object('ok', true, 'contract', 'retiro.instrumentos.v1', 'enabled', false);
  end if;
  v_vinc := public.landing_portal_resolver_vinculo(v_pc, p_usuario, coalesce(p_telefono,''));
  v_verdict := upper(coalesce(v_vinc->>'verdict',''));
  if v_verdict not in ('ACCESO','NUEVO','PENDIENTE') then raise exception 'VINCULO_NO_VALIDO'; end if;
  if v_verdict = 'ACCESO' then
    select * into v_inst from public.retiro_instrumentos i
     where i.pc_codigo = v_pc and i.usuario = v_u and i.estado = 'VALIDADO' order by i.validado_at desc limit 1;
  end if;
  select s.id, s.estado, s.monto, s.updated_at, s.created_at,
         s.metadata->'retiro_instrumento_v1'->>'estado' as validacion, coalesce(s.metadata->>'motivo_rechazo','') as codigo
    into v_last
    from public.retiro_instrumentos i
    join public.landing_solicitudes s on s.id = i.solicitud_id
   where i.pc_codigo = v_pc and i.usuario = v_u
   order by s.id desc limit 1;
  return jsonb_build_object('ok', true, 'contract', 'retiro.instrumentos.v1', 'enabled', true,
    'pide_dni', coalesce(v_dni_on, false),
    'instrumento', case when v_inst.id is null then null else jsonb_build_object(
      'id', v_inst.id,
      'destino', upper(regexp_replace(btrim(v_inst.destino), '[[:space:]]+', '', 'g')),
      'titular', upper(regexp_replace(btrim(coalesce(v_inst.titular,'')), '[[:space:]]+', ' ', 'g')),
      'validado_at', v_inst.validado_at) end,
    'ultima_solicitud', case when v_last.id is null then null else jsonb_build_object(
      'id', v_last.id, 'estado_validacion', v_last.validacion, 'estado', v_last.estado, 'monto', v_last.monto,
      'actualizada_at', v_last.updated_at, 'creada_at', v_last.created_at, 'codigo', v_last.codigo) end);
end $function$;

create or replace function public.landing_portal_retiro_contexto_v1(p_public_code text, p_usuario text, p_telefono text, p_host text default null::text)
returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $function$
declare v jsonb;
begin
  v := public.landing_portal_retiro_contexto_v2(p_public_code, p_usuario, p_telefono, p_host);
  if coalesce((v->>'enabled')::boolean, false) and not coalesce((v->>'pide_dni')::boolean, false) then
    return jsonb_build_object('ok', true, 'contract', 'retiro.instrumentos.v1', 'enabled', false);
  end if;
  return v;
end $function$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'grant execute on function public.landing_portal_retiro_contexto_v2(text, text, text, text) to anon, authenticated';
  end if;
end $$;
