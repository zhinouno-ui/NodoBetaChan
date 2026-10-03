const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Un aviso que no se llegó a leer NO está consumido.
//
// Juan, 3/10: "pausa la visualizacion de las solicitudes por ende si llegan mas de dos en el
// momento en que el sistema por lo visto marca el error hace que se acumulen hasta el proximo
// refresh".
//
// El mecanismo: cada 10 s se pregunta SI CAMBIÓ algo (125 bytes) y sólo entonces se baja la
// bandeja entera. Pero la señal se marcaba como vista ANTES de leer. Si la lectura fallaba -- y en
// P4 la bandeja pesa 382 kB y tarda entre 187 y 1.104 ms, así que falla -- en el tick siguiente la
// señal ya coincidía con la guardada, no se pedía nada, y esas solicitudes quedaban invisibles
// hasta el reintento (8/16/32/60 s) o el reloj de 60 s. Entrando varias juntas, caían todas de
// golpe más tarde.
//
// Estas pruebas EJECUTAN el módulo real con relojes falsos.

const Refresh  = require(path.join(__dirname, '..', 'renderer', 'runtime', 'refresh-coordinator.js'));
const Realtime = require(path.join(__dirname, '..', 'renderer', 'runtime', 'realtime.js'));

// Reloj falso: `correr` ejecuta timeouts vencidos, `tick` ejecuta los intervalos.
function relojFalso(){
  let ahora = 0;
  const timeouts = [];
  const intervalos = [];
  return {
    setTimeout(fn, ms){ const id = {fn, cuando: ahora + (ms||0)}; timeouts.push(id); return id; },
    clearTimeout(id){ const i = timeouts.indexOf(id); if(i >= 0) timeouts.splice(i, 1); },
    setInterval(fn, ms){ const id = {fn, ms: ms||0, acum: 0}; intervalos.push(id); return id; },
    clearInterval(id){ const i = intervalos.indexOf(id); if(i >= 0) intervalos.splice(i, 1); },
    async correr(ms){
      ahora += (ms || 0);
      for(const t of timeouts.filter(t => t.cuando <= ahora)){
        this.clearTimeout(t);
        await t.fn();
      }
      await Promise.resolve();
    },
    // Los intervalos se ARRANCAN y no se esperan de entrada: el del aviso se queda esperando una
    // lectura que sólo avanza cuando corren los timers de acá. Esperarlo antes de correrlos
    // trababa la prueba contra sí misma.
    // `tick` avanza 10 s: dispara el reloj de la señal, no el de 60 s. Antes los disparaba todos
    // juntos y las lecturas del reloj de seguridad se mezclaban con las que se querían medir.
    async tick(ms = 10000){
      const vencidos = [];
      for(const i of intervalos.slice()){
        i.acum += ms;
        if(i.acum >= i.ms){ i.acum -= i.ms; vencidos.push(i); }
      }
      const enVuelo = vencidos.map(i => { try { return i.fn(); } catch(_e){ return null; } });
      for(let k = 0; k < 5; k++) await Promise.resolve();   // que registren sus timers
      await this.correr(200);                               // delay de agrupado del coordinador
      for(let k = 0; k < 5; k++) await Promise.resolve();
      await this.correr(200);
      await Promise.all(enVuelo.map(p => Promise.resolve(p).catch(() => {})));
      await this.correr(200);
    }
  };
}

function armar({ fallarLasPrimeras = 0 } = {}){
  const timers = relojFalso();
  let lecturas = 0;
  let senalActual = 'A';
  const refresh = {
    requests: async () => {
      lecturas++;
      if(lecturas <= fallarLasPrimeras) return { error: { message: 'canceling statement due to statement timeout' } };
      return { ok: true };
    },
    wallets: async () => ({ok:true}), chats: async () => ({ok:true}), conversation: async () => ({ok:true})
  };
  const servicio = Realtime.create({
    client: null,                       // sin suscripciones: acá se prueba el reloj de la señal
    getOffice: () => 'P4',
    getAliases: () => ['P4'],
    hasOpenChat: () => false,
    refresh,
    senal: async () => senalActual,
    logger: { warn(){}, error(){} },
    timers
  });
  return {
    timers, servicio,
    lecturas: () => lecturas,
    cambiarSenal: (v) => { senalActual = v; },
    arrancar: () => servicio.start ? servicio.start() : servicio.startPolling && servicio.startPolling()
  };
}

test('una lectura que FALLA no da por consumido el aviso', async () => {
  // Lo que pasaba antes: la primera lectura falla, la señal queda marcada como vista, y aunque
  // haya una solicitud esperando nunca se vuelve a pedir. La prueba falla contra el código viejo
  // porque la segunda vuelta no hacía ninguna lectura.
  const c = armar({ fallarLasPrimeras: 1 });
  c.arrancar();
  await c.timers.tick();            // primera foto: sólo se guarda, no lee
  c.cambiarSenal('B');              // entra una solicitud
  await c.timers.tick();            // lee y FALLA
  const trasElFallo = c.lecturas();
  await c.timers.tick();            // la señal sigue sin consumirse -> tiene que volver a leer
  assert.ok(c.lecturas() > trasElFallo,
    'si la lectura falló, el próximo tick tiene que volver a pedirla, no quedarse esperando');
});

test('cuando entra de verdad, deja de insistir', async () => {
  const c = armar();
  c.arrancar();
  await c.timers.tick();
  c.cambiarSenal('B');
  await c.timers.tick();            // lee bien
  const trasLeer = c.lecturas();
  await c.timers.tick();            // nada nuevo: no tiene que pedir nada
  await c.timers.tick();
  assert.equal(c.lecturas(), trasLeer, 'sin novedad no se baja la bandeja de nuevo');
});

test('la espera máxima es un tick, no el reintento largo', async () => {
  // Con el reintento de 8/16/32/60 s, tres fallos seguidos dejaban la bandeja quieta más de medio
  // minuto. Ahora cada tick vuelve a intentar: el techo es el tick, pase lo que pase.
  const c = armar({ fallarLasPrimeras: 3 });
  c.arrancar();
  await c.timers.tick();
  c.cambiarSenal('B');
  await c.timers.tick();            // falla 1
  await c.timers.tick();            // falla 2
  await c.timers.tick();            // falla 3
  const antes = c.lecturas();
  await c.timers.tick();            // esta entra
  assert.ok(c.lecturas() > antes, 'siguió intentando en cada tick');
});

test('el coordinador devuelve el resultado, no solamente undefined', async () => {
  // Es lo que permite distinguir "ya está" de "no bajó nada". Sin esto no hay arreglo posible.
  const timers = relojFalso();
  const reads = Refresh.create({ requests: async () => ({ ok: true, marca: 7 }) }, { timers });
  const p = reads.request('requests');
  await timers.correr(200);
  const r = await p;
  assert.equal(r && r.marca, 7, 'request tiene que resolver con lo que devolvió la lectura');
});

test('un error devuelto (no tirado) se ve como error', async () => {
  // cargarSolicitudesPortal NO tira: devuelve {error}. Si el coordinador sólo mirara las
  // excepciones, un fallo pasaría por éxito -- que es exactamente lo que pasaba.
  const timers = relojFalso();
  const reads = Refresh.create({ requests: async () => ({ error: { message: 'timeout' } }) }, { timers });
  const p = reads.request('requests');
  await timers.correr(200);
  const r = await p;
  assert.ok(r && r.error, 'el que pide tiene que poder ver que falló');
});
