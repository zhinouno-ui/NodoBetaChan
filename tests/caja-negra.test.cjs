const test = require('node:test');
const assert = require('node:assert/strict');
const cajaNegra = require('../renderer/domain/caja-negra.js');

function reloj(){ let t = 1000; return () => (t += 10); }

test('una falla congela el rastro: los pasos que vienen después no la tapan', () => {
  const caja = cajaNegra.crear({ ahora: reloj() });
  caja.anotar({ paso: 'estadoPagina', estado: 'ok' });
  caja.anotar({ paso: 'buscarUsuario', estado: 'ok' });
  caja.anotar({ paso: 'cargarSaldo', estado: 'inicio' });
  const falla = caja.anotarFalla({ paso: 'cargarSaldo', mensaje: 'Timeout: la automatización tardó demasiado.' });

  // Después de la falla la vida sigue y se anotan más pasos.
  caja.anotar({ paso: 'estadoPagina', estado: 'ok' });
  caja.anotar({ paso: 'buscarUsuario', estado: 'ok' });

  const guardada = caja.fallas[0];
  assert.equal(guardada.paso, 'cargarSaldo');
  assert.deepEqual(guardada.rastro.map(p => p.paso), ['estadoPagina', 'buscarUsuario', 'cargarSaldo']);
  assert.equal(falla.capa, 'main', 'el timeout lo emite main, no el preload');
});

test('la capa sale de quién emite el mensaje, y lo desconocido queda desconocido', () => {
  const { capaDeError } = cajaNegra;
  assert.equal(capaDeError('Timeout: la automatización tardó demasiado.'), 'main');
  assert.equal(capaDeError('La página de Agentes se recargó durante la operación. Revisá el resultado antes de reintentar.'), 'main');
  assert.equal(capaDeError('La ventana de Agentes se cerró durante la operación.'), 'main');
  assert.equal(capaDeError('Método no permitido: pepe'), 'contrato');
  assert.equal(capaDeError('Sesión de Agentes caída — "carga" no se ejecutó. Se abrió el login: entrá y reintentá.'), 'panel');
  assert.equal(capaDeError('La tarea "cargarSaldo" superó 120s · se destrabó la cola'), 'panel');
  assert.equal(capaDeError('⛔ Operación frenada por el operador (antes de aplicar). No se aplicó plata.'), 'operador');
  assert.equal(capaDeError('Se cayó la sesión de Agentes (Drex mostró "session is invalid").'), 'agentes');
  assert.equal(capaDeError('No se encontró el formulario de login de BET300.'), 'preload');
  // Lo importante: no inventa. Un mensaje que no se reconoce NO se le cuelga a nadie.
  assert.equal(capaDeError('cualquier cosa rara que nunca vimos'), 'desconocida');
  assert.equal(capaDeError(''), 'desconocida');
  assert.equal(capaDeError(null), 'desconocida');
});

test('el resumen dice hasta dónde llegó y qué fue lo último que sí anduvo', () => {
  const caja = cajaNegra.crear({ ahora: reloj() });
  caja.contexto({ pc: 'EYF-F', operador: 'juan', backend: 'casinodrex' });
  caja.anotar({ paso: 'estadoPagina', estado: 'ok' });
  caja.anotar({ paso: 'iniciarSesion', estado: 'ok' });
  caja.anotarFalla({ paso: 'buscarUsuario', mensaje: 'Timeout: la automatización tardó demasiado.',
                     pantalla: '/login · formulario de login' });
  const r = caja.resumen();
  assert.match(r, /cortó en "buscarUsuario"/);
  assert.match(r, /capa: main/);
  assert.match(r, /lo último que sí anduvo: estadoPagina → iniciarSesion/);
  assert.match(r, /pantalla: \/login/);
  assert.equal(caja.fallas[0].contexto.pc, 'EYF-F');
});

test('los topes no dejan crecer nada sin freno', () => {
  const caja = cajaNegra.crear({ ahora: reloj(), topePasos: 5, topeFallas: 2 });
  for(let i = 0; i < 50; i++) caja.anotar({ paso: 'p' + i, estado: 'ok' });
  assert.equal(caja.pasos.length, 5);
  assert.equal(caja.pasos[4].paso, 'p49', 'se queda con los últimos, no con los primeros');
  for(let i = 0; i < 10; i++) caja.anotarFalla({ paso: 'f' + i, mensaje: 'x' });
  assert.equal(caja.fallas.length, 2);
  assert.equal(caja.fallas[1].paso, 'f9');
});

test('el texto se recorta y se normaliza: nada de volcados enormes', () => {
  const caja = cajaNegra.crear({ ahora: reloj() });
  caja.anotar({ paso: 'x', estado: 'error', detalle: 'a'.repeat(5000) });
  assert.equal(caja.pasos[0].detalle.length, 300);
  caja.anotar({ paso: 'y', estado: 'error', detalle: '  hola\n\n   mundo  ' });
  assert.equal(caja.pasos[1].detalle, 'hola mundo');
});

test('exportar e importar conservan lo registrado (sobrevive al reinicio del panel)', () => {
  const a = cajaNegra.crear({ ahora: reloj() });
  a.contexto({ pc: 'P4' });
  a.anotar({ paso: 'estadoPagina', estado: 'ok' });
  a.anotarFalla({ paso: 'cargarSaldo', mensaje: 'Método no permitido: x' });
  const guardado = JSON.parse(JSON.stringify(a.exportar()));

  const b = cajaNegra.crear({ ahora: reloj() });
  b.importar(guardado);
  assert.equal(b.contexto().pc, 'P4');
  assert.equal(b.fallas.length, 1);
  assert.equal(b.fallas[0].capa, 'contrato');
  assert.match(b.resumen(), /cortó en "cargarSaldo"/);
});

test('anotar nunca explota con entradas basura', () => {
  const caja = cajaNegra.crear({ ahora: reloj() });
  caja.anotar();
  caja.anotar({});
  caja.anotar({ paso: 123, estado: undefined, ms: 'no es un número' });
  caja.anotarFalla();
  assert.equal(caja.pasos.length, 3);
  assert.equal(caja.pasos[0].paso, '(sin nombre)');
  assert.equal(caja.pasos[0].estado, 'inicio');
  assert.ok(!('ms' in caja.pasos[2]), 'un ms que no es número no se guarda');
  assert.equal(caja.fallas[0].capa, 'desconocida');
});
