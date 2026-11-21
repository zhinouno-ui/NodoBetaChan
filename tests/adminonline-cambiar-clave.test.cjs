// Cambiar clave en AdminOnline (Juan, 21/11: "Error al cambiar clave: AdminOnline no confirmó el cambio de
// clave", con el cartel "Cambiar contraseña · ¿Estás seguro de guardar esta nueva contraseña?" abierto y la
// contraseña vacía). La página pide confirmar; NODO no apretaba Aceptar.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'agent-preload-adminonline.js'), 'utf8');
const f = src.slice(src.indexOf('async function cambiarClave'), src.indexOf('// ── Crear jugador'));

test('busca el cartel "¿Estás seguro…?" en todos los diálogos y aprieta Aceptar', () => {
  assert.match(f, /est\[aá\]s segur\|guardar esta nueva contrase/);
  assert.match(f, /visibleElements\('\[role="dialog"\]'\)/);
  assert.match(f, /findByText\(\/\^aceptar\$\/i, 'button', v\)/);
  assert.ok(f.indexOf('clickElement(guardar)') < f.indexOf('clickElement(aceptar)'), 'primero Guardar, después Aceptar');
});

test('sólo confirma si el cartel muestra la clave que escribió NODO; vacía u otra → cancela y no cambia nada', () => {
  assert.match(f, /if \(mostrada !== clave\)/);
  assert.match(f, /motivo: 'NO_TOMO_LA_CLAVE'/);
  assert.ok(f.indexOf('if (mostrada !== clave)') < f.indexOf('clickElement(aceptar)'), 'se compara antes de aceptar');
  assert.match(f, /\/\^\(cancelar\|aceptar\|cancel\)\$\/i\.test\(mostrada\)/, 'tras "Contraseña:" vacía vienen los botones');
});

test('"Balance actualizado" no cuenta como clave cambiada', () => {
  assert.match(f, /capt\.resultado\.tipo === 'ok' && !\/contrase\|clave\|password\/i\.test/);
});

test('la clave va al campo de contraseña, no al primer input (el alias puede estar en uno de sólo lectura)', () => {
  assert.match(f, /const campo = campoClaveDelModal\(modal\)/);
  const c = src.slice(src.indexOf('function campoClaveDelModal'), src.indexOf('// ── Crear jugador'));
  assert.match(c, /!i\.readOnly && !i\.disabled/);
  assert.match(c, /\/contrase\|clave\|password\/i/);
});

test('al operador no le habla de "AdminOnline"', () => {
  assert.doesNotMatch(f, /message: '[^']*AdminOnline/);
});
