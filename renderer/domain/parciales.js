// Decisión: ¿qué retiros pagándose por partes hay que cerrar porque el jugador volvió a cargar?
//
// El caso que lo originó (Maria6981x, 26/9): tenía un retiro parcial abierto, se jugó las fichas
// del retiro y volvió a cargar. El parcial siguió vivo pidiendo el resto de una plata que ya no
// correspondía, y el operador lo cerró siete veces.
//
// Decisión de Juan (26/9): al entrar la carga, el parcial se cierra SOLO, sin confirmar. Queda
// pagado lo que se pagó y el resto se da de baja con motivo automático.
//
// Módulo puro: decide, no escribe. El adaptador del panel hace el cierre y el aviso.
(function(root, factory){
  if(typeof module==='object' && module.exports && typeof window==='undefined') module.exports=factory();
  else (root.NodoDomain||(root.NodoDomain={})).parciales=factory();
})(globalThis, function(){
  'use strict';

  const MOTIVO = 'CARGO_DE_NUEVO';
  const ETIQUETA = 'Volvió a cargar con el retiro a medio pagar';

  function texto(v){ return String(v == null ? '' : v).trim(); }
  function usuarioDe(s){ return texto(s && (s.USUARIO || s.USUARIO_JUGADOR)).toLowerCase(); }
  function tipoDe(s){ return texto(s && (s.TIPO || s.TIPO_SOLICITUD)).toUpperCase(); }
  function idDe(s){ return texto(s && (s.ID || s.SOLICITUD_ID || s.id)); }
  function fechaDe(s){
    const v = s && (s.FECHA_CREACION || s.created_at || s.FECHA);
    const t = new Date(v || 0).getTime();
    return Number.isFinite(t) ? t : 0;
  }

  // `info` y `cerrado` los pone el panel: son las mismas funciones con las que pinta la caja, así
  // que esto no puede opinar distinto que lo que el operador ve en pantalla.
  function aCerrarPorCarga(opciones){
    const o = opciones || {};
    const solicitudes = Array.isArray(o.solicitudes) ? o.solicitudes : [];
    const info = typeof o.info === 'function' ? o.info : function(){ return null; };
    const cerrado = typeof o.cerrado === 'function' ? o.cerrado : function(){ return false; };
    const yaVistos = o.yaVistos instanceof Set ? o.yaVistos : new Set();

    // Las cargas, agrupadas por jugador y ordenadas: alcanza con la más nueva posterior al retiro.
    const cargasPorUsuario = new Map();
    for(const s of solicitudes){
      if(tipoDe(s) !== 'CARGA') continue;
      const u = usuarioDe(s); if(!u) continue;
      if(!cargasPorUsuario.has(u)) cargasPorUsuario.set(u, []);
      cargasPorUsuario.get(u).push(s);
    }

    const salida = [];
    for(const s of solicitudes){
      if(tipoDe(s) !== 'RETIRO') continue;
      const id = idDe(s); if(!id || yaVistos.has(id)) continue;
      // Un cierre deliberado (a mano o de antes) no se vuelve a tocar: es definitivo.
      if(cerrado(s)) continue;
      const estado = texto(s && s.ESTADO).toUpperCase();
      if(/RECHAZ|CANCEL/.test(estado)) continue;
      const pp = info(s);
      // Sólo los que se están pagando POR PARTES y todavía deben plata. Un retiro común no entra
      // acá, y uno ya saldado tampoco: cerrarlo no cambiaría nada y ensuciaría el historial.
      if(!pp || !pp.hasProg || !(pp.total > 0) || !(pp.restante > 0.5)) continue;

      const desde = fechaDe(s);
      // La carga tiene que ser POSTERIOR al retiro. Sin esto, una carga vieja del mismo jugador
      // cerraría el parcial apenas se abre — que es exactamente al revés de lo que se busca.
      let carga = null;
      for(const c of (cargasPorUsuario.get(usuarioDe(s)) || [])){
        const t = fechaDe(c);
        if(t <= desde) continue;
        if(!carga || t > fechaDe(carga)) carga = c;
      }
      if(!carga) continue;

      salida.push({
        id: id,
        solicitud: s,
        cargaId: idDe(carga),
        cargaMonto: Number(carga.MONTO_REAL || carga.MONTO || carga.MONTO_DECLARADO || 0) || 0,
        cargaFecha: fechaDe(carga),
        pagado: pp.pagado, total: pp.total, restante: pp.restante,
        motivo: MOTIVO, etiqueta: ETIQUETA
      });
    }
    return salida;
  }

  // Estados que el panel considera "cerrada". Copia de data.js: el llamador puede pasar la suya
  // (requests-view lo hace) y esa manda, así no pueden divergir.
  const CERRADOS = ['ACREDITADA','PAGADA','APROBADA','RECHAZADA','CANCELADA','CERRADA','FINALIZADA'];
  function cerradoPorDefecto(e){ return CERRADOS.indexOf(texto(e).toUpperCase()) >= 0; }

  // ¿Este retiro va a la caja de "pagándose por partes"?
  //
  // UN solo criterio, compartido por los dos lugares que lo usan: el render del Inicio (que arma la
  // lista y el contador) y el modal (que la muestra). Estaban escritos aparte y se contradecían.
  //
  // OJO: los que ya cobraron todo pero NADIE cerró siguen entrando a propósito. Es el único lugar
  // desde donde se los puede cerrar; sacarlos de acá los manda a tapar la lista principal, que es
  // el problema que la caja vino a resolver.
  function enProceso(s, opciones){
    const o = opciones || {};
    const info = typeof o.info === 'function' ? o.info : function(){ return null; };
    const cerrado = typeof o.cerrado === 'function' ? o.cerrado : function(){ return false; };
    const estadoCerrado = typeof o.estadoCerrado === 'function' ? o.estadoCerrado : cerradoPorDefecto;
    const sigueAbierto = typeof o.sigueAbierto === 'function' ? o.sigueAbierto : function(){ return false; };
    try{
      if(tipoDe(s) !== 'RETIRO') return false;
      if(/RECHAZ|CANCEL/.test(texto(s && s.ESTADO).toUpperCase())) return false;
      // Cerrado a mano (o solo): es definitivo, no vuelve.
      if(cerrado(s)) return false;
      // La misma regla con la que el Inicio decide si una solicitud sigue abierta. Sin esto, un
      // retiro PAGADA y cobrado entero se quedaba en la caja diciendo "falta $38.907" (D-108).
      if(estadoCerrado(s && s.ESTADO) && !sigueAbierto(s)) return false;
      const pp = info(s);
      return !!(pp && pp.hasProg && pp.total > 0);
    }catch(_e){ return false; }
  }

  // La nota que queda registrada y que ve el jugador. Sin nombres de operadores ni billeteras.
  function notaCierre(caso, money){
    const m = typeof money === 'function' ? money : function(n){ return String(n); };
    return 'Cerrado automáticamente: se registró una carga nueva (' + m(caso.cargaMonto) + ') '
         + 'con el retiro a medio pagar. Cobrado ' + m(caso.pagado) + ' de ' + m(caso.total)
         + '; quedaron sin pagar ' + m(caso.restante) + '.';
  }

  return { aCerrarPorCarga, enProceso, notaCierre, MOTIVO, ETIQUETA };
});
