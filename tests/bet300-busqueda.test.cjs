const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Se extrae la función REAL del preload y se ejecuta, en vez de mirarla con una expresión regular.
const src = fs.readFileSync(path.join(__dirname, '..', 'agent-preload-bet300.js'), 'utf8');
const m = src.match(/function _puedeConcluirQueNoExiste\([^)]*\) ?\{[\s\S]*?\n\}/);
assert.ok(m, 'no encontré _puedeConcluirQueNoExiste en el preload');
const puede = new Function(m[0] + '\nreturn _puedeConcluirQueNoExiste;')();

const completo = { refresco: true, textoOk: true, estable: true, vistaOk: true };

test('con las cuatro condiciones sí se puede decir que no existe', () => {
  assert.equal(puede(completo), true);
});

test('sin haber llegado a la lista de JUGADORES no se puede concluir nada', () => {
  // El caso de pruebaxx (26/9): la lista quedó quieta y vacía, pero era la vista de AGENTES.
  // El usuario existía y venía cargando hacía una hora.
  assert.equal(puede({ ...completo, vistaOk: false }), false,
    'esto es lo que hacía que dijera "no existe en el casino" sin haber buscado');
});

test('falta cualquiera de las otras tres y tampoco', () => {
  assert.equal(puede({ ...completo, refresco: false }), false, 'nunca llegó una respuesta');
  assert.equal(puede({ ...completo, textoOk: false }), false, 'el alias no quedó escrito');
  assert.equal(puede({ ...completo, estable: false }), false, 'la lista seguía moviéndose');
});

test('sin datos no dice que no existe', () => {
  for (const r of [undefined, null, {}, { refresco: true }]) {
    assert.equal(puede(r), false, 'ante la duda, falla técnica y se reintenta: ' + JSON.stringify(r));
  }
});

test('el preload usa esta función y no repite la condición suelta', () => {
  assert.match(src, /if \(_puedeConcluirQueNoExiste\(r\)\) \{/, 'la decisión tiene que pasar por acá');
  // Fuera del cuerpo de la propia función, la condición no puede aparecer en ningún lado: si se
  // copia, una de las dos copias se va a quedar atrás. Es lo que pasó con los dos preloads (H-7).
  const afuera = src.replace(m[0], '');
  const sueltas = afuera.match(/r\.refresco && r\.textoOk && r\.estable/g) || [];
  assert.equal(sueltas.length, 0, 'la condición no puede quedar copiada en otro lado');
});
