const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// D-101 / H-7. Mientras el operador está entrando a Agentes, NADA puede navegar la ventana: la
// navegación descarga la página, la llamada de login en vuelo no contesta nunca, el panel lo
// muestra como "se recargó durante la operación", el operador reintenta y vuelve a pasar. Eso es
// el loop que vio EYF-F el 26/09 después de pasar esa PC a BET300.
// El preload de casinodrex ya se blindó (_loginEnCurso). Este test corre sobre LOS DOS, porque el
// arreglo tiene que estar en los dos: la PC que quedó en BET300 es la que loopeaba.

const RAIZ = path.join(__dirname, '..');
const noop = () => {};

// No hace falta un DOM entero: con la URL en /login, pageNeedsLogin() ya devuelve true por el
// primer chequeo, y sin formulario iniciarSesion se queda buscándolo unos segundos — que es
// justo el momento en que el operador está entrando y nada tiene que navegar.
function cargarPreload(archivo) {
  const navegaciones = [];
  const sandbox = {
    console: { log: noop, warn: noop, error: noop, info: noop },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: noop,
    Date, Promise, Error, Boolean, String, Number, Object, Array, RegExp, Math, JSON, Set, Map,
    document: {
      querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
      title: '', body: { innerText: '', textContent: '' }, documentElement: {}, readyState: 'complete'
    },
    getComputedStyle: () => ({ visibility: 'visible', display: 'block' }),
    require: (nombre) => {
      if (nombre !== 'electron') throw new Error('require inesperado: ' + nombre);
      return {
        contextBridge: { exposeInMainWorld: noop },
        ipcRenderer: { on: noop, send: noop, invoke: () => Promise.resolve(null) }
      };
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.location = {
    href: 'https://agentesbet.io/login',
    pathname: '/login',
    assign(url) { navegaciones.push(url); }
  };
  sandbox.window.location = sandbox.location;
  const codigo = fs.readFileSync(path.join(RAIZ, archivo), 'utf8');
  // El preload expone su api con contextBridge; para el test alcanza con leerla del sandbox.
  vm.runInNewContext(codigo + '\n;globalThis.__api = api;', sandbox, { filename: archivo });
  return { api: sandbox.__api, navegaciones, sandbox };
}

for (const archivo of ['agent-preload.js', 'agent-preload-bet300.js']) {
  test(archivo + ': nada navega la ventana mientras el operador está entrando', async () => {
    const { api, navegaciones } = cargarPreload(archivo);

    // El operador aprieta "Conectar": el login queda EN VUELO (busca el formulario).
    const login = api.iniciarSesion('operador', 'clave');
    await new Promise(r => setTimeout(r, 50));

    // En ese momento cualquier otro camino que navegue mataría el login. Este es el que navega
    // sin mirar nada: va al inicio porque la página "pide login" — justamente porque se está
    // logueando.
    api.irABusquedaUsuarios();
    assert.deepEqual(navegaciones, [],
      'navegó encima del login: eso descarga la página y el login en vuelo nunca contesta (D-101)');

    await login;
  });
}
