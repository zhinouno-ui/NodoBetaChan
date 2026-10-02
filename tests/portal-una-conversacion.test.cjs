const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Una conversación, UNA solicitud.
//
// landing_portal_v16_crear_solicitud no devuelve chat_id ni chat_token, y el portal los tomaba
// sólo de ahí. Entonces state.chatId quedaba vacío para siempre y CADA mensaje del jugador volvía
// a crear una solicitud. El 1/10, un solo reclamo dejó 25 ("Borrame", "Jo", "Ko", "No"...). Así se
// juntaron 3.925 consultas abiertas en la red, la más vieja del 21 de julio — y de ahí salen la
// bandeja de 427 kB, los chats contestados que reaparecen y el icono de sin leer titilando.
//
// Estas pruebas EJECUTAN el código real del Portal con una base falsa.

const PORTAL = fs.readFileSync(process.env.PORTAL_A_PROBAR || path.join(__dirname, '..', 'Portal'), 'utf8');
const NL = String.fromCharCode(10);

function sacar(firma){
  const i = PORTAL.indexOf(firma);
  assert.notEqual(i, -1, 'no está en el Portal: ' + firma);
  const j = PORTAL.indexOf('{', i);
  let n = 0, fin = -1;
  for(let k = j; k < PORTAL.length; k++){
    if(PORTAL[k] === '{') n++;
    else if(PORTAL[k] === '}'){ n--; if(!n){ fin = k + 1; break; } }
  }
  assert.notEqual(fin, -1, 'no cierra: ' + firma);
  // Desde la firma misma. Buscar hacia atrás la palabra "function" se traía la función ANTERIOR
  // cuando la firma empieza con "async", y el pedazo extraído compilaba igual — la prueba parecía
  // andar midiendo otra cosa.
  return PORTAL.slice(i, fin);
}

// Base falsa que se comporta como la de verdad: crear_solicitud NO devuelve el token (igual que en
// producción), crear_chat_v2_blindado SÍ, y enviar_mensaje_v2 exige los dos.
function armar({ chatRota = false } = {}){
  const llamadas = [];
  let proximaSolicitud = 1000;
  const ctx = {
    console: { warn(){}, log(){} },
    localStorage: { _m:new Map(), getItem(k){ return this._m.has(k)?this._m.get(k):null; },
                    setItem(k,v){ this._m.set(String(k),String(v)); }, removeItem(k){ this._m.delete(String(k)); } },
    location: { host: 'vip.portal-bet-300.com' },
    state: { usuario:'scarymovie871', telefono:'1140388784', pcCodigo:'P4',
             publicCode:'rt-z9p42', chatId:'', chatToken:'' },
    normalize: (d) => (Array.isArray(d) ? d[0] : d),
    billeteraPayloadPlano: () => ({}),
    _marcaDeTiempo: () => ({}),
    addMsg(){}, startChatPoll(){}, startPortalThreadPoll(){},
    Number, String, Object,
    async rpc(nombre, args){
      llamadas.push({ nombre, args });
      if(nombre === 'landing_portal_v16_crear_solicitud'){
        const id = ++proximaSolicitud;
        // Tal cual produccion: ni chat_id ni chat_token.
        return { data: { ok:true, id, solicitud_id:id, estado:'PENDIENTE' } };
      }
      if(nombre === 'landing_crear_chat_v2_blindado'){
        if(chatRota) return { error: { message: 'no se pudo' } };
        return { data: { chat_id: 77, chat_token: 'tok-77', estado:'ABIERTO' } };
      }
      if(nombre === 'landing_enviar_mensaje_v2'){
        if(!args.p_chat_id || !args.p_chat_token) return { error:{ message:'Chat no autorizado' } };
        return { data: { ok:true, mensaje:'Mensaje enviado', mensaje_id: 1 } };
      }
      return { data: null };
    }
  };
  vm.createContext(ctx);
  vm.runInContext(sacar('async function enviarMensajeSoporte('), ctx);
  const creadas = () => llamadas.filter(x => x.nombre === 'landing_portal_v16_crear_solicitud').length;
  const enviados = () => llamadas.filter(x => x.nombre === 'landing_enviar_mensaje_v2').length;
  return { ctx, llamadas, creadas, enviados };
}

test('el primer mensaje abre la consulta Y consigue el chat', async () => {
  const c = armar();
  await c.ctx.enviarMensajeSoporte('Tengo varios usuarios');
  assert.equal(c.creadas(), 1, 'una solicitud, la del reclamo');
  assert.equal(c.ctx.state.chatId, '77', 'y el chat queda abierto');
  assert.equal(c.ctx.state.chatToken, 'tok-77');
  const pidio = c.llamadas.find(x => x.nombre === 'landing_crear_chat_v2_blindado');
  assert.ok(pidio, 'tiene que pedir el chat');
  assert.equal(pidio.args.p_solicitud_id, 1001, 'atado a ESA solicitud, no suelto');
  assert.equal(pidio.args.p_usuario, 'scarymovie871');
});

test('los mensajes que siguen NO abren otra solicitud', async () => {
  // Esto es lo que fallaba: trece mensajes seguidos eran trece solicitudes.
  const c = armar();
  for(const t of ['Tengo varios usuarios','Y se mezclan','Borrame','Jo','Ko','No','El usuario.'])
    await c.ctx.enviarMensajeSoporte(t);
  assert.equal(c.creadas(), 1, 'SIETE mensajes -> UNA sola solicitud. Hubo: ' + c.creadas());
  assert.equal(c.enviados(), 6, 'los otros seis van al hilo de esa consulta');
});

test('el chat se guarda en el telefono: no se pierde al recargar', async () => {
  const c = armar();
  await c.ctx.enviarMensajeSoporte('hola');
  assert.equal(c.ctx.localStorage.getItem('bet300_chat_id'), '77');
  assert.equal(c.ctx.localStorage.getItem('bet300_chat_token'), 'tok-77');
});

test('si no se puede abrir el chat, el mensaje igual sale', async () => {
  // Ante la duda, que el reclamo llegue. Vuelve a crear solicitud, que es como funcionaba antes:
  // feo, pero el jugador no queda sin que nadie lo lea.
  const c = armar({ chatRota: true });
  await c.ctx.enviarMensajeSoporte('hola');
  await c.ctx.enviarMensajeSoporte('alguien ahi?');
  assert.equal(c.ctx.state.chatId, '', 'no inventó un chat que no existe');
  assert.equal(c.creadas(), 2, 'cae al camino viejo: el mensaje llega igual');
});

test('no se manda nada vacio', async () => {
  const c = armar();
  await c.ctx.enviarMensajeSoporte('');
  await c.ctx.enviarMensajeSoporte('   ');
  assert.equal(c.llamadas.length, 0);
});
