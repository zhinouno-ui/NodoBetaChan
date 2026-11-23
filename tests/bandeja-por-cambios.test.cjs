const test = require('node:test');
const assert = require('node:assert/strict');
const requests = require('../renderer/portal/requests.js');

// Juan, 23/11: "¿con qué necesidad va a traer todo? Literalmente es la base de los nuevos canales que el
// servidor pueda filtrar". En los canales nuevos NODO le dice al servidor qué tiene (número y firma de cada
// solicitud) y recibe sólo las nuevas o cambiadas, y cuáles ya no están (servidor/beta-bandeja-v1.sql).
// Estas pruebas EJECUTAN el cargado de la bandeja con un servidor falso que contesta como el real.

const noop = () => {};
function elemento(){
  return { style:{}, classList:{add:noop,remove:noop,toggle:noop,contains:()=>false},
           appendChild:noop, remove:noop, querySelector:()=>null, querySelectorAll:()=>[],
           innerHTML:'', textContent:'', parentNode:{ insertBefore:noop } };
}
function fila(id, minuto, estado, extra){
  return Object.assign({ id, created_at: '2026-11-23T12:' + String(minuto).padStart(2, '0') + ':00+00:00',
    tipo: 'CARGA', usuario: 'jug' + id, monto: 1000, estado: estado || 'PENDIENTE', metadata: { telefono: '' },
    _firma: 'f' + id + '-' + (estado || 'PENDIENTE') }, extra || {});
}

// El servidor falso: guarda la bandeja "real" y contesta como nodo_beta_bandeja_v1.
function servidor(){
  const bandeja = new Map();
  const llamadas = [];
  function contestar(args){
    const tengo = args.p_cursor && args.p_cursor.tengo && typeof args.p_cursor.tengo === 'object' ? args.p_cursor.tengo : null;
    const todas = Array.from(bandeja.values()).sort((a, b) => b.created_at.localeCompare(a.created_at));
    return { data: { ok: true, contract: 'nodo.beta.v1', completa: !tengo,
      operativas: todas.filter(x => !tengo || tengo[String(x.id)] !== x._firma).map(x => JSON.parse(JSON.stringify(x))),
      quitar: tengo ? Object.keys(tengo).filter(id => !bandeja.has(id)) : [],
      total: bandeja.size, next_cursor: null, has_more: false, totales: null } };
  }
  return { bandeja, llamadas, contestar,
    poner: (x) => bandeja.set(String(x.id), x),
    sacar: (id) => bandeja.delete(String(id)) };
}

function armar(opts){
  opts = opts || {};
  const srv = servidor();
  const V154P = { solicitudes: [] };
  let canal = opts.canal || 'P4';
  const viejo = [];
  const panelAPI = {
    getContext: async () => ({ beta: { enabled: true, offices: ['P4', 'P7'] } }),
    rpc: async (nombre, args) => {
      if(nombre === 'nodo_beta_capacidades_v1'){
        return { data: { ok: true, contract: 'nodo.beta.v1', scope: { pc_codigo: args.p_pc_codigo }, capabilities: ['bandeja.queue.v1'] } };
      }
      if(nombre === 'nodo_beta_bandeja_v1'){
        srv.llamadas.push(JSON.parse(JSON.stringify(args)));
        return opts.contestar ? opts.contestar(args, srv) : srv.contestar(args);
      }
      throw new Error('rpc inesperada ' + nombre);
    }
  };
  const deps = {
    V154P,
    window: { V154P, clearTimeout: noop, _retiroParcialInfo: null, panelAPI },
    rpc: async (nombre, args) => { viejo.push({ nombre, args }); return { data: [] }; },
    setTimeout: (fn, ms) => { if(ms < 1100) fn(); return 0; },
    getCanal: async () => canal,
    normArr: (x) => (Array.isArray(x) ? x : []),
    mapSolicitudPortal: (x) => x,
    esc: (x) => String(x), money: (x) => String(x),
    document: { getElementById: () => elemento() },
    _v154pAvisoDesfasaje: noop, _portalAutoRechazar: noop, cargarAlertasRetiro: noop, alert: noop, toast: noop,
    operador: {}, solicitudes: [], renderInicio: noop,
    renderSolicitudesPortalCompleto: noop, renderSolicitudesPortalEnInicio: noop, verificarSolicitudes: noop
  };
  const api = requests.create(deps);
  const ids = () => V154P.solicitudes.map(x => String(x.id));
  return { api, srv, V154P, viejo, ids, cambiarCanal: (c) => { canal = c; } };
}

