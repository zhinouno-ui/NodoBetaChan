# MAPA — qué toca cada acción del panel

Para qué sirve: cada operación de plata vive en **siete lugares a la vez**. Si una acción actualiza
seis y se olvida del séptimo, nadie se da cuenta hasta que un jugador reclama o no cierra la caja.
Este archivo dice, para cada botón, en qué lugares escribe y con qué motor. Es la lista contra la
cual se revisa: si mañana se agrega un botón, tiene que poder llenar su fila entera.

**La regla**: *mismo desenlace, mismas consecuencias*. Si la operación termina bien, se actualizan
los siete lugares, sin importar qué botón la disparó.

Cómo leer la tabla: `✓` lo toca · `—` no corresponde · `✗` **debería y no lo hace** (hueco, con su
número) · `≈` lo toca por otro camino.

---

## 1. Los siete lugares, y el motor que escribe en cada uno

| # | Lugar | Qué es | Motor (el único que debería escribirlo) | Archivo |
|---|---|---|---|---|
| 1 | **Agentes / Drex** | las fichas del jugador | `callDrex(accion, ...)` → preload de la ventana | `agent-preload.js` · `agent-preload-bet300.js` |
| 2 | **Chunior** | el libro de la plata | `registrarCargaEnChunior` / `registrarRetiroEnChunior` (movimientos de jugador) · `_registrarAdminChunior` (gasto, propina, depósito) | `chunior-verificacion-y-registro.js` · `chunior-movimientos.js` |
| 3 | **`historial_ops`** | nuestro libro | `registrarEnHistorial(op)` | `pendientes-y-registro.js:156` |
| 4 | **`landing_solicitudes`** | lo que ve el jugador | RPC `panel_v15_5_actualizar_solicitud_portal`, con **dos puertas**: `actualizarSolicitudPortal` (reintenta si la red pestañea y refresca la bandeja) y `actualizarSolicitudSupabase` (además puede cambiar el monto) | `requests.js:121` · `api-y-solicitudes.js:63` |
| 5 | **Progreso del retiro** (`metadata.retiro_parcial`) | cuánto se pagó de un retiro y desde qué cuenta | `landing_retiro_registrar_parcial` (vía `notificarRetiroParcialPortal`, que negocia 5 firmas) · `landing_retiro_revertir_parcial` · `landing_retiro_cambiar_billetera_pago` | `withdrawals-execution.js:11` |
| 6 | **Saldo de billeteras** | la plata que nos queda en cada cuenta | `ajustarSaldoBilletera(id, delta)` | `lotes-y-solicitudes.js:264` |
| 7 | **Chat del jugador** | el aviso de que su pedido se resolvió | `notificarUsuarioEnChat` / `avisarJugadorEnChat` | `automatizaciones.js:28` |

Cada RPC del punto 5 tiene **un solo llamador** en todo el panel. Eso es lo que hay que mantener:
el día que dos lugares distintos anoten un pago, se va a contar dos veces.

---

## 2. Qué toca cada acción

### Acciones que crean un movimiento

