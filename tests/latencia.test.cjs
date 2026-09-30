const test = require('node:test');
const assert = require('node:assert/strict');
const lat = require('../renderer/domain/latencia.js');

// El caso que lo origino: solicitud 278484, noronorma, P4. El jugador escribio el 28/9 a las 11:15
// (hora de Argentina) y el operador contesto el 29/9 a las 11:33. En el panel las dos se veian
// como "11:15 a. m." y "11:33 a. m." — parecian veinte minutos y eran 24 h 18 m.
const ESCRITO_28 = '2026-09-28T14:15:31.386Z';   // 11:15:31 en Argentina
const VISTO_29   = '2026-09-29T14:33:22.073Z';   // 11:33:22 del dia siguiente

test('el caso real: 24 horas que parecian veinte minutos', () => {
  const m = lat.crear();
  const t = m.anotar({ clave: '278484#2', tipo: 'soporte', oficina: 'P4',
                       fecha: ESCRITO_28, ahora: VISTO_29 });
  assert.ok(t, 'tiene que medir');
  // 24 h 17 m 50,687 s
  assert.equal(t.espera, new Date(VISTO_29) - new Date(ESCRITO_28));
  assert.ok(t.espera > 24 * 3600 * 1000, 'mas de un dia');
  assert.match(m.linea(t), /espera 1 d/, m.linea(t));
  assert.match(m.linea(t), /portal viejo/, 'sin hora de toque no se puede dar el total');
});

test('los tres tramos, con las horas del telefono', () => {
  const m = lat.crear();
  const toque = '2026-09-29T14:00:00.000Z';   // el dedo
  const envio = '2026-09-29T14:00:01.000Z';   // 1 s de validaciones antes de salir
  const base  = '2026-09-29T14:00:03.000Z';   // 2 s mas en llegar a la base
  const ahora = '2026-09-29T14:02:03.000Z';   // 2 min mas hasta que el panel lo tuvo
  const t = m.anotar({ clave: 'a', fecha: base, toque, envio, ahora });
  assert.equal(t.preparacion, 1000, 'dedo -> pedido');
  assert.equal(t.subida, 2000, 'pedido -> base');
  assert.equal(t.espera, 120000, 'base -> panel');
  assert.equal(t.total, 123000, 'lo que espero el jugador');
  const l = m.linea(t);
  assert.match(l, /preparacion 1 s/);
  assert.match(l, /subida 2 s/);
  assert.match(l, /espera 2 m/);
  assert.match(l, /TOTAL 2 m 3 s/);
});

test('sin hora de envio igual se mide lo que no depende del telefono', () => {
  // Un portal viejo no manda nada de esto. La espera en el panel se mide igual, y es justamente
  // la que descubrio el caso de las 24 horas.
  const m = lat.crear();
  const t = m.anotar({ clave: 'viejo', fecha: ESCRITO_28, ahora: VISTO_29 });
  assert.ok(t.espera > 24 * 3600 * 1000);
  assert.equal(t.preparacion, null);
  assert.equal(t.subida, null);
  assert.equal(t.total, null);
  assert.equal(m.resumen().sinToque, 1);
});

test('un mensaje se cuenta UNA sola vez aunque el panel repinte', () => {
  // La lista del panel se repinta sola cada 1,2 s. Si cada repintado sumara una muestra, el
  // promedio serian los repintados, no los mensajes.
  const m = lat.crear();
  const uno = { clave: 'x', fecha: ESCRITO_28, ahora: VISTO_29 };
  assert.ok(m.anotar(uno), 'la primera vez mide');
  for(let i = 0; i < 50; i++) assert.equal(m.anotar(uno), null, 'las siguientes no');
  assert.equal(m.resumen().muestras, 1);
});

test('sin clave no se mide: no hay forma de no contarlo dos veces', () => {
  const m = lat.crear();
  assert.equal(m.anotar({ fecha: ESCRITO_28, ahora: VISTO_29 }), null);
  assert.equal(m.anotar({ clave: '', fecha: ESCRITO_28, ahora: VISTO_29 }), null);
  assert.equal(m.resumen().muestras, 0);
});

test('un reloj de telefono adelantado no ensucia el promedio', () => {
  // Si el telefono cree que son las 3 cuando son las 2, la subida sale en -1 h: el mensaje habria
  // llegado antes de salir. Eso no es un dato, es un reloj. Se marca en vez de promediarlo.
  const m = lat.crear();
  const t = m.anotar({ clave: 'r', toque: '2026-09-29T14:59:59Z', envio: '2026-09-29T15:00:00Z',
                       fecha: '2026-09-29T14:00:03Z', ahora: '2026-09-29T14:00:05Z' });
  assert.equal(t.relojRaro, true);
  assert.equal(t.subida, null, 'no se reporta una subida negativa de una hora');
  assert.equal(t.total, null);
  assert.equal(t.espera, 2000, 'la espera SI sirve: no pasa por el telefono');
  assert.equal(t.preparacion, 1000, 'la preparacion SI sirve: el telefono contra si mismo');
  assert.equal(m.resumen().relojesRaros, 1);
  assert.match(m.linea(t), /reloj del telefono/);
});

