// Pasada por los historiales de Chunior (Juan, 18/11): todo lo anotado en Chunior tiene que estar en NODO.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const fuente = fs.readFileSync(path.join(ROOT, 'renderer', 'core', 'cotejo-chunior.js'), 'utf8');
const win = {};
vm.runInNewContext(fuente, { window: win, console, Date, Math, Number, String, JSON, setTimeout, setInterval });
const P = win.NodoPasadaChunior;
const ficha = P.TABLAS.find(t => t.ruta === 'movimientoficha');
const propina = P.TABLAS.find(t => t.ruta === 'propina');
const ms = (s) => P.fechaChunior(s);
const AHORA = ms('18-11-2026 20:00:00');

test('recorre los siete historiales de Chunior', () => {
  assert.equal(P.TABLAS.map(t => t.ruta).join(','),
    'movimientoficha,movimientointerno,propina,depositossinreclamar,gastoslocal,recargafichas,movimientofinanciera');
});

test('lee la fila de Movimientos de fichas tal como la muestra Chunior', () => {
  const m = P.interpretarFila({ id: '10183949', cells: [
    { c: 'action-checkbox', t: '' }, { c: 'field-id', t: '10183949' }, { c: 'field-creation nowrap', t: '18-11-2026 17:41:50' },
    { c: 'field-created_by nowrap', t: 'xprueba' }, { c: 'field-cuenta_destino nowrap', t: '1170 - SALVATIERRA MP' },
    { c: 'field-as_money', t: '$ 12,00' }, { c: 'field-notas', t: '12hec' }] });
  assert.equal(m.id, '10183949');
  assert.equal(m.ms, ms('18-11-2026 17:41:50'));
  assert.equal(m.monto, 12);
  assert.equal(m.creadoPor, 'xprueba');
  assert.equal(m.cuenta, '1170 - SALVATIERRA MP');
  assert.equal(m.notas, '12hec');
});

test('montos de Chunior: miles con punto, decimales con coma, y el signo del retiro', () => {
  assert.equal(P.montoChunior('$ 1.500,00'), 1500);
  assert.equal(P.montoChunior('$ -15,00'), -15);
  assert.equal(P.montoChunior('-$ 15,00'), -15);
  assert.equal(P.montoChunior('$ 172.552'), 172552);
});

const mov = (id, fecha, monto, notas, extra = {}) => ({ id, ms: ms(fecha), monto, notas, creadoPor: 'agusx', cuenta: '1170 - SALVATIERRA MP', ...extra });

test('ya está en NODO por su N°: nada; sin nada en NODO: se crea; con signo menos es un RETIRO', () => {
  const d = P.decidir(ficha, [mov('1', '18-11-2026 17:00:00', 500, 'pepe'), mov('2', '18-11-2026 17:10:00', -300, 'juan')],
    { '1': { id: 9 } }, [], AHORA);
  assert.equal(d[0].accion, 'ya');
  assert.equal(d[1].accion, 'crear');
  assert.equal(d[1].tipo, 'RETIRO');
});

test('una fila de NODO sin N° que es la misma (tipo, monto, horario y usuario) se enlaza', () => {
  const d = P.decidir(ficha, [mov('5', '18-11-2026 17:00:00', 500, 'Pepe')], {},
    [{ id: 3, tipo: 'CARGA', monto: 500, usuario: 'pepe', created_at: new Date(ms('18-11-2026 17:01:30')).toISOString() }], AHORA);
  assert.equal(d[0].accion, 'enlazar');
  assert.equal(d[0].fila.id, 3);
});

test('una carga de NODO no se enlaza con un retiro de Chunior ni con otro usuario', () => {
  const sueltas = [{ id: 3, tipo: 'CARGA', monto: 500, usuario: 'pepe', created_at: new Date(ms('18-11-2026 17:00:30')).toISOString() }];
  assert.equal(P.decidir(ficha, [mov('5', '18-11-2026 17:00:00', -500, 'pepe')], {}, sueltas, AHORA)[0].accion, 'crear');
  assert.equal(P.decidir(ficha, [mov('6', '18-11-2026 17:00:00', 500, 'otro')], {}, sueltas, AHORA)[0].accion, 'crear');
});

test('dos filas posibles en NODO: duda, no se toca', () => {
  const s = (id) => ({ id, tipo: 'PROPINA', monto: 1000, usuario: 'x', created_at: new Date(ms('18-11-2026 17:00:30')).toISOString() });
  const d = P.decidir(propina, [mov('7', '18-11-2026 17:00:00', 1000, '')], {}, [s(1), s(2)], AHORA);
  assert.equal(d[0].accion, 'duda');
});

test('lo recién anotado (menos de un minuto y medio) se deja para la próxima: NODO puede estar escribiendo su fila', () => {
  const d = P.decidir(ficha, [mov('8', '18-11-2026 19:59:00', 500, 'pepe')], {}, [], AHORA);
  assert.equal(d[0].accion, 'espera');
});

