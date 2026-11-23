-- La lista de chats del canal nuevo trababa en las oficinas grandes (23/11, P4 recién pasada a los canales nuevos):
-- cada llamada contaba los mensajes sin leer de TODAS las conversaciones de la oficina (2.071 en P4, 55 en P1) para
-- sumar el total, y tardaba 2,4 a 3,2 s; dos de cada diez se cortaban a los 3 s y NODO mostraba "Sin conexión con el
-- chat. Reintentando...". El canal viejo tardaba 0,6 s.
--
-- Ahora se cuentan sólo las conversaciones abiertas (son las únicas que suman al total de sin leer; 22 en P4) y las
-- de la página que se muestra. Mismo contrato y mismos valores: total, unread_total, seen_remaining_total y cada fila.
-- Vuelta atrás: beta-chat-lista-rapida.vuelta-atras.sql (la definición anterior).

create or replace function public.nodo_beta_chat_lista_v1(p_token text, p_pc_codigo text, p_usuario text default null::text,
  p_estado text default null::text, p_limit integer default 50, p_before_id bigint default null::bigint)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare v_out jsonb;
begin
 perform nodo_beta.autorizar(p_token,p_pc_codigo);
 if p_limit is null or p_limit not between 1 and 100 or length(coalesce(p_usuario,''))>200
   or length(coalesce(p_estado,''))>40 or p_before_id<=0 then
   raise exception using errcode='22023',message='BETA_INVALID_PAGE';
 end if;
 with scope as materialized (
   select c.* from public.chat_sesiones c
    where upper(btrim(coalesce(c.pc_codigo,'')))=upper(btrim(p_pc_codigo))
      and (nullif(btrim(p_usuario),'') is null or lower(btrim(c.usuario))=lower(btrim(p_usuario)))
      and (nullif(btrim(p_estado),'') is null or upper(coalesce(c.estado,'ABIERTO'))=upper(btrim(p_estado)))
 ), abiertas as materialized (
   select s.id, nodo_beta.contadores(s.id) as counts from scope s
    where upper(coalesce(s.estado,'')) not in ('CERRADO','RESUELTA')
 ), page as materialized (
   select s.* from scope s where p_before_id is null or s.id<p_before_id order by s.id desc limit p_limit+1
 ), shown as materialized (
   select p.*, coalesce(a.counts, nodo_beta.contadores(p.id)) as counts
     from (select * from page order by id desc limit p_limit) p left join abiertas a on a.id = p.id
 ),
 rendered as (
   select s.id,jsonb_build_object('id',s.chat_id,'chat_id',s.chat_id,'sesion_id',s.id::text,
     'usuario',s.usuario,'telefono',s.telefono,'pc_codigo',s.pc_codigo,'estado',s.estado,
     'solicitud_id',s.solicitud_id::text,'sin_leer',s.counts->'unread',
     'sin_ver_confirmado',s.counts->'seen_remaining','created_at',s.created_at,
     'updated_at',coalesce(last_msg.created_at,s.ultimo_mensaje,s.created_at),
     'fecha_ultimo',coalesce(last_user.created_at,s.created_at),
     'ultimo_mensaje',coalesce(last_msg.mensaje,''),'ultimo_de',last_msg.tipo_emisor,
     'ultimo_auto',coalesce(last_msg.metadata->>'auto','')='true' or upper(coalesce(last_msg.emisor,''))='NODO',
     'ultimo_operador',last_msg.emisor,
     'ultimo_id',last_msg.id::text) as row
   from shown s
   left join lateral(select m.id,m.created_at,m.mensaje,m.tipo_emisor,m.emisor,m.metadata from nodo_beta.mensajes(s.id) m
      where coalesce(m.visible_operador,true) order by m.id desc limit 1) last_msg on true
   left join lateral(select m.created_at from nodo_beta.mensajes(s.id) m
      where coalesce(m.visible_operador,true) and upper(m.tipo_emisor)='USUARIO' order by m.id desc limit 1) last_user on true
 )
 select jsonb_build_object('ok',true,'contract','nodo.beta.v1',
   'rows',coalesce((select jsonb_agg(row order by id desc) from rendered),'[]'::jsonb),
   'total', (select count(*) from scope),
   'unread_total',coalesce((select sum((counts->>'unread')::bigint) from abiertas),0),
   'seen_remaining_total',coalesce((select sum((counts->>'seen_remaining')::bigint) from abiertas),0),
   'has_more',(select count(*) from page)>p_limit,
   'next_before_id',case when (select count(*) from page)>p_limit then (select min(id)::text from shown) end)
 into v_out;
 return v_out;
end $function$;
