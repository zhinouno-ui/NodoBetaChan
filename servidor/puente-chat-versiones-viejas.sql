-- Puente del canal de chat hacia la bandeja que TODAS las PCs leen.  (Juan, 3/10/2026)
--
-- El problema: la 2.1.4 -- la version instalada en las 14 oficinas -- arma la lista de chats
-- desde la bandeja de solicitudes, leyendo metadata.chat_thread. No sabe leer chat_sesiones.
-- El portal nuevo manda la consulta al canal de chat y la deja suelta, sin solicitud. Resultado:
-- el mensaje se guarda bien, con el sello de la oficina, y NADIE lo ve. Verificado con los
-- mensajes de pruebasan del 3/10 a las 08:35 ("llega?" / "en efecto no llega").
--
-- Decision de Juan: que los mensajes viajen por el canal que todas las PCs ya toman, con tal de
-- tenerlo mapeado; las cargas y retiros siguen por el suyo, que la 2.1.4 ya recibe.
--
-- El arreglo es chico porque medio puente ya existia: landing_enviar_mensaje_v2 YA copia cada
-- mensaje a metadata.chat_thread de la solicitud... pero solo si la conversacion esta atada a
-- una (if v_sol_id is not null). Yo la abria con p_solicitud_id = null, asi que esa copia nunca
-- corria. Entonces: se abre la conversacion atada a UNA solicitud.
--
-- UNA por conversacion. NO una por mensaje -- ese era el bug viejo, el que dejo 25 solicitudes
-- de un solo reclamo y 3.925 acumuladas en la red.
--
-- Van marcadas con metadata.puente_chat = true para poder encontrarlas y sacarlas cuando todas
-- las PCs esten actualizadas. Para listarlas:
--   select id, pc_codigo, usuario, created_at from landing_solicitudes
--    where metadata->>'puente_chat' = 'true' order by created_at desc;

create or replace function public.landing_chat_abrir_v3(
  p_usuario      text,
  p_telefono     text,
  p_public_code  text,
  p_solicitud_id bigint
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_pc text; v_id bigint; v_token text; v_chat text; v_sol bigint;
begin
  if coalesce(btrim(p_usuario),'') = '' then
    return jsonb_build_object('ok', false, 'motivo', 'usuario_requerido');
  end if;

  v_pc := public._landing_resolver_pc_privado(p_public_code);
  if coalesce(btrim(coalesce(v_pc,'')),'') = '' then
    return jsonb_build_object('ok', false, 'motivo', 'agente_no_resuelto');
  end if;

  -- Solo por ESTA consulta: si el portal reintenta, no se abren dos.
  if p_solicitud_id is not null then
    select cs.id, cs.chat_public_token into v_id, v_token
      from public.chat_sesiones cs
     where cs.solicitud_id = p_solicitud_id
     order by cs.id desc limit 1;
    if v_id is not null then
      return jsonb_build_object('ok', true, 'chat_id', v_id, 'chat_token', v_token,
                                'nueva', false, 'solicitud_id', p_solicitud_id);
    end if;
  end if;

  v_sol := p_solicitud_id;

  -- El puente: una solicitud por conversacion, para que la vean las versiones viejas.
  if v_sol is null then
    insert into public.landing_solicitudes
      (pc_codigo, origen, usuario, telefono, tipo, monto, estado, prioridad, metadata)
    values
      (upper(v_pc), 'PORTAL_V16', btrim(p_usuario),
       nullif(btrim(coalesce(p_telefono,'')),''),
       'SOPORTE', 0, 'PENDIENTE', 100,
       jsonb_build_object(
         'tipo',           'SOPORTE',
         'usuario',        btrim(p_usuario),
         'telefono',       btrim(coalesce(p_telefono,'')),
         'pc_codigo',      upper(v_pc),
         'public_code',    coalesce(p_public_code,''),
         'origen_portal',  'PORTAL_V16',
         'created_by_rpc', 'landing_chat_abrir_v3',
         'puente_chat',    true,
         'canal',          'CHAT',
         'chat_thread',    '[]'::jsonb))
    returning id into v_sol;
  end if;

  v_token := md5(random()::text || clock_timestamp()::text || coalesce(p_usuario,''));
  v_chat  := 'CHAT_' || md5(random()::text || clock_timestamp()::text || coalesce(p_usuario,''));

  insert into public.chat_sesiones
    (chat_id, usuario, telefono, pc_codigo, solicitud_id, estado, chat_public_token, created_at)
  values
    (v_chat, btrim(p_usuario), btrim(coalesce(p_telefono,'')), upper(v_pc),
     v_sol, 'ABIERTO', v_token, now())
  returning id into v_id;

  return jsonb_build_object('ok', true, 'chat_id', v_id, 'chat_token', v_token,
                            'nueva', true, 'solicitud_id', v_sol);
end
$fn$;

-- ---------------------------------------------------------------------------
-- Probado el 3/10 ejecutandolo, no leyendolo: una conversacion con 3 mensajes
-- dejo 1 solicitud, 1 conversacion y 3 mensajes. El bug viejo dejaba 3 solicitudes.
-- Juan contesto "llego" desde el panel sobre esa misma conversacion, asi que la
-- version vieja la ve Y puede responderla.
--
-- Borrar la fila de prueba (el permiso me freno el delete):
--   delete from chat_mensajes
--    where chat_id in (select chat_id from chat_sesiones where usuario = 'ZZ_puente_test');
--   delete from chat_sesiones      where usuario = 'ZZ_puente_test';
--   delete from landing_solicitudes where usuario = 'ZZ_puente_test';
--
-- CUANDO TODAS LAS PCs ESTEN ACTUALIZADAS, se saca el puente: alcanza con volver a
-- poner `v_sol := p_solicitud_id;` y borrar el bloque del insert. Las que queden:
--   select id, pc_codigo, usuario, created_at from landing_solicitudes
--    where metadata->>'puente_chat' = 'true' order by created_at desc;

-- Prueba del OTRO camino (solicitud de carga), 3/10 12:38 -- ejecutada, no leida:
--   solicitud 299084, CARGA $5.000 de pruebasan en P4.
--   La ve la bandeja de la PC vieja: SI.  Conversaciones de chat que creo: 0.
--   Se creo en 103 ms. Las marcas t_toque / t_envio viajan hasta la bandeja.
--   Borrarla:  delete from landing_solicitudes where id = 299084;
