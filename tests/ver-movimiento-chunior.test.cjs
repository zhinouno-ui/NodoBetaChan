// Juan, 23/11: una alerta de la revisión de Chunior decía "(sin usuario)" y no había cómo ver qué estaba anotado
// allá: "debería de haber un botón que despliegue el movimiento para revisarlo". Era un ajuste de un movimiento
// duplicado (monto 0, sin notas). El botón "📄 Chunior" lee la ficha del movimiento en la ventana de Chunior y
// la despliega debajo de la fila. Se aprieta como en NODO: del HTML que arma renderHistorial (docs/BOTONES.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'core', 'historial-operaciones.js'), 'utf8').replace(/\r\n/g, '\n');
const desde = src.indexOf('function _chuRutaDeTipo');
const finRender = src.indexOf('\n}\n', src.indexOf('function renderHistorial(lista)')) + 3;
const errSrc = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'core', 'operaciones-manuales.js'), 'utf8').replace(/\r\n/g, '\n');
const errParse = errSrc.slice(errSrc.indexOf('function _errParse'), errSrc.indexOf('// Etiqueta corta para la celda Estado'));

const ALERTA = { id: 563344, created_at: '2026-11-23T12:08:24Z', usuario: '(sin usuario)', monto: 0, tipo: 'ALERTA', estado: 'ERROR',
  origen: 'CHUNIOR', billetera_nombre: 'MATRELO mp', operador: 'lautaroo',
  notas: 'Revisión de Chunior · Movimientos de fichas N° 10217140: lautaroo lo anotó directo en Chunior. [ERR]'
    + JSON.stringify({ m: 'ANOTADO_SOLO_EN_CHUNIOR', tabla: 'Movimientos de fichas', n: '10217140', tipo: 'CARGA' }) };
const CARGA = { id: 9, created_at: '2026-11-23T12:00:00Z', usuario: 'pepe', monto: 5000, tipo: 'CARGA', estado: 'OK', origen: 'LANDING', chunior_movimiento_id: '10220442' };
const SIN_N = { id: 10, created_at: '2026-11-23T12:00:00Z', usuario: 'pepe', monto: 0, tipo: 'CONSULTA', estado: 'OK', origen: 'MANUAL' };

