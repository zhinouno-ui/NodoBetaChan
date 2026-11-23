/* ══════════════════════════════════════════════════════════════════════════════════════════
   COTEJO DE CARGAS Y RETIROS · Agentes ↔ NODO ↔ Chunior (Juan, 18/11)
   Los retiros van igual que las cargas (Juan: "fijate también los retiros"): en Agentes son el mismo
   "Deposito de un jugador" pero con signo menos; en NODO, filas RETIRO; en Chunior, el monto en negativo.
   Una carga nunca se ata con un retiro, aunque sean del mismo usuario y por el mismo monto.
   Cada tanto (y cuando el operador aprieta Recargar en el historial) NODO lee las cargas que
   figuran en Agentes ("Reporte de carga y descarga"), las compara con su historial y con Chunior
   y deja todo atado. Criterio de Juan: simple — mismo usuario, mismo monto, mismo horario. Los
   movimientos de Agentes no tienen id: la fecha con segundos es su identidad, y queda escrita en
   las notas de la fila ("Agentes 18/11/2026 13:33:38") para no usarla dos veces.

     Agentes sí · NODO no · Chunior no  → se anota en Chunior (billetera en uso), se dibuja en el
                                          historial (con su Deshacer) y se avisa: "esta carga no se
                                          hizo desde NODO ni estaba anotada, avisale a tu superior".
                                          El operador la reconoce con una casilla.
     Agentes sí · NODO no · Chunior sí  → NODO la enlaza y la dibuja en el historial. Nada más.
     Agentes sí · NODO sí · Chunior no  → se sube a Chunior.
     NODO/Chunior sí · Agentes no       → se avisa: está anotada pero la carga no aparece en Agentes.

   Ante la duda no se toca nada: dos cargas iguales que podrían ser cualquiera de las dos, una
   lectura incompleta, una operación en curso → se deja para la próxima vuelta.
   ══════════════════════════════════════════════════════════════════════════════════════════ */
