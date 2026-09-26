// ── Caja negra del panel ──────────────────────────────────────────────────────
// Adaptador de NodoDomain.cajaNegra. Anota el camino de cada llamada a Agentes para que, cuando
// algo corte, se vea hasta dónde llegó y de qué capa salió — en vez del "no anda" de siempre.
//
// Regla de oro: esto NO puede cambiar el comportamiento ni romper una operación. Todo va envuelto
// en try/catch y se traga cualquier error propio. Si el registro falla, la operación sigue.
//
// Qué NO se guarda: los argumentos de las llamadas. Una clave viaja en los de iniciarSesion.
// Se anota el nombre del método y lo que devuelve la pantalla, nada más.
(function(){
  'use strict';
  const CLAVE = 'nodo_caja_negra';
  const caja = NodoDomain.cajaNegra.crear({ topePasos: 120, topeFallas: 15 });

  // Lo de antes del reinicio sigue sirviendo: la falla puede ser de ayer y el panel se reabrió.
  try{
    const guardado = localStorage.getItem(CLAVE);
    if(guardado) caja.importar(JSON.parse(guardado));
  }catch(_e){}

  let timerGuardar = null;
  function guardar(){
    // Agrupado: una operación anota varios pasos seguidos y no hace falta escribir en cada uno.
    if(timerGuardar) return;
    timerGuardar = setTimeout(function(){
      timerGuardar = null;
      try{ localStorage.setItem(CLAVE, JSON.stringify(caja.exportar())); }catch(_e){}
    }, 1500);
  }

  function contextoDelPanel(){
    try{
      const pc = (typeof pcOperativa !== 'undefined' ? pcOperativa : '') || window.pcOperativa || '';
      const op = (window.operador && (window.operador.usuario || window.operador.nombre)) || '';
      const backend = (window._agentBackendState && window._agentBackendState.backend) || '';
      return { pc: pc, oficina: window.oficinaId || '', operador: op,
               version: window._versionApp || '', backend: backend };
    }catch(_e){ return {}; }
  }

  // Dónde quedó la pantalla de Agentes, según lo que devolvió el preload. Es el dato que no se
  // puede reconstruir después: para cuando alguien mira, la ventana ya cambió.
  function pantallaDe(r){
    try{
      if(!r || typeof r !== 'object') return '';
      const p = [];
      if(r.url) p.push(String(r.url).replace(/^https?:\/\/[^/]+/, ''));
      if(r.flujo) p.push('flujo: ' + r.flujo);
      if(r.needsLogin) p.push('pide login');
      if(r.pageError) p.push('página bloqueada');
      if(Array.isArray(r.carteles) && r.carteles.length) p.push('carteles: ' + r.carteles.slice(0, 3).join(' | '));
      return p.join(' · ');
    }catch(_e){ return ''; }
  }

  window._cnPaso = function(paso, estado, datos){
    try{
      const d = datos || {};
      caja.contexto(contextoDelPanel());
      caja.anotar({ paso: paso, capa: d.capa || 'preload', estado: estado, ms: d.ms,
                    detalle: d.detalle, pantalla: d.pantalla });
      guardar();
    }catch(_e){}
  };

  window._cnFalla = function(paso, mensaje, datos){
    try{
      const d = datos || {};
      caja.contexto(contextoDelPanel());
      const falla = caja.anotarFalla({ paso: paso, mensaje: mensaje, capa: d.capa, pantalla: d.pantalla });
      guardar();
      // Al toque en la consola de la PC: si el operador abre el devtools, lo primero que ve es
      // hasta dónde llegó, no un stack.
      try{ console.warn('%c[caja negra] ' + caja.resumen(falla), 'color:#f97316'); }catch(_e){}
      return falla;
    }catch(_e){ return null; }
  };

  // Para consultar sentado en la PC, o para que el operador lo copie y lo mande.
  window.cajaNegra = {
    fallas: function(){ return caja.fallas; },
    pasos: function(){ return caja.pasos; },
    resumen: function(){ return caja.resumen(); },
    exportar: function(){ return caja.exportar(); },
    texto: function(){
      const e = caja.exportar();
      const ctx = e.contexto;
      const cab = 'CAJA NEGRA · pc ' + (ctx.pc || '?') + ' · operador ' + (ctx.operador || '?')
                + ' · backend ' + (ctx.backend || '?') + ' · versión ' + (ctx.version || '?');
      const fallas = e.fallas.slice().reverse().map(function(f){
        return '\n[' + new Date(f.t).toLocaleString() + '] ' + caja.resumen(f)
             + '\n   camino: ' + f.rastro.map(function(p){
                 return p.paso + '(' + p.estado + (p.ms ? ' ' + p.ms + 'ms' : '') + ')';
               }).join(' → ');
      }).join('\n');
      return cab + '\n' + (fallas || '\n(sin fallas registradas)');
    },
    limpiar: function(){ caja.limpiar(); try{ localStorage.removeItem(CLAVE); }catch(_e){} return 'caja negra vacía'; }
  };
  // Atajo para leerlo de un vistazo en la consola de la PC.
  window.verCajaNegra = function(){ const t = window.cajaNegra.texto(); console.log(t); return t; };
  window._cnPantallaDe = pantallaDe;
})();
