// El jugador veía "*clave*" en el Portal y no sabía si los asteriscos eran parte de la clave (18/11).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
test('NODO manda la clave nueva sin asteriscos', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'core', 'automatizaciones.js'), 'utf8');
  assert.ok(src.includes('Nueva clave: ${claveFinal}'), 'la clave va pelada, sin nada alrededor');
  assert.doesNotMatch(src, /\*\$\{claveFinal\}\*/);
});
test('el aviso del proxy dice la verdad: va sólo a Agentes', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'core', 'chunior-sesion-y-billeteras.js'), 'utf8');
  assert.match(src, /Proxy de oficina aplicado a Agentes/);
  assert.doesNotMatch(src, /aplicado a Chunior y Agentes/);
});