| Acción (lo que aprieta el operador) | Motor | 1 Drex | 2 Chunior | 3 Historial | 4 Solicitud | 5 Progreso | 6 Saldo bill. | 7 Chat |
|---|---|---|---|---|---|---|---|---|
| **Aprobar carga** (expediente del portal) | `operation-execution.js:203` | ✓ | ✓ | ✓ | ✓ ACREDITADA | — | ✓ | ✗ **H-4** |
| **Aprobar retiro** (paga todo de una) | `operation-execution.js:203` | ✓ | ✓ | ✓ | ✓ PAGADA | — | ✓ | ✗ **H-4** |
| **Pagar retiro por partes / varias billeteras** | `withdrawals-execution.js` | ✓ | ✓ (+ cola si falla) | ✓ una fila por billetera | ✓ | ✓ | ✓ | ✓ |
| **Bono/promo pegado a una carga** | `operation-execution.js:545` | ✓ | ✓ | ✓ | — (la del jugador es la carga) | — | ✓ | ✗ **H-4** |
| **Carga / retiro a mano** (sin solicitud) | `operaciones-manuales.js` | ✓ | ✓ | ✓ | — | — | ✓ | — |
| **▶ Auto** (carga, retiro, clave) | `automatizaciones.js` | ✓ | ✓ | ✓ | ✓ | ✗ **H-2** | ✓ | ✓ |
| **"Cargar"** de la bandeja de respaldo | `lotes-y-solicitudes.js:374` | ✓ | ✗ **H-1** | ✓ | ✓ | — | ✓ | ✓ |
| **"Cerrar retiro"** de la bandeja de respaldo | `lotes-y-solicitudes.js:515` | — (asume fichas ya sacadas) | ✓ | ✓ | ✓ PAGADA | ✗ **H-2** | ✓ | ✓ |
| **Gasto de oficina · propina · depósito sin reclamar** | `chunior-movimientos.js:27` | — | ✓ | ✓ | — | — | ✗ **H-6** | — |
| **Recarga de fichas** | `chunior-movimientos.js:172` | — | ✓ | ✓ | — | — | ✗ **H-6** | — |
| **Alta de usuario · reset de clave** | `alta-usuarios.js` · `automatizaciones.js` | ✓ | — | ✓ | ✓ | — | — | ✓ |
| **Reclamar depósito sin reclamar** | `chunior-movimientos.js:693` | ✓ | ✓ | ✓ | — | — | ≈ (sólo al revertir) | — |

### Acciones que cambian un movimiento que ya existe

| Acción | Motor | 1 Drex | 2 Chunior | 3 Historial | 4 Solicitud | 5 Progreso | 6 Saldo bill. | 7 Chat |
|---|---|---|---|---|---|---|---|---|
| **Reintentar** una operación fallida | `historial-operaciones.js:558` | ✓ | ✓ | ✓ | ✓ *(arreglado, `e967cb6`)* | ✓ usa el motor del portal | ✗ **H-5** | ✗ **H-4** |
| **Deshacer** | `historial-operaciones.js:735` | ✓ | ✓ espejo | ✓ + fila de reversión | ✓ retiro y carga | ✓ | ✓ | ✓ si la carga queda sin pagar |
| **Cambiar la billetera** de un movimiento | `chunior-recuperacion-y-transferencias.js` | — | ✓ | ✓ | ✓ | ✓ corrige el "te transfirió X" | ✓ las dos | — |
| **Cambio de billetera por lote** | `lotes-y-solicitudes.js:57` | — | ✓ | ✓ | ✓ mismo motor | ✓ | ✓ | — |
| **Buscar el N° de Chunior** de una fila | `historial-operaciones.js:17` | — | lee | ✓ | ≈ en memoria | — | — | — |
| **Editar las notas** de una fila | `historial-unificado.js:1176` | — | — | ✓ | — | — | — | — |
| **Cerrar un retiro parcial a mano** | `archivo-historial.js:425` | — | — | ✓ fila con el motivo | ✓ PAGADA + motivo del cierre | ✓ guarda el cierre | — | ✗ **H-4** |
| **Rechazar** una solicitud | `rejections.js` | — | — | ✓ | ✓ RECHAZADA + motivo | — | — | ✓ |
| **Cola de Chunior** (reintento automático) | `chunior-verificacion-y-registro.js` | — | ✓ verifica antes de anotar | ✓ vincula el N° | — (ya la cerró el camino principal) | — | — | — |

---

## 3. Los huecos, en orden de lo que cuesta cada uno

### H-1 · Una carga aprobada por la bandeja de respaldo no entra al libro de Chunior

**Dónde** — `lotes-y-solicitudes.js:374-512` (`abrirAprobarSolicitud`). Pone las fichas en Drex,
escribe nuestro historial, cierra la solicitud, ajusta el saldo y le avisa al jugador. Nunca llama
a `registrarCargaEnChunior`: es el único camino de carga que no lo hace.