test('un reloj atrasado tambien se detecta', () => {
  // Al reves: el telefono cree que son las 13 y son las 14. La subida daria una hora "de red".
  const m = lat.crear();
  const t = m.anotar({ clave: 'r2', toque: '2026-09-29T13:00:00Z', envio: '2026-09-29T13:00:00Z',
                       fecha: '2026-09-29T14:00:03Z', ahora: '2026-09-29T14:00:05Z' });
  assert.equal(t.relojRaro, true, 'una hora de subida desde un telefono no es red');
  assert.equal(t.total, null);
  assert.equal(t.espera, 2000);
});

test('un desfasaje de milisegundos no se toma por un reloj roto', () => {
  const m = lat.crear();
  const t = m.anotar({ clave: 'ok', toque: '2026-09-29T14:00:03.000Z', envio: '2026-09-29T14:00:03.400Z',
                       fecha: '2026-09-29T14:00:03.000Z', ahora: '2026-09-29T14:00:04Z' });
  assert.equal(t.relojRaro, false);
  assert.equal(t.subida, -400, 'se reporta como viene, sin inventar');
});

test('fechas que no sirven no rompen nada', () => {
  const m = lat.crear();
  for(const mal of [null, undefined, '', 'ayer', 0, '0000-00-00']){
    assert.equal(m.anotar({ clave: 'k'+String(mal), fecha: mal, ahora: VISTO_29 }), null, String(mal));
    assert.equal(m.anotar({ clave: 'j'+String(mal), fecha: ESCRITO_28, ahora: mal }), null, String(mal));
  }
  assert.equal(m.resumen().muestras, 0);
});

test('la suma para la consola', () => {
  const m = lat.crear();
  const t0 = Date.parse('2026-09-29T14:00:00Z');
  const seg = s => new Date(t0 + s * 1000).toISOString();
  m.anotar({ clave:'1', tipo:'soporte', oficina:'P4', toque:seg(0), envio:seg(1), fecha:seg(2), ahora:seg(12) });
  m.anotar({ clave:'2', tipo:'soporte', oficina:'P4', toque:seg(0), envio:seg(1), fecha:seg(1), ahora:seg(61) });
  m.anotar({ clave:'3', tipo:'soporte', oficina:'P4', toque:seg(0), envio:seg(1), fecha:seg(3), ahora:seg(6) });
  const r = m.resumen();
  assert.equal(r.muestras, 3);
  assert.equal(r.espera.peor, 60000, 'el peor tramo base->panel');
  assert.equal(r.total.peor, 61000);
  assert.equal(r.espera.medio, 10000, 'la mediana de 10, 60 y 3');
  assert.equal(r.peor.clave, '2', 'el peor caso queda identificado');

  const txt = m.texto();
  assert.match(txt, /3 mensajes medidos/);
  assert.match(txt, /espera en el panel/);
  assert.match(txt, /peor 1 m/);
  assert.match(txt, /el peor: /);
});

test('sin mediciones lo dice, no miente con ceros', () => {
  assert.match(lat.crear().texto(), /todavia sin mediciones/);
});

test('no se guarda para siempre: hay tope', () => {
  const m = lat.crear({ tope: 10 });
  for(let i = 0; i < 100; i++)
    m.anotar({ clave: 'c'+i, fecha: ESCRITO_28, ahora: VISTO_29 });
  assert.equal(m.tamano, 10, 'la memoria no puede crecer sin freno en una PC que no se apaga');
});

test('los tiempos se leen de un vistazo', () => {
  assert.equal(lat.dur(0), '0 s');
  assert.equal(lat.dur(3000), '3 s');
  assert.equal(lat.dur(59000), '59 s');
  assert.equal(lat.dur(60000), '1 m');
  assert.equal(lat.dur(125000), '2 m 5 s');
  assert.equal(lat.dur(3600000), '1 h');
  assert.equal(lat.dur(3660000), '1 h 1 m');
  assert.equal(lat.dur(24 * 3600000), '1 d');
  // 24 h 17 m se lee "1 d": para decidir si algo llego tarde, el dia es el dato; los 17 minutos
  // no cambian nada. La linea completa igual lleva las fechas exactas.
  assert.equal(lat.dur(new Date(VISTO_29) - new Date(ESCRITO_28)), '1 d');
  assert.equal(lat.dur(26 * 3600000), '1 d 2 h');
  assert.equal(lat.dur(-5000), '-5 s');
  assert.equal(lat.dur(null), '?');
  assert.equal(lat.dur(NaN), '?');
});

test('el texto no lleva nada de lo que el jugador escribio', () => {
  // A la consola de una oficina no tiene por que ir el contenido de un mensaje.
  const m = lat.crear();
  const t = m.anotar({ clave:'278484#2', tipo:'soporte', oficina:'P4',
                       mensaje:'Cual seria mi usuario', usuario:'noronorma',
                       fecha:ESCRITO_28, ahora:VISTO_29 });
  assert.equal(t.mensaje, undefined);
  assert.equal(t.usuario, undefined);
  assert.ok(!m.linea(t).includes('usuario'), m.linea(t));
  assert.ok(!m.texto().includes('noronorma'), m.texto());
});
