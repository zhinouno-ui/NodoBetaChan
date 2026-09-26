'use strict';
// Carteles promocionales del backoffice (torneos, promos).
//
// Aparecen ENCIMA de todo, se comen los clicks y frenan al operador y a la automatización detrás de
// una publicidad. Cerrarlos a mano desde el preload llega tarde: para cuando se los ve, ya taparon
// la pantalla. Con CSS no llegan a pintarse.
//
// Es por SELECTOR y no por "escondé todos los diálogos": los modales de trabajo (carga, retiro) son
// .v-dialog igual que estos, y esconderlos rompería las operaciones. Por eso los que apuntan a un
// diálogo van con :has(), o sea "sólo si tiene el cartel adentro".
//
// Contra de pelearle al HTML de otro: si el backoffice cambia el maquetado, esto deja de agarrar y
// hay que sumar el selector nuevo. Por eso el preload SIGUE cerrándolos a mano como respaldo — y
// además así Vuetify limpia su propio estado (el bloqueo de scroll).
//
// Vive acá, en un solo lugar, porque lo usan las DOS ventanas que abren el backoffice: la de
// Agentes y la de verificación. Duplicarlo es como quedaron desincronizados los dos preloads (H-7).
const CSS_SIN_CARTELES = [
  '[class*="tournament-popup"],',
  'img[src*="/images/tournaments/"],',
  '.v-overlay:has([class*="tournament-popup"]),',
  '.v-overlay:has(img[src*="/images/tournaments/"]),',
  '.v-dialog:has(img[src*="/images/tournaments/"])',
  '{ display: none !important; }'
].join(' ');

// El CSS se pierde en cada navegación, así que se vuelve a poner. Un backoffice que es una SPA
// cambia de ruta sin recargar: por eso también va en did-navigate-in-page.
function taparCarteles(win) {
  try {
    const wc = win && win.webContents;
    if (!wc) return () => {};
    const poner = () => { try { wc.insertCSS(CSS_SIN_CARTELES); } catch (_e) {} };
    wc.on('dom-ready', poner);
    wc.on('did-navigate', poner);
    wc.on('did-navigate-in-page', poner);
    return poner;
  } catch (_e) { return () => {}; }
}

module.exports = { CSS_SIN_CARTELES, taparCarteles };
