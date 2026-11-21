// Juan, 21/11 (P4): Gastóngasti y gustavok628 daban "Usuario no encontrado" la primera vez y andaban al
// reintentar; y el cartel de Aprobar decía "Vínculo: no registrado" y mostraba "CSV_WHATICKET" tal cual.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..');

test('AdminOnline: "no existe" sólo con el chip "Todos los jugadores", no por filas de la búsqueda anterior', () => {
  const src = fs.readFileSync(path.join(RAIZ, 'agent-preload-adminonline.js'), 'utf8');
  const f = src.slice(src.indexOf('async function ejecutarBusqueda'), src.indexOf('function _puedeConcluirQueNoExiste'));
  assert.doesNotMatch(f, /vistaOk[^\n]*filasJugador\(\)\.length/, 'las filas en pantalla no prueban el ámbito');
  assert.match(f, /let vistaOk = _chipJugadores\(\);/);
  assert.equal((f.match(/vistaOk: _chipJugadores\(\) \}/g) || []).length, 3);
  const antesDeEnter = f.slice(0, f.indexOf("key: 'Enter'"));
  assert.match(antesDeEnter, /if \(!_chipJugadores\(\)\)[\s\S]*elegirTodosLosJugadores/, 'el ámbito se elige antes de buscar');
});

function cargarAlias(backend) {
  const src = fs.readFileSync(path.join(RAIZ, 'renderer', 'core', 'agentes-cola-y-sesion.js'), 'utf8').replace(/\r\n/g, '\n');
  const bloque = src.slice(0, src.indexOf('// ══════'));
  const store = {};
  const ctx = {
    window: { _agentBackendState: { backend } },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    supabaseClient: { from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) },
    console: { log() {} }
  };
  vm.createContext(ctx);
  vm.runInContext(bloque, ctx);
  return ctx;
}

test('se busca como Agentes lo tiene, según la última búsqueda que lo encontró (por backoffice)', async () => {
  const c = cargarAlias('adminonline');
  assert.equal(await c._resolverAliasParaCasino('gastongasti'), 'gastongasti', 'sin nada recordado, como vino');
  c._recordarAliasCasino('gastongasti', 'Gastóngasti');
  assert.equal(await c._resolverAliasParaCasino('GASTONGASTI'), 'Gastóngasti');
  assert.equal(await c._resolverAliasParaCasino('gastóngasti'), 'Gastóngasti');
  assert.equal(c.nodoAliasCasinoRecordado('Gaston gasti'), 'Gastóngasti');
  c._recordarAliasCasino('pepe', 'otrojugador');
  assert.equal(c.nodoAliasCasinoRecordado('pepe'), '', 'si Agentes devolvió otro jugador, no se recuerda');
  c.window._agentBackendState = { backend: 'casinodrex' };
  assert.equal(c.nodoAliasCasinoRecordado('gastongasti'), '', 'otro backoffice, otra memoria');
});

test('callDrex recuerda el alias de Agentes cuando la búsqueda lo encontró', () => {
  const src = fs.readFileSync(path.join(RAIZ, 'renderer', 'core', 'agentes-cola-y-sesion.js'), 'utf8');
  assert.match(src, /if\(_r && _r\.ok !== false && _r\.exists && _r\.user\) _recordarAliasCasino\(args\[0\], _r\.user\);/);
});

// Juan, 21/11: "intentaron buscar el usuario sin acento". Gastóngasti no estaba igual en la tabla usuarios y
// NODO le mandaba "gastongasti" a Agentes.
test('con acento se busca TAL CUAL primero; sin acento sólo si Agentes dijo que no existe', async () => {
  const c = cargarAlias('adminonline');
  assert.equal(await c._resolverAliasParaCasino('Gastóngasti'), 'Gastóngasti');
  assert.equal(await c._resolverAliasParaCasino('juan.perez'), 'juan.perez');
  const src = fs.readFileSync(path.join(RAIZ, 'renderer', 'core', 'agentes-cola-y-sesion.js'), 'utf8').replace(/\r\n/g, '\n');
  const f = src.slice(src.indexOf("if(method === 'buscarUsuario'"), src.indexOf('} else {', src.indexOf("if(method === 'buscarUsuario'")));
  assert.ok(f.indexOf("drexAutomation('buscarUsuario', aliasFinal") < f.indexOf("drexAutomation('buscarUsuario', _sinSignos"));
  assert.match(f, /_r\.exists === false && _sinSignos && _sinSignos !== String\(aliasFinal\)\.toLowerCase\(\)/);
  assert.match(f, /if\(_r2 && _r2\.ok !== false && _r2\.exists\) _r = _r2;/);
});

function modal(window) {
  const m = require(path.join(RAIZ, 'renderer', 'portal', 'operation-modal.js'));
  const deps = {};
  for (const d of m.dependencies) deps[d] = () => {};
  Object.assign(deps, { window, document: { getElementById: () => null }, esc: v => String(v), V154P: { solicitudes: [] }, billeteras: [] });
  return m.create(deps).globals;
}

test('cartel de Aprobar: el vínculo en castellano, sin códigos', () => {
  const g = modal({});
  const esc = v => String(v);
  assert.match(g._vinculoHtml({ estado_vinculo: 'VINCULADO', fuente: 'CSV_WHATICKET' }, esc), /Vinculado.*base de WhatsApp/);
  assert.match(g._vinculoHtml(null, esc), /Sin vínculo/);
  assert.match(g._vinculoHtml({ estado_vinculo: 'PENDIENTE', fuente: 'PORTAL_PRIMER_INGRESO' }, esc), /sin confirmar.*entró por el portal[\s\S]*Confirmar/);
  for (const v of [{ estado_vinculo: 'DUPLICADO', fuente: 'SOPORTE_AUTO' }, { estado_vinculo: 'VINCULADO', fuente: 'PRUEBA_X' }, null]) {
    assert.doesNotMatch(g._vinculoHtml(v, esc), /[A-Z]{3,}_[A-Z]|VINCULADO|DUPLICADO|no registrado/);
  }
});

test('cartel de Aprobar: el vínculo se busca con y sin acento y como figura en Agentes', () => {
  const g = modal({ nodoAliasCasinoRecordado: () => 'GastonGasti' });
  assert.deepEqual([...g._variantesUsuario('gastóngasti')], ['gastóngasti', 'gastongasti']);
  const g2 = modal({ nodoAliasCasinoRecordado: () => 'gaston.gasti' });
  assert.deepEqual([...g2._variantesUsuario('gastóngasti')], ['gastóngasti', 'gastongasti', 'gaston.gasti']);
});

test('cartel de Aprobar: el vínculo va al lado de los botones, no adentro de lo que declaró el usuario', () => {
  const src = fs.readFileSync(path.join(RAIZ, 'renderer', 'portal', 'operation-modal.js'), 'utf8');
  const i = src.indexOf('id="portalJobVinculo"');
  assert.ok(i > src.indexOf('id="portalJobResultado"'), 'abajo, en la fila de los botones');
  assert.ok(i < src.indexOf('id="portalJobEnviarBtn"'));
});