(function(){
  "use strict";

  var VENTANA_NODO_MS    = 3 * 60000;      // Agentes ↔ NODO: la misma carga, a menos de 3 minutos
  var VENTANA_CHUNIOR_MS = 15 * 60000;     // Chunior se anota a mano y puede ir unos minutos después
  var MIRAR_ATRAS_MS     = 6 * 3600000;    // nunca más atrás que esto
  // Cada vuelta mira sólo desde la anterior (con un margen), no las últimas 6 horas: en una oficina con
  // movimiento (P4, 21/11) leer 6 horas eran 15 páginas de Agentes cada 10 minutos, con Agentes ocupado.
  var PRIMERA_VEZ_MS     = 60 * 60000;     // la primera vuelta del día mira la última hora
  var MARGEN_MS          = 15 * 60000;     // y cada vuelta repite los últimos 15 minutos de la anterior
  var CLAVE_HASTA        = "nodoCotejoCargasHasta";
  // Ancla (Juan, 23/11: "si ya sabés que estaban en la página 5, no te sirve revisar antes de las 12 ni después de
  // esa página"): el movimiento más nuevo de Agentes que ya quedó revisado. Cada vuelta lee de lo más nuevo hacia
  // atrás SÓLO hasta el ancla (menos un minuto, por si las páginas se corrieron mientras se leía). Medido en P4 el
  // 23/11: una página son 20 movimientos, ~1,9 s, y en hora pico cubre 11 a 15 minutos; 400 de 400 movimientos
  // engancharon con su carga de NODO, a 0-2 segundos. Leer más de unas pocas páginas no tiene sentido: si el ancla
  // no aparece en TOPE_PAGINAS, se para ahí y lo que quedó en el medio se busca por jugador con el filtro.
  var CLAVE_ANCLA        = "nodoCotejoAncla";
  var ANCLA_MARGEN_MS    = 60 * 1000;
  var TOPE_PAGINAS       = 4;
  var CLAVE_PENDIENTES   = "nodoCotejoPendientes";
  var TOPE_FILAS_NODO    = 1500;           // si NODO trae más que esto, la lectura no es completa: no se decide
  var TOPE_SIN_AGENTES   = 3;              // más de esto en una vuelta = algo anda mal (relojes, lectura): no se marca
  var GRACIA_SIN_AGENTES = 15 * 60000;     // una fila de NODO más nueva que esto todavía no se juzga (era 10; 2.1.10, 21/11)
  var DUDA_MS            = 60 * 60000;     // una fila igual suelta a menos de una hora: no se decide
  var CADA_CUANTO_MS     = 10 * 60000;
  var MARCA_FUERA        = "fuera de NODO";
  // La marca cambió el 21/11: "sin carga en Agentes" la ponía la 2.1.9 de a montones y sin confirmar (P4). Desde
  // ahora la marca confirmada (buscando al jugador) es otra; la vieja no se muestra ni se vuelve a juzgar, y el
  // servidor deja de aceptarla (servidor/cotejo-sin-filas-repetidas.sql).
  var MARCA_SIN_AGENTES  = "no aparece en Agentes";
  var MARCA_SIN_AGENTES_VIEJA = "sin carga en Agentes";
  var MARCA_RECONOCIDA   = "reconocida por";
  var MARCA_CHUNIOR      = "no estaba en NODO";               // la pone la pasada por Chunior (cotejo-chunior.js)

  function _norm(u){ return String(u || "").trim().toLowerCase(); }
  function _monto(n){ return Math.round(Math.abs(Number(n) || 0)); }
  function _etiqueta(mov){ return "Agentes " + mov.fecha; }
  function _ms(h){ return Date.parse(h && h.created_at); }
  // CARGA / RETIRO de un movimiento de Agentes (null = no es con un jugador, o no terminó).
  function _tipoMov(m){
    if(!m || !/DONE/i.test(m.estado || "") || !Number.isFinite(m.ms) || !Number(m.cantidad)) return null;
    if(/retiro de un jugador/i.test(m.tipo || "")) return "RETIRO";
    if(!/dep[oó]sito de un jugador/i.test(m.tipo || "")) return null;
    return Number(m.cantidad) > 0 ? "CARGA" : "RETIRO";
  }
  function _tipoFila(h){ return String((h && h.tipo) || "CARGA").toUpperCase(); }
  // Mismo usuario, mismo monto y misma clase de operación.
  function _igual(m, h){ return _norm(h.usuario) === _norm(m.alias) && _monto(h.monto) === _monto(m.cantidad) && _tipoFila(h) === m._tipo; }

  // ── Núcleo (sin pantalla ni red): empareja Agentes con el historial de NODO ────────────────
  // movs:  [{ fecha, ms, tipo, estado, cantidad, alias }] tal cual los devuelve leerMovimientosCredito.
  // filas: historial_ops (CARGA, OK) de la oficina, desde antes del primer movimiento.
  // Devuelve { pares:[{ mov, fila|null, caso }], sobrantes:[fila] }.
  //   caso: "enlazada" (fila con Chunior) · "nodo_sin_chunior" · "sin_nodo" · "ambiguo"
  function emparejar(movs, filas, opts){
    opts = opts || {};
    var ahora = Number(opts.ahora) || Date.now();
    var cargas = (movs || []).filter(function(m){ m._tipo = _tipoMov(m); return !!m._tipo; });
    var libres = (filas || []).filter(function(h){ return h && String(h.estado || "OK") === "OK"; }).slice();
    var usadas = {};
    var pares = [];
    // 1) Las filas que ya llevan la fecha del movimiento en las notas: esas son, sin discusión.
    cargas.forEach(function(m){
      var et = _etiqueta(m);
      var f = libres.find(function(h){ return !usadas[h.id] && String(h.notas || "").indexOf(et) >= 0 && _igual(m, h); });
      if(f){ usadas[f.id] = true; m._fila = f; }
    });
    // 2) El resto, por usuario + monto + horario. Si hay más de una candidata, no se elige.
    cargas.forEach(function(m){
      if(m._fila) return;
      var cand = libres.filter(function(h){
        return !usadas[h.id] && !/Agentes \d{2}\/\d{2}\/\d{4}/.test(String(h.notas || ""))
          && _igual(m, h) && Math.abs(_ms(h) - m.ms) <= VENTANA_NODO_MS;
      });
      if(cand.length > 1){ m._ambiguo = cand; return; }
      if(cand.length === 1){ usadas[cand[0].id] = true; m._fila = cand[0]; }
    });
    // Reloj corrido: si el reloj de Agentes y el de la PC difieren más que la ventana, la misma carga
    // quedaría como "sin NODO" y como "sin Agentes" a la vez, y se anotaría dos veces en Chunior. Por eso,
    // si queda suelta una fila igual (usuario y monto) a menos de una hora, no se decide nada.
    var parecida = function(m, h){ return _igual(m, h) && Math.abs(_ms(h) - m.ms) <= DUDA_MS; };
    cargas.forEach(function(m){
      if(m._fila || m._ambiguo) return;
      var sueltas = libres.filter(function(h){ return !usadas[h.id] && parecida(m, h); });
      if(sueltas.length){ m._ambiguo = sueltas; sueltas.forEach(function(h){ h._enDuda = true; }); }
    });
    cargas.forEach(function(m){
      var f = m._fila || null, caso;
      if(m._ambiguo) caso = "ambiguo";
      else if(!f) caso = "sin_nodo";
      else caso = f.chunior_movimiento_id ? "enlazada" : "nodo_sin_chunior";
      pares.push({ mov: m, tipo: m._tipo, fila: f, caso: caso, candidatas: m._ambiguo || null });
      delete m._fila; delete m._ambiguo;
    });
    // 3) Filas de NODO sin carga en Agentes: sólo si la lectura cubre su horario y ya pasó la gracia.
    var desdeLeido = Number(opts.desdeLeidoMs);
    // "Cubre" es por los dos lados (de la 2.1.10): desde lo más viejo leído HASTA lo más nuevo leído.
    var conTecho = Object.prototype.hasOwnProperty.call(opts, "hastaLeidoMs");
    var hastaLeido = Number(opts.hastaLeidoMs);
    var cubre = Number.isFinite(desdeLeido) && (!conTecho || Number.isFinite(hastaLeido));
    var sobrantes = cubre ? libres.filter(function(h){
      var t = _ms(h);
      return !usadas[h.id] && !h._enDuda && Number.isFinite(t) && t >= desdeLeido && (!conTecho || t <= hastaLeido) && (ahora - t) >= GRACIA_SIN_AGENTES
        && String(h.notas || "").indexOf(MARCA_SIN_AGENTES) < 0 && String(h.notas || "").indexOf(MARCA_SIN_AGENTES_VIEJA) < 0
        && (opts.esNuestra ? opts.esNuestra(h) : true);
    }) : [];
    return { pares: pares, sobrantes: sobrantes };
  }

  // ── Lo que hace con cada caso ────────────────────────────────────────────────────────────
  var CORRIENDO = false, ULTIMA = 0;
  function _colaOcupada(){
    var c = window._drexCola;
    return !!(c && (c.activo || c.pendientes > 0));
  }
  function _ocupado(){
    if(_colaOcupada()) return true;
    if(window._v154pPortalJobActivo) return true;                        // registrarEnHistorial lo usaría
    try{ if(typeof _watchdog !== "undefined" && _watchdog && _watchdog.busy > 0) return true; }catch(_e){}
    return false;
  }
  function _pc(){ try{ return (typeof pcOperativa !== "undefined" ? pcOperativa : "") || window.pcOperativa || ""; }catch(_e){ return ""; } }
  function _operador(){
    try{ var o = window.operador || (typeof operador !== "undefined" ? operador : null); return (o && (o.usuario || o.nombre)) || "NODO"; }
    catch(_e){ return "NODO"; }
  }
  function _toast(t, c){ try{ if(window.toast) window.toast(t, c); }catch(_e){} }
  function _signo(tipo){ return tipo === "RETIRO" ? -1 : 1; }
  function _verificarChunior(usuario, monto, tipo, tMs, filas){
    return _chu(function(){ return verificarMovimientoEnChunior(usuario, monto, tMs, VENTANA_CHUNIOR_MS, _yaLigadosChunior(filas), _signo(tipo)); });
  }
  function _anotarEnChunior(uid, monto, usuario, tipo){
    return tipo === "RETIRO" ? registrarRetiroEnChunior(uid, monto, usuario) : registrarCargaEnChunior(uid, monto, usuario);
  }
  function _chu(fn){
    try{ if(typeof _chuSerializar === "function") return _chuSerializar(fn); }catch(_e){}
    return fn();
  }

  // Estado del sistema: estas lecturas no pasan por callDrex, así que se anotan acá (Agentes · Leer movimientos).
  function _conSalud(args, fn){
    return async function(){
      var r, e;
      try{ r = await fn(); return r; }catch(x){ e = x; throw x; }
      finally{ try{ if(window.NodoSalud && window.NodoSalud.agentes) window.NodoSalud.agentes("leerMovimientosCredito", r, e, [args]); }catch(_e){} }
    };
  }
  // Las revisiones de fondo también tienen su fila: qué miró la última que anduvo y, si falló, por qué.
  // "Ocupado", "recién revisado" o "arrancando" no son fallas: esa vuelta no se hizo.
  var NO_ES_FALLA = /ya est[aá] corriendo|operaci[oó]n en curso|arrancando|reci[eé]n revisado|sin NODO|sin Chunior|trabajando/i;
  function _saludRevision(nombre, r, prueba){
    try{
      if(!r || !window.NodoSalud || !window.NodoSalud.accion) return;
      if(r.ok === false && NO_ES_FALLA.test(r.motivo || "")) return;
      var ok = r.ok !== false && !(r.resumen && r.resumen.fallas && r.resumen.fallas.length);
      var motivo = r.ok === false ? (r.motivo || "no se pudo revisar") : ok ? "" : "no pudo leer " + r.resumen.fallas.join(", ");
      window.NodoSalud.accion("Revisiones", nombre, ok, { motivo: motivo, prueba: ok ? prueba(r) : "" });
    }catch(_e){}
  }
  async function _leerAgentes(desdeMs, maxPaginas){
    var args = { desdeMs: desdeMs, maxPaginas: maxPaginas || TOPE_PAGINAS };
    var llamar = _conSalud(args, function(){ return window.ctrlElectron.drexAutomation("leerMovimientosCredito", args); });
    if(typeof window._drexEncolar === "function") return window._drexEncolar("leerMovimientosCredito", llamar, { silencioso: true });
    return llamar();
  }
  // Todas las filas de NODO del período, de la más nueva a la más vieja. Antes: de la más vieja, con tope de 400:
  // en P4 (21/11) las de la última hora quedaban afuera, NODO no las encontraba, creaba una fila COTEJO repetida
  // por cada carga y después marcaba la carga de verdad como "sin carga en Agentes". Si se llega al tope, la
  // lectura no es completa y no se decide nada.
  async function _leerNodo(desdeMs){
    var r = await supabaseClient.from("historial_ops")
      .select("id,created_at,usuario,monto,tipo,estado,origen,notas,solicitud_id,chunior_movimiento_id,billetera_id")
      .in("tipo", ["CARGA", "RETIRO"]).eq("pc_codigo", _pc())
      .gte("created_at", new Date(desdeMs).toISOString())
      .order("created_at", { ascending: false }).limit(TOPE_FILAS_NODO);
    if(r.error) throw r.error;
    var filas = r.data || [];
    if(filas.length >= TOPE_FILAS_NODO) throw new Error("demasiados movimientos en NODO para cotejar de una vez");
    return filas.reverse();
  }
  // ¿Ese N° de Chunior ya es de alguna fila de NODO (de cualquier PC)? Si lo es, NODO hizo esa operación y el
  // cotejo no la emparejó: no se crea otra fila. Es la red de seguridad contra filas repetidas.
  async function _chuniorYaEnNodo(id){
    if(!id) return false;
    var r = await supabaseClient.from("historial_ops").select("id").eq("chunior_movimiento_id", String(id)).limit(1);
    if(r.error) throw r.error;
    return !!(r.data && r.data.length);
  }
  // ¿Ese movimiento de NODO está en Agentes? Busca al jugador con el filtro del informe. true = confirmado que NO
  // está; false = está (o hay uno igual cerca); null = no se puede afirmar (sin filtro, lectura cortada, error).
  async function _confirmarSinAgentes(h){
    var args = { alias: h.usuario, filtrarAlias: true, desdeMs: _ms(h) - DUDA_MS, maxPaginas: 3 };
    var llamar = _conSalud(args, function(){ return window.ctrlElectron.drexAutomation("leerMovimientosCredito", args); });
    var r = (typeof window._drexEncolar === "function")
      ? await window._drexEncolar("leerMovimientosCredito", llamar, { silencioso: true }) : await llamar();
    if(!r || !r.ok || r.filtradoPorAlias !== true) return null;
    var tipo = _tipoFila(h), t = _ms(h);
    // Está: se devuelve el movimiento (el más cercano en hora) para engancharlo con la carga.
    var esta = (r.filas || []).filter(function(m){
      return _tipoMov(m) === tipo && _monto(m.cantidad) === _monto(h.monto) && Math.abs(m.ms - t) <= DUDA_MS;
    }).sort(function(a, b){ return Math.abs(a.ms - t) - Math.abs(b.ms - t); })[0];
    if(esta) return { mov: esta };
    return r.completo ? true : null;
  }
  function _anclaGuardada(){
    try{ var a = JSON.parse(localStorage.getItem(CLAVE_ANCLA) || "null"); return a && Number.isFinite(a.ms) && a.pc === _pc() ? a : null; }catch(_e){ return null; }
  }
  function _guardarAncla(m){
    try{ localStorage.setItem(CLAVE_ANCLA, JSON.stringify({ ms: m.ms, fecha: m.fecha, alias: m.alias, cantidad: m.cantidad, pc: _pc() })); }catch(_e){}
  }
  // Filas de NODO que quedaron entre el ancla vieja y lo que se alcanzó a leer: se verifican por jugador, de a poco.
  function _pendientes(){ try{ var p = JSON.parse(localStorage.getItem(CLAVE_PENDIENTES) || "[]"); return Array.isArray(p) ? p : []; }catch(_e){ return []; } }
  function _guardarPendientes(ids){ try{ localStorage.setItem(CLAVE_PENDIENTES, JSON.stringify(ids.slice(-200))); }catch(_e){} }
  function _hastaGuardado(){ try{ return Number(localStorage.getItem(CLAVE_HASTA)) || 0; }catch(_e){ return 0; } }
  async function _anotarNotas(fila, extra){
    var notas = (fila.notas ? fila.notas + " · " : "") + extra;
    var r = await supabaseClient.from("historial_ops").update({ notas: notas }).eq("id", fila.id).select("id");
    return !(r && r.error);
  }
  var MEMO_KEY = "nodoCotejoCargasDudas";
  function _memo(){ try{ return JSON.parse(localStorage.getItem(MEMO_KEY) || "{}") || {}; }catch(_e){ return {}; } }
  function _clave(mov){ return _norm(mov.alias) + "|" + _monto(mov.cantidad) + "|" + mov.fecha; }
  function _enDudaReciente(mov){ var t = _memo()[_clave(mov)]; return !!t && Date.now() - t < 3600000; }
  function _anotarDuda(mov){
    try{ var m = _memo(), ahora = Date.now(); m[_clave(mov)] = ahora;
      Object.keys(m).forEach(function(k){ if(ahora - m[k] > 86400000) delete m[k]; });
      localStorage.setItem(MEMO_KEY, JSON.stringify(m)); }catch(_e){}
  }
  function _yaLigadosChunior(filas){
    return (filas || []).map(function(h){ return h.chunior_movimiento_id; }).filter(Boolean).map(String);
  }

  async function _sinNodo(mov, tipo, filas, resumen){
    var usuario = mov.alias, monto = _monto(mov.cantidad);
    var v = await _verificarChunior(usuario, monto, tipo, mov.ms, filas);
    if(!v || v.ok === false){ resumen.dudas++; return; }                  // "no pude mirar" no es "no está"
    if(v.vinculadoAOtro){ resumen.dudas++; return; }                       // hay una, pero ya es de otra fila
    var cuando = new Date(mov.ms).toISOString();
    if((v.existe || v.encontrado) && await _chuniorYaEnNodo(v.movimientoId)){ resumen.dudas++; return; }
    if(v.existe || v.encontrado){
      // Agentes + Chunior: se enlaza y se dibuja. No hace falta avisar a nadie.
      await registrarEnHistorial({ usuario: usuario, tipo: tipo, monto: monto, origen: "COTEJO", estado: "OK",
        chunior_movimiento_id: v.movimientoId ? String(v.movimientoId) : null, created_at: cuando,
        notas: (tipo === "RETIRO" ? "Hecho directo en Agentes, ya anotado en Chunior · " : "Hecha directo en Agentes, ya anotada en Chunior · ") + _etiqueta(mov) });
      resumen.enlazadas++;
      return;
    }
    // Ni en NODO ni en Chunior: se anota en la billetera en uso y se avisa.
    var bil = (typeof getBilleraLanding === "function") ? getBilleraLanding() : null;
    var movChu = null, nota;
    if(bil && bil.CHUNIOR_UID){
      var r = await _anotarEnChunior(bil.CHUNIOR_UID, monto, usuario, tipo);
      if(r && r.ok && r.movimientoId) movChu = String(r.movimientoId);
    }
    nota = MARCA_FUERA + ": no se hizo desde NODO ni estaba anotada · "
      + (movChu ? "NODO la anotó en Chunior (" + (bil.NOMBRE_VISIBLE || "billetera en uso") + ")" : "NO se pudo anotar en Chunior")
      + " · " + _etiqueta(mov);
    await registrarEnHistorial({ usuario: usuario, tipo: tipo, monto: monto, origen: "COTEJO", estado: "OK",
      billetera_id: bil ? bil.ID_BILLETERA : null, billetera_nombre: bil ? bil.NOMBRE_VISIBLE : null,
      chunior_movimiento_id: movChu, created_at: cuando, notas: nota });
    resumen.fuera++;
  }

  async function _nodoSinChunior(mov, tipo, fila, filas, resumen){
    var usuario = fila.usuario || mov.alias, monto = _monto(fila.monto);
    // La billetera de esa carga: si no usa Chunior, no hay nada que subir (y no se le mueve la ventana).
    var bil = (typeof billeteras !== "undefined" && fila.billetera_id)
      ? (billeteras || []).find(function(b){ return String(b.ID_BILLETERA) === String(fila.billetera_id); }) : null;
    if(!bil) bil = (typeof getBilleraLanding === "function") ? getBilleraLanding() : null;
    if(!bil || !bil.CHUNIOR_UID) return;
    // Si NODO todavía tiene esa anotación en su cola de reintentos, es de ella: no se duplica.
    try{
      var pend = (typeof _chuPendAll === "function") ? _chuPendAll() : [];
      if(pend.some(function(p){ return _norm(p.usuario) === _norm(usuario) && _monto(p.monto) === monto; })){ resumen.dudas++; return; }
    }catch(_e){}
    var v = await _verificarChunior(usuario, monto, tipo, _ms(fila), filas);
    if(!v || v.ok === false || v.vinculadoAOtro){ resumen.dudas++; return; }
    if(v.existe || v.encontrado){
      await supabaseClient.from("historial_ops").update({ chunior_movimiento_id: String(v.movimientoId) }).eq("id", fila.id);
      resumen.enlazadas++;
      return;
    }
    var r = await _anotarEnChunior(bil.CHUNIOR_UID, monto, usuario, tipo);
    if(r && r.ok && r.movimientoId){
      await supabaseClient.from("historial_ops").update({ chunior_movimiento_id: String(r.movimientoId) }).eq("id", fila.id);
      resumen.subidas++;
    }else resumen.dudas++;
  }

  // Una vuelta completa. motivo: "recargar" | "reloj" | "manual"
  async function revisar(motivo){
    if(CORRIENDO) return { ok: false, motivo: "ya está corriendo" };
    if(!window.ctrlElectron || typeof supabaseClient === "undefined" || !_pc()) return { ok: false, motivo: "sin NODO" };
    // Antes de elegir el puesto (o con Agentes/historial sin arrancar) no se pide nada a nadie.
    if(window.nodoArranqueHabilitado && (!window.nodoArranqueHabilitado("agentes") || !window.nodoArranqueHabilitado("historial")))
      return { ok: false, motivo: "NODO todavía está arrancando" };
    if(_ocupado()) return { ok: false, motivo: "hay una operación en curso" };
    if(motivo === "recargar" && Date.now() - ULTIMA < 60000) return { ok: false, motivo: "recién revisado" };
    CORRIENDO = true; ULTIMA = Date.now();
    var resumen = { enlazadas: 0, subidas: 0, fuera: 0, sinAgentes: 0, dudas: 0, leidas: 0 };
    try{
      var empezo = Date.now(), ancla = _anclaGuardada(), hasta = _hastaGuardado();
      var desde = ancla ? ancla.ms - ANCLA_MARGEN_MS : (hasta ? hasta - MARGEN_MS : empezo - PRIMERA_VEZ_MS);
      desde = Math.max(empezo - MIRAR_ATRAS_MS, desde);
      var t0 = Date.now();
      var lectura = await _leerAgentes(desde, TOPE_PAGINAS);
      resumen.segundosAgentes = Math.round((Date.now() - t0) / 100) / 10;
      if(!lectura || !lectura.ok) return { ok: false, motivo: (lectura && lectura.message) || "no se pudo leer Agentes" };
      // Las páginas se corren mientras se lee (entran movimientos nuevos arriba): el mismo movimiento puede venir
      // dos veces, al final de una página y al principio de la siguiente. Se cuenta una vez.
      var vistosMov = {};
      var movs = (lectura.filas || []).filter(function(m){
        var k = m.fecha + "|" + _norm(m.alias) + "|" + m.cantidad + "|" + (m.tipo || "");
        if(vistosMov[k]) return false; vistosMov[k] = true; return true;
      });
      resumen.leidas = movs.length; resumen.paginas = lectura.paginas || 0;
      var masViejo = movs.reduce(function(a, m){ return Math.min(a, m.ms); }, Infinity);
      var masNuevo = movs.reduce(function(a, m){ return Math.max(a, m.ms); }, -Infinity);
      // Llegó al ancla: lo leído cubre todo desde la vuelta anterior. Si no (más de TOPE_PAGINAS de movimientos
      // nuevos), se juzga sólo lo que cae en lo leído y el hueco queda para buscarlo por jugador.
      var cubreDesde = lectura.completo ? desde : (Number.isFinite(masViejo) ? masViejo : NaN);
      // NODO desde un poco antes: la fila puede ir unos segundos antes que el movimiento.
      var filas = await _leerNodo(desde - VENTANA_NODO_MS);
      if(!lectura.completo && Number.isFinite(masViejo)){
        var hueco = filas.filter(function(h){ var t = _ms(h); return t >= desde && t < masViejo && String(h.notas || "").indexOf("Agentes ") < 0; })
          .map(function(h){ return h.id; });
        if(hueco.length) _guardarPendientes(_pendientes().concat(hueco.filter(function(id){ return _pendientes().indexOf(id) < 0; })));
      }
      var r = emparejar(movs, filas, { desdeLeidoMs: cubreDesde,
        // Techo (de la 2.1.10): lo más nuevo que lo leído no se juzga, todavía no figura en el informe.
        hastaLeidoMs: Number.isFinite(masNuevo) ? masNuevo : NaN,
        // Los bonos (PROMO_BONO) no figuran como "Depósito de un jugador" en Agentes: no se cotejan (de la 2.1.10).
        esNuestra: function(h){ var o = String(h.origen || ""); return o !== "COTEJO" && o !== "PROMO_BONO"; } });
      // Enganche (Juan, 23/11: "el movimiento en agentes se debe de enlazar directamente con la carga tal cual lo
      // hace en chunior"): cada carga de NODO que encontró su movimiento queda con la hora de Agentes en sus notas,
      // como queda el N° de Chunior. La próxima vez se reconoce de una (paso 1 de emparejar) y no se vuelve a buscar.
      for(var e = 0; e < r.pares.length; e++){
        var pe = r.pares[e];
        if(!pe.fila || String(pe.fila.notas || "").indexOf(_etiqueta(pe.mov)) >= 0) continue;
        if(pe.caso !== "enlazada" && pe.caso !== "nodo_sin_chunior") continue;
        try{ if(await _anotarNotas(pe.fila, _etiqueta(pe.mov))){ pe.fila.notas = (pe.fila.notas ? pe.fila.notas + " · " : "") + _etiqueta(pe.mov); resumen.enganchadas = (resumen.enganchadas || 0) + 1; } }catch(_e){}
      }
      for(var i = 0; i < r.pares.length; i++){
        if(_ocupado()) break;                                           // el operador arrancó algo: se sigue después
        var p = r.pares[i];
        if(p.caso !== "enlazada" && _enDudaReciente(p.mov)) continue;
        var antes = resumen.dudas;
        try{
          if(p.caso === "sin_nodo") await _sinNodo(p.mov, p.tipo, filas, resumen);
          else if(p.caso === "nodo_sin_chunior") await _nodoSinChunior(p.mov, p.tipo, p.fila, filas, resumen);
          else if(p.caso === "ambiguo") resumen.dudas++;
        }catch(e){ resumen.dudas++; console.warn("[cotejo-cargas]", p.caso, e && e.message); }
        if(resumen.dudas > antes) _anotarDuda(p.mov);
      }
      // Muchas de golpe no son errores de los operadores: es que el cotejo no está viendo bien (relojes, lectura).
      // No se marca ninguna y queda para revisar (P4, 21/11: 142 cargas marcadas de una).
      // "Sin carga en Agentes" se afirma de a una y buscando: con el filtro de alias del informe se traen los
      // movimientos de ESE jugador en la última semana, y recién si ahí no está, se marca (Juan, 21/11: la lista
      // de 20 por página ya no llega a las cargas de hace un rato). Como mucho TOPE_SIN_AGENTES por vuelta, para
      // no tener Agentes ocupado; las que quedan en duda no se vuelven a buscar por una hora. Si el backoffice no
      // tiene ese filtro (agentesbet.io, Drex), no se marca nada.
      var pend = _pendientes();
      var delHueco = pend.length ? filas.filter(function(h){ return pend.indexOf(h.id) >= 0 && String(h.notas || "").indexOf("Agentes ") < 0
        && String(h.notas || "").indexOf(MARCA_SIN_AGENTES) < 0 && (Date.now() - _ms(h)) >= GRACIA_SIN_AGENTES; }) : [];
      var aConfirmar = r.sobrantes.concat(delHueco.filter(function(h){ return r.sobrantes.indexOf(h) < 0; }))
        .filter(function(h){ return !_enDudaReciente({ alias: "fila", cantidad: 0, fecha: h.id }); })
        .slice(0, TOPE_SIN_AGENTES);
      // Lo que ya se resolvió (o ya no está en lo que se lee de NODO) sale de pendientes.
      if(pend.length){
        var vivos = {}; filas.forEach(function(h){ vivos[h.id] = h; });
        _guardarPendientes(pend.filter(function(id){ var h = vivos[id]; return h && String(h.notas || "").indexOf("Agentes ") < 0 && String(h.notas || "").indexOf(MARCA_SIN_AGENTES) < 0; }));
      }
      var confirmadas = [];
      for(var k = 0; k < aConfirmar.length; k++){
        if(_ocupado()) break;
        var cand = aConfirmar[k], conf = null;
        try{ conf = await _confirmarSinAgentes(cand); }catch(_e){ conf = null; }
        if(conf && conf.mov){
          try{ if(await _anotarNotas(cand, _etiqueta(conf.mov))) resumen.enganchadas = (resumen.enganchadas || 0) + 1; }catch(_e){}
          _guardarPendientes(_pendientes().filter(function(id){ return id !== cand.id; }));
          continue;
        }
        if(conf === true){ confirmadas.push(cand); _guardarPendientes(_pendientes().filter(function(id){ return id !== cand.id; })); }
        else { resumen.dudas += conf === null ? 1 : 0; _anotarDuda({ alias: "fila", cantidad: 0, fecha: cand.id }); }
      }
      for(var j = 0; j < confirmadas.length; j++){
        var h = confirmadas[j];
        // Si ese movimiento ya se vio en otra fila (una copia), no se vuelve a avisar.
        try{ if(await _hermanasConVista(h)){ resumen.dudas++; continue; } }catch(_e){}
        var esRetiro = _tipoFila(h) === "RETIRO";
        var txt = MARCA_SIN_AGENTES + " (buscado por alias): " + (h.chunior_movimiento_id ? "anotado en Chunior" : "NODO lo marcó hecho")
          + " pero en Agentes no aparece " + (esRetiro ? "este retiro" : "esta carga");
        if(await _anotarNotas(h, txt)) resumen.sinAgentes++;
      }
      if(resumen.enlazadas || resumen.subidas || resumen.fuera || resumen.sinAgentes){
        try{ if(typeof cargarHistorial === "function") await cargarHistorial(true); }catch(_e){}
      }
      if(resumen.fuera) _toast("⚠️ Hay " + resumen.fuera + " carga(s) o retiro(s) hechos fuera de NODO. Revisalos en el historial y avisale a tu superior.", "red");
      if(resumen.sinAgentes) _toast("⚠️ Hay " + resumen.sinAgentes + " movimiento(s) anotados que no aparecen en Agentes. Revisalos en el historial.", "red");
      await pintarAvisos();
      // La próxima vuelta lee sólo hasta el movimiento más nuevo de esta (el ancla). Si no llegó al ancla vieja, lo
      // del medio ya quedó en pendientes, así que el ancla igual avanza: no se vuelve a leer lo mismo.
      if(movs.length){ var nuevo = movs.reduce(function(a, m){ return m.ms > a.ms ? m : a; }, movs[0]); _guardarAncla(nuevo); }
      if(lectura.completo){ try{ localStorage.setItem(CLAVE_HASTA, String(empezo)); }catch(_e){} }
      return { ok: true, resumen: resumen };
    }catch(e){
      console.warn("[cotejo-cargas] vuelta", e && e.message);
      return { ok: false, motivo: "falló la revisión" };
    }finally{ CORRIENDO = false; }
  }

  // ── Avisos para el operador: salen del historial, así los ve cualquier PC de la oficina ────
  // ── "Lo vi" enlazado al movimiento (Juan, 23/11: "que estos 'lo vi' se enlacen también al movimiento, así por
  // lo menos no se repiten") ─────────────────────────────────────────────────────────────────────────────────
  // Un mismo movimiento puede dejar varias filas con aviso: la carga y sus copias repetidas (P4, 21-22/11: miles,
  // "Lo vi" apretado 629 veces en un día), la fila que agregó la revisión de Chunior y su alerta para el admin.
  // Son el mismo movimiento si tienen el mismo N° de Chunior (en la fila o en el detalle de la alerta), la misma
  // hora de Agentes para el mismo jugador, o el mismo jugador, monto y tipo a menos de 3 minutos ("es
  // virtualmente imposible que pepe transfiera en el mismo minuto dos veces"). "Lo vi" en una las marca a todas,
  // y en el cartel sale una sola por movimiento y ninguna de un movimiento que ya se vio.
  var ETIQUETA_AG = /Agentes \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}/;
  var COPIA_MS = 3 * 60000;
  function _chuDe(h){
    var propio = String((h && h.chunior_movimiento_id) || "").trim();
    if(/^\d+$/.test(propio)) return propio;
    return (String((h && h.notas) || "").match(/"n":"(\d+)"/) || [])[1] || "";
  }
  function _mismoMovimiento(a, b){
    if(!a || !b) return false;
    var ca = _chuDe(a), cb = _chuDe(b);
    if(ca && cb) return ca === cb;
    var ua = _norm(a.usuario), ub = _norm(b.usuario);
    var ea = (String(a.notas || "").match(ETIQUETA_AG) || [])[0], eb = (String(b.notas || "").match(ETIQUETA_AG) || [])[0];
    if(ea && eb && ua === ub) return ea === eb;
    var ta = Date.parse(a.created_at), tb = Date.parse(b.created_at);
    return !!ua && ua === ub && _monto(a.monto) === _monto(b.monto) && _tipoFila(a) === _tipoFila(b)
      && Number.isFinite(ta) && Number.isFinite(tb) && Math.abs(ta - tb) <= COPIA_MS;
  }
  function _vista(h){ return String((h && h.notas) || "").indexOf(MARCA_RECONOCIDA) >= 0; }
  // De la lista de avisos (vistos y no vistos): los que hay que mostrar, uno por movimiento.
  function avisosParaMostrar(filas){
    var vistas = (filas || []).filter(_vista), salen = [];
    (filas || []).forEach(function(h){
      if(_vista(h) || h.estado === "REVERTIDA") return;
      if(vistas.some(function(v){ return _mismoMovimiento(v, h); })) return;
      if(salen.some(function(v){ return _mismoMovimiento(v, h); })) return;
      salen.push(h);
    });
    return salen;
  }
  async function _leerAvisos(){
    var r = await supabaseClient.from("historial_ops")
      .select("id,created_at,usuario,monto,tipo,notas,estado,operador,chunior_movimiento_id")
      .eq("pc_codigo", _pc())
      .gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString())
      .or("notas.ilike.*" + MARCA_FUERA + "*,notas.ilike.*" + MARCA_SIN_AGENTES + "*,notas.ilike.*" + MARCA_CHUNIOR + "*")
      .order("created_at", { ascending: false }).limit(80);
    if(r.error) return [];
    return avisosParaMostrar(r.data || []);
  }
  // ¿Ese movimiento ya se vio en otra fila? (copias de la misma carga a menos de 3 minutos, mismo N° de Chunior).
  async function _hermanasConVista(base){
    var t = Date.parse(base.created_at);
    if(!Number.isFinite(t)) return false;
    var r = await supabaseClient.from("historial_ops").select("id,created_at,usuario,monto,tipo,notas,chunior_movimiento_id")
      .eq("pc_codigo", _pc()).gte("created_at", new Date(t - COPIA_MS).toISOString()).lte("created_at", new Date(t + COPIA_MS).toISOString())
      .ilike("notas", "%" + MARCA_RECONOCIDA + "%").limit(50);
    if(r.error) return false;
    return (r.data || []).some(function(h){ return String(h.id) !== String(base.id) && _mismoMovimiento(base, h); });
  }
  // Las otras filas del mismo movimiento que todavía no se vieron (la base no).
  async function _hermanasNoVistas(base){
    var t = Date.parse(base.created_at), out = [];
    var marcas = [MARCA_FUERA, MARCA_SIN_AGENTES, MARCA_SIN_AGENTES_VIEJA, MARCA_CHUNIOR];
    var cerca = await supabaseClient.from("historial_ops").select("id,created_at,usuario,monto,tipo,notas,chunior_movimiento_id")
      .eq("pc_codigo", _pc())
      .gte("created_at", new Date(t - 86400000).toISOString()).lte("created_at", new Date(t + 86400000).toISOString())
      .or(marcas.map(function(m){ return "notas.ilike.*" + m + "*"; }).join(",")).limit(300);
    if(!cerca.error) out = (cerca.data || []);
    // La alerta para el admin de la revisión de Chunior lleva el N° en su detalle y puede ser de días después.
    var n = _chuDe(base);
    if(n){
      var al = await supabaseClient.from("historial_ops").select("id,created_at,usuario,monto,tipo,notas,chunior_movimiento_id")
        .eq("pc_codigo", _pc()).eq("tipo", "ALERTA")
        .gte("created_at", new Date(t - 86400000).toISOString()).lte("created_at", new Date(t + 14 * 86400000).toISOString())
        .ilike("notas", '%"n":"' + n + '"%').limit(20);
      if(!al.error) out = out.concat(al.data || []);
    }
    var vistos = {};
    return out.filter(function(h){
      if(String(h.id) === String(base.id) || vistos[h.id] || _vista(h)) return false;
      vistos[h.id] = true;
      return _mismoMovimiento(base, h);
    });
  }
  function _esc(v){ try{ return window.escapeHtml ? window.escapeHtml(String(v == null ? "" : v)) : String(v == null ? "" : v); }catch(_e){ return String(v || ""); } }
  async function pintarAvisos(){
    var tabla = document.getElementById("historialTable");
    if(!tabla || !_pc()) return;
    if(window.nodoArranqueHabilitado && !window.nodoArranqueHabilitado("historial")) return;
    var box = document.getElementById("cotejoCargasAvisos");
    if(!box){
      box = document.createElement("div");
      box.id = "cotejoCargasAvisos";
      tabla.parentNode.insertBefore(box, tabla);
    }
    var lista = [];
    try{ lista = await _leerAvisos(); }catch(_e){}
    if(!lista.length){ box.innerHTML = ""; return; }
    var resto = lista.length > 5 ? lista.length - 5 : 0;
    if(resto) lista = lista.slice(0, 5);
    box.innerHTML = lista.map(function(h){
      var fuera = String(h.notas || "").indexOf(MARCA_FUERA) >= 0;
      var hora = new Date(h.created_at).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
      var retiro = _tipoFila(h) === "RETIRO";
      var notas = String(h.notas || "");
      var deChunior = !fuera && notas.indexOf(MARCA_SIN_AGENTES) < 0 && notas.indexOf(MARCA_CHUNIOR) >= 0;
      var titulo, detalle;
      if(deChunior){
        // "Anotado directo en Chunior por xprueba, no estaba en NODO · Propinas N° 10184376 · a 882 - PROMOS"
        var que = (notas.match(/·\s*([^·]+?)\s+N°/) || [])[1] || "Movimiento";
        titulo = que + ": anotado directo en Chunior" + (h.operador ? " por " + h.operador : "") + ", no estaba en NODO.";
        detalle = (h.usuario ? h.usuario + " · " : "") + "$" + Number(h.monto || 0).toLocaleString("es-AR") + " · " + hora;
      }else{
        titulo = fuera
          ? (retiro ? "Retiro hecho fuera de NODO: no se hizo desde NODO ni estaba anotado." : "Carga hecha fuera de NODO: no se hizo desde NODO ni estaba anotada.") + " Avisale a tu superior."
          : (retiro ? "Este retiro figura anotado, pero en Agentes no aparece." : "Esta carga figura anotada, pero en Agentes no aparece.");
        detalle = h.usuario + " · $" + Number(h.monto || 0).toLocaleString("es-AR") + " · " + hora;
      }
      // La casilla va a la IZQUIERDA: a la derecha quedaba cortada cuando el historial es más ancho que la
      // pantalla ("el cartel que avisa está roto", Juan 18/11).
      // La casilla lleva ancho, relleno y márgenes propios: la regla general "input{width:100%;padding:11px…}" la
      // estiraba y el "Lo vi" quedaba encima del título ("L6aitos" = "Lo vi" sobre "Gastos", 20/11).
      var estilo = deChunior ? "background:#2a2416;color:#f0d99b;border-left:3px solid #c9a227" : "background:#2a1717;color:#fecaca;border-left:3px solid #ef4444";
      return '<div class="alert-box" style="' + estilo + ';margin:6px 0;display:flex;gap:12px;align-items:flex-start;max-width:100%;box-sizing:border-box">'
        + '<label style="flex:none;white-space:nowrap;cursor:pointer;font-weight:700"><input type="checkbox" style="width:auto;height:auto;padding:0;margin:0 4px 0 0;vertical-align:middle;flex:none" onchange="nodoCotejoReconocer(\'' + _esc(h.id) + '\', this)">Lo vi</label>'
        + '<div style="min-width:0;overflow-wrap:anywhere"><b>' + _esc(titulo) + '</b><br><span class="small">' + _esc(detalle) + '</span></div>'
        + '</div>';
    }).join("") + (resto ? '<div class="small" style="color:#94a3b8;margin:2px 0 8px 4px">y ' + resto + ' aviso(s) más: marcá estos como vistos para ver los siguientes.</div>' : "");
  }
  window.nodoCotejoReconocer = async function(id, casilla){
    if(casilla) casilla.disabled = true;
    try{
      var r = await supabaseClient.from("historial_ops").select("id,created_at,usuario,monto,tipo,notas,chunior_movimiento_id").eq("id", id).single();
      if(r.error || !r.data) throw r.error || new Error("no está");
      var marca = MARCA_RECONOCIDA + " " + _operador() + " " + new Date().toLocaleString("es-AR");
      var ok = await _anotarNotas(r.data, marca);
      if(!ok) throw new Error("no se guardó");
      // El mismo movimiento en otras filas (copias, la alerta para el admin): también quedan vistas.
      var otras = 0;
      try{
        var hermanas = await _hermanasNoVistas(r.data);
        for(var i = 0; i < hermanas.length; i++){ if(await _anotarNotas(hermanas[i], marca)) otras++; }
      }catch(e){ console.warn("[cotejo-cargas] lo vi en las copias", e && e.message); }
      _toast("Listo: quedó marcada como vista por " + _operador() + (otras ? " (y " + otras + " fila(s) más del mismo movimiento)" : "") + ".", "green");
      await pintarAvisos();
    }catch(_e){
      if(casilla){ casilla.checked = false; casilla.disabled = false; }
      _toast("No se pudo marcar. Probá de nuevo.", "red");
    }
  };

  // El botón Recargar del historial: recarga, y es buen momento para cotejar (Juan, 18/11). Primero se
  // dibuja el historial, después se lee Agentes y Chunior, y si algo cambió se vuelve a dibujar.
  window.nodoHistorialRecargar = async function(boton){
    if(boton) boton.disabled = true;
    try{
      try{ if(typeof cargarHistorial === "function") await cargarHistorial(); }catch(_e){}
      try{ await pintarAvisos(); }catch(_e){}
      if(FONDO.corriendo){ _toast("Ya se está revisando con Agentes y Chunior: el resultado aparece en un momento.", "blue"); return; }
      if(_ocupado()){ _toast("El cotejo con Agentes queda para cuando termine la operación en curso.", "blue"); return; }
      _toast("Cotejando el historial con Agentes y Chunior…", "blue");
      var todo = await revisionesFondo({ forzar: true, motivo: "recargar" });
      var r = todo && todo.cotejo;
      if(!r || !r.ok){
        if(r && r.motivo && r.motivo !== "recién revisado") _toast("No se pudo cotejar con Agentes: " + r.motivo + ".", "yellow");
        return;
      }
      var z = r.resumen;
      if(!z.enlazadas && !z.subidas && !z.fuera && !z.sinAgentes && !z.dudas) _toast("✔ Historial al día con Agentes (" + z.leidas + " movimientos revisados).", "green");
      else{
        var partes = [];
        if(z.enlazadas) partes.push(z.enlazadas + " enlazada(s)");
        if(z.subidas) partes.push(z.subidas + " subida(s) a Chunior");
        if(z.dudas) partes.push(z.dudas + " sin tocar por dudas");
        if(partes.length) _toast("Cotejo: " + partes.join(" · ") + ".", z.dudas ? "yellow" : "green");
      }
    }finally{ if(boton) boton.disabled = false; }
  };

  // ── Una sola fila para las revisiones de fondo (Juan, 18/11) ─────────────────────────────
  // "Que no haya dos revisiones separadas esperando a que no haya ninguna solicitud: una arranca cuando
  // termina la otra, o se chocan". El cotejo con Agentes y la pasada por Chunior corren en UNA fila, uno
  // detrás del otro, y el watchdog le pasa la posta a esta fila cuando termina su lectura (relevo, nunca
  // encimado). El watchdog, a su vez, no lee mientras esta fila corre (_revisionFondoCorriendo).
  // Además no arranca si el operador está usando NODO (tocó algo hace menos de 20 s): cuando se lanza un
  // preload NODO se siente trabado, y no tiene que pasar en medio de lo que está haciendo.
  var FONDO = { corriendo: false, ultCotejo: 0, ultChunior: 0 };
  var CHUNIOR_CADA_MS = 30 * 60000;
  try{
    if(typeof document !== "undefined" && document.addEventListener){
      var _marcar = function(){ window._nodoUltimaInteraccion = Date.now(); };
      document.addEventListener("mousedown", _marcar, true);
      document.addEventListener("keydown", _marcar, true);
    }
  }catch(_e){}
  function _operadorTrabajando(){ return Date.now() - (Number(window._nodoUltimaInteraccion) || 0) < 20000; }
  async function revisionesFondo(opts){
    opts = opts || {};
    // En "sólo mirar" las revisiones de fondo no corren: escriben en NODO y anotan en Chunior.
    if(typeof window.nodoSoloMirar === "function" && window.nodoSoloMirar()) return { ok: false, motivo: "sólo mirar" };
    if(FONDO.corriendo) return { ok: false, motivo: "ya se está revisando" };
    if(_ocupado()) return { ok: false, motivo: "hay una operación en curso" };
    if(!opts.forzar && _operadorTrabajando()) return { ok: false, motivo: "el operador está trabajando" };
    var ahora = Date.now();
    var tocaCotejo = !opts.soloChunior && (opts.forzar || opts.cotejoYa || ahora - FONDO.ultCotejo >= CADA_CUANTO_MS);
    var tocaChunior = !!window.NodoPasadaChunior && (opts.forzar || opts.soloChunior || ahora - FONDO.ultChunior >= CHUNIOR_CADA_MS);
    if(!tocaCotejo && !tocaChunior) return { ok: true, nada: true };
    FONDO.corriendo = true; window._revisionFondoCorriendo = true;
    var out = { ok: true };
    try{
      if(tocaCotejo){
        out.cotejo = await revisar(opts.motivo || "reloj");
        _saludRevision("Agentes con NODO y Chunior", out.cotejo, function(c){
          var s = c.resumen || {};
          return "leyó " + (s.leidas || 0) + " movimientos de Agentes · " + (s.enlazadas || 0) + " enlazados con Chunior";
        });
        if(out.cotejo && out.cotejo.ok) FONDO.ultCotejo = Date.now();
      }
      if(tocaChunior && !_ocupado()){
        out.chunior = await window.NodoPasadaChunior.pasada({ recargar: !!opts.forzar || !!opts.soloChunior });
        _saludRevision("Historiales de Chunior", out.chunior, function(c){
          var t = (c.resumen && c.resumen.tablas) || {}, n = 0, k = Object.keys(t);
          k.forEach(function(x){ n += t[x].leidas || 0; });
          return "revisó " + k.length + " historiales · " + n + " movimientos · " + ((c.resumen && c.resumen.creadas) || 0) + " que faltaban en NODO";
        });
        if(out.chunior && out.chunior.ok) FONDO.ultChunior = Date.now();
      }
      try{ await pintarAvisos(); }catch(_e){}
      return out;
    }catch(e){
      console.warn("[revisiones-fondo]", e && e.message);
      return { ok: false, motivo: "falló la revisión" };
    }finally{ FONDO.corriendo = false; window._revisionFondoCorriendo = false; }
  }
  window._revisionesFondo = revisionesFondo;
  // El cotejo va DESPUÉS de la carga (Juan, 23/11). Un rato después de cada carga o retiro, con NODO libre, se lee la
  // página 1 de Agentes (alcanza: en hora pico cubre 11 minutos) y la carga queda enganchada con su movimiento. Si el
  // operador sigue trabajando, se espera y se vuelve a intentar.
  var _trasOpTimer = null;
  window.nodoCotejoTrasOperacion = function(){
    if(_trasOpTimer) clearTimeout(_trasOpTimer);
    var intentar = function(){
      _trasOpTimer = null;
      Promise.resolve(revisionesFondo({ cotejoYa: true, motivo: "tras-operacion" })).then(function(r){
        if(r && r.ok === false && /operaci[oó]n en curso|trabajando|revisando/i.test(r.motivo || "")) _trasOpTimer = setTimeout(intentar, 30000);
      }).catch(function(){});
    };
    _trasOpTimer = setTimeout(intentar, 45000);
  };

  window.NodoCotejoCargas = { emparejar: emparejar, revisar: revisar, pintarAvisos: pintarAvisos, revisionesFondo: revisionesFondo,
    avisosParaMostrar: avisosParaMostrar, mismoMovimiento: _mismoMovimiento,
    _marcas: { fuera: MARCA_FUERA, sinAgentes: MARCA_SIN_AGENTES, reconocida: MARCA_RECONOCIDA } };

  // Un solo reloj: cada 2 minutos se pregunta si algo de la fila "toca" (cotejo cada 10, Chunior cada 30)
  // y si NODO está libre. La primera, a los 2 minutos de abrir.
  try{
    if(typeof document !== "undefined" && window.ctrlElectron){
      setInterval(function(){ revisionesFondo().catch(function(){}); }, 2 * 60000);
    }
  }catch(_e){}
})();
