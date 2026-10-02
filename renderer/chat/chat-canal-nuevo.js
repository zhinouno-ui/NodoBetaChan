// NODO escuchando los DOS caminos del chat a la vez.
//
// Hoy una consulta del portal se guarda como SOLICITUD, y de ahí sale todo lo que venimos
// arrastrando: la bandeja llena de chats, una conversación partida en 25 solicitudes, el peso que
// le corta la conexión a la oficina más cargada. El camino que corresponde —`chat_sesiones` /
// `chat_mensajes`, con `panel_core_get_chat_sesiones_json` de este lado— existe entero y está
// permitido, pero nadie lo usa.
//
// El plan es el de Juan (2/10): la página nueva manda al canal que corresponde, y mientras tanto
// NODO lee LOS DOS. Durante el cambio va a haber jugadores con la página vieja en el teléfono que
// no la refrescan —y si la refrescan va a ser tarde—, así que ninguna consulta puede quedar sin
// que alguien la vea por estar del lado equivocado.
//
// Esto SÓLO LEE y SÓLO SUMA. Si el canal nuevo no contesta o viene vacío, la bandeja queda
// exactamente como hoy. Cuando `verCaminos()` muestre que ya no llega nadie por el viejo, se apaga
// el viejo y esto queda como el único camino.
(function(){
  'use strict';
  if(typeof window === 'undefined') return;

  const S = (v) => String(v == null ? '' : v);
  const U = (v) => S(v).trim().toUpperCase();

  let _sesiones = [];
  let _ultima = 0;
  let _enCurso = null;
  const VIVE_MS = 15000;                   // no se pide más seguido que el reloj de la lista

  async function pedirSesiones(){
    const pc = S(window.pcOperativa || '');
    if(!pc) return [];
    try{
      const r = await window.panelAPI.rpc('panel_core_get_chat_sesiones_json', { p_pc_codigo: pc });
      if(r && r.error){ console.warn('[canal nuevo] no se pudieron leer las sesiones', r.error); return _sesiones; }
      let filas = r && r.data;
      if(typeof filas === 'string'){ try{ filas = JSON.parse(filas); }catch(_e){ return _sesiones; } }
      if(filas && !Array.isArray(filas) && Array.isArray(filas.rows)) filas = filas.rows;
      return Array.isArray(filas) ? filas : [];
    }catch(e){
      console.warn('[canal nuevo] no se pudieron leer las sesiones', e);
      return _sesiones;
    }
  }

  async function cargarSesiones(forzar){
    const ahora = Date.now();
    if(!forzar && (ahora - _ultima) < VIVE_MS) return _sesiones;
    if(_enCurso) return _enCurso;
    _enCurso = pedirSesiones().then(function(filas){
      _sesiones = filas; _ultima = Date.now(); return _sesiones;
    }).finally(function(){ _enCurso = null; });
    return _enCurso;
  }

  // Una sesión del canal nuevo, con la forma que usa la lista de chats del panel.
  // El hilo completo NO se trae acá: son una llamada por conversación y la lista muestra sólo el
  // último mensaje. Se pide al abrir la conversación (mensajesDe).
  function comoTicket(s){
    const usuario = S(s.usuario || s.USUARIO || '');
    const clave = U(usuario).replace(/[^A-Z0-9]/g, '_');
    const fecha = S(s.fecha_ultimo || s.updated_at || s.created_at || '');
    const ultimo = S(s.ultimo_mensaje || '');
    const cerrado = U(s.estado || '') === 'CERRADO';
    return {
      id: 'CANAL_' + clave,
      usuario: usuario,
      telefono: S(s.telefono || ''),
      items: [],
      fecha: fecha,
      mensaje: ultimo,
      solicitudId: S(s.solicitud_id || ''),
      masterId: null,
      accepted: !cerrado,
      cerrado: cerrado,
      thread: ultimo ? [{ origen: 'USUARIO', usuario: usuario, mensaje: ultimo, fecha: fecha }] : [],
      unread: Number(s.sin_leer) || 0,
      last: ultimo ? { origen: 'USUARIO', usuario: usuario, mensaje: ultimo, fecha: fecha } : null,
      _canalNuevo: true,
      _chatId: S(s.chat_id || s.id || '')
    };
  }

  // Los mensajes de una conversación del canal nuevo. Una llamada, sólo al abrirla.
  async function mensajesDe(chatId){
    if(!chatId) return [];
    try{
      const r = await window.panelAPI.rpc('panel_core_get_chat_mensajes_json', { p_chat_id: S(chatId) });
      if(r && r.error){ console.warn('[canal nuevo] no se pudieron leer los mensajes', r.error); return []; }
      let filas = r && r.data;
      if(typeof filas === 'string'){ try{ filas = JSON.parse(filas); }catch(_e){ return []; } }
      if(filas && !Array.isArray(filas) && Array.isArray(filas.rows)) filas = filas.rows;
      if(!Array.isArray(filas)) return [];
      return filas.map(function(m){
        const emisor = U(m.tipo_emisor || m.emisor || '');
        const esOperador = emisor.indexOf('OPER') >= 0 || emisor.indexOf('PANEL') >= 0
                        || emisor.indexOf('SIST') >= 0 || emisor.indexOf('ADMIN') >= 0;
        return {
          origen: esOperador ? 'OPERADOR' : 'USUARIO',
          usuario: S(m.emisor || ''),
          mensaje: S(m.mensaje || ''),
          fecha: S(m.created_at || ''),
          imagen_url: S(m.imagen_url || '') || undefined
        };
      });
    }catch(e){ console.warn('[canal nuevo] no se pudieron leer los mensajes', e); return []; }
  }

  // Lo que consume la lista: las conversaciones del canal nuevo listas para mezclar.
  function ticketsDelCanalNuevo(incluirCerrados){
    return (_sesiones || [])
      .filter(function(s){ return S(s.usuario || s.USUARIO || '').trim() !== ''; })
      .filter(function(s){ return incluirCerrados || U(s.estado || '') !== 'CERRADO'; })
      .map(comoTicket);
  }

  window._chatCanalNuevo = {
    cargar: cargarSesiones,
    tickets: ticketsDelCanalNuevo,
    mensajesDe: mensajesDe,
    crudas: function(){ return _sesiones.slice(); }
  };
})();
