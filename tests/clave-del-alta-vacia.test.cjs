// La clave del alta no se rellena con 1a2b3c4d.
//
// Juan, 23/11: "la clave del usuario en los nuevos preloads, no es necesario rellenar con 1a2b3c si vas a
// usar la clave aleatoria que entrega la pagina, en todo caso pedi que el operador ingrese clave
// manualmente o dejalo vacio para usar el de la pagina".
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ALTA = fs.readFileSync(path.join(ROOT, 'renderer', 'core', 'alta-usuarios.js'), 'utf8');
const crear = ALTA.slice(ALTA.indexOf('async function _ejecutarCrearUsuario('), ALTA.indexOf('// Genera N variantes del alias'));

test('el campo de la clave del alta arranca vacío y dice qué pasa si se deja así', () => {
  assert.match(ALTA, /<input id="nuevoJugClave" type="text" placeholder="'\+escapeHtml\(_altaClavePista\(\)\)\+'" value=""/);
  assert.ok(!/value="1a2b3c4d"/.test(ALTA), 'sin 1a2b3c4d puesto de entrada');
  assert.match(ALTA, /'Vacía: la que da Agentes'/);
  assert.match(ALTA, /be === 'casinodrex' \? 'Vacía: 1a2b3c4d'/, 'Drex no propone clave: ahí va la estándar');
});

test('vacía viaja vacía a Agentes; si escribió una, tiene que servirle al sistema de juego', () => {
  assert.match(crear, /const clave\s+= \(document\.getElementById\("nuevoJugClave"\)\?\.value\s+\|\| ""\)\.trim\(\);/);
  assert.ok(!/\|\| "1a2b3c4d"/.test(crear), 'no se cambia la vacía por la estándar');
  assert.match(crear, /if\(clave && clave\.length < 8\)/);
  assert.match(crear, /callDrex\("crearUsuario", usuario, clave\)/);
  // Lo que se le pasa al jugador es lo que quedó en Agentes.
  assert.match(crear, /const claveFinal = r\.password \|\| clave;/);
});

test('los paneles nuevos usan la de la página sólo si quedó vacía', () => {
  for (const archivo of ['agent-preload-adminonline.js', 'agent-preload-bet300.js']) {
    const pre = fs.readFileSync(path.join(ROOT, archivo), 'utf8');
    const i = pre.indexOf('async function crearUsuario(');
    const f = pre.slice(i, pre.indexOf('\n// ── ', i + 10));
    assert.match(f, /if \(passInput && !elegida\)/, archivo);
    assert.ok(!/elegida === CLAVE_ESTANDAR/.test(f), archivo + ': la que escribió el operador se respeta');
  }
});

test('Drex: vacía va la estándar, porque la página no propone ninguna', () => {
  const pre = fs.readFileSync(path.join(ROOT, 'agent-preload.js'), 'latin1');
  const i = pre.indexOf('async function crearUsuario(alias, password, options = {}) {');
  const f = pre.slice(i, i + 600);
  assert.match(f, /if \(password == null \|\| !String\(password\)\.trim\(\)\) password = '1a2b3c4d';/);
  assert.ok(f.indexOf("password = '1a2b3c4d'") < f.indexOf('La contrase'), 'antes de pedir 6 caracteres');
});
