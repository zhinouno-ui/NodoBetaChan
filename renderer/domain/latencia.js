// Cuánto tarda de verdad un mensaje desde que el jugador aprieta el botón.
//
// No se puede saber si el sistema anda bien mirando el código: las velocidades no son siempre las
// mismas y no hay forma de decir si dos minutos son normales o son una falla. Hay que MEDIRLO, y
// tenerlo siempre a mano (Juan, 29/9).
//
// El 29/9 una consulta se veía en el panel como "11:13 a. m." y parecía de hace veinte minutos.
// Era del día ANTERIOR: 24 horas y 20 minutos. Nadie podía notarlo, ni el operador ni yo.
//
// Se miden tres tramos, y cada uno dice de quién es el problema:
//
//   toque ──preparacion──> envio ──subida──> base ──espera──> panel
//
//   preparacion  del dedo hasta que salió el pedido. Lo mide el teléfono contra SU PROPIO reloj,
//                así que es exacto aunque el teléfono esté en hora equivocada.
//   subida       del pedido hasta que quedó escrito en la base. Acá se mezclan la red y el
//                desfasaje del reloj del teléfono, y NO se pueden separar: se dice así, no se
//                inventa una corrección. Un valor absurdo delata un reloj, no una red lenta.
//   espera       lo que estuvo escrito sin que el panel lo mostrara. Las dos horas son de la base
//                y de la PC, no del teléfono: es el tramo confiable, y el que delata al panel.
//   total        la suma, solo cuando el reloj del teléfono es creíble.
//
// (Se intentó mandar el toque ya corregido contra la hora del servidor. No se puede: el navegador
// no deja leer la cabecera Date de otro dominio. Verificado ejecutándolo el 29/9.)
//
// Módulo puro: no toca DOM, ni red, ni relojes propios — el `ahora` siempre entra por parámetro,
// así las pruebas son exactas. Acá no entra el texto de ningún mensaje: solo tiempos e ids.
(function(root, factory){
  if(typeof module==='object' && module.exports && typeof window==='undefined') module.exports=factory();
  else (root.NodoDomain||(root.NodoDomain={})).latencia=factory();
})(globalThis, function(){
  'use strict';

  const TOPE = 400;
  // Cuánto puede tardar la subida antes de que deje de ser una red lenta y pase a ser un reloj
  // equivocado. Una subida negativa es imposible: el mensaje no puede llegar antes de salir. Y más
  // de cinco minutos no es red desde un teléfono: es un reloj mal puesto. En los dos casos el total
  // queda en null en vez de ensuciar el promedio con un número inventado.
  const SUBIDA_MIN_MS = -2000;        // margen para el redondeo entre relojes
  const SUBIDA_MAX_MS = 5 * 60 * 1000;

  function ms(v){
    if(v === null || v === undefined || v === '') return null;
    const t = (v instanceof Date) ? v.getTime() : new Date(v).getTime();
    return Number.isFinite(t) && t > 0 ? t : null;
  }

  // "3 s", "2 m 10 s", "1 d 4 h". Para leer de un vistazo en la consola.
  function dur(x){
    if(x === null || x === undefined || !Number.isFinite(x)) return '?';
    const neg = x < 0 ? '-' : '';
    let s = Math.round(Math.abs(x) / 1000);
    if(s < 60) return neg + s + ' s';
    const m = Math.floor(s / 60); s = s % 60;
    if(m < 60) return neg + m + ' m' + (s ? ' ' + s + ' s' : '');
    const h = Math.floor(m / 60); const m2 = m % 60;
    if(h < 24) return neg + h + ' h' + (m2 ? ' ' + m2 + ' m' : '');
    const d = Math.floor(h / 24); const h2 = h % 24;
    return neg + d + ' d' + (h2 ? ' ' + h2 + ' h' : '');
  }

  function crear(opciones){
    const o = opciones || {};
    const tope = Number(o.tope) > 0 ? Number(o.tope) : TOPE;
    const vistos = new Set();     // para no contar dos veces: el panel repinta todo el tiempo
    let muestras = [];

    // Devuelve el tramo medido, o null si ya estaba contado o si no hay con qué medir.
    // `clave` identifica al mensaje: mientras sea la misma, se cuenta una sola vez.
    function anotar(m){
      const d = m || {};
      const clave = String(d.clave == null ? '' : d.clave);
      if(!clave || vistos.has(clave)) return null;

      const base  = ms(d.fecha);    // cuándo quedó escrito en la base (lo estampa el servidor)
      const ahora = ms(d.ahora);
      if(base === null || ahora === null) return null;

      vistos.add(clave);

      const toque = ms(d.toque);    // cuándo apretó el dedo, si el portal lo mandó
      const envio = ms(d.envio);    // cuándo salió el pedido del teléfono
      const preparacion = (toque !== null && envio !== null) ? envio - toque : null;
      const subida = envio === null ? null : base - envio;
      const relojRaro = subida !== null && (subida < SUBIDA_MIN_MS || subida > SUBIDA_MAX_MS);

      const tramo = {
        clave,
        tipo:   String(d.tipo || 'mensaje'),
        oficina: String(d.oficina || ''),
        espera: ahora - base,                       // siempre confiable
        preparacion,                                // siempre confiable (reloj contra sí mismo)
        subida: relojRaro ? null : subida,
        total:  (toque === null || relojRaro) ? null : ahora - toque,
        relojRaro,
        base, ahora
      };

      muestras.push(tramo);
      if(muestras.length > tope) muestras = muestras.slice(-tope);
      return tramo;
    }

    // Una línea por mensaje. Es lo que se lee cuando algo llegó tarde.
    function linea(t){
      if(!t) return '';
      const partes = ['[latencia]', t.tipo];
      if(t.oficina) partes.push(t.oficina);
      partes.push('espera ' + dur(t.espera));
      if(t.preparacion !== null) partes.push('preparacion ' + dur(t.preparacion));
      if(t.subida !== null) partes.push('subida ' + dur(t.subida));
      if(t.total !== null) partes.push('TOTAL ' + dur(t.total));
      else if(t.relojRaro) partes.push('(el reloj del telefono esta desfasado: sin total)');
      else partes.push('(sin hora de toque: portal viejo)');
      return partes.join(' · ');
    }

    function nums(campo){
      return muestras.map(x => x[campo]).filter(v => Number.isFinite(v));
    }
    function mediana(a){
      if(!a.length) return null;
      const s = a.slice().sort((x, y) => x - y);
      const i = Math.floor(s.length / 2);
      return s.length % 2 ? s[i] : Math.round((s[i - 1] + s[i]) / 2);
    }

    function resumen(){
      const e = nums('espera'), t = nums('total');
      const peor = muestras.reduce((a, b) => {
        const va = a && Number.isFinite(a.total) ? a.total : (a ? a.espera : -1);
        const vb = Number.isFinite(b.total) ? b.total : b.espera;
        return vb > va ? b : a;
      }, null);
      return {
        muestras: muestras.length,
        sinToque: muestras.filter(x => x.preparacion === null).length,
        relojesRaros: muestras.filter(x => x.relojRaro).length,
        espera: { medio: mediana(e), peor: e.length ? Math.max.apply(null, e) : null },
        total:  { medio: mediana(t), peor: t.length ? Math.max.apply(null, t) : null },
        peor
      };
    }

    // La suma que va siempre a la consola.
    function texto(){
      const r = resumen();
      if(!r.muestras) return '[latencia] todavia sin mediciones';
      const l = ['[latencia] ' + r.muestras + ' mensajes medidos'];
      l.push('  espera en el panel   medio ' + dur(r.espera.medio) + ' · peor ' + dur(r.espera.peor));
      if(r.total.medio !== null)
        l.push('  total desde el toque medio ' + dur(r.total.medio) + ' · peor ' + dur(r.total.peor));
      if(r.sinToque)     l.push('  ' + r.sinToque + ' sin hora de toque (portal viejo)');
      if(r.relojesRaros) l.push('  ' + r.relojesRaros + ' con el reloj del telefono desfasado');
      if(r.peor)         l.push('  el peor: ' + linea(r.peor));
      return l.join('\n');
    }

    function reset(){ vistos.clear(); muestras = []; }

    return { anotar, linea, resumen, texto, reset,
             get tamano(){ return muestras.length; } };
  }

  return { crear, dur, SUBIDA_MIN_MS, SUBIDA_MAX_MS };
});
