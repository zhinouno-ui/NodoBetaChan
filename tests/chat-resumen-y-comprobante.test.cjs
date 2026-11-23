// Juan, 23/11 (P4 en los canales nuevos): "hay que mejorar estos mensajes" (el pedido a una persona que arma el
// asistente del Portal), "no parece detectar el comprobante en el chat cuando lo adjuntás con el sistema de autochat"
// y "ya rechacé la solicitud y el usuario debe recargar para saber".
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Message = require('../renderer/chat/message-model.js');
const RAIZ = path.join(__dirname, '..');

test('el pedido a una persona del asistente se lee como ficha: tema, última carga y último retiro con su estado', () => {
  const r = Message.resumenAsistente({ origen: 'USUARIO', mensaje: 'Pido hablar con mi cajero.\nTema: una consulta.\nResumen del asistente:\n'
    + '· Última carga: $2.000 · 23/11 10:27 · no aprobada · pedido 520466\n· Último retiro: $10.000 · 20/11 01:19 · pagado · pedido 506200' });
  assert.equal(r.tema, 'una consulta');
  assert.deepEqual(r.operaciones.map(o => [o.tipo, o.monto, o.fecha, o.estado, o.pedido]), [
    ['CARGA', '$2.000', '23/11 10:27', 'no aprobada', '520466'],
    ['RETIRO', '$10.000', '20/11 01:19', 'pagado', '506200']
  ]);
  assert.equal(Message.resumenAsistente({ origen: 'USUARIO', mensaje: 'Hola, no me llega la carga' }), null);
  const hilos = fs.readFileSync(path.join(RAIZ, 'renderer', 'chat', 'chat-hilos.js'), 'utf8');
  assert.match(hilos, /\$\{fichaResumenAsistente\(m\)\|\|E\(NodoChatMessage\.visibleText\(m\)\)/);
});

test('el comprobante que el jugador manda por el chat del canal nuevo cuenta para la carga (por el número de pedido)', () => {
  const src = fs.readFileSync(path.join(RAIZ, 'renderer', 'chat', 'chat-solicitud-preview.js'), 'utf8');
  assert.match(src, /window\._chatCanalNuevo\.paginaMensajes\(t\._chatId\)/, 'mira la conversación que trajo el canal nuevo');
  assert.match(src, /const foto = fotoDelPedidoEnElChat\(sol\.ID \|\| sol\.SOLICITUD_ID \|\| sol\.id\);/);
  assert.match(src, /new RegExp\('pedido\\\\s\*#\?\\\\s\*' \+ id \+ '\(\?!\\\\d\)', 'i'\)/);
  const sql = fs.readFileSync(path.join(RAIZ, 'servidor', 'portal-comprobante-v1.sql'), 'utf8');
  assert.doesNotMatch(sql, /set comprobante_url = v_url/, 'la tabla no tiene esa columna: va en metadata');
});

test('Portal: el rechazo se confirma con una segunda lectura enseguida, avisa con notificación y se mira con el cajero cerrado', () => {
  const portal = fs.readFileSync(path.join(RAIZ, 'Portal'), 'utf8');
  assert.match(portal, /if\(rechazadoStreak < 2\)\{setEstadoLive\("⏳ En verificación"\);setTimeout\(/);
  assert.match(portal, /notificarLocal\("BET300 · Tu solicitud no pudo procesarse"/);
  assert.match(portal, /stopChatPoll\(\);stopPortalThreadPoll\(\);\s*if\(!tieneSolicitudPendiente\(\)\) stopEstadoPoll\(\);/);
});
