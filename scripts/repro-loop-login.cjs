// ══════════════════════════════════════════════════════════════════════════════
// Reproduce el loop del login de Agentes (D-102) en el entorno de desarrollo.
//
// Corre con Electron REAL, el preload REAL (`agent-preload.js`) y los módulos REALES de main
// (`agent-window.js`, `automation.js`, `request-registry.js`). Lo único falso es el backoffice:
// un drex de mentira servido en 127.0.0.1. NO se toca bo.casinodrex.com — además, toda salida a
// internet queda bloqueada en la sesión de la ventana.
//
// Uso:
//   node_modules/.bin/electron scripts/repro-loop-login.cjs
//
// Qué muestra: el operador aprieta "Conectar", y mientras el login está en vuelo el panel navega
// la ventana (es lo que hacen sus 21 navigateAgent(), que no pasan por la cola). Se corre con el
// freno saltado —el comportamiento de antes— y con el freno puesto.
// ══════════════════════════════════════════════════════════════════════════════
'use strict';
const { app, BrowserWindow, ipcMain, session } = require('electron');
const http = require('node:http');
const path = require('node:path');

const { createRequestRegistry } = require('../main/request-registry');
const { createAgentWindowService } = require('../main/agent-window');
const { createAutomationService } = require('../main/automation');

const RAIZ = path.resolve(__dirname, '..');
const PARTICION = 'persist:nodo-repro-loop';
const LOGIN_TARDA_MS = 2500;   // lo que tarda el "casino" en dar por buena la clave
const INTENTOS = 3;
// El timeout real de una llamada de automatización es 40 s. Acá se acorta sólo para que la
// reproducción no tarde dos minutos: el mecanismo es idéntico.
const TIMEOUT_MS = 9000;

// ── El drex falso ─────────────────────────────────────────────────────────────
// Fiel a lo que mira el preload: la URL /login y un h4 "Login Agente" lo hacen "pantalla de
// ingreso"; un #searchButton visible lo hace "app operable".
//
// Drex es un SPA de React (el preload usa setReactInputValue). Al entrar NO recarga el documento:
// cambia la ruta por dentro. Eso importa acá, porque una navegación real durante una operación
// dispara OTRA protección de main y el resultado sería distinto. Se deja también el modo
// 'navegacion' para ver qué pasaría si el backoffice cambiara a eso.
const CUERPO_APP = '<h4>Control de agentes</h4>'
  + '<input class="validationField" name="alias">'
  + '<button id="searchButton">Buscar</button>';

function paginaLogin(modo) {
  const alEntrar = modo === 'navegacion'
    ? "location.assign('/agents/user_search');"
    : "history.pushState({},'','/agents/user_search'); document.body.innerHTML=" + JSON.stringify(CUERPO_APP) + ";";
  return '<!doctype html><meta charset="utf-8"><title>Backoffice</title>'
    + '<h4 class="loginTitle">Login Agente</h4>'
    + '<form onsubmit="return entrar()">'
    + '<input type="text" name="username" autocomplete="username">'
    + '<input type="password" name="password">'
    + '<button type="submit">ENTRAR</button>'
    + '</form>'
    + '<scr' + 'ipt>function entrar(){setTimeout(function(){' + alEntrar + '},'
    + LOGIN_TARDA_MS + ');return false;}</scr' + 'ipt>';
}

const PAGINA_APP = '<!doctype html><meta charset="utf-8"><title>Backoffice</title>' + CUERPO_APP;

