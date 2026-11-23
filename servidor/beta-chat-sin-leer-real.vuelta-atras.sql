-- Vuelta atrás de beta-chat-sin-leer-real.sql: la definición que había el 23/11.
create or replace function nodo_beta.contadores(p_sesion_id bigint)
returns jsonb
language sql
stable
set search_path to ''
as $function$
 select jsonb_build_object(
   'unread',count(*) filter(where coalesce(m.leido,false)=false or m.leido_operador_at is null),
   'seen_remaining',count(*) filter(where r.message_id is null))
 from nodo_beta.mensajes(p_sesion_id) m
 left join nodo_beta.chat_lecturas r on r.message_id=m.id and r.sesion_id=p_sesion_id
 where upper(m.tipo_emisor)='USUARIO' and coalesce(m.visible_operador,true);
$function$;
