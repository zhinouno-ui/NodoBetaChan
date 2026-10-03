(function(root, factory){
  if(typeof module === 'object' && module.exports) module.exports = factory();
  else root.NodoRefresh = factory();
})(globalThis, function(){
  'use strict';

  // Sólo lecturas: agrupa ráfagas y garantiza una lectura final si llegó un evento
  // durante una petición. Nunca usar para acciones monetarias ni escrituras.
  function create(tasks, { timers = globalThis, delay = 80, onError = () => {} } = {}) {
    const entries = new Map();
    let disposed = false;
    for(const [name, task] of Object.entries(tasks)) {
      entries.set(name, { task, timer: null, running: false, dirty: false });
    }
    // `request` devuelve una promesa con el RESULTADO de la lectura. Hace falta para saber si la
    // lectura entró de verdad: cargarSolicitudesPortal no tira excepción cuando falla, devuelve
    // {error}. Sin esto, el que avisó no tiene forma de distinguir "ya está" de "no bajó nada", y
    // daba por consumido un aviso que nunca se llegó a leer (Juan, 3/10).
    function request(name) {
      const entry = entries.get(name);
      if(!entry) throw new Error('Lectura desconocida: ' + name);
      if(disposed) return Promise.resolve(undefined);
      entry.dirty = true;
      if(!entry.waiters) entry.waiters = [];
      const esperar = new Promise(resolve => entry.waiters.push(resolve));
      if(entry.running || entry.timer !== null) return esperar;
      entry.timer = timers.setTimeout(() => {
        entry.timer = null;
        if(disposed) return;
        entry.dirty = false;
        entry.running = true;
        // Los que estaban esperando ANTES de arrancar se resuelven con esta vuelta; los que
        // lleguen mientras corre quedan para la siguiente.
        const avisar = entry.waiters;
        entry.waiters = [];
        Promise.resolve().then(() => {
          if(!disposed) return entry.task();
        }).then(valor => {
          avisar.forEach(resolve => { try { resolve(valor); } catch(_) {} });
        }).catch(error => {
          try { onError(error, name); } catch(_) {}
          avisar.forEach(resolve => { try { resolve(undefined); } catch(_) {} });
        }).finally(() => {
          entry.running = false;
          if(entry.dirty && !disposed) request(name);
        });
      }, delay);
      return esperar;
    }
    function dispose() {
      disposed = true;
      for(const entry of entries.values()) {
        if(entry.timer !== null) timers.clearTimeout(entry.timer);
        entry.timer = null;
        entry.dirty = false;
        // Nadie se queda esperando una promesa que ya no va a resolver nunca.
        if(entry.waiters) {
          entry.waiters.forEach(resolve => { try { resolve(undefined); } catch(_) {} });
          entry.waiters = [];
        }
      }
    }
    return { request, dispose };
  }
  return { create };
});