function levantarDrexFalso(estado) {
  const server = http.createServer((req, res) => {
    const ruta = new URL(req.url, 'http://127.0.0.1').pathname;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (/^\/agents\/user_search\/?$/.test(ruta)) { res.end(PAGINA_APP); return; }
    res.end(paginaLogin(estado.modo));   // cualquier otra cosa, /login incluido, es el ingreso
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// ── Reproducción ──────────────────────────────────────────────────────────────
async function correr() {
  const estado = { modo: 'spa' };
  const server = await levantarDrexFalso(estado);
  const base = 'http://127.0.0.1:' + server.address().port;
  const LOGIN_URL  = base + '/login';
  const SEARCH_URL = base + '/agents/user_search';

  // Red de seguridad: que nada de esto pueda salir a internet ni por error.
  const ses = session.fromPartition(PARTICION);
  const bloqueadas = [];
  ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (detalles, cb) => {
    if (detalles.url.startsWith(base)) return cb({ cancel: false });
    bloqueadas.push(detalles.url);
    cb({ cancel: true });
  });

  // Los módulos de main son los de producción. Sólo se le cambian las URLs del backend, para que
  // apunten al drex falso en vez del casino.
  const backends = {
    current: {
      url: SEARCH_URL,
      newUserUrl: SEARCH_URL,
      preload: path.join(RAIZ, 'agent-preload.js'),
      spa: false,        // drex declara spa:false: por eso compara la ruta completa y siempre recarga
      label: 'drex falso (local)',
      appSel: '#searchButton, input.validationField, input[type="password"], input[name="alias"]'
    }
  };

  const requests = createRequestRegistry();
  ipcMain.on('drex:automation:result', (_e, resp = {}) => requests.settle(resp, 'Error en automatización.'));

  const agents = createAgentWindowService({
    BrowserWindow, icon: undefined, partition: PARTICION, backends,
    headers: { configure() {} }, requests
  });
  const automation = createAutomationService({
    agents, backends, requests, env: { DREX_AUTOMATION_TIMEOUT_MS: String(TIMEOUT_MS) }
  });

  const espera = ms => new Promise(r => setTimeout(r, ms));

  async function unIntento(n, saltearFreno) {
    const win = agents.get(LOGIN_URL);
    // Dejar la ventana en la pantalla de ingreso, como cuando se cayó la sesión.
    await agents.navigate(LOGIN_URL, { forceReload: true, permitirDuranteLogin: true });

    const t0 = Date.now();
    // El operador aprieta "Conectar".
    const login = automation.send('iniciarSesion', 'operador', 'clave').then(
      r => ({ ok: true, r }), e => ({ ok: false, error: e.message || String(e) }));

    // …y mientras eso está en vuelo, el panel navega la ventana.
    await espera(600);
    await agents.navigate(SEARCH_URL, { permitirDuranteLogin: saltearFreno });

    const res = await login;
    const ms = Date.now() - t0;
    const url = win.isDestroyed() ? '(ventana cerrada)' : win.webContents.getURL().replace(base, '');
    const dijo = res.ok ? ((res.r && res.r.message) || 'ok') : res.error;
    console.log('  intento ' + n + ': ' + (res.ok ? 'ENTRÓ ' : 'FALLÓ ') +
      '· ' + (ms / 1000).toFixed(1) + 's · ' + dijo + ' · quedó en ' + url);
    return res.ok;
  }

  async function tanda(titulo, saltearFreno, modo) {
    estado.modo = modo;
    console.log('\n' + titulo);
    let entraron = 0;
    for (let n = 1; n <= INTENTOS; n++) if (await unIntento(n, saltearFreno)) entraron++;
    console.log('  → entró ' + entraron + ' de ' + INTENTOS);
    return entraron;
  }

  console.log('drex falso en ' + base + ' · timeout de automatización: ' + (TIMEOUT_MS / 1000) +
              's (en producción son 40s)');

  const antes   = await tanda('ANTES · freno saltado, login de SPA (lo que pasaba en EYF-F):', true, 'spa');
  const despues = await tanda('DESPUÉS · freno puesto, login de SPA:', false, 'spa');
  // Escenario aparte: si el ingreso de drex hiciera una navegación de documento en vez de cambiar
  // la ruta por dentro. No es lo que hace hoy; sirve para saber qué pasaría si cambiara.
  const conNav  = await tanda('APARTE · freno puesto, pero el ingreso navega el documento:', false, 'navegacion');

  console.log('\n' + '='.repeat(72));
  console.log('ANTES:   entró ' + antes + '/' + INTENTOS + '  ← el operador reintenta y vuelve a pasar: loop');
  console.log('DESPUÉS: entró ' + despues + '/' + INTENTOS);
  console.log('APARTE:  entró ' + conNav + '/' + INTENTOS + '  (escenario que hoy no ocurre)');
  console.log('salidas a internet bloqueadas: ' + bloqueadas.length +
              (bloqueadas.length ? ' · ' + [...new Set(bloqueadas.map(u => new URL(u).origin))].join(', ') : ''));
  console.log('='.repeat(72));

  agents.close();
  await new Promise(r => { server.closeAllConnections(); server.close(r); });

  // Si el arreglo no sostiene, esto tiene que fallar fuerte, no informar lindo.
  const bien = antes === 0 && despues === INTENTOS;
  console.log(bien
    ? '\nOK · el loop se reproduce sin el freno y desaparece con el freno.'
    : '\nATENCIÓN · esto no es lo esperado. Revisar antes de dar el arreglo por bueno.');
  return bien;
}

app.disableHardwareAcceleration();
app.whenReady().then(correr).then(
  bien => { app.exit(bien ? 0 : 1); },
  error => { console.error('\nla reproducción se cayó:', error); app.exit(2); }
);
