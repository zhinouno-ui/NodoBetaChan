'use strict';
const { whenWindowReady } = require('./window-ready');
const { taparCarteles } = require('./carteles');
const { vigilarPreload } = require('./preload-listo');

function createVerificationService({ BrowserWindow, icon, partition, backends, requests }) {
  let verifyWindow = null;
  let verifyPreload = null;   // el saludo del preload · ver main/preload-listo.js
  function createVerifyWindow() {
    verifyWindow = new BrowserWindow({
      width:  1200,
      height: 800,
      title:  'Verificación — Login usuarios',
      icon:   icon,
      show:   false,
      webPreferences: {
        preload:          backends.current.preload,
        partition:        partition, // misma sesión que Agentes (comparte login + proxy)
        contextIsolation: true,
        nodeIntegration:  false,
        sandbox:          true,
      }
    });
    // Mismo backoffice, mismos carteles encima (ver main/carteles.js).
    taparCarteles(verifyWindow);
    // Mismo agujero que en la ventana de Agentes: sin el saludo, la orden se manda al vacio.
    verifyPreload = vigilarPreload(verifyWindow);
    verifyWindow.loadURL(backends.current.url);
    verifyWindow.on('closed', () => { verifyWindow = null; requests.rejectAll(new Error('La ventana de verificación se cerró.')); });
    return verifyWindow;
  }

  function getVerifyWindow() {
    if (verifyWindow && !verifyWindow.isDestroyed()) return verifyWindow;
    return createVerifyWindow();
  }

  async function sendVerification(usuario) {
    const win = getVerifyWindow();
    const currentUrl = win.webContents.getURL();
    if (!currentUrl.includes('user_search')) {
      win.loadURL(backends.current.url);
      await whenWindowReady(win, 12000);
      await new Promise(r => setTimeout(r, 900));
    } else {
      await whenWindowReady(win, 12000);
    }
    // Que la pagina haya cargado no significa que el preload ya escuche: sin esperar su saludo,
    // la orden se manda al vacio y la verificacion muere en su timeout.
    if (verifyPreload) await verifyPreload.esperar();
    // Puede haberse cerrado mientras esperabamos el saludo (p.ej. un cambio de backend).
    if (!win || win.isDestroyed()) throw new Error('La ventana de verificación se cerró.');
    return requests.run(win.webContents, 'drex:verify:run', { method: 'buscarUsuario', args: [usuario] }, 30000, 'Timeout en verificación.', 'v-');
  }
  function close() { if (verifyWindow && !verifyWindow.isDestroyed()) verifyWindow.destroy(); verifyWindow = null; }

  return { send: sendVerification, close };
}

module.exports = { createVerificationService };
