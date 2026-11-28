// Fichas apenas llega el retiro.
//
// Juan, 23/11: "la revision de fichas al llegar un retiro se puede realizar en el momento mientras el
// operador procesa el mismo retiro [...] si falla se reintenta en el momento, sabemos que esta revision es
// instantanea siempre y cuando el cartel con informacion se dibuje en el momento". El escaneo de fondo
// esperaba hasta 4 minutos y se salteaba los retiros tomados: el cartel casi nunca la encontraba hecha.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cartel = require('../renderer/portal/operation-modal.js');

const RAIZ = path.join(__dirname, '..', 'renderer');
const FUENTE = fs.readFileSync(path.join(RAIZ, 'core', 'chunior-recuperacion-y-transferencias.js'), 'utf8');
function cortar(desde, hasta) {
  const i = FUENTE.indexOf(desde), j = FUENTE.indexOf(hasta, i);
  assert.ok(i !== -1 && j !== -1, 'no está: ' + desde);
  return FUENTE.slice(i, j);
}

const HACE_UN_MINUTO = () => new Date(Date.now() - 60000).toISOString();
function retiro(extra) {
  return Object.assign({ ID: 501, TIPO: 'RETIRO', ESTADO: 'PENDIENTE', USUARIO: 'jugador_retiro', MONTO_DECLARADO: 50000, FECHA_CREACION: HACE_UN_MINUTO() }, extra || {});
}

// respuestas: lo que va devolviendo la lectura de fichas, en orden.
function armar(respuestas) {
  const pedidos = [];
  let reloj = Date.now();
  const ventana = {
    ctrlElectron: {},
    _estadoYaCerrado: (e) => /PAGAD|RECHAZ|CANCEL|ACREDIT|APROBAD/.test(String(e || '').toUpperCase()),
    revisarFichasRetiro: async (p) => { pedidos.push(p); return respuestas.length ? respuestas.shift() : { error: 'sin respuesta', motivo: 'sin_respuesta' }; }
  };
  const ctx = {
    window: ventana, setTimeout: (fn) => setImmediate(fn),
    Date: { now: () => reloj, parse: (s) => Date.parse(s) }, JSON, Number, String, Math, Array, Promise
  };
  vm.createContext(ctx);
  vm.runInContext(cortar('const _FICHAS_LLEGADA_EDAD_MS', '// ── LA lectura de fichas'), ctx);
  const esperar = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };
  return {
    llegan: async (lista) => { ventana.revisarFichasAlLlegar(lista); await esperar(); },
    pedidos, ventana, avanzar: (ms) => { reloj += ms; }
  };
}

const BIEN = { saldo: 80000, raw: 'ARS 80,000.00', confiable: true };

test('llega un retiro: se leen sus fichas en el momento, con la misma lectura del cartel', async () => {
  const t = armar([BIEN]);
  await t.llegan([retiro()]);
  assert.equal(t.pedidos.length, 1);
  assert.deepEqual({ ...t.pedidos[0] }, { usuario: 'jugador_retiro', solicitudId: '501', monto: 50000 });
  // El refresco siguiente de la bandeja no la vuelve a pedir.
  await t.llegan([retiro()]);
  assert.equal(t.pedidos.length, 1);
});

test('también si el operador ya lo tomó: se lee mientras lo procesa', async () => {
  const t = armar([BIEN]);
  await t.llegan([retiro({ ESTADO: 'EN_PROCESO' })]);
  assert.equal(t.pedidos.length, 1);
});

test('si falla, se reintenta en el momento', async () => {
  const t = armar([{ error: 'El agente está ocupado con otra operación.', ocupado: true, motivo: 'ocupado' }, BIEN]);
  await t.llegan([retiro()]);
  assert.equal(t.pedidos.length, 2, 'la segunda vuelta sale enseguida, no a los 5 minutos');
  assert.equal(t.ventana._fichasAlLlegar['501'].ok, true);
});

test('si sigue fallando, prueba de nuevo en un refresco posterior y después se rinde', async () => {
  const t = armar([]);   // todo falla
  await t.llegan([retiro()]);
  assert.equal(t.pedidos.length, 3, 'tres seguidas');
  await t.llegan([retiro()]);
  assert.equal(t.pedidos.length, 3, 'no se insiste en el mismo instante');
  t.avanzar(31000);
  await t.llegan([retiro()]);
  assert.equal(t.pedidos.length, 6, 'pasado medio minuto, otra tanda');
  t.avanzar(31000);
  await t.llegan([retiro()]);
  assert.equal(t.pedidos.length, 6, 'tope: lo sigue el cartel con su botón de reintentar');
});

