const test = require('node:test');
const assert = require('node:assert/strict');
const tel = require('../renderer/domain/telefono.js');

// Son todos argentinos: todos tienen que quedar 549 + 10 dígitos (Juan, 27/9). Hasta ahora cada
// pantalla los dibujaba como venían y el mismo jugador no cruzaba consigo mismo.

test('las formas que llegan de verdad terminan todas igual', () => {
  const esperado = '5491123456789';
  for (const entrada of [
    '1123456789',                 // como lo tipea el operador
    '11 2345-6789',
    '541123456789',               // con país, sin el 9
    '5491123456789',              // ya normalizado
    '+54 9 11 2345-6789',         // como lo manda WhatsApp
    '+5411 2345 6789',
    '01123456789',                // con el 0 de larga distancia
    '011 15 2345-6789',           // con el 15 viejo
    '0111523456789',
    '  5491123456789  '
  ]) {
    assert.equal(tel.normalizar(entrada), esperado, 'entrada: ' + JSON.stringify(entrada));
  }
});

test('el 9 se agrega si falta y no se duplica si ya está', () => {
  assert.equal(tel.normalizar('541123456789'), '5491123456789', 'sin 9 → se agrega');
  assert.equal(tel.normalizar('5491123456789'), '5491123456789', 'con 9 → se deja');
  assert.ok(!tel.normalizar('5491123456789').startsWith('5499'), 'nunca 99');
});

test('códigos de área de 3 y 4 dígitos', () => {
  assert.equal(tel.normalizar('3511234567'), '5493511234567', 'Córdoba');
  assert.equal(tel.normalizar('0351 15 1234567'), '5493511234567', 'Córdoba con 0 y 15');
  assert.equal(tel.normalizar('2954123456'), '5492954123456', 'Santa Rosa');
});

test('lo que no alcanza para un teléfono queda vacío, no a medias', () => {
  // Devolver un número incompleto es peor que no devolver nada: se guarda, no cruza con
  // nadie, y después hay que salir a buscar de dónde salió.
  for (const basura of ['', null, undefined, '   ', 'no tiene', '123', '1123456', '54']) {
    assert.equal(tel.normalizar(basura), '', JSON.stringify(basura));
  }
});

test('mostrar deja el número legible, sin cambiarlo', () => {
  assert.equal(tel.mostrar('1123456789'), '+54 9 11 2345-6789');
  assert.equal(tel.mostrar('5491123456789'), '+54 9 11 2345-6789');
  assert.equal(tel.mostrar('3511234567'), '+54 9 351 123-4567', 'area de 3');
  // El agrupado es cosmético: con 10 dígitos no se sabe si el área es de 2, 3 o 4. Lo que NO
  // puede pasar es que se pierda o cambie un dígito.
  for(const n of ['1123456789','3511234567','2954123456']){
    const soloDigitos = tel.mostrar(n).replace(/[^0-9]/g, '');
    assert.equal(soloDigitos, tel.normalizar(n), 'mostrar no puede tocar los dígitos: '+n);
  }
});

test('si no se puede normalizar, mostrar no inventa: deja lo que había', () => {
  assert.equal(tel.mostrar('sin teléfono'), 'sin teléfono');
  assert.equal(tel.mostrar(''), '');
  assert.equal(tel.mostrar(null), '');
});

test('dos escrituras del mismo número son el mismo número', () => {
  assert.equal(tel.mismo('011 15 2345-6789', '+54 9 11 2345 6789'), true);
  assert.equal(tel.mismo('1123456789', '541123456789'), true);
  assert.equal(tel.mismo('1123456789', '1123456780'), false);
});

test('sin número NO hay coincidencia', () => {
  // Decir que dos vacíos son "el mismo" juntaría jugadores que no tienen nada que ver.
  assert.equal(tel.mismo('', ''), false);
  assert.equal(tel.mismo(null, undefined), false);
  assert.equal(tel.mismo('1123456789', ''), false);
});