test('la primera vez pide la bandeja entera; después manda lo que tiene', async () => {
  const c = armar();
  c.srv.poner(fila(1, 1)); c.srv.poner(fila(2, 2)); c.srv.poner(fila(3, 3));
  await c.api.cargarSolicitudesPortal(true);
  assert.equal(c.srv.llamadas.length, 1);
  assert.equal(c.srv.llamadas[0].p_cursor, null, 'al arrancar no tiene nada: la pide entera');
  assert.deepEqual(c.ids(), ['3', '2', '1'], 'la más nueva arriba, como siempre');
  assert.equal(c.viejo.length, 0, 'en los canales nuevos no se usa el listado viejo');

  await c.api.cargarSolicitudesPortal(true);
  const tengo = c.srv.llamadas[1].p_cursor && c.srv.llamadas[1].p_cursor.tengo;
  assert.deepEqual(tengo, { '1': 'f1-PENDIENTE', '2': 'f2-PENDIENTE', '3': 'f3-PENDIENTE' }, 'le dice al servidor qué tiene y con qué firma');
  assert.deepEqual(c.ids(), ['3', '2', '1'], 'sin cambios en el servidor, la bandeja queda igual');
});

test('sin cambios, el servidor no manda ninguna solicitud y la bandeja sigue entera', async () => {
  let llegaron = null;
  const c = armar({ contestar: (args, srv) => { const r = srv.contestar(args); llegaron = r.data.operativas.length; return r; } });
  for(let i = 1; i <= 40; i++) c.srv.poner(fila(i, i));
  await c.api.cargarSolicitudesPortal(true);
  assert.equal(llegaron, 40);
  await c.api.cargarSolicitudesPortal(true);
  assert.equal(llegaron, 0, 'ni una fila de más');
  assert.equal(c.V154P.solicitudes.length, 40);
  assert.equal(c.V154P.bandejaCambios.completa, false);
  assert.equal(c.V154P.bandejaCambios.cuadra, true);
});

test('junta lo que cambió, lo nuevo y saca lo que ya no está', async () => {
  const c = armar();
  c.srv.poner(fila(1, 1)); c.srv.poner(fila(2, 2)); c.srv.poner(fila(3, 3));
  await c.api.cargarSolicitudesPortal(true);

  c.srv.poner(fila(2, 2, 'TOMADA', { tomada_por_operador_nombre: 'otra caja' }));   // la tomó otra caja
  c.srv.sacar(1);                                                                     // se cerró y salió de la bandeja
  c.srv.poner(fila(4, 4));                                                            // entró una nueva
  await c.api.cargarSolicitudesPortal(true);

  assert.deepEqual(c.ids(), ['4', '3', '2'], 'la nueva arriba, la que se fue no está');
  const dos = c.V154P.solicitudes.find(x => String(x.id) === '2');
  assert.equal(dos.estado, 'TOMADA', 'la cambiada llega como está ahora');
  assert.equal(dos.tomada_por_operador_nombre, 'otra caja');
  assert.equal(c.V154P.bandejaCambios.llegaron, 2, 'sólo bajaron la cambiada y la nueva');
  assert.equal(c.V154P.bandejaCambios.quitadas, 1);
});