**Cuándo se ve** — Esa bandeja se dibuja sólo si el puente del portal **no arrancó**
(`portalBridgeReady` en falso, `vistas-y-billeteras.js:344`). O sea: justo el día que algo falla, el
operador usa el camino que no anota la plata.

**Qué pasa** — La carga existe para el jugador y para nosotros, pero no en Chunior. Al cerrar la
caja falta esa plata y no hay con qué cotejar.

### H-2 · "Cerrar retiro" y el ▶ Auto marcan PAGADA sin pasar por la máquina de parciales

**Dónde** — `lotes-y-solicitudes.js:553` y `automatizaciones.js:593-604`: escriben
`estado:"PAGADA"` derecho, sin `landing_retiro_registrar_parcial`.

**Qué pasa** — Si el retiro ya tenía pagos parciales, el progreso queda en lo viejo y el retiro
figura pagado igual. Ese es exactamente el cuadro de "el parcial quedó colgado" (D-100).

### H-3 · ✅ RESUELTO (20/09) · Deshacer una CARGA que vino de una solicitud dejaba la solicitud acreditada

**Dónde** — `historial-operaciones.js:783`: `if(ok && _sidRev && tipoOriginal==='RETIRO')`. La
condición era sólo para retiros.

**Qué pasa** — Se le sacan las fichas al jugador, vuelve la plata, se anota la reversión… y el
jugador sigue viendo "acreditada". Ojo: el arreglo no es reabrir siempre, porque *deshacer* también
se usa para borrar una carga duplicada — ahí la solicitud sí está bien pagada por la otra fila. El
criterio quedó así: se reabre sólo si, después de la reversión, no queda otra CARGA OK que cubra el
monto de la solicitud (`_solicitudQuedoSinPagar`). Si se reabre, la solicitud vuelve a EN_REVISION
con etapa `CARGA_REVERTIDA_PANEL` y el jugador recibe el aviso, porque el "✅ acreditada" que le
mandamos ya no es cierto.

### H-4 · El jugador no se entera cuando la operación se resuelve desde el expediente

**Dónde** — `operation-execution.js` no tiene ni una llamada a `notificarUsuarioEnChat`. Sí las
tienen la bandeja de respaldo (`lotes-y-solicitudes.js:490`), el retiro por partes
(`withdrawals-execution.js:548`), los automatismos y los rechazos.

**Qué pasa** — Según por dónde entró la misma carga, el jugador recibe el aviso o no. Tampoco avisa
*deshacer* (le dijimos "acreditada" y ya no lo está) ni el cierre manual de un retiro (se cerró
debiéndole plata y nadie se lo dice).

### H-5 · El reintento no ajusta el saldo de la billetera

**Dónde** — `historial-operaciones.js:558-730`: no llama a `ajustarSaldoBilletera`. El intento
original tampoco lo había hecho, porque el ajuste está en su rama de éxito
(`operation-execution.js:435`).

**Qué pasa** — La operación entra, pero la billetera sigue mostrando la plata que ya salió.

### H-6 · Gasto, propina, depósito y recarga no descuentan el saldo local de la billetera

**Dónde** — `chunior-movimientos.js`: `ajustarSaldoBilletera` aparece una sola vez, y es para
*revertir* un depósito (línea 746).

**A definir con Juan** — puede ser a propósito (esa plata no es de la caja del portal). Si lo es,
se anota como decidido y se deja de mirar.

### H-7 · ✅ RESUELTO (20/09) · El loop de BET300

**La causa no estaba en el preload** — `refrescarSaldoAgente` (el widget del saldo, cada 60 s) era el
único lector periódico que NO tomaba `_drexGlobalLock`. La cola de Agentes serializa llamada por
llamada, pero una carga son dos llamadas (buscar el usuario y después cargarle), así que el refresco
se colaba justo en el medio. En BET300 leer las fichas obliga a irse a `tokens-report` y volver: la
pantalla se movía abajo de la operación, el panel lo veía como "la página se recargó durante la
operación", reintentaba, y al minuto volvía a pasar. Ese es el loop corto que reportaron.

