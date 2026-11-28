// 19/11 · Juan: "si dos usuarios retiran desde el mismo lado se debe unificar el retiro de 24 hs: es por
// persona, no por cuenta". Caso real de una oficina (los datos de acá son inventados, el repo es público):
// tres cuentas, tres teléfonos, un titular y la misma cuenta de cobro; el chequeo por usuario frenaba 2 de 28.
// No se traba nada: el operador ve quién cobró, cuándo y a qué cuenta, y el texto para el rechazo.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const FUENTE = fs.readFileSync(path.join(ROOT, 'renderer', 'core', 'retiros-y-lealtad.js'), 'utf8');
const HORA = 3600000;
const CBU = '0000000000000000000001';

// Un supabaseClient de mentira: cada consulta guarda sus filtros y contesta con `responder(filtros)`.
function cliente(responder, consultas) {
  return {
    from(tabla) {
      const q = { tabla, f: [] };
      const b = {
        select(c) { q.select = c; return b; },
        ilike(c, v) { q.f.push(['ilike', c, v]); return b; },
        in(c, v) { q.f.push(['in', c, v]); return b; },
        eq(c, v) { q.f.push(['eq', c, v]); return b; },
        gte(c, v) { q.f.push(['gte', c, v]); return b; },
        or(v) { q.f.push(['or', v]); return b; },
        order() { return b; },
        limit() { consultas.push(q); return Promise.resolve(responder(q)); }
      };
      return b;
    }
  };
}
const fila = (usuario, horasAtras, titular, destino, extra = {}) => ({
  id: Math.floor(Math.random() * 1e6), usuario, monto: 10000, pc_codigo: 'P9', billetera_nombre: null,
  created_at: new Date(Date.now() - horasAtras * HORA).toISOString(),
  notas: '#1 · Titular: ' + titular + ' · Alias: ' + destino + ' · ARS 10,000.00', ...extra
});

function contexto(responder) {
  const consultas = [], salud = [];
  const c = {
    window: { NodoSalud: { begin: () => ({ record: (...a) => salud.push(a) }) } },
    supabaseClient: cliente(responder, consultas), retiros24hCSV: [], console,
    normalizar: (t) => String(t || '').trim().toLowerCase(),
    formatFecha: (iso) => String(iso), money: (n) => '$' + n,
    escapeHtml: (t) => String(t).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]),
    setTimeout, clearTimeout, Promise, Date, Math, JSON, Number, String, Array, Set
  };
  vm.createContext(c);
  vm.runInContext(FUENTE, c);
  return { c, consultas, salud };
}
// Responde como el servidor: los retiros del usuario (por .in) y los de las últimas 24 h que pasan el .or.
function servidor(filas) {
  return (q) => {
    const inU = q.f.find((x) => x[0] === 'in' && x[1] === 'usuario');
    if (inU) return { data: filas.filter((h) => inU[2].includes(h.usuario)), error: null };
    const or = q.f.find((x) => x[0] === 'or');
    if (or) {
      const pats = or[1].split(',').map((p) => p.replace(/^notas\.ilike\.\*/, '').replace(/\*$/, ''));
      const rx = pats.map((p) => new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/_/g, '.'), 'i'));
      const desde = Date.parse(q.f.find((x) => x[0] === 'gte')[2]);
      return { data: filas.filter((h) => Date.parse(h.created_at) >= desde && rx.some((r) => r.test(h.notas))), error: null };
    }
    return { data: [], error: null };   // las fuentes del chequeo por usuario (landing_solicitudes / historial por ilike)
  };
}

test('las notas del retiro dicen titular y cuenta, y el titular se busca sin que una tilde lo esconda', () => {
  const { c } = contexto(() => ({ data: [], error: null }));
  assert.deepEqual({ ...c._bl24DeNotas('#9 · Titular: Nombre Ficticio López · Alias: ' + CBU + ' · ARS 5,000.06') },
    { titular: 'Nombre Ficticio López', destino: CBU });
  assert.equal(c._bl24PatronTitular('Nombre Ficticio López'), 'Titular: __mbr_ f_ct_c__');
  assert.equal(c._bl24Norm('Nombre  Ficticio LÓPEZ'), 'nombre ficticio lopez');
});

