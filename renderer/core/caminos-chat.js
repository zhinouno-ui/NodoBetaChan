// Los dos caminos del chat, lado a lado, para mirarlos antes de apagar el viejo.
//
// Hoy una consulta de soporte se guarda como SOLICITUD. Por eso la bandeja de solicitudes viene
// llena de chats (256 de 300 filas en P4), una conversación son 25 solicitudes, y se juntaron
// 3.925 abiertas. El camino que corresponde existe entero y está permitido —`chat_sesiones` /
// `chat_mensajes`, con `panel_core_get_chat_sesiones_json` de este lado— pero nadie lo usa.
//
// El plan es el de Juan (2/10): primero que las cosas lleguen a los DOS lados, mirar que el nuevo
// reciba igual que el viejo, y recién cuando no haya dudas apagar el viejo. Esto es el instrumento
// para mirar: no cambia ningún comportamiento, sólo compara y cuenta.
//
//   verCaminos()        resumen de los dos y en qué se diferencian
//   verCaminos(true)    además lista usuario por usuario
//
// Va a la consola. El operador no ve nada.
(function(){
  'use strict';
  if(typeof window === 'undefined') return;

  const U = (v) => String(v == null ? '' : v).trim().toUpperCase();

  // CAMINO NUEVO: las sesiones de chat de verdad.
  async function sesionesDelCaminoNuevo(){
    const pc = String(window.pcOperativa || '');
    if(!pc) return { error: 'todavía no hay oficina resuelta' };
    try{
      const r = await window.panelAPI.rpc('panel_core_get_chat_sesiones_json', { p_pc_codigo: pc });
      if(r && r.error) return { error: (r.error.message || JSON.stringify(r.error)) };
      let filas = r && r.data;
      if(typeof filas === 'string'){ try{ filas = JSON.parse(filas); }catch(_e){} }
      if(filas && !Array.isArray(filas) && Array.isArray(filas.rows)) filas = filas.rows;
      return { filas: Array.isArray(filas) ? filas : [] };
    }catch(e){ return { error: e.message || String(e) }; }
  }

  // CAMINO VIEJO: la lista de chats que el panel arma desde las solicitudes.
  function ticketsDelCaminoViejo(){
    try{
      if(typeof window.ticketsAgrupados === 'function') return window.ticketsAgrupados() || [];
    }catch(_e){}
    return [];
  }

  function usuarioDe(x){
    return U(x && (x.usuario || x.USUARIO || x.nombre_usuario || ''));
  }

  async function verCaminos(detalle){
    const nuevo = await sesionesDelCaminoNuevo();
    const viejo = ticketsDelCaminoViejo();

    if(nuevo.error){
      console.warn('[caminos] el camino nuevo no contestó:', nuevo.error);
      console.log('[caminos] camino viejo (solicitudes): ' + viejo.length + ' conversaciones');
      return { error: nuevo.error, viejo: viejo.length };
    }

    const enNuevo = new Set(nuevo.filas.map(usuarioDe).filter(Boolean));
    const enViejo = new Set(viejo.map(usuarioDe).filter(Boolean));
    const soloViejo = [...enViejo].filter(u => !enNuevo.has(u));
    const soloNuevo = [...enNuevo].filter(u => !enViejo.has(u));
    const enLosDos  = [...enViejo].filter(u => enNuevo.has(u));

    const resumen = {
      oficina: String(window.pcOperativa || ''),
      porSolicitudes: enViejo.size,
      porSesionesDeChat: enNuevo.size,
      enLosDos: enLosDos.length,
      soloPorSolicitudes: soloViejo.length,
      soloPorSesionesDeChat: soloNuevo.length
    };
    console.log('[caminos] ' + JSON.stringify(resumen, null, 1));

    // Lo que importa para decidir: si alguien aparece SOLO por el camino viejo, apagarlo todavía
    // lo dejaría sin atender. Mientras ese número no sea cero, el viejo no se toca.
    if(soloViejo.length){
      console.warn('[caminos] estos sólo llegan por el camino viejo — si se apaga, se pierden: '
        + soloViejo.slice(0, 20).join(', ') + (soloViejo.length > 20 ? ' …' : ''));
    }else if(enViejo.size){
      console.log('[caminos] todos los que están por solicitudes están también por sesiones de chat.');
    }

    if(detalle){
      console.table([...new Set([...enViejo, ...enNuevo])].map(u => ({
        usuario: u,
        porSolicitudes: enViejo.has(u),
        porSesionesDeChat: enNuevo.has(u)
      })));
    }
    return resumen;
  }

  window.verCaminos = verCaminos;
})();