**Cómo quedó** — el widget toma el candado y se saltea el refresco si hay algo operando (lo lee al
minuto siguiente). Además, del lado del preload de BET300: una sola puerta para recargar
(`_navegarA`, que no recarga con una operación en curso ni dos veces en 25 s), `obtenerSaldoAgente`
no se mueve de pantalla si hay un modal de trabajo abierto, y **todo error ahora dice dónde quedó
parada la ventana** (`_resumenPantalla`), que era lo que faltaba para poder arreglarlo a distancia.

### Por revisar (todavía sin evidencia)

- **El casino rechaza el retiro después de "Aplicar"**. El camino del retiro por partes está bien
  cubierto: un `ok:false` del preload es siempre *antes* de tocar Aplicar y ahí no se mueve nada
  (`withdrawals-execution.js:220-233`). Lo que falta mirar es qué pasa si el preload devuelve
  `ok:true` y la página igual no confirmó.

---

## 4. Ya enganchado (no hace falta volver a revisarlo)

| Qué | Cómo quedó | Prueba que lo cuida |
|---|---|---|
| Reintento → solicitud | Cierra la solicitud con los mismos motores que Aprobar; en retiros deja que la máquina de parciales decida el estado, y verifica que el pago no esté ya anotado | `reintento · una CARGA que sale bien…`, `· un RETIRO anota el pago con el motor del portal`, `· si el pago YA estaba anotado` |
| Deshacer → progreso del retiro | El pago vuelve a quedar pendiente, marcado como revertido (no se borra) | `deshacer · un pago de retiro por partes vuelve a quedar pendiente` |
| Cambio de billetera → lo que ve el jugador | Un solo motor para los tres caminos (ficha, historial y lote) | `cambio de billetera · corrige el "te transfirio X"` |
| Cola de Chunior | Verifica en la lista real antes de anotar; si no pudo ver, no anota a ciegas | `chunior · si la anotacion YA entro…`, `· si la lista no carga, NO anota a ciegas` |
| Anotación en Chunior (gasto/propina/depósito) | El script inyectado se arma derecho (`_readyChuniorJs`) | prueba que **ejecuta** el depósito contra una pantalla simulada |
| Deshacer una carga → solicitud | Se reabre sólo si no quedó otra carga que la cubra; si se reabre, se le avisa al jugador | `deshacer carga · el criterio distingue…`, `· si queda sin pagar…` |
| El widget del saldo → operaciones | Toma el candado global; se saltea el refresco si hay algo operando | `saldo del agente · no lee las fichas con una operacion en curso` |
| Tarjeta de cotejo | Sugiere sólo lo que tiene respaldo (mismo teléfono), y deja crear la cuenta ahí mismo | `cotejo · un alias corto no dispara cuatro sugerencias`, `· si la cuenta parecida tiene el telefono` |

---

## 5. Cómo volver a armar este mapa en dos minutos

Si se agrega un botón, esto dice dónde escribe cada cosa. Si una columna queda vacía, es un hueco.

```bash
grep -rn --include=*.js "registrarEnHistorial("        renderer/ | grep -v generated   # 3 historial
grep -rn --include=*.js "actualizarSolicitud"          renderer/ | grep -v generated   # 4 solicitud
grep -rn --include=*.js "landing_retiro_"              renderer/ | grep -v generated   # 5 progreso
grep -rn --include=*.js "ajustarSaldoBilletera("       renderer/ | grep -v generated   # 6 saldo
grep -rn --include=*.js "notificarUsuarioEnChat(\|avisarJugadorEnChat(" renderer/ | grep -v generated   # 7 chat
grep -rn --include=*.js "registrarCargaEnChunior(\|registrarRetiroEnChunior(\|_registrarAdminChunior(" renderer/ | grep -v generated   # 2 Chunior
grep -rn --include=*.js -E "callDrex\('|callDrex\(\"" renderer/ | grep -v generated   # 1 Drex
```