test('otra cuenta de la misma persona cobró a la misma cuenta hace 3 h: se avisa con el texto del rechazo', async () => {
  const filas = [
    fila('cuentauno', 3, 'Nombre Ficticio Lopez', CBU),
    fila('cuentados', 40, 'Nombre Ficticio López', CBU)      // el retiro anterior de esta cuenta, fuera de las 24 h
  ];
  const { c, salud } = contexto(servidor(filas));
  const r = await c.verificarRetiro24h('cuentados');
  assert.equal(r.bloqueado, true);
  assert.equal(r.origen, 'MISMA_PERSONA');
  assert.equal(r.otroUsuario, 'cuentauno');
  assert.equal(r.porCuenta, true);
  assert.match(r.mensaje, /^Retiro 24 hs: ya se hizo un retiro desde el usuario cuentauno (hoy|ayer) a las \d\d:\d\d, a la misma cuenta de cobro\. Podés volver a pedir (hoy|mañana) a las \d\d:\d\d\.$/);
  assert.ok(salud.some((s) => s[2] === 'RETIRO_24H_MISMA_PERSONA'));
});

test('con otra cuenta de cobro pero el mismo titular (con y sin tilde) también se avisa, diciendo que es por el titular', async () => {
  const filas = [fila('cuentatres', 2, 'Nombre Ficticio López', '0000000000000000000099')];
  const { c } = contexto(servidor(filas));
  const r = await c.verificarRetiro24h('cuentados', { destino: CBU, titular: 'Nombre Ficticio Lopez' });
  assert.equal(r.origen, 'MISMA_PERSONA');
  assert.equal(r.porCuenta, false);
  assert.match(r.mensaje, /a nombre del mismo titular\./);
});

test('otro titular que empieza igual no es la misma persona; un retiro en partes o sacado de la blacklist tampoco cuenta', async () => {
  const filas = [
    fila('otrapersona', 2, 'Nombre Ficticio Gomez', '0000000000000000000077'),
    fila('cuentauno', 1, 'Nombre Ficticio Lopez', CBU, { notas: '#2 · PARCIAL · Titular: Nombre Ficticio Lopez · Alias: ' + CBU }),
    fila('cuentauno', 1, 'Nombre Ficticio Lopez', CBU, { notas: '#3 · Titular: Nombre Ficticio Lopez · Alias: ' + CBU + ' [BL_EXCLUIDO]' })
  ];
  const { c } = contexto(servidor(filas));
  const r = await c.verificarRetiro24h('cuentados', { destino: CBU, titular: 'Nombre Ficticio López' });
  assert.equal(r.bloqueado, false);
});

test('si la búsqueda por persona falla, el retiro sigue y la luz queda en "sin comprobar"', async () => {
  const { c, salud } = contexto((q) => (q.f.some((x) => x[0] === 'in') ? { data: null, error: { message: 'timeout' } } : { data: [], error: null }));
  const avisos = []; c.console = { warn: (...a) => avisos.push(a) };
  const r = await c.verificarRetiro24h('cuentados', { destino: CBU });
  assert.equal(r.bloqueado, false);
  assert.ok(salud.some((s) => s[1] === 'DEGRADED' && s[2] === 'RETIRO_24H_PERSONA_SIN_COMPROBAR'));
});

test('el cuadro dice quién cobró y a qué cuenta, y trae el mensaje para el rechazo con su botón Copiar', async () => {
  const { c } = contexto(() => ({ data: [], error: null }));
  let cuerpo = '';
  c.abrirModal = (titulo, body) => { cuerpo = body; };
  c.document = { getElementById: () => null, querySelector: () => null };
  c.confirmarRetiroDuplicado({ origen: 'MISMA_PERSONA', usuario: 'cuentados', otroUsuario: 'cuentauno', porCuenta: true,
    titular: 'Nombre Ficticio López', destino: CBU, oficinaOtro: 'P9', fecha: new Date(Date.now() - 3 * HORA).toISOString(),
    proximoRetiro: new Date(Date.now() + 21 * HORA).toISOString(), monto: 10000,
    mensaje: 'Retiro 24 hs: ya se hizo un retiro desde el usuario cuentauno hoy a las 05:39, a la misma cuenta de cobro.' });
  assert.match(cuerpo, /Esta persona ya retiró desde otro usuario/);
  assert.match(cuerpo, /<b>cuentauno<\/b> cobró hace <b>3h<\/b> \(P9\), a la misma cuenta de cobro/);
  assert.match(cuerpo, /MENSAJE PARA EL RECHAZO/);
  assert.match(cuerpo, /data-valor="Retiro 24 hs: ya se hizo un retiro desde el usuario cuentauno[^"]*" onclick="portalCopiarCbu\(this\)"/);
});

