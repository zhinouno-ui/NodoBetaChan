'use strict';

// Canales nuevos según la versión de NODO (Juan, 15/11 y 23/11: "el archivo de los nuevos canales debe de estar en la
// aplicación posterior a la versión 2.1.5"). Al elegir la oficina, si esta versión es mayor a 2.1.5 y la PC todavía no
// tiene clave de canales nuevos para esa oficina, se la pide al servidor (panel_beta_alta_v1, con el secreto del panel)
// y la guarda en %LOCALAPPDATA%\NODO\beta\connection.json, el mismo archivo que hasta acá se copiaba a mano. El
// puente (main/panel-rpc.js) lee ese archivo en cada llamada: desde ahí la oficina usa los canales nuevos.
// Una PC con el archivo puesto en enabled:false (apagado a mano) no se toca.
const fs = require('node:fs');
const path = require('node:path');
const { loadBetaConfig, normalizeOffice } = require('./beta-config');

function versionNueva(version) {
  const m = String(version || '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return false;
  const a = [Number(m[1]), Number(m[2]), Number(m[3])], b = [2, 1, 5];
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

function archivoBeta(env) {
  return env.NODO_BETA_CONFIG || (env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'NODO', 'beta', 'connection.json'));
}

async function asegurarCanalesNuevos({ pcCodigo, version, env = process.env, fetch = globalThis.fetch, fsx = fs } = {}) {
  const pc = normalizeOffice(String(pcCodigo || '').trim().replace(/^PC(\d+)$/i, 'P$1'));
  if (!pc) return { ok: false, motivo: 'sin-oficina' };
  if (!versionNueva(version)) return { ok: true, nuevos: false, motivo: 'version' };
  const file = archivoBeta(env);
  if (!file) return { ok: false, motivo: 'sin-carpeta' };

  let actual = null;
  try { actual = JSON.parse(String(fsx.readFileSync(file)).replace(/^﻿/, '')); } catch (_e) { actual = null; }
  if (actual && actual.enabled === false) return { ok: true, nuevos: false, motivo: 'apagado-a-mano' };
  if (actual && actual.credentials && typeof actual.credentials[pc] === 'string') return { ok: true, nuevos: true, ya: true };

  const url = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const anon = env.SUPABASE_ANON_KEY || env.SUPABASE_KEY || '';
  const secret = env.PANEL_DATA_SECRET;
  if (!url || !anon || !secret) return { ok: false, motivo: 'config' };

  let data = null;
  try {
    const resp = await fetch(url + '/rest/v1/rpc/panel_beta_alta_v1', {
      method: 'POST',
      headers: { apikey: anon, Authorization: 'Bearer ' + anon, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_secret: secret, p_pc_codigo: pc, p_version: String(version) })
    });
    data = await resp.json().catch(() => null);
  } catch (_e) { return { ok: false, motivo: 'red' }; }
  if (!data || data.ok !== true) return { ok: false, motivo: 'servidor' };
  if (data.nuevos_canales !== true || !/^[a-f0-9]{64}$/.test(String(data.token || ''))) return { ok: true, nuevos: false, motivo: 'servidor-no' };

  const credenciales = Object.assign({}, (actual && actual.credentials) || {});
  credenciales[pc] = data.token;
  const nuevo = {
    enabled: true,
    url: (actual && actual.url) || url,
    public_key: (actual && actual.public_key) || anon,
    build: 'nodo-' + String(version).trim(),
    credentials: credenciales
  };
  fsx.mkdirSync(path.dirname(file), { recursive: true });
  fsx.writeFileSync(file, JSON.stringify(nuevo, null, 2) + '\n');
  // Lo que quedó escrito tiene que ser lo que el puente acepta; si no, se avisa (no se usa a medias).
  const cfg = loadBetaConfig({ env: Object.assign({}, env, { NODO_BETA_CONFIG: file }), readFile: fsx.readFileSync });
  return { ok: cfg.enabled === true && cfg.offices.includes(pc), nuevos: true, ya: false };
}

module.exports = { asegurarCanalesNuevos, versionNueva, archivoBeta };
