// Adaptador de NodoDomain.latencia. Mide cuánto tarda cada mensaje del jugador en llegar al panel
// y lo deja SIEMPRE en la consola de la PC. El operador no lo ve: no se dibuja nada en pantalla.
//
// Por qué: no hay forma de saber si el sistema anda bien mirando el código. Las velocidades no son
// siempre las mismas y nadie puede decir si dos minutos son normales o son una falla. Hay que
// medirlo y tenerlo a mano en cada oficina, para cuando haya que mirarlo (Juan, 29/9).
//
// El día que se armó, una consulta de P4 se veía en el panel como "11:13 a. m." — parecía de hacía
// veinte minutos y era del día anterior. Con esto en la consola habría dicho "espera 1 d".
//
// Se mide en el momento en que los datos ENTRAN al panel, no cuando el operador los mira: lo que
// se quiere saber es cuánto tardó el sistema, no cuánto tardó la persona en abrir la conversación.
(function(){
  'use strict';
  if(typeof window === 'undefined') return;
  if(!window.NodoDomain || !NodoDomain.latencia) return;

  const medidor = NodoDomain.latencia.crear({ tope: 300 });

  // Cada cuánto se escupe la suma a la consola. No es un aviso: es para que si alguien abre la
  // consola de una PC a cualquier hora, el número ya esté ahí sin tener que pedirlo.
  const CADA_MS = 10 * 60 * 1000;
  // Un mensaje que tardó más que esto se avisa en el momento, no solo en la suma.
  const GRITA_MS = 3 * 60 * 1000;

  function oficina(){
    try{ return String(window.pcOperativa || '') ; }catch(_e){ return ''; }
  }

  // Del hilo de una solicitud saca los mensajes del JUGADOR. Los del operador no se miden: el
  // tiempo que tarda una persona en contestar no es una falla del sistema.
  function mensajesDelJugador(sol){
    let m = (sol && (sol.METADATA !== undefined ? sol.METADATA : sol.metadata)) || {};
    if(typeof m === 'string'){ try{ m = JSON.parse(m); }catch(_e){ return []; } }
    const hilo = m && m.chat_thread;
    if(!Array.isArray(hilo)) return [];
    return hilo.filter(x => x && String(x.origen || '').toUpperCase() === 'USUARIO');
  }

  // El portal manda en el metadata de la solicitud la hora del dedo (t_toque) y la de cuando salió
  // el pedido (t_envio). Los mensajes que entraron antes de que el portal las mandara no las
  // tienen: ahí se mide solo el tramo base→panel, que igual es el que delata al panel.
  function horasDelPortal(sol, msg){
    if(msg && (msg.t_toque || msg.t_envio)) return { toque: msg.t_toque, envio: msg.t_envio };
    let m = (sol && (sol.METADATA !== undefined ? sol.METADATA : sol.metadata)) || {};
    if(typeof m === 'string'){ try{ m = JSON.parse(m); }catch(_e){ return {}; } }
    return { toque: (m && m.t_toque) || null, envio: (m && m.t_envio) || null };
  }

  // Se llama con la tanda de solicitudes recién traída del servidor.
  function medirTanda(solicitudes){
    if(!Array.isArray(solicitudes) || !solicitudes.length) return;
    const ahora = new Date().toISOString();
    const pc = oficina();
    for(const sol of solicitudes){
      const id = String((sol && (sol.ID || sol.id || sol.SOLICITUD_ID)) || '');
      if(!id) continue;
      const tipo = String((sol && (sol.TIPO || sol.tipo)) || 'mensaje').toLowerCase();
      for(const msg of mensajesDelJugador(sol)){
        const h = horasDelPortal(sol, msg);
        const t = medidor.anotar({
          clave:  id + '#' + String(msg.fecha || ''),
          tipo:   tipo,
          oficina: pc,
          fecha:  msg.fecha,
          toque:  h.toque,
          envio:  h.envio,
          ahora:  ahora
        });
        if(!t) continue;
        const linea = medidor.linea(t);
        // warn y no log para los lentos: en la consola quedan resaltados y filtrables por nivel.
        const salida = (t.espera >= GRITA_MS || (t.total !== null && t.total >= GRITA_MS))
          ? console.warn : console.log;
        salida(linea + ' · solicitud ' + id);
      }
    }
  }

  let _reloj = null;
  function arrancar(){
    if(_reloj) return;
    _reloj = setInterval(function(){
      try{
        if(medidor.tamano) console.log(medidor.texto());
      }catch(_e){}
    }, CADA_MS);
  }

  window.nodoLatencia = {
    medirTanda,
    resumen: () => medidor.resumen(),
    texto:   () => medidor.texto(),
    reset:   () => medidor.reset()
  };
  // Para escribir en la consola de cualquier PC y ver el número al instante.
  window.verLatencia = function(){ const t = medidor.texto(); console.log(t); return t; };

  arrancar();
})();
