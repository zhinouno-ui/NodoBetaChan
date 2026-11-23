-- Canal nuevo de solicitudes (Juan, 23/11: "¿con qué necesidad va a traer todo? Es la base de los nuevos canales que el
-- servidor pueda filtrar"). NODO bajaba la bandeja entera en cada aviso: en P4, 136 solicitudes y 269 kB, cada vez que
-- entraba o cambiaba una (y aunque no cambiara nada, cada 60 s).
--
-- nodo_beta_bandeja_v1 contesta POR CAMBIOS. NODO le dice qué tiene (p_cursor.tengo = {número: firma}) y el servidor
-- devuelve sólo las solicitudes nuevas o cambiadas (cada una con su _firma) y los números que NODO tiene y ya no están
-- en la bandeja (quitar). Sin p_cursor.tengo devuelve la bandeja completa (completa = true), igual que
-- panel_v15_5_listar_solicitudes_portal: abiertas + las 80 más nuevas, con las mismas columnas.
--
-- Por qué firma y no hora de cambio: seis funciones escriben la solicitud sin tocar updated_at (el comprobante que
-- adjunta el jugador, el hilo del chat viejo, la respuesta automática, los toques repetidos, el chat_master_id) y el
-- Portal tiene permiso de escribir la tabla directo. La firma sale de la fila entera tal como se manda (md5), así que
-- cualquier cambio cuenta, lo haga quien lo haga. Medido en P4: 138 filas firmadas en 18 ms.
--
-- Lo usan sólo las oficinas en los canales nuevos (lo pide su clave: nodo_beta.autorizar). Las demás, igual que antes.
-- Vuelta atrás: beta-bandeja-v1.vuelta-atras.sql.

create or replace function public.nodo_beta_bandeja_v1(p_token text, p_pc_codigo text, p_filtros jsonb default '{}'::jsonb,
  p_limit integer default 300, p_cursor jsonb default null)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare
  v_pc text := upper(btrim(coalesce(p_pc_codigo, '')));
  v_tengo jsonb := case when jsonb_typeof(p_cursor->'tengo') = 'object' then p_cursor->'tengo' end;
begin
  perform nodo_beta.autorizar(p_token, p_pc_codigo);
  return (
    with recientes as (
      select s.id, s.created_at from public.landing_solicitudes s
       where s.pc_codigo = v_pc and coalesce(s.origen, '') = 'PORTAL_V16'
       order by s.created_at desc limit 80
    ), abiertas as (
      select s.id, s.created_at from public.landing_solicitudes s
       where s.pc_codigo = v_pc and coalesce(s.origen, '') = 'PORTAL_V16'
         and upper(coalesce(s.estado, 'PENDIENTE')) in ('PENDIENTE','EN_PROCESO','EN_REVISION','TOMADA','TOMADO','PROCESANDO','ERROR_OPERATIVO')
       order by s.created_at desc limit 300
    ), ids as (
      select id, created_at from recientes
      union
      select id, created_at from abiertas
      order by created_at desc limit 300
    ), firmadas as (
      select s.id, s.created_at, f.fila, left(md5(f.fila::text), 12) as firma
        from public.landing_solicitudes s join ids on ids.id = s.id
        cross join lateral (select to_jsonb(s) || jsonb_build_object('metadata',
            coalesce(s.metadata, '{}'::jsonb) - 'host' - 'created_by_rpc' - 'public_code'
              - 'origen_portal' - 'agente_por_host' - 'comprobante_obligatorio') as fila) f
    )
    select jsonb_build_object('ok', true, 'contract', 'nodo.beta.v1', 'scope', jsonb_build_object('pc_codigo', v_pc),
      'completa', v_tengo is null,
      'operativas', coalesce((select jsonb_agg(x.fila || jsonb_build_object('_firma', x.firma) order by x.created_at desc)
          from firmadas x
         where v_tengo is null or (v_tengo->>(x.id::text)) is distinct from x.firma), '[]'::jsonb),
      'quitar', case when v_tengo is null then '[]'::jsonb else coalesce((select jsonb_agg(k.k)
          from jsonb_object_keys(v_tengo) as k(k)
         where not exists (select 1 from ids where ids.id::text = k.k)), '[]'::jsonb) end,
      'total', (select count(*) from ids),
      'next_cursor', null, 'has_more', false, 'totales', null)
  );
end
$function$;

revoke all on function public.nodo_beta_bandeja_v1(text, text, jsonb, integer, jsonb) from public;
grant execute on function public.nodo_beta_bandeja_v1(text, text, jsonb, integer, jsonb) to anon, authenticated;
