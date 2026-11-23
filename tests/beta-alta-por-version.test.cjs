// Canales nuevos según la versión de NODO (Juan, 15/11 y 23/11: "el archivo de los nuevos canales debe de estar en la
// aplicación posterior a la versión 2.1.5"). La PC pide su clave al elegir la oficina y la guarda en el archivo que
// lee el puente; las versiones viejas no la piden.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { asegurarCanalesNuevos, versionNueva } = require('../main/beta-alta');
const { loadBetaConfig } = require('../main/beta-config');

const TOKEN = 'a'.repeat(32) + 'b'.repeat(32);
function armar({ archivo = null, respuesta = { ok: true, nuevos_canales: true, pc_codigo: 'P4', token: TOKEN } } = {}) {
  const discos = {}, pedidos = [];
  const FILE = path.join('C:', 'x', 'NODO', 'beta', 'connection.json');
  if (archivo) discos[FILE] = JSON.stringify(archivo);
  const fsx = {
    readFileSync: (f) => { if (!(f in discos)) { const e = new Error('no'); e.code = 'ENOENT'; throw e; } return discos[f]; },
    writeFileSync: (f, v) => { discos[f] = String(v); },
    mkdirSync: () => {}
  };
  const env = { NODO_BETA_CONFIG: FILE, SUPABASE_URL: 'https://pjvvyvfcwjoocjqvdror.supabase.co', SUPABASE_ANON_KEY: 'sb_publishable_x', PANEL_DATA_SECRET: 's3cr3t' };
  const fetch = async (url, op) => { pedidos.push({ url, body: JSON.parse(op.body) }); return { json: async () => respuesta }; };
  return { discos, pedidos, FILE, correr: (pcCodigo, version) => asegurarCanalesNuevos({ pcCodigo, version, env, fetch, fsx }) };
}

test('versión mayor a 2.1.5 sí; 2.1.5 o anterior no', () => {
  assert.equal(versionNueva('2.2.0'), true);
  assert.equal(versionNueva('2.1.6'), true);
  assert.equal(versionNueva('2.1.10'), true, '10 es mayor que 5 (no se compara como texto)');
  assert.equal(versionNueva('2.1.5'), false);
  assert.equal(versionNueva('1.6.0'), false);
  assert.equal(versionNueva(''), false);
});

test('2.2.0 sin clave para la oficina: la pide y la guarda junto a las que ya había', async () => {
  const p = armar({ archivo: { enabled: true, url: 'https://pjvvyvfcwjoocjqvdror.supabase.co', public_key: 'sb_publishable_x', build: 'nodo-beta-20261027', credentials: { P1: 'c'.repeat(64) } } });
  const r = await p.correr('PC4', '2.2.0');
  assert.deepEqual({ ...r }, { ok: true, nuevos: true, ya: false });
  assert.equal(p.pedidos.length, 1);
  assert.match(p.pedidos[0].url, /\/rest\/v1\/rpc\/panel_beta_alta_v1$/);
  assert.deepEqual(p.pedidos[0].body, { p_secret: 's3cr3t', p_pc_codigo: 'P4', p_version: '2.2.0' });
  const guardado = JSON.parse(p.discos[p.FILE]);
  assert.deepEqual(Object.keys(guardado.credentials).sort(), ['P1', 'P4'], 'la de P1 sigue');
  assert.equal(guardado.credentials.P4, TOKEN);
  const cfg = loadBetaConfig({ env: { NODO_BETA_CONFIG: p.FILE }, readFile: (f) => p.discos[f] });
  assert.equal(cfg.enabled, true);
  assert.deepEqual([...cfg.offices], ['P1', 'P4'], 'el puente la toma');
});

test('ya tiene clave para esa oficina: no pide nada', async () => {
  const p = armar({ archivo: { enabled: true, url: 'https://pjvvyvfcwjoocjqvdror.supabase.co', public_key: 'k', credentials: { P4: TOKEN } } });
  const r = await p.correr('P4', '2.2.0');
  assert.equal(r.ya, true);
  assert.equal(p.pedidos.length, 0);
});

test('versión 2.1.5, archivo apagado a mano o servidor que dice que no: no se toca nada', async () => {
  const vieja = armar();
  assert.equal((await vieja.correr('P4', '2.1.5')).nuevos, false);
  assert.equal(vieja.pedidos.length, 0);
  const apagado = armar({ archivo: { enabled: false } });
  assert.equal((await apagado.correr('P4', '2.2.0')).motivo, 'apagado-a-mano');
  assert.equal(apagado.pedidos.length, 0);
  const no = armar({ respuesta: { ok: true, nuevos_canales: false } });
  assert.equal((await no.correr('P4', '2.2.0')).nuevos, false);
  assert.equal(no.discos[no.FILE], undefined, 'sin clave no se escribe el archivo');
});

test('la PC pide su clave al elegir la oficina, sin frenar la elección', () => {
  const src = require('node:fs').readFileSync(path.join(__dirname, '..', 'main', 'office-credentials.js'), 'utf8');
  assert.match(src, /ipcMain\.handle\('proxy:apply', async \(_event, \{ pcCodigo \} = \{\}\) => \{\s*canalesNuevosParaOficina\(pcCodigo\);\s*return applyProxyForOffice\(pcCodigo\);/);
  const main = require('node:fs').readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /registerOfficeCredentialsIpc\(\{ ipcMain, automation, proxy, version:/);
  const sql = require('node:fs').readFileSync(path.join(__dirname, '..', 'servidor', 'beta-alta-por-version.sql'), 'utf8');
  assert.match(sql, /if \(v_m\[1\]::int, v_m\[2\]::int, v_m\[3\]::int\) <= \(2, 1, 5\) then/);
  assert.match(sql, /if not public\._panel_data_auth\(p_secret\) then raise exception 'no-auth'; end if;/);
});