test('"no existe" es una respuesta: no se reintenta', async () => {
  const t = armar([{ motivo: 'no_existe', error: 'El casino no encuentra al usuario jugador_retiro' }]);
  await t.llegan([retiro()]);
  assert.equal(t.pedidos.length, 1);
});

test('dos refrescos seguidos mientras lee: una sola lectura', async () => {
  let soltar;
  const t = armar([]);
  t.ventana.revisarFichasRetiro = (p) => { t.pedidos.push(p); return new Promise((r) => { soltar = r; }); };
  t.ventana.revisarFichasAlLlegar([retiro()]);
  t.ventana.revisarFichasAlLlegar([retiro()]);
  await new Promise((r) => setImmediate(r));
  soltar(BIEN);
  await new Promise((r) => setImmediate(r));
  assert.equal(t.pedidos.length, 1);
});

test('no se leen cargas, retiros cerrados ni retiros viejos', async () => {
  const t = armar([BIEN, BIEN, BIEN]);
  await t.llegan([
    retiro({ ID: 1, TIPO: 'CARGA' }),
    retiro({ ID: 2, ESTADO: 'PAGADA' }),
    retiro({ ID: 3, FECHA_CREACION: new Date(Date.now() - 3 * 3600 * 1000).toISOString() })
  ]);
  assert.equal(t.pedidos.length, 0);
});

test('con una parte ya pagada, se coteja contra lo que falta', async () => {
  const t = armar([BIEN]);
  t.ventana._retiroParcialInfo = () => ({ hasProg: true, restante: 12000 });
  await t.llegan([retiro()]);
  assert.equal(t.pedidos[0].monto, 12000);
});

test('la bandeja la pide apenas pinta lo que llegó, sin esperar', () => {
  const req = fs.readFileSync(path.join(RAIZ, 'portal', 'requests.js'), 'utf8');
  const pinta = req.indexOf('deps.renderSolicitudesPortalEnInicio();');
  const pide = req.indexOf('deps.window.revisarFichasAlLlegar(deps.V154P.solicitudes)');
  assert.ok(pinta !== -1 && pide > pinta, 'después de pintar la bandeja');
  assert.ok(!/await deps\.window\.revisarFichasAlLlegar/.test(req), 'sin await: no frena la bandeja');
});

// ── el cartel abierto se corrige solo ───────────────────────────────────────────────────────
test('si el cartel de aprobar había quedado en "no pude leer", la lectura que llega después se dibuja ahí', () => {
  const caja = { style: {}, innerHTML: 'No pude leer bien el saldo' };
  const modal = { dataset: { solicitudId: '501' }, style: { display: '' } };
  const ventana = { _retiroSaldoCheck: { jugador_retiro: Object.assign({ ts: Date.now() }, BIEN) } };
  const m = cartel.create({
    V154P: { solicitudes: [retiro()] }, alert: () => {}, billeteras: [], cargarBilleteras: async () => {},
    cerrarPortalJobModal: () => {}, ejecutarSolicitudPortalSimple: async () => {},
    document: { getElementById: (id) => (id === 'portalJobFichas' ? caja : id === 'portalJobModal' ? modal : null), querySelectorAll: () => [] },
    esc: (v) => String(v == null ? '' : v), fecha: () => '', getBilleraLanding: () => null, money: (v) => '$ ' + v,
    normalizar: (v) => String(v || '').toUpperCase(), pcAliasesHist: () => ['P1'], pcOperativa: 'P1', portalCheckDiferencia: () => {},
    setTimeout: () => 0, supabaseClient: null, toast: () => {}, v154pRegistrarParcial: () => {},
    window: ventana
  });
  assert.equal(typeof ventana.fichasRepintarAbiertos, 'function');
  ventana.fichasRepintarAbiertos('otro_jugador');
  assert.match(caja.innerHTML, /No pude leer/, 'la de otro jugador no pisa este cartel');
  ventana.fichasRepintarAbiertos('Jugador_Retiro');
  assert.match(caja.innerHTML, /ARS 80,000\.00/);
  assert.match(caja.innerHTML, /alcanza/);
  assert.ok(m);
});
