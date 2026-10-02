const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// La lista blanca de main tiene que cubrir TODO lo que el panel pide.
//
// `landing_retiro_progreso` no estaba. main devolvia RPC_NO_PERMITIDA, el panel se lo comia en un
// catch vacio y el retiro sostenido no se soltaba nunca: en P1 seguian apareciendo cuatro de
// agosto y septiembre, uno con $1 pendiente, ciclo tras ciclo. El arreglo de D-109 decia "antes de
// sostenerla se le pregunta a la base como esta" y la pregunta nunca llegaba (2/10).
//
// Una RPC que falta no rompe nada a la vista: devuelve error y el panel sigue como si nada. Por eso
// hace falta que lo diga una prueba y no la cara de un operador.

const RAIZ = path.join(__dirname, '..');
const PANEL_RPC = fs.readFileSync(path.join(RAIZ, 'main', 'panel-rpc.js'), 'utf8');

function permitidas(){
  const i = PANEL_RPC.indexOf('PANEL_RPC_ALLOW');
  assert.notEqual(i, -1, 'no esta PANEL_RPC_ALLOW en main/panel-rpc.js');
  const fin = PANEL_RPC.indexOf(']', i);
  const bloque = PANEL_RPC.slice(i, fin);
  return new Set((bloque.match(/'([a-z0-9_]+)'/g) || []).map(s => s.replace(/'/g, '')));
}

// Lo que el panel pide por panelAPI.rpc. En renderer/portal eso es deps.rpc(...).
function pedidas(){
  const dir = path.join(RAIZ, 'renderer', 'portal');
  const out = new Map();
  for(const f of fs.readdirSync(dir).filter(x => x.endsWith('.js'))){
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const re = /deps\.rpc\(\s*['"]([a-z0-9_]+)['"]/g;
    let m;
    while((m = re.exec(src))){
      if(!out.has(m[1])) out.set(m[1], f);
    }
  }
  return out;
}

test('todo lo que el panel pide esta permitido en main', () => {
  const ok = permitidas();
  const faltan = [];
  for(const [fn, archivo] of pedidas()){
    if(!ok.has(fn)) faltan.push(fn + '  (lo pide renderer/portal/' + archivo + ')');
  }
  assert.deepEqual(faltan, [],
    'main va a contestar RPC_NO_PERMITIDA y el panel se lo come en silencio:\n  ' + faltan.join('\n  '));
});

test('landing_retiro_progreso esta permitida', () => {
  // La que faltaba. Explicita, para que si alguien la saca se vea por que estaba.
  assert.ok(permitidas().has('landing_retiro_progreso'),
    'sin esto, un retiro sostenido no se suelta nunca de la caja');
});

test('la lista no deja pasar cualquier cosa', () => {
  // La lista existe para que un bug o un XSS en el renderer no pueda llamar RPC no previstas.
  // Si alguien la vacia o mete un comodin, esto lo frena.
  const ok = permitidas();
  assert.ok(ok.size >= 20 && ok.size <= 80, 'tamano razonable, hay ' + ok.size);
  for(const fn of ok){
    assert.match(fn, /^(panel|landing)_/, 'solo RPC del panel o del portal: ' + fn);
  }
  assert.ok(!PANEL_RPC.includes('PANEL_RPC_ALLOW.has(fn) || true'), 'la verificacion no puede estar anulada');
  assert.match(PANEL_RPC, /if \(!PANEL_RPC_ALLOW\.has\(fn\)\)/, 'la lista se tiene que seguir mirando');
});
