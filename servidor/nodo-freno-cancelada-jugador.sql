-- ============================================================================
-- Que ninguna PC pueda revivir una solicitud que el jugador ya cancelo.
--
-- EL AGUJERO
-- El portal nuevo trae algo que el que esta en uso no tiene: el jugador puede cancelar su
-- solicitud desde el telefono (landing_cancelar_solicitud). Esa RPC esta bien cerrada — se niega
-- si la solicitud ya no esta PENDIENTE y se niega si un operador ya la tomo.
--
-- El problema esta del otro lado. La bandeja del panel se refresca cada varios segundos, asi que
-- entre que el jugador cancela y que la lista se actualiza, el operador sigue viendo la solicitud
-- y puede tocar "Tomar". Y las dos RPC con las que el panel escribe el estado hacen un UPDATE
-- ciego: no miran como estaba la fila. La revivian sin decir nada.
--
-- Resultado: el jugador ve "cancelada" en el portal y el operador le carga la plata igual.
-- Es exactamente la "operacion sin registro" de siempre, pero al reves.
--
-- POR QUE VA EN LA BASE Y NO EN EL PANEL
-- Al 29/9 hay 15 PCs trabajando y NO estan todas iguales:
--   2.1.3 -> P1 P2 P3 P4 P5 P7 P8
--   2.1.2 -> P6 P9 P9B P10 P10B P10C ALVOFI
--   1.2.0 -> P11   <- quedo atras y sigue operando
-- Las tres versiones llaman a estas mismas dos funciones. El freno puesto aca las tapa a todas
-- de una, sin esperar que P11 actualice. Si estuviera en el panel, P11 quedaria afuera.
--
-- SE FRENA ANTES DE LA PLATA, NUNCA DESPUES
-- Solo se bloquean los estados de "la estoy agarrando / la estoy haciendo". ACREDITADA y PAGADA
-- pasan igual: si la plata ya salio, el registro TIENE que quedar — una operacion sin registro es
-- peor que una mal estampada. Esas quedan marcadas en el metadata para poder buscarlas despues.
--
-- Cuando el panel frena, el operador ve el texto del raise en el cartel de error (en todas las
-- versiones, porque todas alertan el mensaje que devuelve la RPC).
--
-- Para revisar despues que paso:
--   select id, usuario, tipo, monto, estado,
--          metadata->>'cancelada_por'                    as cancelo,
--          metadata->>'revivida_tras_cancelacion_jugador' as revivida,
--          metadata->>'revivida_por_operador'             as operador
--     from landing_solicitudes
--    where metadata ? 'revivida_tras_cancelacion_jugador'
--    order by updated_at desc;
-- ============================================================================

-- Estados que significan "todavia no movi plata, la estoy tomando". Son los que se frenan.
create or replace function public._freno_estado_previo_a_la_plata(p_estado text)
returns boolean
language sql
immutable
set search_path to 'public'
as $$
  select upper(coalesce(p_estado,'')) in
    ('PENDIENTE','TOMADA','TOMADO','EN_REVISION','EN_PROCESO','PROCESANDO','APROBADA');
$$;

-- La fila esta cancelada POR EL JUGADOR y es plata (no un chat de soporte).
create or replace function public._freno_la_cancelo_el_jugador(p_id bigint)
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select exists (
    select 1 from public.landing_solicitudes s
     where s.id = p_id
       and upper(coalesce(s.estado,'')) = 'CANCELADA'
       and s.metadata->>'cancelada_por' = 'JUGADOR'
       and upper(coalesce(s.tipo,'')) in ('CARGA','RETIRO')
  );
$$;

