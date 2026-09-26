const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createDiscordPresence, marco, rutasPosibles } = require('../main/discord.js');

// Un Discord de mentira: guarda lo que se le escribe y deja decidir si el pipe existe o no.
function discordFalso({ aceptaEn = 0, nunca = false } = {}) {
  const escrito = [], intentos = [];
  const sockets = [];
  const conectar = (ruta) => {
    intentos.push(ruta);
    const s = new EventEmitter();
    s.write = (b) => { escrito.push(leer(b)); return true; };
    s.destroy = () => { s.destruido = true; };
    sockets.push(s);
    const i = intentos.length - 1;
    queueMicrotask(() => {
      if (nunca || i !== aceptaEn) s.emit('error', new Error('ENOENT'));
      else s.emit('connect');
    });
    return s;
  };
  const leer = (b) => ({ op: b.readInt32LE(0), datos: JSON.parse(b.slice(8).toString('utf8')) });
  return { conectar, escrito, intentos, sockets };
}
const listo = (s) => s.emit('data', marco(1, { cmd: 'DISPATCH', evt: 'READY', data: {} }));
const esperar = () => new Promise(r => setTimeout(r, 5));

test('sin Application ID no hace absolutamente nada', async () => {
  const d = discordFalso();
  const p = createDiscordPresence({ appId: '', conectar: d.conectar });
  assert.equal(p.habilitado, false);
  p.actualizar({ details: 'algo', state: 'otra cosa' });
  await esperar();
  assert.deepEqual(d.intentos, [], 'ni siquiera intenta conectarse');
  p.apagar();
});

test('hace el handshake y recién después publica el estado', async () => {
  const d = discordFalso({ aceptaEn: 0 });
  const p = createDiscordPresence({ appId: '123', version: '2.1.3', conectar: d.conectar });
  p.actualizar({ details: '3 solicitudes pendientes', state: 'Última carga hace 3 min', largeText: 'NODO 2.1.3 · P4' });
  await esperar();

  assert.equal(d.escrito.length, 1, 'primero el handshake, nada más');
  assert.equal(d.escrito[0].op, 0);
  assert.equal(d.escrito[0].datos.client_id, '123');

  listo(d.sockets[0]);
  await esperar();
  const act = d.escrito[1];
  assert.equal(act.op, 1);
  assert.equal(act.datos.cmd, 'SET_ACTIVITY');
  assert.equal(act.datos.args.activity.details, '3 solicitudes pendientes');
  assert.equal(act.datos.args.activity.state, 'Última carga hace 3 min');
  assert.equal(act.datos.args.activity.assets.large_text, 'NODO 2.1.3 · P4');
  p.apagar();
});

test('si Discord no está abierto no molesta a nadie', async () => {
  const d = discordFalso({ nunca: true });
  const p = createDiscordPresence({ appId: '123', conectar: d.conectar });
  p.actualizar({ details: 'x', state: 'y' });
  await esperar();
  assert.equal(d.intentos.length, 10, 'prueba los 10 pipes y se rinde en silencio');
  assert.equal(p.conectado, false);
  p.apagar();
});

test('mientras no está listo guarda el ÚLTIMO estado, no una cola de viejos', async () => {
  const d = discordFalso({ aceptaEn: 0 });
  const p = createDiscordPresence({ appId: '123', conectar: d.conectar });
  p.actualizar({ details: '1 solicitud pendiente', state: 'a' });
  p.actualizar({ details: '2 solicitudes pendientes', state: 'b' });
  p.actualizar({ details: '3 solicitudes pendientes', state: 'c' });
  await esperar();
  listo(d.sockets[0]);
  await esperar();
  const envios = d.escrito.filter(e => e.op === 1 && e.datos.cmd === 'SET_ACTIVITY');
  assert.equal(envios.length, 1, 'un solo envío');
  assert.equal(envios[0].datos.args.activity.details, '3 solicitudes pendientes', 'y el más nuevo');
  p.apagar();
});

test('respeta el límite de Discord: no manda más de uno cada 15 s', async () => {
  const d = discordFalso({ aceptaEn: 0 });
  let t = 1000;
  const timers = [];
  const p = createDiscordPresence({ appId: '123', conectar: d.conectar,
    ahora: () => t, setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer() {} });
  p.actualizar({ details: 'uno', state: 'a' });
  await esperar();
  listo(d.sockets[0]);
  await esperar();
  assert.equal(d.escrito.filter(e => e.datos.cmd === 'SET_ACTIVITY').length, 1);

  p.actualizar({ details: 'dos', state: 'b' });          // enseguida: no sale
  assert.equal(d.escrito.filter(e => e.datos.cmd === 'SET_ACTIVITY').length, 1);
  const espera = timers.find(x => x.ms > 0 && x.ms <= 15000);
  assert.ok(espera, 'tiene que quedar programado para cuando se pueda');

  t += 15000;
  espera.fn();
  const envios = d.escrito.filter(e => e.datos.cmd === 'SET_ACTIVITY');
  assert.equal(envios.length, 2);
  assert.equal(envios[1].datos.args.activity.details, 'dos');
  p.apagar();
});

test('responde el PING de Discord, así no lo da por muerto', async () => {
  const d = discordFalso({ aceptaEn: 0 });
  const p = createDiscordPresence({ appId: '123', conectar: d.conectar });
  p.actualizar({ details: 'x', state: 'y' });
  await esperar();
  d.sockets[0].emit('data', marco(3, { hola: 1 }));
  await esperar();
  assert.ok(d.escrito.some(e => e.op === 4), 'tiene que contestar PONG');
  p.apagar();
});

test('los pipes son los que Discord usa', () => {
  const r = rutasPosibles();
  assert.equal(r.length, 10);
  if (process.platform === 'win32') {
    // El named pipe que abre Discord en Windows. Se arma acá en vez de con una expresión regular
    // para que se lea tal cual es, sin barras escapadas de más.
    const esperado = String.fromCharCode(92, 92, 63, 92) + 'pipe' + String.fromCharCode(92) + 'discord-ipc-0';
    assert.equal(r[0], esperado);
    assert.equal(r[9].slice(-1), '9', 'del 0 al 9');
  } else {
    assert.match(r[0], /discord-ipc-0$/);
  }
});
