const test = require('node:test');
const assert = require('node:assert/strict');
const parciales = require('../renderer/domain/parciales.js');

// Caso real: Maria6981x (26/9). Retiro parcial abierto, se jugó las fichas y volvió a cargar.
// El parcial siguió pidiendo plata que ya no correspondía y se cerró siete veces a mano.

const RETIRO = {
  ID: 266250, TIPO: 'RETIRO', ESTADO: 'EN_PROCESO', USUARIO: 'Maria6981x',
  FECHA_CREACION: '2026-09-25T12:08:58Z'
};
const CARGA_DESPUES = {
  ID: 270368, TIPO: 'CARGA', ESTADO: 'ACREDITADA', USUARIO: 'Maria6981x',
  MONTO: 250000, FECHA_CREACION: '2026-09-26T11:45:11Z'
};
const CARGA_ANTES = {
  ID: 266177, TIPO: 'CARGA', ESTADO: 'ACREDITADA', USUARIO: 'Maria6981x',
  MONTO: 400000, FECHA_CREACION: '2026-09-25T11:20:52Z'
};

// Las mismas funciones con las que el panel pinta la caja: esto no puede opinar distinto.
const aMedioPagar = () => ({ hasProg: true, total: 1738907, pagado: 1700000, restante: 38907 });
const nadieCerro = () => false;

function correr(solicitudes, opciones) {
  return parciales.aCerrarPorCarga(Object.assign(
    { solicitudes, info: aMedioPagar, cerrado: nadieCerro }, opciones || {}));
}

test('una carga posterior cierra el parcial', () => {
  const r = correr([RETIRO, CARGA_DESPUES]);
  assert.equal(r.length, 1);
  assert.equal(r[0].id, '266250');
  assert.equal(r[0].cargaId, '270368');
  assert.equal(r[0].cargaMonto, 250000);
  assert.equal(r[0].restante, 38907);
  assert.equal(r[0].motivo, 'CARGO_DE_NUEVO');
});

test('una carga ANTERIOR al retiro no lo toca', () => {
  // Maria cargó 400.000 a las 11:20 y pidió el retiro a las 12:08. Esa carga no significa nada acá:
  // si contara, el parcial se cerraría solo apenas se abre, que es justo al revés.
  assert.deepEqual(correr([RETIRO, CARGA_ANTES]), []);
});

test('con varias cargas posteriores queda la más nueva', () => {
  const masNueva = Object.assign({}, CARGA_DESPUES, { ID: 270473, MONTO: 400000, FECHA_CREACION: '2026-09-26T12:22:03Z' });
  const r = correr([RETIRO, CARGA_ANTES, CARGA_DESPUES, masNueva]);
  assert.equal(r.length, 1);
  assert.equal(r[0].cargaId, '270473');
  assert.equal(r[0].cargaMonto, 400000);
});

test('un retiro ya cerrado no se vuelve a cerrar', () => {
  assert.deepEqual(correr([RETIRO, CARGA_DESPUES], { cerrado: () => true }), []);
});

test('un retiro ya saldado no se cierra: no cambiaría nada y ensucia el historial', () => {
  const saldado = () => ({ hasProg: true, total: 1738907, pagado: 1738907, restante: 0 });
  assert.deepEqual(correr([RETIRO, CARGA_DESPUES], { info: saldado }), []);
});

test('un retiro común (sin pagos por partes) no entra acá', () => {
  const sinPartes = () => ({ hasProg: false, total: 50000, pagado: 0, restante: 50000 });
  assert.deepEqual(correr([RETIRO, CARGA_DESPUES], { info: sinPartes }), []);
});

test('un retiro rechazado o cancelado se respeta', () => {
  for (const estado of ['RECHAZADA', 'CANCELADA']) {
    const s = Object.assign({}, RETIRO, { ESTADO: estado });
    assert.deepEqual(correr([s, CARGA_DESPUES]), [], estado + ' no se toca');
  }
});

test('la carga de OTRO jugador no cierra nada', () => {
  const deOtro = Object.assign({}, CARGA_DESPUES, { USUARIO: 'aldana747k' });
  assert.deepEqual(correr([RETIRO, deOtro]), []);
});