test('sin fecha o sin monto legible no se crea nada', () => {
  const d = P.decidir(ficha, [{ id: '9', ms: NaN, monto: 5, notas: 'a' }, { id: '10', ms: ms('18-11-2026 17:00:00'), monto: NaN, notas: 'a' }], {}, [], AHORA);
  assert.equal(d.map(x => x.accion).join(','), 'duda,duda');
});

test('la fila nueva dice quién la anotó en Chunior, y se busca por N° sólo dentro de su tipo', () => {
  assert.match(fuente, /"Anotado directo en Chunior" \+ \(m\.creadoPor \? " por " \+ m\.creadoPor : ""\) \+ ", no estaba en NODO · "/);
  assert.match(fuente, /origen: "CHUNIOR"/);
  assert.match(fuente, /\.in\("chunior_movimiento_id", ids\.slice\(i, i \+ 100\)\)\.in\("tipo", tabla\.grupo\)/);
  const cargas = fs.readFileSync(path.join(ROOT, 'renderer', 'core', 'cotejo-cargas.js'), 'utf8');
  assert.match(cargas, /window\.NodoPasadaChunior\.pasada\(\{ recargar:/, 'Recargar también hace la pasada por Chunior');
  const manifest = fs.readFileSync(path.join(ROOT, 'renderer', 'manifest.json'), 'utf8');
  assert.match(manifest, /"core\/cotejo-chunior\.js"/);
});

// Juan, 18/11: lo que la pasada tiene que agregar a NODO es un error y le tiene que llegar al admin por el
// canal de errores de siempre (historial con estado ERROR y [ERR]{...} en notas), sin tocar el servidor.
test('lo anotado sólo en Chunior sale como alerta de error para el admin, con el detalle completo', () => {
  const d = { mov: mov('10184376', '18-11-2026 17:41:00', -1500, 'pepe', { creadoPor: 'xprueba', origen: '882 - PROMOS' }), accion: 'crear', tipo: 'RETIRO' };
  const a = P.alertaDeError(ficha, d, { filaId: 777, pc: 'P1', op: 'Chunior', usuario: 'pepe', billetera: 'SALVATIERRA MP' });
  assert.equal(a.estado, 'ERROR');
  assert.equal(a.tipo, 'ALERTA', 'nunca CARGA/RETIRO: un operador la tomaría por una carga que falló');
  assert.equal(a.billetera_id, null, 'no mueve el saldo de ninguna billetera');
  assert.equal(a.monto, 1500);
  assert.equal(a.pc_codigo, 'P1');
  assert.equal(a.operador, 'xprueba');
  assert.equal(a.chunior_movimiento_id, undefined, 'la pasada y el cotejo no la toman por un movimiento');
  assert.match(a.notas, /^Revisión de Chunior · Movimientos de fichas N° 10184376: xprueba lo anotó directo en Chunior el 18\/11 17:41, sin pasar por NODO\. NODO lo agregó al historial \(fila 777\)\. \[ERR\]\{/);
  const det = JSON.parse(a.notas.slice(a.notas.indexOf('[ERR]') + 5));
  assert.deepEqual(det, { m: 'ANOTADO_SOLO_EN_CHUNIOR', tabla: 'Movimientos de fichas', n: '10184376', tipo: 'RETIRO', por: 'xprueba',
    chunior: '18/11 17:41', monto: -1500, usuario: 'pepe', cuenta: '1170 - SALVATIERRA MP', desde: '882 - PROMOS', fila: 777, pc: 'P1', op: 'Chunior' });
  // Las marcas del cartel del operador: si la alerta las tuviera, el cartel la mostraría dos veces.
  assert.doesNotMatch(a.notas, /no estaba en NODO|fuera de NODO|sin carga en Agentes/);
  assert.ok(a.notas.length < 1800);
});

test('la alerta sale después de crear la fila, y si no sale no frena la pasada', () => {
  const crear = fuente.slice(fuente.indexOf('async function _crear('), fuente.indexOf('// ── Una pasada'));
  assert.ok(crear.indexOf('.insert(fila)') < crear.indexOf('.insert(alertaDeError('));
  assert.match(crear, /catch\(e\)\{ console\.warn\("\[pasada-chunior\] alerta para el admin"/);
  assert.match(fuente, /if\(!\(await _crear\(tabla, d\)\)\) resumen\.alertasSinMandar/);
  const manuales = fs.readFileSync(path.join(ROOT, 'renderer', 'core', 'operaciones-manuales.js'), 'utf8');
  assert.match(manuales, /ANOTADO_SOLO_EN_CHUNIOR: \{t:'Anotado sólo en Chunior', plata:false/, '"Por qué falló" la explica en castellano');
});

test('Juan anotó tres pruebas, apretó Recargar y no aparecieron: ahora espera poco y se vuelve a mirar sola', () => {
  assert.ok(fuente.includes('var FRESCO_MS    = 90 * 1000;'));
  assert.match(fuente, /resumen\.esperan && opts\.recargar[\s\S]{0,80}setTimeout/);
  assert.equal(P.decidir(ficha, [mov('8', '18-11-2026 19:57:00', 500, 'pepe')], {}, [], AHORA)[0].accion, 'crear', 'a los 3 minutos ya se crea');
});
