const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// El Portal es un HTML de una sola pieza: no se puede require(). Se saca de ahi el codigo REAL de
// los minimos y se ejecuta, para que la prueba falle si alguien lo vuelve a dejar en numeros fijos.
//
// P8 tiene min_carga = 2000 en landing_rutas_publicas. El portal nuevo habia perdido esta parte y
// le entraban cargas de $1.000 que el operador tenia que rechazar a mano (verificado en la base el
// 29/9). El resto de las oficinas esta en null y usa el minimo de fabrica.
// PORTAL_A_PROBAR permite apuntar a otra copia: sirve para comprobar que estas pruebas de verdad
// fallan contra el portal sin el arreglo, en vez de confiar en que lo harian.
const PORTAL = fs.readFileSync(process.env.PORTAL_A_PROBAR || path.join(__dirname, '..', 'Portal'), 'utf8');
const NL = String.fromCharCode(10);

function sacar(nombre){
  const i = PORTAL.indexOf(nombre);
  assert.notEqual(i, -1, 'no esta en el Portal: ' + nombre);
  // Desde el nombre hasta la llave que cierra, contando llaves.
  const j = PORTAL.indexOf('{', i);
  let nivel = 0, fin = -1;
  for(let k = j; k < PORTAL.length; k++){
    if(PORTAL[k] === '{') nivel++;
    else if(PORTAL[k] === '}'){ nivel--; if(nivel === 0){ fin = k + 1; break; } }
  }
  assert.notEqual(fin, -1, 'no cierra: ' + nombre);
  // Desde la firma misma. Buscar hacia atras la palabra "function" se traia la funcion ANTERIOR
  // cuando la firma empieza con "async", y el pedazo extraido compilaba igual: la prueba parecia
  // andar midiendo otra cosa.
  return PORTAL.slice(i, fin);
}

// La linea de los minimos de fabrica tambien se saca del Portal: si alguien cambia el 1000 o el
// 5000, la prueba sigue midiendo lo que el portal hace de verdad y no un numero copiado aca.
function sacarLinea(prefijo){
  const linea = PORTAL.split(NL).map(l => l.trim()).find(l => l.startsWith(prefijo));
  assert.ok(linea, 'no esta en el Portal la linea que arranca con: ' + prefijo);
  return linea;
}

function armar(respuesta){
  const llamadas = [];
  const ctx = {
    state: { publicCode: 'rt-xvv80', minCarga: null, minRetiro: null },
    rpc: async (nombre, args) => { llamadas.push({ nombre, args }); return respuesta; },
    JSON, Number
  };
  vm.createContext(ctx);
  vm.runInContext([
    sacarLinea('const MONTO_MIN_CARGA='),
    sacar('function _minCarga()'),
    sacar('function _minRetiro()'),
    sacar('async function cargarMinimos()')
  ].join(NL), ctx);
  return { ctx, llamadas };
}

test('el minimo de la oficina pisa al de fabrica (el caso real de P8)', async () => {
  const { ctx, llamadas } = armar({ data: { ok: true, min_carga: 2000, min_retiro: 5000 } });
  assert.equal(ctx._minCarga(), 1000, 'antes de consultar, el de fabrica');
  await ctx.cargarMinimos();
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].nombre, 'landing_minimos_v1');
  assert.equal(llamadas[0].args.p_public_code, 'rt-xvv80');
  assert.equal(ctx._minCarga(), 2000, 'P8 pide 2000: una carga de 1000 tiene que rebotar');
  assert.equal(ctx._minRetiro(), 5000);
});

test('la RPC puede devolver el json como texto', async () => {
  const { ctx } = armar({ data: JSON.stringify({ ok: true, min_carga: 3000, min_retiro: 8000 }) });
  await ctx.cargarMinimos();
  assert.equal(ctx._minCarga(), 3000);
  assert.equal(ctx._minRetiro(), 8000);
});

test('oficina sin minimo propio: queda el de fabrica, no cero', async () => {
  // Asi estan hoy 13 de las 14 rutas activas: min_carga y min_retiro en null. Si un null se colara
  // como minimo, entrarian cargas de $0.
  const { ctx } = armar({ data: { ok: true, min_carga: null, min_retiro: null } });
  await ctx.cargarMinimos();
  assert.equal(ctx._minCarga(), 1000);
  assert.equal(ctx._minRetiro(), 5000);
});

test('si la consulta falla, el portal no se queda sin minimo', async () => {
  for(const respuesta of [
    { error: { message: 'fetch failed' } },
    { data: { ok: false } },
    { data: null },
    {}
  ]){
    const { ctx } = armar(respuesta);
    await ctx.cargarMinimos();
    assert.equal(ctx._minCarga(), 1000, JSON.stringify(respuesta));
    assert.equal(ctx._minRetiro(), 5000, JSON.stringify(respuesta));
  }
});

test('sin oficina resuelta todavia, no se consulta nada', async () => {
  const { ctx, llamadas } = armar({ data: { ok: true, min_carga: 2000 } });
  ctx.state.publicCode = '';
  await ctx.cargarMinimos();
  assert.equal(llamadas.length, 0, 'sin public_code la RPC devuelve ok:false: no vale gastar el viaje');
  assert.equal(ctx._minCarga(), 1000);
});

test('las pantallas y las validaciones usan el minimo de la oficina, no el fijo', () => {
  // La regresion fue exactamente esto: los textos y los if seguian con MONTO_MIN_CARGA pelado.
  // MONTO_MIN_* solo puede vivir en su declaracion y en el respaldo de cada helper; cualquier otra
  // linea que lo mencione es una pantalla o un if que se saltea el minimo de la oficina.
  const lineas = PORTAL.split(NL).map(l => l.trim()).filter(l => /MONTO_MIN_/.test(l));
  assert.equal(lineas.length, 3, 'MONTO_MIN_* se colo en otra linea: ' + lineas.join(' | '));
  assert.ok(lineas[0].startsWith('const MONTO_MIN_CARGA=1000'), lineas[0]);
  assert.ok(lineas[1].startsWith('function _minCarga()'), lineas[1]);
  assert.ok(lineas[2].startsWith('function _minRetiro()'), lineas[2]);

  assert.ok(PORTAL.includes('mínimo ${_money(_minCarga())}'), 'el texto de Cargar');
  assert.ok(PORTAL.includes('mínimo ${_money(_minRetiro())}'), 'el texto de Retirar');
  assert.ok(PORTAL.includes('if(Number(monto)<_minCarga())'), 'la validacion de carga');
  assert.ok(PORTAL.includes('if(monto<_minRetiro())'), 'la validacion de retiro');
  assert.ok(PORTAL.includes('await cargarMinimos()'), 'se consulta al arrancar');
});

test('la IP se pide al arrancar, no arriba del boton Enviar', () => {
  // _ipPublica() tenia 2,5 s de espera y se llamaba recien al tocar Enviar: el primer envio de cada
  // dispositivo pagaba esa demora justo en el boton que mas importa. Pidiendola en el arranque, al
  // llegar a Enviar ya esta; y si todavia esta en viaje, devuelve null en el acto (no vuelve a
  // esperar) y la solicitud sale igual, con la IP vacia.
  const i = PORTAL.indexOf('await initRoute();');
  assert.notEqual(i, -1);
  const arranque = PORTAL.slice(i, i + 400);
  assert.ok(arranque.includes('_ipPublica();'), 'se dispara en el arranque: ' + arranque.slice(0, 200));
  assert.ok(!arranque.includes('await _ipPublica()'), 'en el arranque NO se espera la IP');
});