test('el usuario se compara sin importar mayúsculas ni espacios', () => {
  const s = Object.assign({}, RETIRO, { USUARIO: '  MARIA6981X ' });
  const r = correr([s, CARGA_DESPUES]);
  assert.equal(r.length, 1, 'el mismo jugador escrito distinto sigue siendo el mismo');
});

test('lo ya intentado no se repite (no cierra dos veces por el mismo refresco)', () => {
  const r = correr([RETIRO, CARGA_DESPUES], { yaVistos: new Set(['266250']) });
  assert.deepEqual(r, []);
});

test('la nota no lleva operadores ni billeteras: la lee el jugador', () => {
  const caso = correr([RETIRO, CARGA_DESPUES])[0];
  const money = n => '$ ' + Number(n).toLocaleString('es-AR');
  const nota = parciales.notaCierre(caso, money);
  assert.match(nota, /se registró una carga nueva/);
  assert.match(nota, /quedaron sin pagar/);
  assert.ok(!/operador|billetera|giordano|matrelo/i.test(nota), 'nada de datos internos: ' + nota);
});

test('sin datos no explota', () => {
  assert.deepEqual(parciales.aCerrarPorCarga(), []);
  assert.deepEqual(parciales.aCerrarPorCarga({ solicitudes: null }), []);
  assert.deepEqual(correr([{}, {}]), []);
});

// ── enProceso: el criterio único de "está pagándose por partes" ───────────────
// Caso real (#266250, 26/9 10:41): se pagó el resto y quedó 1.738.907 de 1.738.907, pero la caja
// seguía mostrándolo con "falta $38.907" porque leía una lista vieja y porque el criterio del
// modal y el del filtro estaban escritos aparte.

const enProceso = (s, info, cerrado) =>
  parciales.enProceso(s, { info: info || aMedioPagar, cerrado: cerrado || nadieCerro });

test('enProceso · uno a medio pagar sí va a la caja', () => {
  assert.equal(enProceso(RETIRO), true);
});

test('enProceso · uno cobrado entero pero SIN cerrar se queda en la caja', () => {
  // A propósito: la caja es el único lugar desde donde se lo puede cerrar. Sacarlo de acá lo manda
  // a tapar la lista principal, que es el problema que la caja vino a resolver.
  const saldado = () => ({ hasProg: true, total: 1738907, pagado: 1738907, restante: 0, saldadoPorAlguna: true });
  assert.equal(enProceso(RETIRO, saldado), true);
});

test('enProceso · uno cobrado entero Y en estado cerrado sale de la caja', () => {
  // Este es #266250 después del pago de las 10:41: PAGADA y 1.738.907 de 1.738.907. Seguía
  // figurando con "falta $38.907" porque la caja no recalculaba (D-108).
  const saldado = () => ({ hasProg: true, total: 1738907, pagado: 1738907, restante: 0, saldadoPorAlguna: true });
  const cerrada = Object.assign({}, RETIRO, { ESTADO: 'PAGADA' });
  assert.equal(parciales.enProceso(cerrada, {
    info: saldado, cerrado: nadieCerro,
    sigueAbierto: function(){ return false; }        // ya cobró todo: no sigue abierto
  }), false);
});

test('enProceso · cerrado, rechazado o sin pagos por partes: fuera', () => {
  assert.equal(enProceso(RETIRO, aMedioPagar, () => true), false, 'cerrado');
  assert.equal(enProceso(Object.assign({}, RETIRO, { ESTADO: 'RECHAZADA' })), false, 'rechazado');
  assert.equal(enProceso(RETIRO, () => ({ hasProg: false, total: 50000, pagado: 0, restante: 50000 })), false, 'sin partes');
  assert.equal(enProceso({ TIPO: 'CARGA', ESTADO: 'ACREDITADA' }), false, 'una carga no es un retiro');
});

test('enProceso · sin datos no explota', () => {
  assert.equal(parciales.enProceso(), false);
  assert.equal(parciales.enProceso({}, {}), false);
});
