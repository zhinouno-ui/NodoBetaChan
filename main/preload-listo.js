'use strict';
// El saludo del preload: "ya estoy escuchando".
//
// loadURL() es asíncrono. Justo después de crear la ventana, isLoading() puede dar false, así que
// whenWindowReady() resolvía enseguida, main daba la ventana por lista y mandaba la orden cuando
// del otro lado todavía no había ningún listener registrado. El mensaje se perdía y la llamada
// moría en su timeout. Pasaba al pedir una búsqueda o una carga mientras la ventana recién se
// levantaba (Juan, 26/9).
//
// Esperar un evento de carga no alcanza: lo que importa no es que la página haya cargado, sino que
// el preload haya llegado a registrar sus listeners. Eso sólo lo sabe el preload, así que lo avisa.
//
// Vive acá, en un solo lugar, porque lo usan las DOS ventanas que cargan el preload: la de Agentes
// y la de verificación. Duplicarlo es como quedaron desincronizados los dos preloads (H-7).
const CANAL = 'drex:preload-listo';

function vigilarPreload(win, { setTimer = setTimeout } = {}) {
  let listo = false;
  let esperando = [];

  function avisar(valor) {
    const cola = esperando; esperando = [];
    for (const resolver of cola) { try { resolver(valor); } catch (_e) {} }
  }
  function marcar() { listo = true; avisar(true); }
  function olvidar() { listo = false; }   // documento nuevo = preload nuevo

  // Si la ventana se muere mientras esperamos, no hay saludo que esperar: se corta enseguida en
  // vez de dejar la llamada colgada hasta el timeout. El llamador se da cuenta de que no hay
  // ventana y falla con su propio mensaje, que es el que el operador entiende.
  let muerta = false;
  // Se avisa FALSE: no hubo saludo. Decir true acá sería mentir — el llamador tiene que ver que
  // no hay preload y fallar con su propio mensaje.
  function matar() { muerta = true; avisar(false); }

  try {
    const wc = win && win.webContents;
    if (wc) {
      wc.on('ipc-message', (_e, canal) => { if (canal === CANAL) marcar(); });
      // Una navegación DENTRO de la página (SPA) no cambia el preload; una de documento sí.
      wc.on('did-start-navigation', (_e, _url, _inPage, mismoDocumento) => {
        if (!mismoDocumento) olvidar();
      });
      wc.once('destroyed', matar);
      try { win.once('closed', matar); } catch (_e) {}
    }
  } catch (_e) {}

  // NUNCA rechaza ni se cuelga: si el saludo no llega, devuelve false y el llamador sigue como
  // antes. Un preload viejo o una ventana rara no pueden dejar al operador esperando para siempre.
  function esperar(timeoutMs = 8000) {
    if (listo) return Promise.resolve(true);
    if (muerta) return Promise.resolve(false);
    return new Promise(resolve => {
      let cerrado = false;
      const terminar = (v) => { if (cerrado) return; cerrado = true; resolve(v); };
      esperando.push(terminar);
      setTimer(() => terminar(false), timeoutMs);
    });
  }

  return { esperar, olvidar, get listo() { return listo; } };
}

module.exports = { vigilarPreload, CANAL };
