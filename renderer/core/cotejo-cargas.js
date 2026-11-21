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
  var TOPE_FILAS_NODO    = 1500;           // si NODO trae más que esto, la lectura no es completa: no se decide
  var TOPE_SIN_AGENTES   = 3;              // más de esto en una vuelta = algo anda mal (relojes, lectura): no se marca
  var GRACIA_SIN_AGENTES = 10 * 60000;     // una fila de NODO más nueva que esto todavía no se juzga
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
    var sobrantes = Number.isFinite(desdeLeido) ? libres.filter(function(h){
      var t = _ms(h);
      return !usadas[h.id] && !h._enDuda && Number.isFinite(t) && t >= desdeLeido && (ahora - t) >= GRACIA_SIN_AGENTES
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

  async function _leerAgentes(desdeMs){
    var llamar = function(){ return window.ctrlElectron.drexAutomation("leerMovimientosCredito", { desdeMs: desdeMs }); };
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
    var llamar = function(){ return window.ctrlElectron.drexAutomation("leerMovimientosCredito",
      { alias: h.usuario, filtrarAlias: true, desdeMs: _ms(h) - DUDA_MS, maxPaginas: 3 }); };
    var r = (typeof window._drexEncolar === "function")
      ? await window._drexEncolar("leerMovimientosCredito", llamar, { silencioso: true }) : await llamar();
    if(!r || !r.ok || r.filtradoPorAlias !== true) return null;
    var tipo = _tipoFila(h), t = _ms(h);
    var esta = (r.filas || []).some(function(m){
      return _tipoMov(m) === tipo && _monto(m.cantidad) === _monto(h.monto) && Math.abs(m.ms - t) <= DUDA_MS;
    });
    if(esta) return false;
    return r.completo ? true : null;
  }
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
      var empezo = Date.now(), hasta = _hastaGuardado();
      var desde = Math.max(empezo - MIRAR_ATRAS_MS, hasta ? hasta - MARGEN_MS : empezo - PRIMERA_VEZ_MS);
      var lectura = await _leerAgentes(desde);
      if(!lectura || !lectura.ok) return { ok: false, motivo: (lectura && lectura.message) || "no se pudo leer Agentes" };
      var movs = lectura.filas || [];
      resumen.leidas = movs.length;
      // NODO desde un poco antes: la fila puede ir unos segundos antes que el movimiento.
      var filas = await _leerNodo(desde - VENTANA_NODO_MS);
      var masViejo = movs.reduce(function(a, m){ return Math.min(a, m.ms); }, Infinity);
      // Las filas de NODO del período sin movimiento en esta lectura son CANDIDATAS: cada una se confirma
      // buscando a ese jugador con el filtro del informe (abajo), no por no haberla visto en las páginas.
      var cubreDesde = desde;
      var r = emparejar(movs, filas, { desdeLeidoMs: cubreDesde,
        esNuestra: function(h){ return String(h.origen || "") !== "COTEJO"; } });
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
      var aConfirmar = r.sobrantes.filter(function(h){ return !_enDudaReciente({ alias: "fila", cantidad: 0, fecha: h.id }); })
        .slice(0, TOPE_SIN_AGENTES);
      var confirmadas = [];
      for(var k = 0; k < aConfirmar.length; k++){
        if(_ocupado()) break;
        var cand = aConfirmar[k], conf = null;
        try{ conf = await _confirmarSinAgentes(cand); }catch(_e){ conf = null; }
        if(conf === true) confirmadas.push(cand);
        else { resumen.dudas += conf === null ? 1 : 0; _anotarDuda({ alias: "fila", cantidad: 0, fecha: cand.id }); }
      }
      for(var j = 0; j < confirmadas.length; j++){
        var h = confirmadas[j];
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
      // La próxima vuelta arranca desde acá (menos el margen). Sólo si se pudo leer todo el período.
      if(lectura.completo){ try{ localStorage.setItem(CLAVE_HASTA, String(empezo)); }catch(_e){} }
      return { ok: true, resumen: resumen };
    }catch(e){
      console.warn("[cotejo-cargas] vuelta", e && e.message);
      return { ok: false, motivo: "falló la revisión" };
    }finally{ CORRIENDO = false; }
  }

  // ── Avisos para el operador: salen del historial, así los ve cualquier PC de la oficina ────
  async function _leerAvisos(){
    var r = await supabaseClient.from("historial_ops")
      .select("id,created_at,usuario,monto,tipo,notas,estado,operador")
      .eq("pc_codigo", _pc())
      .gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString())
      .or("notas.ilike.*" + MARCA_FUERA + "*,notas.ilike.*" + MARCA_SIN_AGENTES + "*,notas.ilike.*" + MARCA_CHUNIOR + "*")
      .order("created_at", { ascending: false }).limit(30);
    if(r.error) return [];
    return (r.data || []).filter(function(h){ return String(h.notas || "").indexOf(MARCA_RECONOCIDA) < 0 && h.estado !== "REVERTIDA"; });
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
      var r = await supabaseClient.from("historial_ops").select("id,notas").eq("id", id).single();
      if(r.error || !r.data) throw r.error || new Error("no está");
      var ok = await _anotarNotas(r.data, MARCA_RECONOCIDA + " " + _operador() + " " + new Date().toLocaleString("es-AR"));
      if(!ok) throw new Error("no se guardó");
      _toast("Listo: quedó marcada como vista por " + _operador() + ".", "green");
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
    if(FONDO.corriendo) return { ok: false, motivo: "ya se está revisando" };
    if(_ocupado()) return { ok: false, motivo: "hay una operación en curso" };
    if(!opts.forzar && _operadorTrabajando()) return { ok: false, motivo: "el operador está trabajando" };
    var ahora = Date.now();
    var tocaCotejo = !opts.soloChunior && (opts.forzar || ahora - FONDO.ultCotejo >= CADA_CUANTO_MS);
    var tocaChunior = !!window.NodoPasadaChunior && (opts.forzar || opts.soloChunior || ahora - FONDO.ultChunior >= CHUNIOR_CADA_MS);
    if(!tocaCotejo && !tocaChunior) return { ok: true, nada: true };
    FONDO.corriendo = true; window._revisionFondoCorriendo = true;
    var out = { ok: true };
    try{
      if(tocaCotejo){
        out.cotejo = await revisar(opts.motivo || "reloj");
        if(out.cotejo && out.cotejo.ok) FONDO.ultCotejo = Date.now();
      }
      if(tocaChunior && !_ocupado()){
        out.chunior = await window.NodoPasadaChunior.pasada({ recargar: !!opts.forzar || !!opts.soloChunior });
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

  window.NodoCotejoCargas = { emparejar: emparejar, revisar: revisar, pintarAvisos: pintarAvisos, revisionesFondo: revisionesFondo,
    _marcas: { fuera: MARCA_FUERA, sinAgentes: MARCA_SIN_AGENTES, reconocida: MARCA_RECONOCIDA } };

  // Un solo reloj: cada 2 minutos se pregunta si algo de la fila "toca" (cotejo cada 10, Chunior cada 30)
  // y si NODO está libre. La primera, a los 2 minutos de abrir.
  try{
    if(typeof document !== "undefined" && window.ctrlElectron){
      setInterval(function(){ revisionesFondo().catch(function(){}); }, 2 * 60000);
    }
  }catch(_e){}
})();
