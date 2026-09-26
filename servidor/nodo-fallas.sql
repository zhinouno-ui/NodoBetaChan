-- ══════════════════════════════════════════════════════════════════════════════
-- nodo_fallas · el camino que recorrió lo que falló, PC por PC
--
-- NO APLICADO. Esperando el OK de Juan (26/09). Ver D-103 en DESCONEXIONES.md.
--
-- Por qué una tabla de EVENTOS y no una columna en panel_actividad: panel_actividad es un latido,
-- una fila por máquina (upsert sobre pc_codigo + clave_maquina). Dice si la PC está viva, no qué le
-- pasó. Guardar ahí la última falla borra la anterior, y lo que sirve para diagnosticar es la
-- secuencia, no la foto.
--
-- Qué guarda: el paso donde cortó, de qué capa fue, y el CAMINO previo (rastro). No guarda un
-- catálogo de errores previstos: no se puede escribir de antemano el cartel de una falla que
-- todavía no ocurrió. Se anota lo que se recorrió y de ahí se deduce.
--
-- Qué NO guarda: argumentos de las operaciones. En los de iniciarSesion viaja la clave. El panel
-- manda nombre de método, mensaje y estado de pantalla, nada más.
-- ══════════════════════════════════════════════════════════════════════════════

create table if not exists public.nodo_fallas (
  id           bigserial primary key,
  creado_en    timestamptz not null default now(),
  -- de dónde vino
  pc_codigo    text not null,
  oficina_id   text,
  operador     text,
  version      text,
  instalacion  text,
  backend      text,          -- casinodrex | bet300 · con qué backoffice estaba operando
  -- qué pasó
  ocurrido_en  timestamptz,   -- reloj de la PC (puede diferir del servidor; se guardan los dos)
  paso         text not null, -- el método donde cortó: cargarSaldo, buscarUsuario, iniciarSesion…
  capa         text not null, -- panel | main | preload | contrato | agentes | operador | desconocida
  mensaje      text,
  pantalla     text,          -- dónde quedó la ventana de Agentes: lo que no se reconstruye después
  rastro       jsonb not null default '[]'::jsonb   -- los pasos previos, en orden
);

comment on table public.nodo_fallas is
  'Fallas del panel con el camino previo, para consultar PC por PC. Escribe panel_registrar_falla.';

create index if not exists nodo_fallas_pc_fecha_idx   on public.nodo_fallas (pc_codigo, creado_en desc);
create index if not exists nodo_fallas_capa_fecha_idx on public.nodo_fallas (capa, creado_en desc);
create index if not exists nodo_fallas_fecha_idx      on public.nodo_fallas (creado_en desc);

-- Igual que el resto: el anon no escribe ni lee directo. Todo pasa por la RPC con el secreto.
alter table public.nodo_fallas enable row level security;

