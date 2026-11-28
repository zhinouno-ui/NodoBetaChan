const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// 18/11 · Juan: en el chat llegaba "🔑 Nueva clave: *papa66*". El jugador no sabía si los asteriscos eran
// parte de la clave y no la podía copiar. Ahora la clave sale en una tarjeta con "Copiar", y NODO la manda
// sin asteriscos (así también se lee bien en los Portales ya publicados).
const ROOT = path.join(__dirname, '..');
const PORTAL = fs.readFileSync(path.join(ROOT, 'Portal'), 'utf8');
const funcion = (nombre) => {
  const i = PORTAL.indexOf('function ' + nombre + '(');
  assert.ok(i >= 0, 'no encontré ' + nombre);
  const fin = PORTAL.indexOf('\n}', i);
  const linea = PORTAL.indexOf('\n', i);
  // una sola línea o hasta la llave que cierra al principio de línea
  return PORTAL.slice(i, PORTAL.slice(i, linea).trim().endsWith('}') ? linea : fin + 2);
};

function ctx() {
  const c = { state: { usuario: 'pruebaxx' }, esc: (t) => String(t).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]) };
  vm.createContext(c);
  for (const n of ['claveDelMensaje', 'sinAsteriscos', 'renderClaveNuevaHtml']) vm.runInContext(funcion(n), c);
  return c;
}

test('la clave del mensaje se reconoce con y sin asteriscos, y nunca se queda con ellos', () => {
  const c = ctx();
  assert.equal(c.claveDelMensaje('✅ Tu clave fue actualizada correctamente.<br>🔑 Nueva clave: *papa66*<br>Ingresá al casino'), 'papa66');
  assert.equal(c.claveDelMensaje('✅ Listo, cambiamos tu clave.<br>🔑 Nueva clave: 1a2b3c4d<br>Entrá al casino'), '1a2b3c4d');
  assert.equal(c.claveDelMensaje('Hola, ¿cómo estás?'), '');
  assert.equal(c.sinAsteriscos('🔑 Nueva clave: *papa66* Ingresá'), '🔑 Nueva clave: papa66 Ingresá');
});