function armar(chuniorPaginas) {
  const avisos = [], navegadas = [];
  let html = '';
  const tabla = { set innerHTML(v) { html = v; }, get innerHTML() { return html; } };
  const ctx = {
    console: { warn() {} }, Date, Promise, setTimeout, String, Number, JSON, Array, Object, RegExp, encodeURIComponent,
    CHUNIOR_BASE: 'https://bo.chunior.com',
    escapeHtml: v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    money: v => '$' + v, formatFecha: v => String(v), billeteras: [], _errTextoLimpio: n => String(n || '').split('[ERR]')[0],
    _errEtiqueta: () => 'Anotado sólo en Chunior', toast: (t, c) => avisos.push([t, c]),
    document: { getElementById: id => (id === 'historialTable' ? tabla : null), createElement: () => nuevaFila() },
    localStorage: { getItem: () => null }
  };
  ctx.window = ctx;
  ctx.window._histPorId = {};
  ctx.window.NodoPasadaChunior = { TABLAS: [{ ruta: 'movimientoficha', nombre: 'Movimientos de fichas', grupo: ['CARGA', 'RETIRO'], fichas: true },
    { ruta: 'propina', nombre: 'Propinas', grupo: ['PROPINA'] }] };
  let actual = '';
  ctx.window.chunior = {
    navigate: async url => { navegadas.push(url); actual = url; },
    exec: async script => {
      const pag = Object.keys(chuniorPaginas).find(k => actual.endsWith(k));
      return pag ? chuniorPaginas[pag](script) : null;
    },
    focus: async () => { navegadas.push('focus'); }
  };
  vm.createContext(ctx);
  vm.runInContext(errParse + '\n' + src.slice(desde, finRender), ctx);
  return { ctx, avisos, navegadas, html: () => html };
}
function nuevaFila() {
  const td = { innerHTML: '' };
  return { className: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; },
    classList: { contains(c) { return false; } }, get firstChild() { return td; }, set innerHTML(v) { td.innerHTML = v.replace(/^<td[^>]*>|<\/td>$/g, ''); }, td };
}
// El botón tal cual sale del HTML: onclick y data-*.
function botonDe(html, texto) {
  const m = html.match(new RegExp('<button[^>]*onclick="([^"]+)"([^>]*)>' + texto));
  if (!m) return null;
  const attrs = {};
  for (const a of (m[0].match(/data-[a-z]+="[^"]*"/g) || [])) { const [k, v] = a.split('='); attrs[k] = v.slice(1, -1); }
  return { onclick: m[1], attrs };
}
function trFalso(boton) {
  const filas = [];
  const tr = { children: { length: 11 }, nextElementSibling: null,
    parentNode: { insertBefore(nueva) { filas.push(nueva); tr.nextElementSibling = nueva; nueva.remove = () => { tr.nextElementSibling = null; }; nueva.classList = { contains: c => c === 'hrow-chu-ficha' }; } } };
  return { tr, filas, el: { disabled: false, closest: () => tr, getAttribute: k => boton.attrs[k] } };
}
const FICHA = () => ({ ok: true, campos: [{ k: 'Puesto trabajo', v: 'Puesto SANCHEZPLATA' }, { k: 'Billetera destino', v: '957 - MATRELO MP' },
  { k: 'Monto', v: '0,00' }, { k: 'Notas', v: '' }] });
const CAMBIOS = () => ({ ok: true, cambios: [{ cuando: '22-11-2026 19:30:06', quien: 'lautaroo', que: 'Agregado.' },
  { cuando: '22-11-2026 19:32:42', quien: 'lautaroo', que: 'Modificación de monto y Notas.' }] });

test('la alerta de la revisión de Chunior y una carga con N° tienen "📄 Chunior"; sin N°, no', () => {
  const p = armar({});
  p.ctx.renderHistorial([ALERTA, CARGA, SIN_N]);
  const html = p.html();
  assert.equal((html.match(/📄 Chunior/g) || []).length, 2);
  const b = botonDe(html, '📄 Chunior');
  assert.equal(b.onclick, 'verMovimientoChunior(this)', 'los datos van en data-*, no en el onclick');
  assert.equal(b.attrs['data-n'], '10217140', 'de la alerta sale el N° del detalle');
  assert.equal(b.attrs['data-ruta'], 'movimientoficha');
});

test('al apretarlo despliega la ficha de Chunior debajo de la fila, con los cambios; al volver a apretar se pliega', async () => {
  const p = armar({ '/10217140/change/': FICHA, '/10217140/history/': CAMBIOS });
  p.ctx.renderHistorial([ALERTA]);
  const b = botonDe(p.html(), '📄 Chunior');
  const { tr, filas, el } = trFalso(b);
  await vm.runInContext('(function(){ return ' + b.onclick.replace('this', 'el') + '; })', Object.assign(p.ctx, { el }))();
  assert.deepEqual(p.navegadas, ['https://bo.chunior.com/transacciones/movimientoficha/10217140/change/',
    'https://bo.chunior.com/transacciones/movimientoficha/10217140/history/']);
  const ficha = filas[0].td.innerHTML;
  assert.match(ficha, /Movimiento N° 10217140 en Chunior/);
  assert.match(ficha, /Billetera destino[\s\S]*957 - MATRELO MP/);
  assert.match(ficha, /Notas<\/div><div[^>]*>\(vacío\)/, 'lo vacío se dice');
  assert.match(ficha, /Modificación de monto y Notas/);
  assert.match(ficha, /onclick="abrirMovimientoEnChunior\(this\)" data-url="https:\/\/bo\.chunior\.com\/transacciones\/movimientoficha\/10217140\/change\/"/);
  assert.equal(el.disabled, false, 'el botón no queda trabado');
  await p.ctx.verMovimientoChunior(el);
  assert.equal(tr.nextElementSibling, null, 'segundo toque: se pliega');
});

test('si Chunior no abre el movimiento: lo dice en castellano, sin detalle técnico, y el botón se libera', async () => {
  const p = armar({});
  p.ctx.renderHistorial([CARGA]);
  const b = botonDe(p.html(), '📄 Chunior');
  const { filas, el } = trFalso(b);
  await p.ctx.verMovimientoChunior(el).catch(() => {});
  assert.match(filas[0].td.innerHTML, /No se pudo abrir el movimiento N° 10220442 en Chunior/);
  assert.deepEqual(p.avisos[0], ['No se pudo abrir el movimiento en Chunior.', 'red']);
  assert.equal(el.disabled, false);
});

test('"Abrir en Chunior" sólo navega a Chunior y trae la ventana al frente', async () => {
  const p = armar({});
  const el = { disabled: false, getAttribute: () => 'https://bo.chunior.com/transacciones/movimientoficha/1/change/' };
  await p.ctx.abrirMovimientoEnChunior(el);
  assert.deepEqual(p.navegadas, ['https://bo.chunior.com/transacciones/movimientoficha/1/change/', 'focus']);
  const p2 = armar({});
  await p2.ctx.abrirMovimientoEnChunior({ disabled: false, getAttribute: () => 'https://otro.sitio/x' });
  assert.deepEqual(p2.navegadas, [], 'a otro sitio no va');
});
