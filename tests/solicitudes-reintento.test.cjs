const test = require('node:test');
const assert = require('node:assert/strict');
const requests = require('../renderer/portal/requests.js');

// OFI-SAN, 29/9 21:10: "tu nodo me tiene podrido con ese cartel cada 5 segundos, no me llega ni
// una carga, le tengo que dar reintentar 500 veces y me llega todo junto despues".
//
// No mentia. Escribir (actualizarSolicitudPortal) reintentaba 3 veces ante fallos de red por el
// proxy que pestañea; LEER la bandeja no reintentaba nada. Con la red inestable la lista quedaba
// congelada hasta el reloj de 60 s o hasta que el operador apretara el boton.
//
// Estas pruebas EJECUTAN la funcion con relojes falsos. Una prueba que sólo lea el código no
// distingue "reintenta" de "parece que reintenta".

const noop = () => {};
function elemento(){
  return { style:{}, classList:{add:noop,remove:noop,toggle:noop,contains:()=>false},
           appendChild:noop, remove:noop, querySelector:()=>null, querySelectorAll:()=>[],
           innerHTML:'', textContent:'', parentNode:{ insertBefore:noop } };
}

// setTimeout falso: las esperas cortas (el respiro entre intentos) corren solas para que el bucle
// avance; las largas (el reintento programado) quedan en cola para dispararlas a mano.
function relojFalso(){
  const cola = [];
  function set(fn, ms){
    if(ms < 5000){ fn(); return 0; }
    cola.push({ fn, ms });
    return cola.length;
  }
  return {
    set,
    clear: (id) => { if(id >= 1 && cola[id-1]) cola[id-1] = null; },
    pendientes: () => cola.filter(Boolean).length,
    esperaDe: (i) => (cola.filter(Boolean)[i] || {}).ms,
    correr: () => { const c = cola.filter(Boolean); cola.length = 0; c.forEach(x => x.fn()); }
  };
}

function armar(respuestas){
  const reloj = relojFalso();
  const llamadas = [];
  const avisos = [];
  const V154P = { solicitudes: [] };
  let i = 0;
  const deps = {
    V154P,
    window: { V154P, clearTimeout: reloj.clear, _retiroParcialInfo: null },
    rpc: async (nombre, args) => { llamadas.push({ nombre, args }); return respuestas[Math.min(i++, respuestas.length-1)]; },
    setTimeout: reloj.set,
    getCanal: async () => 'P4',
    normArr: (x) => (Array.isArray(x) ? x : []),
    mapSolicitudPortal: (x) => x,
    esc: (x) => String(x),
    money: (x) => String(x),
    document: { getElementById: () => elemento() },
    _v154pAvisoDesfasaje: (m) => avisos.push(m),
    _portalAutoRechazar: noop, cargarAlertasRetiro: noop, alert: noop, toast: noop,
    operador: {}, solicitudes: [], renderInicio: noop,
    renderSolicitudesPortalCompleto: noop, renderSolicitudesPortalEnInicio: noop,
    verificarSolicitudes: noop
  };
  const api = requests.create(deps);
  return { api, deps, reloj, llamadas, avisos, V154P };
}

const RED = { error: { message: 'TypeError: fetch failed' } };
const SERVIDOR = { error: { message: 'permission denied for function panel_v15_5_listar_solicitudes_portal' } };
const OK = { data: [] };

test('un corte de red se reintenta, no se abandona al primer intento', async () => {
  const c = armar([RED, RED, OK]);
  await c.api.cargarSolicitudesPortal(true);
  assert.equal(c.llamadas.length, 3, 'tiene que insistir hasta que una pegue');
  assert.equal(c.llamadas[0].args.p_pc_codigo, 'P4');
  // Pegó a la tercera: el operador no tiene por qué enterarse de nada.
  assert.equal(c.avisos[c.avisos.length-1], null, 'el cartel se saca al recuperarse');
  assert.equal(c.V154P.solicitudesErrorAt, null);
});

test('si la red no vuelve, avisa y se vuelve a intentar SOLO', async () => {
  const c = armar([RED, RED, RED]);
  await c.api.cargarSolicitudesPortal(true);
  assert.equal(c.llamadas.length, 3, 'tres intentos y no mas: insistir sin parar tampoco sirve');
  assert.ok(c.avisos[c.avisos.length-1], 'queda el cartel de lista vieja');
  assert.equal(c.V154P.solicitudesEsRed, true, 'el cartel puede decir que fue la conexion');
  assert.equal(c.reloj.pendientes(), 1, 'y queda UN reintento programado, sin tocar nada');
  assert.equal(c.reloj.esperaDe(0), 8000, 'el primero a los 8 s, no a los 60 del reloj de la bandeja');
});

test('el reintento solo se dispara de verdad y recupera la bandeja', async () => {
  const c = armar([RED, RED, RED, OK]);
  await c.api.cargarSolicitudesPortal(true);
  assert.equal(c.llamadas.length, 3);
  c.reloj.correr();                       // pasan los 8 segundos
  await new Promise(r => setImmediate(r));
  assert.ok(c.llamadas.length > 3, 'se volvio a pedir sin que nadie apretara nada');
  assert.equal(c.avisos[c.avisos.length-1], null, 'y el cartel se fue');
});

test('las esperas se van agrandando, no machacan la red caida', async () => {
  const c = armar([RED]);
  const esperas = [];
  for(let v = 0; v < 4; v++){
    await c.api.cargarSolicitudesPortal(true);
    esperas.push(c.reloj.esperaDe(0));
    c.reloj.correr();                     // consume el programado para poder ver el siguiente
    await new Promise(r => setImmediate(r));
  }
  assert.deepEqual(esperas.slice(0,3), [8000, 16000, 32000], 'se duplica: ' + esperas.join(','));
  assert.ok(esperas.every(x => x <= 60000), 'y nunca pasa del minuto: ' + esperas.join(','));
});

test('un rechazo del servidor NO se reintenta: insistir no lo arregla', async () => {
  // Un permiso mal puesto o una RPC que no existe van a fallar igual mil veces. Insistir solo
  // demora el aviso, que es lo unico util en ese caso.
  const c = armar([SERVIDOR, SERVIDOR, SERVIDOR]);
  await c.api.cargarSolicitudesPortal(true);
  assert.equal(c.llamadas.length, 1, 'un solo intento');
  assert.ok(c.avisos[c.avisos.length-1], 'avisa enseguida');
  assert.equal(c.V154P.solicitudesEsRed, false, 'y el cartel no dice que fue la conexion');
});

test('cuando vuelve a andar, el reintento programado se cancela', async () => {
  const c = armar([RED, RED, RED]);
  await c.api.cargarSolicitudesPortal(true);
  assert.equal(c.reloj.pendientes(), 1);

  const c2 = armar([OK]);
  await c2.api.cargarSolicitudesPortal(true);
  assert.equal(c2.reloj.pendientes(), 0, 'sin fallas no queda ningun reloj corriendo');
});

test('no se acumulan reintentos si la bandeja se pide muchas veces', async () => {
  // La bandeja se pide desde varios lados a la vez. Si cada fallo programara su propio reintento,
  // al volver la red entrarian todas las peticiones juntas de golpe.
  const c = armar([RED]);
  await c.api.cargarSolicitudesPortal(true);
  await c.api.cargarSolicitudesPortal(true);
  await c.api.cargarSolicitudesPortal(true);
  assert.equal(c.reloj.pendientes(), 1, 'uno solo, no tres');
});