test('un cambio que no toca la hora también llega: la firma es de la fila entera', async () => {
  // El comprobante que adjunta el jugador se escribe sin tocar updated_at (landing_portal_adjuntar_comprobante_v1).
  const c = armar();
  c.srv.poner(fila(1, 1));
  await c.api.cargarSolicitudesPortal(true);
  c.srv.poner(Object.assign(fila(1, 1), { metadata: { comprobante_url: 'https://x/c.jpg' }, _firma: 'otra' }));
  await c.api.cargarSolicitudesPortal(true);
  assert.equal(c.V154P.solicitudes[0].metadata.comprobante_url, 'https://x/c.jpg');
});

test('lo que se le cuelga a una solicitud en pantalla no queda pegado a la copia guardada', async () => {
  const c = armar();
  c.srv.poner(fila(1, 1));
  await c.api.cargarSolicitudesPortal(true);
  c.V154P.solicitudes[0].metadata.pegado = true;
  c.V154P.solicitudes[0].__soloLocal = true;
  await c.api.cargarSolicitudesPortal(true);
  assert.equal(c.V154P.solicitudes[0].metadata.pegado, undefined, 'cada vuelta trae copias nuevas, como cuando venía entera');
  assert.equal(c.V154P.solicitudes[0].__soloLocal, undefined);
});

test('al cambiar de oficina la pide entera y no mezcla', async () => {
  const c = armar();
  c.srv.poner(fila(1, 1));
  await c.api.cargarSolicitudesPortal(true);
  c.cambiarCanal('P7');
  c.srv.bandeja.clear(); c.srv.poner(fila(70, 5));
  await c.api.cargarSolicitudesPortal(true);
  assert.equal(c.srv.llamadas[1].p_pc_codigo, 'P7');
  assert.equal(c.srv.llamadas[1].p_cursor, null, 'otra oficina: nada de lo guardado sirve');
  assert.deepEqual(c.ids(), ['70']);
});

test('si lo juntado no da lo que cuenta el servidor, la próxima vuelta se pide entera', async () => {
  let vuelta = 0;
  const c = armar({ contestar: (args, srv) => {
    vuelta++;
    const r = srv.contestar(args);
    if(vuelta === 2) r.data.total = 99;   // el servidor dice 99 y NODO juntó 2
    return r;
  } });
  c.srv.poner(fila(1, 1)); c.srv.poner(fila(2, 2));
  await c.api.cargarSolicitudesPortal(true);
  await c.api.cargarSolicitudesPortal(true);
  assert.equal(c.V154P.bandejaCambios.cuadra, false);
  await c.api.cargarSolicitudesPortal(true);
  assert.equal(c.srv.llamadas[2].p_cursor, null, 'no cuadró: se vuelve a pedir entera');
  assert.deepEqual(c.ids(), ['2', '1']);
});

test('si el servidor contesta entera aunque se le mande lo que hay, se reemplaza todo', async () => {
  // Un servidor que todavía no sabe de firmas contesta completa = true: no puede quedar nada viejo.
  const c = armar({ contestar: (args, srv) => { const r = srv.contestar({ p_cursor: null }); return r; } });
  c.srv.poner(fila(1, 1)); c.srv.poner(fila(2, 2));
  await c.api.cargarSolicitudesPortal(true);
  c.srv.sacar(1);
  await c.api.cargarSolicitudesPortal(true);
  assert.deepEqual(c.ids(), ['2']);
});

test('un error del canal nuevo deja la bandeja guardada como estaba', async () => {
  let falla = false;
  const c = armar({ contestar: (args, srv) => falla ? { error: { message: 'TypeError: fetch failed' } } : srv.contestar(args) });
  c.srv.poner(fila(1, 1)); c.srv.poner(fila(2, 2));
  await c.api.cargarSolicitudesPortal(true);
  falla = true;
  await c.api.cargarSolicitudesPortal(true);
  falla = false;
  c.srv.poner(fila(3, 3));
  await c.api.cargarSolicitudesPortal(true);
  assert.deepEqual(Object.keys(c.srv.llamadas[2].p_cursor.tengo).sort(), ['1', '2'], 'sigue mandando lo que tenía antes del corte');
  assert.deepEqual(c.ids(), ['3', '2', '1']);
});
