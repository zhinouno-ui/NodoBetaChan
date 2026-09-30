/* Portal: requests. Factories are inert until create(deps); legacy handlers are returned in globals. */
(function(root, define){
  const api = define();
  if(typeof module === 'object' && module.exports) module.exports = api;
  else root.NodoPortalRequests = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';
  const dependencies = Object.freeze(["V154P","_portalAutoRechazar","_v154pAvisoDesfasaje","alert","cargarAlertasRetiro","document","esc","getCanal","mapSolicitudPortal","money","normArr","operador","renderInicio","renderSolicitudesPortalCompleto","renderSolicitudesPortalEnInicio","rpc","setTimeout","solicitudes","toast","verificarSolicitudes","window"]);
  function create(deps){
const api = {};
// Leer la bandeja no reintentaba NADA, mientras que escribir (actualizarSolicitudPortal) ya
// reintenta 3 veces ante fallos de red, por "la mirror con proxy que pestañea". En una oficina con
// la red inestable eso deja la bandeja congelada: el operador ve "Esta lista está desactualizada",
// no le entra ninguna carga, y tiene que apretar Reintentar a mano hasta que una pega — y ahí le
// entran todas juntas. Reportado por OFI-SAN el 29/9 a las 21:10, y el cartel no mentía.
//
// Ahora la lectura reintenta igual que la escritura, y si aun así falla se vuelve a intentar sola
// con esperas cada vez más largas. Sin esto, entre intento e intento pasaban los 60 s del reloj de
// la bandeja, que es una eternidad con gente esperando que le carguen.
function _esErrorDeRed(e){
  const m = String((e && (e.message || e)) || '').toLowerCase();
  return /fetch failed|failed to fetch|network|timeout|econn|socket|load failed|networkerror/.test(m);
}
let _reintentoTimer = null, _reintentoNro = 0;
function _cancelarReintento(){
  if(_reintentoTimer){
    try{ deps.window.clearTimeout(_reintentoTimer); }catch(_e){}
    _reintentoTimer = null;
  }
  _reintentoNro = 0;
}
function _programarReintento(){
  if(_reintentoTimer) return;                                  // ya hay uno en camino
  _reintentoNro = Math.min(_reintentoNro + 1, 4);
  const espera = Math.min(8000 * Math.pow(2, _reintentoNro - 1), 60000);  // 8s · 16s · 32s · 60s
  _reintentoTimer = deps.setTimeout(function(){
    _reintentoTimer = null;
    try{ cargarSolicitudesPortal(true); }catch(_e){}
  }, espera);
}

async function cargarSolicitudesPortal(silencioso=false){
    // SAFE: anti-solapamiento. Si hay una carga en curso, dejamos una sola cola.
    if(deps.V154P.solicitudesLoading){
      deps.V154P.solicitudesQueued = true;
      return {ok:true, skipped:true, reason:"solicitudes_loading"};
    }
    deps.V154P.solicitudesLoading = true;
    try{
      const canal = await deps.getCanal();
      // Sólo se insiste ante fallos de RED. Si el servidor contesta y rechaza, insistir no arregla
      // nada y sólo demora el aviso.
      let r = null;
      for(let intento = 1; intento <= 3; intento++){
        r = await deps.rpc("panel_v15_5_listar_solicitudes_portal", {p_pc_codigo: canal});
        if(!r?.error || !_esErrorDeRed(r.error)) break;
        if(intento < 3) await new Promise(res => deps.setTimeout(res, 500 * intento));
      }

      if(r?.error){
        const msg = r.error.message || JSON.stringify(r.error);
        const box = deps.document.getElementById("tablaSolicitudesInicio");
        if(box && !deps.V154P.solicitudesLastHtml){
          box.innerHTML = `<div class="alert-box">Error solicitudes Portal: ${deps.esc(msg)}</div>`;
        }
        // Si ya había una lista pintada, se deja en pantalla para no vaciar la bandeja —
        // pero AVISANDO que está vieja. Sin esto los datos viejos se ven igual que los
        // frescos, y se puede aprobar dos veces algo que ya se resolvió.
        deps.V154P.solicitudesErrorAt = Date.now();
        deps.V154P.solicitudesEsRed = _esErrorDeRed(r.error);
        try{ deps._v154pAvisoDesfasaje(msg); }catch(_e){}
        if(!silencioso) console.error("[V15.4 PLUS] solicitudes portal", r.error);
        _programarReintento();
        return r;
      }
      _cancelarReintento();
      deps.V154P.solicitudesOkAt = Date.now();
      deps.V154P.solicitudesErrorAt = null;
      deps.V154P.solicitudesEsRed = false;
      try{ deps._v154pAvisoDesfasaje(null); }catch(_e){}

      const _nuevas = deps.normArr(r.data).map(deps.mapSolicitudPortal);

      // Medir ACÁ y no al dibujar: lo que se quiere saber es cuánto tardó el sistema en traer el
      // mensaje, no cuánto tardó el operador en abrir la conversación. Va a la consola de la PC,
      // el operador no ve nada. Ver renderer/core/latencia-panel.js.
      try{ if(deps.window.nodoLatencia) deps.window.nodoLatencia.medirTanda(_nuevas); }catch(_e){}
      // Un retiro a medio pagar NO puede desaparecer de la lista. La RPC filtra por estado, así que
      // al pasar el parcial a EN_PROCESO deja de devolverlo y el retiro se esfumaba del panel con
      // plata todavía debida — no había forma de terminar de pagarlo. Los que tienen progreso
      // parcial y ya no vienen del server se conservan del ciclo anterior, marcados, hasta que se
      // salden o los cierre alguien a mano.
      // La copia que se sostiene NO se refrescaba nunca: quedaba congelada con los números del
      // momento en que dejó de venir. Se pagaba el resto o se cerraba, y la copia vieja se volvía a
      // empujar en cada ciclo diciendo «falta $X» — no había forma de sacarla. Le pasó a #266250
      // (Maria6981x): pagado entero el 26/9 10:41 y seguía en la caja pidiendo $38.907 (D-109).
      // Ahora, antes de sostenerla, se le pregunta a la base cómo está.
      try{
        const _ids = new Set(_nuevas.map(function(x){ return String(x.ID||x.SOLICITUD_ID||''); }));
        const _candidatos = [];
        (deps.V154P.solicitudes||[]).forEach(function(v){
          const id = String(v.ID||v.SOLICITUD_ID||'');
          if(!id || _ids.has(id)) return;
          const pp = deps.window._retiroParcialInfo ? deps.window._retiroParcialInfo(v) : null;
          if(pp && pp.hasProg && pp.restante > 0.5) _candidatos.push({ id: id, v: v, pp: pp });
        });
        for(const c of _candidatos){
          let fresco = null;
          try{
            const rp = await deps.rpc('landing_retiro_progreso', { p_solicitud_id: Number(c.id) });
            const row = Array.isArray(rp && rp.data) ? rp.data[0] : (rp && rp.data);
            if(!(rp && rp.error) && row && row.ok !== false) fresco = row;
          }catch(_e){}
          if(fresco){
            // Lo que dice la base pisa a la copia vieja.
            try{
              let m = (c.v.METADATA !== undefined ? c.v.METADATA : c.v.metadata) || {};
              if(typeof m === 'string'){ try{ m = JSON.parse(m); }catch(_e){ m = {}; } }
              const rpPrev = (m && m.retiro_parcial) || {};
              const rpNuevo = Object.assign({}, rpPrev, {
                total: Number(fresco.total) || rpPrev.total,
                pagado: Number(fresco.pagado) || 0
              });
              if(fresco.pagos) rpNuevo.pagos = fresco.pagos;
              if(fresco.cierre) rpNuevo.cierre = fresco.cierre;
              const mNuevo = Object.assign({}, m, { retiro_parcial: rpNuevo });
              c.v.metadata = mNuevo; c.v.METADATA = mNuevo;
              if(fresco.estado) c.v.ESTADO = String(fresco.estado);
            }catch(_e){}
            // Saldado o cerrado en la base → se suelta. Es lo que antes no podía pasar nunca.
            const restante = Number(fresco.restante);
            if(fresco.cierre || (Number.isFinite(restante) && restante <= 0.5)){
              console.warn('[portal] retiro #'+c.id+' ya está saldado o cerrado en la base — se suelta');
              continue;
            }
          }
          // Sin respuesta de la base NO se suelta: un retiro con plata debida no puede perderse de
          // vista por un error de red.
          c.v.__soloLocal = true;
          _nuevas.push(c.v);
          console.warn('[portal] retiro #'+c.id+' con '+deps.money(c.pp.restante)+' sin pagar dejó de venir de la RPC — se conserva local');
        }
      }catch(_e){}
      deps.V154P.solicitudes = _nuevas;
      try{ deps._portalAutoRechazar(deps.V154P.solicitudes); }catch(_e){}
      deps.window.solicitudes = deps.V154P.solicitudes.slice();
      try{ deps.solicitudes = deps.V154P.solicitudes.slice(); }catch(_e){}
      // Cosecha pasiva → base LOCAL de jugadores (portado de NexoBetaChan): cada solicitud del portal
      // trae usuario + teléfono y (según tipo) titular/CBU. Se registra UNA vez por solicitud (Set de
      // sesión) → TODO usuario que operó en el portal queda guardado, aunque nadie lo vincule a mano.
      try{
        if(deps.window.jugadorRegistrarDato && Array.isArray(deps.V154P.solicitudes)){
          deps.window.__jugHarvested = deps.window.__jugHarvested || new Set();
          deps.V154P.solicitudes.forEach(function(s){
            const sid = String(s.ID||s.SOLICITUD_ID||''); if(!sid || deps.window.__jugHarvested.has(sid)) return;
            // Una consulta de SOPORTE —y sobre todo un alta nueva ("soy nuevo, apodo X, tel Y")— es lo
            // que el cliente DECLARA, no un dato del sistema. Guardarla como jugador hacía que el cotejo
            // comparara la declaración contra sí misma y dijera "COINCIDEN · en sistema · mismo dueño"
            // para alguien sin cuenta (Juan, 12/09).
            if(String(s.TIPO||s.TIPO_SOLICITUD||'').toUpperCase()==='SOPORTE') return;
            const u = String(s.USUARIO||s.USUARIO_JUGADOR||'').trim(); if(!u) return;
            deps.window.__jugHarvested.add(sid);
            let meta = s.METADATA!==undefined?s.METADATA:(s.metadata||{});
            if(typeof meta==='string'){ try{ meta=JSON.parse(meta); }catch(_e){ meta={}; } }
            const esRet = String(s.TIPO||s.TIPO_SOLICITUD||'').toUpperCase()==='RETIRO';
            const dato = {
              telefono: s.TELEFONO || s.telefono || (meta&&meta.telefono) || '',
              titular: s.TITULAR || s.NOMBRE_COMPLETO || (meta&&meta.titular) || '',
              // CBU/alias SOLO de retiros: en una carga ese campo es NUESTRA billetera.
              cbu: esRet ? String(s.CBU||s.CVU||s.CBU_ALIAS||s.DESTINO||(meta&&(meta.cbu||meta.destino))||'').trim() : '',
              fecha: s.FECHA_CREACION || s.FECHA || undefined
            };
            if(dato.telefono || dato.titular || dato.cbu) deps.window.jugadorRegistrarDato(u, dato);
          });
        }
      }catch(_e){}
      // Actualizamos stats generales, pero la caja de inicio queda en manos del render portal.
      try{ if(typeof deps.renderInicio === "function") deps.renderInicio(); }catch(e){}
      deps.renderSolicitudesPortalEnInicio();
      // Si entró una carga con un retiro a medio pagar, ese parcial se cierra solo (Juan, 26/9).
      // Va después del render para no demorar la pantalla, y sin await: si falla, no arrastra nada.
      try{ if(deps.window.cerrarParcialesPorCarga) deps.window.cerrarParcialesPorCarga(); }catch(_e){}
      // NODO en Discord: los renglones se rearman con lo que acaba de llegar.
      try{ if(deps.window.actualizarPresenciaDiscord) deps.window.actualizarPresenciaDiscord(); }catch(_e){}
      // Alertas de retiro (bono sin liberar / CBU compartido): async y cacheadas 60 s.
      // Cuando llegan, vuelven a pintar la lista solas.
      try{ deps.cargarAlertasRetiro(); }catch(_e){}
      deps.renderSolicitudesPortalCompleto();
      try{ if(typeof deps.verificarSolicitudes === "function") deps.verificarSolicitudes(silencioso); }catch(e){}

      // Auto-refrescar conversación abierta cuando llegan nuevas solicitudes SOPORTE
      try{
        if(deps.window.__nodoChatCurrentTicket && typeof deps.window.renderChatMensajes === "function"){
          const usr = String(deps.window.__nodoChatCurrentTicket.usuario||"").toUpperCase();
          if(typeof deps.window.ticketsAgrupados === "function"){
            const actualizado = deps.window.ticketsAgrupados().find(t=>String(t.usuario||"").toUpperCase()===usr);
            if(actualizado) deps.window.__nodoChatCurrentTicket = actualizado;
          }
          deps.window.renderChatMensajes();
        }
      }catch(_e){}
      return r;
    }finally{
      deps.V154P.solicitudesLoading = false;
      if(deps.V154P.solicitudesQueued){
        deps.V154P.solicitudesQueued = false;
        deps.setTimeout(()=>cargarSolicitudesPortal(true), 350);
      }
    }
  }
  async function actualizarSolicitudPortal(id, estado, extra){
    const payload = {
      p_id: Number(id),
      p_estado: estado,
      p_operador: deps.window.operador?.usuario || deps.window.operador?.nombre
               || (typeof deps.operador!=='undefined' ? (deps.operador?.usuario||deps.operador?.nombre||'') : '')
               || "",
      p_monto: null,
      p_metadata: extra || {}
    };

    // Reintento ante fallos de RED ("fetch failed"/timeout/socket) — típico en la mirror con proxy
    // que pestañea. Setear el estado es IDEMPOTENTE, así que reintentar es seguro (no duplica nada).
    let r, ultimoErr;
    for(let intento = 1; intento <= 3; intento++){
      r = await deps.rpc("panel_v15_5_actualizar_solicitud_portal", payload);
      if(!r?.error){ await cargarSolicitudesPortal(true); return r; }
      ultimoErr = r.error;
      const msg = String(r.error.message || r.error || '').toLowerCase();
      const esRed = /fetch failed|failed to fetch|network|timeout|econn|socket|load failed|networkerror/.test(msg);
      if(!esRed) break; // error real de negocio → no reintentar
      if(intento < 3){
        try{ deps.toast('Red inestable, reintentando actualización ('+intento+'/3)…','yellow'); }catch(_e){}
        await new Promise(res => deps.setTimeout(res, 600 * intento));
      }
    }

    deps.alert("Error actualizando solicitud: " + (ultimoErr?.message || JSON.stringify(ultimoErr)));
    return r;
  }


    return { globals: api, cargarSolicitudesPortal, actualizarSolicitudPortal };
  }
  return Object.freeze({ create, dependencies });
});