-- ══ panel_registrar_falla ═════════════════════════════════════════════════════
create or replace function public.panel_registrar_falla(
  p_secret      text,
  p_pc_codigo   text,
  p_paso        text,
  p_capa        text,
  p_mensaje     text default null,
  p_pantalla    text default null,
  p_rastro      jsonb default '[]'::jsonb,
  p_oficina_id  text default null,
  p_operador    text default null,
  p_version     text default null,
  p_instalacion text default null,
  p_backend     text default null,
  p_ocurrido_en timestamptz default null
) returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_pc text; v_canon text; v_id bigint;
begin
  if not public._panel_data_auth(p_secret) then raise exception 'no-auth'; end if;

  v_pc := upper(trim(coalesce(p_pc_codigo,'')));
  if v_pc = '' then return jsonb_build_object('ok', false, 'error', 'sin pc'); end if;
  -- Mismo criterio que panel_registrar_actividad: el puesto de Chunior cambia de nombre cuando
  -- está ocupado (SANCHEZPLATA -> SANCHEZPLATAENUSO). Sin canonizar, la misma oficina aparece dos
  -- veces y las fallas se parten en dos listas.
  select r.pc_codigo into v_canon from public._panel_resolver_puesto_raw(v_pc, null) r limit 1;
  if v_canon is not null and v_canon <> '' then v_pc := upper(v_canon); end if;

  if coalesce(trim(p_paso),'') = '' then return jsonb_build_object('ok', false, 'error', 'sin paso'); end if;

  insert into public.nodo_fallas(
    pc_codigo, oficina_id, operador, version, instalacion, backend,
    ocurrido_en, paso, capa, mensaje, pantalla, rastro)
  values (
    v_pc,
    nullif(upper(trim(coalesce(p_oficina_id,''))),''),
    nullif(trim(p_operador),''),
    nullif(trim(p_version),''),
    nullif(trim(p_instalacion),''),
    nullif(lower(trim(p_backend)),''),
    p_ocurrido_en,
    left(trim(p_paso), 120),
    coalesce(nullif(lower(trim(p_capa)),''), 'desconocida'),
    left(coalesce(p_mensaje,''), 400),
    left(coalesce(p_pantalla,''), 400),
    coalesce(p_rastro, '[]'::jsonb))
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'pc', v_pc);
end $function$;

-- ══ panel_fallas_por_pc ═══════════════════════════════════════════════════════
-- Para mirarlo: las últimas fallas de una PC, o de todas si no se pasa ninguna.
create or replace function public.panel_fallas_por_pc(
  p_secret text,
  p_pc     text default null,
  p_desde  timestamptz default null,
  p_limit  integer default 100
) returns table(
  creado_en timestamptz, pc_codigo text, operador text, backend text, version text,
  paso text, capa text, mensaje text, pantalla text, rastro jsonb
)
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
begin
  if not public._panel_data_auth(p_secret) then raise exception 'no-auth'; end if;
  return query
    select f.creado_en, f.pc_codigo, f.operador, f.backend, f.version,
           f.paso, f.capa, f.mensaje, f.pantalla, f.rastro
    from public.nodo_fallas f
    where (p_pc is null or f.pc_codigo = upper(trim(p_pc)))
      and (p_desde is null or f.creado_en >= p_desde)
    order by f.creado_en desc
    limit greatest(1, least(coalesce(p_limit, 100), 1000));
end $function$;

-- ══ panel_fallas_resumen ══════════════════════════════════════════════════════
-- La vista que contesta "¿quién está fallando y en qué?" sin leer fila por fila.
create or replace function public.panel_fallas_resumen(
  p_secret text,
  p_horas  integer default 24
) returns table(pc_codigo text, capa text, paso text, veces bigint, ultima timestamptz)
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
begin
  if not public._panel_data_auth(p_secret) then raise exception 'no-auth'; end if;
  return query
    select f.pc_codigo, f.capa, f.paso, count(*) as veces, max(f.creado_en) as ultima
    from public.nodo_fallas f
    where f.creado_en >= now() - (greatest(1, least(coalesce(p_horas, 24), 720)) || ' hours')::interval
    group by f.pc_codigo, f.capa, f.paso
    order by veces desc, ultima desc;
end $function$;

-- ══ Retención ═════════════════════════════════════════════════════════════════
-- Sin esto la tabla crece para siempre. 30 días alcanza para diagnosticar y deja la tabla chica.
-- Llamarla desde el mismo lugar donde se limpian las otras, o dejarla en un cron de Supabase.
create or replace function public.panel_fallas_limpiar(p_secret text, p_dias integer default 30)
returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_borradas bigint;
begin
  if not public._panel_data_auth(p_secret) then raise exception 'no-auth'; end if;
  delete from public.nodo_fallas
   where creado_en < now() - (greatest(1, coalesce(p_dias, 30)) || ' days')::interval;
  get diagnostics v_borradas = row_count;
  return jsonb_build_object('ok', true, 'borradas', v_borradas);
end $function$;