test('el retiro del Portal y "Cerrar retiro" le pasan al chequeo la cuenta y el titular del pedido', () => {
  const auto = fs.readFileSync(path.join(ROOT, 'renderer', 'core', 'automatizaciones.js'), 'utf8');
  assert.match(auto, /verificarRetiro24h\(usuario, \{ destino: s\.DESTINO \|\| s\.CBU \|\| _retiroMeta\.destino/);
  // Al cancelar, el jugador recibe el mensaje del chequeo (que ahora dice desde qué usuario y cuándo).
  assert.match(auto, /Tu solicitud de retiro fue rechazada: \$\{check\.mensaje\}/);
  const lotes = fs.readFileSync(path.join(ROOT, 'renderer', 'core', 'lotes-y-solicitudes.js'), 'utf8');
  assert.match(lotes, /verificarRetiro24h\(usuario, \{ destino: s\.DESTINO \|\| s\.CBU \|\| s\.RETIRO_ALIAS_CBU/);
});

// "NODO debe notificar cuáles son las segundas cuentas": en el detalle del retiro, sin frenar nada.
test('segundas cuentas: quién más cobró a esta cuenta o a este titular en 60 días, y cuántas veces', async () => {
  const filas = [
    fila('cuentauno', 30, 'Nombre Ficticio Lopez', CBU), fila('cuentauno', 300, 'Nombre Ficticio Lopez', CBU),
    fila('cuentatres', 50, 'Nombre Ficticio López', '0000000000000000000099'),
    fila('cuentados', 10, 'Nombre Ficticio López', CBU),          // el propio usuario no cuenta
    fila('otrapersona', 5, 'Nombre Ficticio Gomez', '0000000000000000000077')
  ];
  const { c } = contexto((q) => {
    const il = q.f.find((x) => x[0] === 'ilike' && x[1] === 'notas');
    if (!il) return { data: [], error: null };
    const rx = new RegExp(il[2].slice(1, -1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/_/g, '.'), 'i');
    return { data: filas.filter((h) => rx.test(h.notas)), error: null };
  });
  const r = await c.nodoOtrasCuentasDeCobro(CBU, 'Nombre Ficticio López', 'cuentados');
  assert.deepEqual(JSON.parse(JSON.stringify(r.cuenta)), [{ usuario: 'cuentauno', oficina: 'P9', veces: 2 }]);
  assert.equal(r.titular.map((x) => x.usuario).sort().join(','), 'cuentatres,cuentauno');
  const html = c.nodoOtrasCuentasHtml(r);
  assert.match(html, /Posibles segundas cuentas \(60 días\)/);
  assert.match(html, /Cobraron a esta misma cuenta: cuentauno \(P9\) ×2/);
  assert.match(html, /Cobraron a nombre del mismo titular: cuentatres \(P9\) ×1/, 'el que ya salió por la cuenta no se repite');
  assert.match(c.nodoOtrasCuentasHtml({ cuenta: [], titular: [] }), /Ningún otro usuario cobró/);
});

test('el detalle del retiro pide las segundas cuentas y las pinta cuando llegan, sin frenar', () => {
  const pj = fs.readFileSync(path.join(ROOT, 'renderer', 'core', 'perfil-jugador.js'), 'utf8');
  assert.match(pj, /window\.nodoOtrasCuentasDeCobro\(cbuVal, titularDecl, usuario\)\.then\(/);
  assert.match(pj, /No se pudo revisar si otros usuarios cobran a esta cuenta\./);
});