-- ── La que usan los paneles de hoy (2.1.x) ──────────────────────────────────
create or replace function public.panel_v15_5_actualizar_solicitud_portal(
  p_id bigint,
  p_estado text default null::text,
  p_operador text default null::text,
  p_monto numeric default null::numeric,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row   public.landing_solicitudes;
  v_meta  jsonb := coalesce(p_metadata,'{}'::jsonb);
begin
  if public._freno_la_cancelo_el_jugador(p_id) then
    if public._freno_estado_previo_a_la_plata(p_estado) then
      raise exception 'El jugador cancelo esta solicitud antes de que la tomaras. No la proceses: si todavia la quiere, pedile que la vuelva a enviar desde el portal.';
    end if;
    -- Pasa, pero queda marcada: aca la plata ya se movio.
    v_meta := v_meta || jsonb_build_object(
      'revivida_tras_cancelacion_jugador', true,
      'revivida_at', now(),
      'revivida_a_estado', upper(coalesce(p_estado,'')),
      'revivida_por_operador', coalesce(p_operador,'')
    );
  end if;

  update public.landing_solicitudes
     set estado = coalesce(p_estado, estado),
         monto  = coalesce(p_monto, monto),
         tomada_por_operador_nombre = coalesce(p_operador, tomada_por_operador_nombre),
         tomada_at = case when p_operador is not null and tomada_at is null then now() else tomada_at end,
         metadata = coalesce(metadata,'{}'::jsonb) || v_meta,
         updated_at = now()
   where id = p_id
   returning * into v_row;

  if not found then
    raise exception 'SOLICITUD_NO_ENCONTRADA';
  end if;

  return to_jsonb(v_row);
end
$function$;

-- ── La hermana vieja: la pueden estar llamando las PCs atrasadas ────────────
create or replace function public.panel_v154_plus_actualizar_solicitud_portal(
  p_id bigint,
  p_estado text default null::text,
  p_operador text default null::text,
  p_monto numeric default null::numeric,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row    public.landing_solicitudes;
  v_estado text := nullif(trim(coalesce(p_estado,'')), '');
  v_meta   jsonb := coalesce(p_metadata,'{}'::jsonb);
begin
  if to_regclass('public.landing_solicitudes') is null then
    return jsonb_build_object('ok', false, 'error', 'NO_EXISTE_TABLA_landing_solicitudes');
  end if;

  if public._freno_la_cancelo_el_jugador(p_id) then
    if public._freno_estado_previo_a_la_plata(v_estado) then
      raise exception 'El jugador cancelo esta solicitud antes de que la tomaras. No la proceses: si todavia la quiere, pedile que la vuelva a enviar desde el portal.';
    end if;
    v_meta := v_meta || jsonb_build_object(
      'revivida_tras_cancelacion_jugador', true,
      'revivida_at', now(),
      'revivida_a_estado', upper(coalesce(v_estado,'')),
      'revivida_por_operador', coalesce(p_operador,'')
    );
  end if;

  update public.landing_solicitudes
     set estado = coalesce(v_estado, estado),
         monto  = coalesce(p_monto, monto),
         tomada_por_operador_nombre = case
           when p_operador is not null and trim(p_operador) <> '' then p_operador
           else tomada_por_operador_nombre end,
         tomada_at = case
           when p_operador is not null and trim(p_operador) <> '' and tomada_at is null then now()
           else tomada_at end,
         cerrada_por_operador_nombre = case
           when upper(coalesce(v_estado,'')) in ('RECHAZADA','CERRADA','CANCELADA','ACREDITADA','PAGADA')
             then coalesce(p_operador, cerrada_por_operador_nombre)
           else cerrada_por_operador_nombre end,
         cerrada_at = case
           when upper(coalesce(v_estado,'')) in ('RECHAZADA','CERRADA','CANCELADA','ACREDITADA','PAGADA')
             then now() else cerrada_at end,
         cierre_motivo = case
           when upper(coalesce(v_estado,'')) = 'RECHAZADA'
             then coalesce(v_meta->>'motivo', cierre_motivo)
           else cierre_motivo end,
         metadata = coalesce(metadata,'{}'::jsonb) || v_meta,
         updated_at = now()
   where id = p_id
   returning * into v_row;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'SOLICITUD_NO_ENCONTRADA', 'id', p_id);
  end if;

  return to_jsonb(v_row);
end
$function$;