test('la tarjeta muestra la clave con su botón Copiar', () => {
  const html = ctx().renderClaveNuevaHtml('papa66');
  assert.match(html, /Tu clave nueva/);
  assert.match(html, /class="copy-btn"[^>]*data-valor="papa66"[^>]*onclick="copyText\(/);
  assert.doesNotMatch(html, /\*/);
});

test('el globo del cajero usa la tarjeta, y el aviso de "Nuevo mensaje" sale sin asteriscos', () => {
  const add = funcion('addMsg');
  assert.match(add, /claveDelMensaje\(text\)/);
  assert.match(add, /renderClaveNuevaHtml\(clave\)/);
  assert.match(funcion('showOperatorBubble'), /sinAsteriscos\(/);
});

test('NODO manda la clave nueva sin asteriscos', () => {
  const src = fs.readFileSync(path.join(ROOT, 'renderer', 'core', 'automatizaciones.js'), 'utf8');
  assert.match(src, /Nueva clave: \$\{claveFinal\}\\n/);
  assert.doesNotMatch(src, /Nueva clave: \*\$\{/);
});

test('Reiniciar clave no promete una clave fija: la nueva llega por el chat', () => {
  assert.doesNotMatch(PORTAL, /Si dejás el campo vacío queda/);
  assert.equal((PORTAL.match(/te damos una clave nueva y te la mandamos por el chat/g) || []).length, 2);
});

test('el Portal nuevo lee el contexto del retiro por v2 y, si no existe, por v1', () => {
  const f = funcion('_consultarRetiroProtocolo');
  assert.ok(f.indexOf('"landing_portal_retiro_contexto_v2"') < f.indexOf('"landing_portal_retiro_contexto_v1"'));
});

test('AdminOnline: si el operador dejó la clave vacía, se usa la que la página ya trae al crear el jugador', () => {
  const pre = fs.readFileSync(path.join(ROOT, 'agent-preload-adminonline.js'), 'utf8');
  const crear = pre.slice(pre.indexOf('async function crearUsuario('), pre.indexOf('const guardar = botonConfirmar(modal);', pre.indexOf('async function crearUsuario(')));
  assert.match(crear, /if \(passInput && !elegida\)/);
  assert.match(crear, /propuesta = v/);
  assert.match(crear, /if \(passInput && !propuesta\) await setFieldAndVerify/);
});

test('agentesbet.io: se usa la clave al azar de la página, y si el operador eligió otra se escribe ésa', () => {
  const pre = fs.readFileSync(path.join(ROOT, 'agent-preload-bet300.js'), 'utf8');
  const i = pre.indexOf('async function crearUsuario(');
  const crear = pre.slice(i, pre.indexOf('\n// ── ', i));
  assert.match(crear, /if \(passInput && !elegida\)/);
  assert.match(crear, /if \(passInput && !propuesta\) await setFieldAndVerify\(passInput, clave, 5\)/);
  assert.doesNotMatch(crear, /password: CLAVE_ESTANDAR/, 'NODO tiene que recibir la clave que quedó, no la estándar');
});

// 18/11 · Juan: "este es el primer flujo de usuario y ni siquiera sabe el usuario la clave una vez que se
// validó". El aviso de una cuenta recién creada era el mismo que el de una cuenta vieja, sin la clave.
test('NODO: al crear la cuenta, el aviso del chat lleva la clave y marca la cuenta como nueva', () => {
  const alta = fs.readFileSync(path.join(ROOT, 'renderer', 'core', 'alta-usuarios.js'), 'utf8');
  assert.match(alta, /ejecutarVincular\(aliasFinal, telefono, !!window\.__altaDesdeChat, \{ claveNueva: claveFinal \|\| undefined \}\)/);
  const cot = fs.readFileSync(path.join(ROOT, 'renderer', 'core', 'cotejo-alta.js'), 'utf8');
  assert.match(cot, /Ya creamos tu cuenta\.\\n\\n👤 Usuario: "\+usuario\+"\\n🔑 Nueva clave: "\+_claveNueva/);
  assert.match(cot, /⟦INGRESAR:"\+usuario\+"\|"\+telefono\+"\|nueva⟧"/);
  // Una cuenta vieja sigue recibiendo el aviso de siempre.
  assert.match(cot, /: "✅ ¡Listo! Ya validamos tu cuenta\./);
});

test('NODO: el tercer dato de la marca ("nueva") no se pega al teléfono validado', () => {
  const cot = fs.readFileSync(path.join(ROOT, 'renderer', 'core', 'cotejo-alta.js'), 'utf8');
  const rx = new RegExp(cot.match(/\.match\(\/(⟦INGRESAR:\(\[\^\|⟧\][^\n]*?⟧)\/\);/)[1]);
  const x = 'Listo ⟦INGRESAR:juan123|1155550000|nueva⟧'.match(rx);
  assert.equal(x[1], 'juan123');
  assert.equal(x[2], '1155550000');
  assert.equal('⟦INGRESAR:juan123|1155550000⟧'.match(rx)[2], '1155550000', 'la marca vieja se lee igual');
});

test('Portal: la cuenta nueva entra por "Elegí tu clave", que no se puede mandar vacía y se puede saltear', () => {
  assert.match(funcion('mostrarBotonIngresar'), /\(nueva\?',true':''\)/);
  const ingreso = funcion('confirmarIngresoValidado');
  assert.match(ingreso, /if\(nueva\)\{ state\.claveCuentaNueva=true; try\{ await goClave\(\); \}/);
  // Primera prueba de Juan: el Portal se minimizaba ANTES de abrir la pantalla de la clave y no se veía.
  assert.ok(ingreso.indexOf('if(nueva)') < ingreso.indexOf('toggleWidget(false)'), 'la cuenta nueva no minimiza el Portal');
  const pantalla = funcion('renderClave');
  assert.match(pantalla, /Elegí tu clave/);
  assert.match(pantalla, /Ahora no, sigo con la que me mandaron/);
  assert.match(funcion('enviarSolicitudClave'), /state\.claveCuentaNueva&&!String\(\$\("claveNueva"\)\?\.value\|\|""\)\.trim\(\)/);
  // Las dos lecturas del chat pasan el tercer dato de la marca.
  assert.match(funcion('incomingOperatorMsg'), /_ingresarNueva=\(_p\[2\]\|\|""\)\.trim\(\)==="nueva"/);
  assert.match(funcion('renderThreadMsg'), /mostrarBotonIngresar\(ing,ingTel,!!notificar,ingNueva\)/);
  assert.equal((PORTAL.match(/mostrarBotonIngresar\(ing\[0\],ing\[1\],!old&&!!notificar,ing\[2\]==="nueva"\)/g) || []).length, 2);
});
