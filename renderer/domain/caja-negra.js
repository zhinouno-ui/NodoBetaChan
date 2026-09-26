// Caja negra de las operaciones contra Agentes.
//
// No adivina el error: guarda el CAMINO. No se puede escribir de antemano el cartel de una falla
// que todavía no ocurrió, así que en vez de eso se anota cada paso que se dio. Cuando algo corta,
// lo que sirve es saber hasta dónde llegó y de qué capa salió el corte.
//
// Módulo puro: no toca DOM, ni red, ni localStorage. El adaptador del panel decide qué guardar y
// dónde. Acá no entra NADA sensible: el adaptador nunca pasa argumentos de operación (una clave
// viaja en los argumentos de iniciarSesion), y por si acaso todo texto se recorta.
(function(root, factory){
  if(typeof module==='object' && module.exports && typeof window==='undefined') module.exports=factory();
  else (root.NodoDomain||(root.NodoDomain={})).cajaNegra=factory();
})(globalThis, function(){
  'use strict';

  const TOPE_PASOS  = 200;   // pasos que se recuerdan
  const TOPE_FALLAS = 20;    // fallas con su rastro, para consultar después
  const RASTRO      = 12;    // cuántos pasos se guardan con cada falla
  const MAX_TEXTO   = 300;

  function texto(v){
    if(v === null || v === undefined) return '';
    const s = typeof v === 'string' ? v : (v.message || String(v));
    return s.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXTO);
  }

  // De quién es la falla. NO es un catálogo de errores previstos: son las firmas de quien EMITE el
  // mensaje, que es un dato del sistema, no un pronóstico. Lo que no se reconoce queda
  // 'desconocida' a propósito — mejor eso que atribuirlo mal.
  function capaDeError(mensaje){
    const m = texto(mensaje);
    if(!m) return 'desconocida';
    if(/^Timeout: la automatizaci/i.test(m))                      return 'main';       // requests.run de main
    if(/se recarg[oó] durante la operaci/i.test(m))               return 'main';       // did-navigate de main
    if(/La ventana de Agentes se cerr/i.test(m))                  return 'main';
    if(/M[eé]todo no permitido/i.test(m))                         return 'contrato';   // panel↔preload desalineados
    if(/no se ejecut[oó]/i.test(m) && /Sesi[oó]n de Agentes/i.test(m)) return 'panel'; // cortacircuitos de la cola
    if(/super[oó] \d+s .*destrab/i.test(m))                       return 'panel';      // tope de tarea de la cola
    if(/Operaci[oó]n frenada por el operador/i.test(m))            return 'operador';
    if(/session is invalid|Se cay[oó] la sesi[oó]n de Agentes/i.test(m)) return 'agentes';
    if(/No se encontr[oó]|no mostraba|no apareci[oó]|tapado|selector/i.test(m)) return 'preload';
    return 'desconocida';
  }

  function crear(opciones){
    const o = opciones || {};
    const ahora = typeof o.ahora === 'function' ? o.ahora : Date.now;
    const topePasos  = o.topePasos  > 0 ? o.topePasos  : TOPE_PASOS;
    const topeFallas = o.topeFallas > 0 ? o.topeFallas : TOPE_FALLAS;
    let contexto = {};
    const pasos = [];
    const fallas = [];

    // El contexto es quién está operando: pc, operador, backend, versión. Va con cada falla para
    // poder mirarlo PC por PC.
    function contextoActual(nuevo){
      if(nuevo && typeof nuevo === 'object'){
        for(const k of Object.keys(nuevo)){
          const v = nuevo[k];
          if(v !== null && v !== undefined && v !== '') contexto[k] = texto(v);
        }
      }
      return Object.assign({}, contexto);
    }

    function anotar(paso){
      const p = paso || {};
      const fila = {
        t: ahora(),
        paso: texto(p.paso) || '(sin nombre)',
        capa: texto(p.capa) || 'panel',
        estado: texto(p.estado) || 'inicio'
      };
      if(p.ms !== null && p.ms !== undefined && isFinite(Number(p.ms))) fila.ms = Math.round(Number(p.ms));
      const d = texto(p.detalle);
      if(d) fila.detalle = d;
      // Lo que devuelve el preload al fallar dice DÓNDE quedó la pantalla: eso es lo que no se
      // puede reconstruir después.
      if(p.pantalla) fila.pantalla = texto(p.pantalla);
      pasos.push(fila);
      if(pasos.length > topePasos) pasos.splice(0, pasos.length - topePasos);
      return fila;
    }

    // Una falla congela el rastro del momento. Sin esto, los pasos que vienen después la tapan y
    // cuando se va a mirar ya no está el camino que importaba.
    function anotarFalla(datos){
      const d = datos || {};
      const mensaje = texto(d.mensaje);
      const falla = {
        t: ahora(),
        paso: texto(d.paso) || '(sin nombre)',
        mensaje,
        capa: texto(d.capa) || capaDeError(mensaje),
        contexto: contextoActual(),
        rastro: pasos.slice(-RASTRO)
      };
      if(d.pantalla) falla.pantalla = texto(d.pantalla);
      fallas.push(falla);
      if(fallas.length > topeFallas) fallas.splice(0, fallas.length - topeFallas);
      return falla;
    }

    function ultimoPaso(){ return pasos.length ? pasos[pasos.length - 1] : null; }

    // Una línea para leer de un vistazo: hasta dónde llegó y de quién fue.
    function resumen(falla){
      const f = falla || (fallas.length ? fallas[fallas.length - 1] : null);
      if(!f) return 'sin fallas registradas';
      const partes = ['cortó en "' + f.paso + '"', 'capa: ' + f.capa];
      const previos = f.rastro.filter(p => p.paso !== f.paso && p.estado === 'ok').slice(-2).map(p => p.paso);
      if(previos.length) partes.push('lo último que sí anduvo: ' + previos.join(' → '));
      if(f.pantalla) partes.push('pantalla: ' + f.pantalla);
      if(f.mensaje) partes.push('dijo: ' + f.mensaje);
      return partes.join(' · ');
    }

    function exportar(){
      return { contexto: contextoActual(), pasos: pasos.slice(), fallas: fallas.slice() };
    }

    function importar(guardado){
      const g = guardado || {};
      if(g.contexto && typeof g.contexto === 'object') contextoActual(g.contexto);
      if(Array.isArray(g.pasos))  pasos.push(...g.pasos.slice(-topePasos));
      if(Array.isArray(g.fallas)) fallas.push(...g.fallas.slice(-topeFallas));
    }

    function limpiar(){ pasos.length = 0; fallas.length = 0; contexto = {}; }

    return { anotar, anotarFalla, ultimoPaso, resumen, exportar, importar, limpiar,
             contexto: contextoActual,
             get pasos(){ return pasos.slice(); },
             get fallas(){ return fallas.slice(); } };
  }

  return { crear, capaDeError };
});
