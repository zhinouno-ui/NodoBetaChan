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

// setTimeout falso: las esperas muy cortas (el respiro de 500/1000 ms entre intentos) corren solas
// para que el bucle avance; de 1100 ms para arriba quedan en cola, para poder dispararlas a mano y
// medir si algo se agendo o no — el rebote del refresco (1200 ms) y el reintento (8 s+).
function relojFalso(){
  const cola = [];
  function set(fn, ms){
    if(ms < 1100){ fn(); return 0; }
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

// Igual que armar(), pero con un retiro parcial SOSTENIDO del ciclo anterior y con control sobre
// lo que contesta landing_retiro_progreso. Ese bloque entro en 2.1.3 (ebfeaf3) y es el que clavaba
// la bandeja: preguntaba a la base por cada sostenido, con await, DENTRO del cargado.
function armarConSostenido(progreso){
  const c = armar([{ data: [] }]);
  const sostenido = { ID: '266250', TIPO: 'RETIRO', metadata: { retiro_parcial: { total: 100000, pagado: 60000 } } };
  c.V154P.solicitudes = [sostenido];
  c.deps.window._retiroParcialInfo = () => ({ hasProg: true, restante: 40000 });
  const rpcBandeja = c.deps.rpc;
  c.deps.rpc = async (nombre, args) => {
    if(nombre === 'landing_retiro_progreso'){ c.llamadas.push({ nombre, args }); return progreso(); }
    return rpcBandeja(nombre, args);
  };
  return Object.assign(c, { sostenido });
}
function conLimite(promesa, ms){
  return Promise.race([
    promesa.then(() => 'termino'),
    new Promise(res => setTimeout(() => res('SE CLAVO'), ms))
  ]);
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

// ── Lo que clavaba la bandeja en 2.1.3 ──────────────────────────────────────────────────────────

test('un retiro sostenido que no contesta NO clava la bandeja', async () => {
  // Este es el caso de OFI-SAN. Antes, landing_retiro_progreso se esperaba DENTRO del cargado: si
  // no contestaba, la bandeja quedaba tomada y todo lo demas salia por "skipped" -- incluido el
  // boton del operador. De ahi "le tengo que dar reintentar 500 veces y me llega todo junto".
  const c = armarConSostenido(() => new Promise(() => {}));   // no contesta nunca
  const r = await conLimite(c.api.cargarSolicitudesPortal(true), 1500);
  assert.equal(r, 'termino', 'el cargado tiene que terminar aunque el sostenido no conteste');
});

test('mientras el sostenido no contesta, la bandeja se puede volver a pedir', async () => {
  const c = armarConSostenido(() => new Promise(() => {}));
  await conLimite(c.api.cargarSolicitudesPortal(true), 1500);
  const antes = c.llamadas.filter(x => x.nombre === 'panel_v15_5_listar_solicitudes_portal').length;
  const r = await conLimite(c.api.cargarSolicitudesPortal(false), 1500);   // el operador aprieta
  assert.equal(r, 'termino');
  const despues = c.llamadas.filter(x => x.nombre === 'panel_v15_5_listar_solicitudes_portal').length;
  assert.ok(despues > antes, 'el pedido del operador tiene que llegar, no salir por skipped');
});

test('el retiro sostenido aparece en la lista en el acto, sin esperar a la base', async () => {
  // El motivo por el que existe el bloque: un retiro con plata debida no puede desaparecer.
  const c = armarConSostenido(() => new Promise(() => {}));
  await conLimite(c.api.cargarSolicitudesPortal(true), 1500);
  const ids = c.V154P.solicitudes.map(x => String(x.ID));
  assert.deepEqual(ids, ['266250'], 'tiene que estar aunque la base no haya contestado');
  assert.equal(c.V154P.solicitudes[0].__soloLocal, true, 'marcado como copia local');
});

test('cuando la base dice que ya esta saldado, se suelta', async () => {
  const c = armarConSostenido(async () => ({ data: [{ ok: true, total: 100000, pagado: 100000, restante: 0 }] }));
  await c.api.cargarSolicitudesPortal(true);
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  assert.equal(c.V154P.solicitudes.length, 0, 'saldado en la base -> sale de la caja');
});

test('si la base no contesta, el sostenido NO se suelta', async () => {
  // Sin respuesta no se puede saber si se pago: soltarlo seria perder de vista plata debida.
  const c = armarConSostenido(async () => ({ error: { message: 'fetch failed' } }));
  await c.api.cargarSolicitudesPortal(true);
  await new Promise(r => setImmediate(r));
  assert.equal(c.V154P.solicitudes.length, 1, 'se queda hasta poder preguntar');
});

// ── Dejar de bajar la bandeja entera despues de cada cambio de estado ────────────────────────────

test('cambiar el estado NO se trae la bandeja entera cada vez', async () => {
  // La respuesta de la bandeja en P4 pesa 427 kB, cuatro veces la de las demas oficinas. Una carga
  // hace cuatro o cinco cambios de estado y cada uno la volvia a bajar Y la esperaba: 195 MB en
  // dos horas y media, ~624 MB en un turno. Es lo que le corta la conexion a esa PC (1/10).
  const c = armar([{ data: [] }]);
  await c.api.actualizarSolicitudPortal(123, 'EN_PROCESO', {});
  await c.api.actualizarSolicitudPortal(123, 'ACREDITADA', {});
  const bandeja = c.llamadas.filter(x => x.nombre === 'panel_v15_5_listar_solicitudes_portal').length;
  assert.equal(bandeja, 0, 'no se baja la bandeja dentro del cambio de estado');
  const updates = c.llamadas.filter(x => x.nombre === 'panel_v15_5_actualizar_solicitud_portal').length;
  assert.equal(updates, 2, 'los cambios de estado si salen, obvio');
});

test('la rafaga de cambios termina en UN solo refresco, no en cinco', async () => {
  const c = armar([{ data: [] }]);
  for(let i = 0; i < 5; i++) await c.api.actualizarSolicitudPortal(123, 'EN_PROCESO', {});
  assert.equal(c.reloj.pendientes(), 1, 'cinco cambios agendan UN refresco, no cinco');
  c.reloj.correr();
  await new Promise(r => setImmediate(r));
  const bandeja = c.llamadas.filter(x => x.nombre === 'panel_v15_5_listar_solicitudes_portal').length;
  assert.equal(bandeja, 1, 'y cuando corre, baja la bandeja una sola vez. Hubo: ' + bandeja);
});

test('el cambio de estado devuelve lo que devolvia antes', async () => {
  // Nadie puede depender de que la lista este repintada: lo que importa es el resultado del cambio.
  const c = armar([{ data: [] }]);
  const r = await c.api.actualizarSolicitudPortal(123, 'ACREDITADA', {});
  assert.ok(r && !r.error, 'sigue devolviendo el resultado de la RPC');
});
