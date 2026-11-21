// Juan, 21/11: "al rechazar y marcar como ya cargado, revisa como 4 páginas, al reverendo pedo; si se marca
// como ya cargado es actual, si no está en la página 1 se desestima el ya cargado".
const test = require('node:test');
const assert = require('node:assert/strict');
const rejections = require('../renderer/portal/rejections');

function armar(respuestas) {
  const pedidos = [];
  const historial = { select() { return this; }, ilike() { return this; }, eq() { return this; }, gte() { return this; },
    order() { return this; }, limit: async () => ({ data: [], error: null }) };
  const api = rejections.create({
    V154P: { solicitudes: [] }, abrirModal() {}, toast() {}, escapeHtml: v => String(v == null ? '' : v),
    document: { getElementById: () => null }, window: { ctrlElectron: {} },
    supabaseClient: { from: () => historial },
    callDrex: async (metodo, args) => { pedidos.push({ metodo, args }); return respuestas.shift(); },
    actualizarSolicitudPortal: async () => ({}), notificarUsuarioEnChat: async () => {}, cargarSolicitudesPortal: async () => {},
    cerrarModal() {}, alert() {}, localStorage: { getItem: () => null, setItem() {} }, registrarEnHistorial: async () => ({})
  }).globals;
  return { api, pedidos };
}
const pedido = { USUARIO: 'pruebaxx', MONTO_DECLARADO: 5000, FECHA_CREACION: new Date().toISOString() };

test('lee sólo la página 1, filtrada por el jugador', async () => {
  const { api, pedidos } = armar([{ ok: true, filas: [], completo: false, paginas: 1 }]);
  await api._yaCargadaCotejo(pedido, 9);
  assert.equal(pedidos.length, 1);
  assert.equal(pedidos[0].metodo, 'leerMovimientosCredito');
  assert.equal(pedidos[0].args.maxPaginas, 1);
  assert.equal(pedidos[0].args.filtrarAlias, true);
});

test('si no está en la página 1, se desestima: "sin rastro", no "hay más movimientos"', async () => {
  const { api } = armar([{ ok: true, filas: [], completo: false, paginas: 1 }]);
  const c = await api._yaCargadaCotejo(pedido, 9);
  assert.equal(c.agentesEstado, 'leido');
  assert.equal(c.decision, 'sin_rastro');
});

test('en la página 1 aparece: se toma', async () => {
  const ms = Date.now() - 60000;
  const { api } = armar([{ ok: true, completo: false, paginas: 1,
    filas: [{ tipo: 'Deposito de un jugador', estado: 'DONE', cantidad: 5000, alias: 'pruebaxx', ms, fecha: '21/11/2026 11:00:00' }] }]);
  const c = await api._yaCargadaCotejo(pedido, 9);
  assert.equal(c.decision, 'solo_agentes');
});

test('sin filtro de alias en esa página: la página 1 del informe general', async () => {
  const { api, pedidos } = armar([{ ok: false, motivo: 'SIN_FILTRO' }, { ok: true, filas: [], completo: false }]);
  await api._yaCargadaCotejo(pedido, 9);
  assert.equal(pedidos.length, 2);
  assert.equal(pedidos[1].args.filtrarAlias, false);
  assert.equal(pedidos[1].args.maxPaginas, 1);
});
