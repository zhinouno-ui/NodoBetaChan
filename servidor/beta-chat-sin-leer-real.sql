-- "Sin leer" que cuenta lo que de verdad nadie atendió (23/11, P4 recién pasada a los canales nuevos: NODO decía 64 chats
-- sin leer y eran 5). Contaba como no leído todo mensaje del jugador sin la marca nueva (leido_operador_at), aunque un
-- operador lo hubiera leído desde una PC con la versión vieja (que sólo pone leido = true): 59 de los 64.
--
-- Como en las herramientas de atención (Intercom "waiting since", Chatwoot): un mensaje del jugador está sin leer si nadie
-- lo leyó (en ningún canal) y nadie le contestó después. Los mensajes automáticos (el bot, los avisos de NODO) no cuentan
-- como respuesta de una persona. seen_remaining (las ✓✓ del Portal) no cambia.
-- Vuelta atrás: beta-chat-sin-leer-real.vuelta-atras.sql.

create or replace function nodo_beta.contadores(p_sesion_id bigint)
returns jsonb
language sql
stable
set search_path to ''
as $function$
  with m as (
    select x.* from nodo_beta.mensajes(p_sesion_id) x where coalesce(x.visible_operador, true)
  ), respuesta as (
    select coalesce(max(m.id), 0) as id from m
     where upper(coalesce(m.tipo_emisor, '')) not in ('USUARIO', 'SISTEMA')
       and coalesce(m.metadata->>'auto', '') <> 'true' and upper(coalesce(m.emisor, '')) <> 'NODO'
  )
  select jsonb_build_object(
    'unread', count(*) filter (where not (coalesce(m.leido, false) or m.leido_operador_at is not null)
                                 and m.id > (select id from respuesta)),
    'seen_remaining', count(*) filter (where r.message_id is null))
  from m left join nodo_beta.chat_lecturas r on r.message_id = m.id and r.sesion_id = p_sesion_id
  where upper(m.tipo_emisor) = 'USUARIO';
$function$;
