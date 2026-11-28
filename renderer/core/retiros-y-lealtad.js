function _blEsParcial(r){ return /PARCIAL/i.test(String((r&&r.notas)||'')); }
function _blFmtGap(ms){ if(ms==null) return ''; const h=Math.floor(ms/3600000), m=Math.floor((ms%3600000)/60000); return (h>0?h+'h':'')+(m>0?(h>0?' ':'')+m+'min':'')||'0min'; }
function _blIsoDay(offset){ const d=new Date(); d.setDate(d.getDate()-(offset||0)); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
// Ventana de 24hs en ms: la usa el fetch (retrovisor del modo día) y el gap pareado.
// var y no const: se referencia desde muy abajo del mismo script; si algo tira arriba,
// var sigue resolviendo por window en vez de quedar muerto en TDZ.
var _BL_H24 = 24*60*60*1000;

// La regla del retiro diario es UNA: la Blacklist 24h, en el servidor (Juan, 18/11: "la blacklist era la
// idea de unificación"). NODO beta la lee por su canal; la misma regla frena el pedido en el Portal, y sacar
// a alguien de la blacklist lo destraba en todos lados. Las versiones sin ese canal siguen con el chequeo
// de abajo (por eso se puede volver a la versión anterior sin romper nada).
async function _blacklistDelServidor(usuario){
  try{
    if(!window.panelAPI || typeof window.panelAPI.rpc !== 'function') return null;
    const pc = (typeof pcOperativa !== 'undefined' && pcOperativa) || window.pcOperativa || '';
    if(!pc) return null;
    const r = await window.panelAPI.rpc('nodo_beta_retiro_blacklist_v1', { p_pc_codigo: pc, p_usuario: String(usuario||'') });
    let d = r && r.data;
    if(typeof d === 'string'){ try{ d = JSON.parse(d); }catch(_e){ d = null; } }
    if(!r || r.error || !d || d.ok !== true || d.contract !== 'nodo.beta.v1') return null;
    return d;
  }catch(_e){ return null; }
}
// ── La misma persona desde otra cuenta (Juan, 19/11) ─────────────────────────────────────────
// El chequeo de 24 h miraba sólo el usuario. Caso real de P4: tres cuentas, tres teléfonos, un mismo titular
// y la misma cuenta de cobro; en 90 días 28 retiros salieron a menos de 24 h del anterior de esa persona, y el
// chequeo por usuario frenaba 2. No se traba nada: se le avisa al operador quién cobró, cuándo y a qué cuenta,
// con el texto listo para el motivo del rechazo ("el operador tiene más decisión con buena información").
// "Misma persona" = cobró a la misma cuenta (CBU/alias) o a nombre del mismo titular, sin importar tildes.
function _bl24Norm(t){ return String(t||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/\s+/g,' ').trim(); }
function _bl24Destino(t){ const s = String(t||'').replace(/[^A-Za-z0-9.]/g,'').toLowerCase(); return s.length > 5 ? s : ''; }
// Las filas de retiro del historial dicen "#502169 · Titular: Nombre Apellido · Alias: 0000… · ARS 5,000.06".
function _bl24DeNotas(notas){
  const s = String(notas||'');
  return { titular: ((s.match(/Titular:\s*([^·|\n]+?)\s*(?:·|\||$)/i)||[])[1]||'').trim(),
           destino: ((s.match(/(?:Alias|CBU|CVU|Destino)\s*:\s*([^·|\s]+)/i)||[])[1]||'').trim() };
}
// Para buscar el titular en el servidor sin que una tilde lo esconda: "López" y "Lopez" tienen que dar igual.
// Vocales y eñe van como comodín (_); después se compara el nombre entero acá.
function _bl24PatronTitular(tit){
  const pal = _bl24Norm(tit).split(' ').filter(Boolean);
  if(pal.length < 2) return '';
  return 'Titular: ' + pal.slice(0, 2).map(function(p){ return p.replace(/[^a-z]/g,'_').replace(/[aeioun]/g,'_'); }).join(' ');
}
function _bl24Hora(d){ return d.toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit', hour12:false }); }
function _bl24Dia(d){
  const hoy = new Date(); const ayer = new Date(Date.now() - _BL_H24); const manana = new Date(Date.now() + _BL_H24);
  return d.toDateString() === hoy.toDateString() ? 'hoy' : d.toDateString() === ayer.toDateString() ? 'ayer'
    : d.toDateString() === manana.toDateString() ? 'mañana' : 'el ' + d.toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit' });
}
// Devuelve el retiro más reciente (24 h) de OTRA cuenta de la misma persona, o null.
async function _retiro24hMismaPersona(usuario, extra){
  if(typeof supabaseClient === 'undefined') return null;
  const u = String(usuario||'').trim(); if(!u) return null;
  const uN = normalizar(u);
  const destinos = new Set(), titulares = new Set();
  const sumar = function(d, t){ const dn = _bl24Destino(d); if(dn) destinos.add(dn); const tn = _bl24Norm(t); if(tn.split(' ').length >= 2) titulares.add(tn); };
  if(extra) sumar(extra.destino, extra.titular);
  // A dónde cobra esta cuenta: sus últimos retiros. Con .in (no ilike) para que use el índice: 0,4–1 s contra 1,2–1,8 s.
  const variantes = Array.from(new Set([u, u.toLowerCase(), u.toUpperCase(), u.charAt(0).toUpperCase() + u.slice(1).toLowerCase()]));
  const prev = await supabaseClient.from('historial_ops').select('notas')
    .in('usuario', variantes).eq('tipo','RETIRO').eq('estado','OK')
    .order('created_at', { ascending:false }).limit(15);
  if(prev.error) throw prev.error;
  (prev.data||[]).forEach(function(r){ const x = _bl24DeNotas(r.notas); sumar(x.destino, x.titular); });
  const filtros = [];
  destinos.forEach(function(d){ filtros.push('notas.ilike.*' + d + '*'); });
  titulares.forEach(function(t){ const p = _bl24PatronTitular(t); if(p) filtros.push('notas.ilike.*' + p + '*'); });
  if(!filtros.length) return null;
  const r = await supabaseClient.from('historial_ops')
    .select('id, usuario, created_at, monto, notas, pc_codigo, billetera_nombre')
    .eq('tipo','RETIRO').eq('estado','OK').gte('created_at', new Date(Date.now() - _BL_H24).toISOString())
    .or(filtros.slice(0, 12).join(','))
    .order('created_at', { ascending:false }).limit(30);
  if(r.error) throw r.error;
  for(const h of (r.data||[])){
    if(normalizar(h.usuario) === uN || _blEsParcial(h) || /\[BL_EXCLUIDO\]/.test(String(h.notas||''))) continue;
    const x = _bl24DeNotas(h.notas), dn = _bl24Destino(x.destino);
    const porCuenta = !!(dn && destinos.has(dn));
    const porTitular = !porCuenta && titulares.has(_bl24Norm(x.titular));
    if(porCuenta || porTitular) return { fila: h, porCuenta: porCuenta, titular: x.titular, destino: x.destino };
  }
  return null;
}
function _retiro24hResultadoPersona(usuario, hit){
  const h = hit.fila, fecha = new Date(h.created_at), proximo = new Date(fecha.getTime() + _BL_H24);
  const como = hit.porCuenta ? 'a la misma cuenta de cobro' : 'a nombre del mismo titular';
  return {
    bloqueado: true, advertencia: true, usuario, origen: 'MISMA_PERSONA',
    otroUsuario: h.usuario, porCuenta: hit.porCuenta, titular: hit.titular || null, destino: hit.destino || null,
    oficinaOtro: h.pc_codigo || null, historial_id: h.id,
    horasRestantes: Math.max(0, Math.ceil((proximo.getTime() - Date.now()) / 3600000)),
    monto: h.monto, fecha: h.created_at, proximoRetiro: proximo.toISOString(), billetera_nombre: h.billetera_nombre || null,
    // Es el texto que le llega al jugador si se rechaza (va después de "Tu solicitud de retiro fue rechazada:").
    mensaje: 'Retiro 24 hs: ya se hizo un retiro desde el usuario ' + h.usuario + ' ' + _bl24Dia(fecha) + ' a las ' + _bl24Hora(fecha)
      + ', ' + como + '. Podés volver a pedir ' + _bl24Dia(proximo) + ' a las ' + _bl24Hora(proximo) + '.'
  };
}
// Las segundas cuentas, fuera de las 24 h (Juan, 19/11: "NODO debe notificar cuáles son las segundas cuentas"):
// qué OTROS usuarios cobraron en los últimos 60 días a esta cuenta o a nombre de este titular, y cuántas veces.
// Para mostrar en el detalle del retiro; no frena nada. → { cuenta:[{usuario,oficina,veces}], titular:[…] } o null.
async function nodoOtrasCuentasDeCobro(destino, titular, usuario){
  if(typeof supabaseClient === 'undefined') return null;
  const dn = _bl24Destino(destino), tn = _bl24Norm(titular), pat = _bl24PatronTitular(titular), uN = normalizar(usuario);
  const desde = new Date(Date.now() - 60 * 86400000).toISOString();
  const pedir = function(patron){
    return supabaseClient.from('historial_ops').select('usuario, pc_codigo, notas')
      .eq('tipo','RETIRO').eq('estado','OK').ilike('notas', '%' + patron + '%').gte('created_at', desde).limit(300);
  };
  const [rc, rt] = await Promise.all([dn ? pedir(dn) : null, pat ? pedir(pat) : null]);
  if((rc && rc.error) || (rt && rt.error)) throw (rc && rc.error) || rt.error;
  const juntar = function(filas, vale){
    const m = {};
    (filas || []).forEach(function(h){
      if(normalizar(h.usuario) === uN || !vale(_bl24DeNotas(h.notas))) return;
      const k = normalizar(h.usuario);
      m[k] = m[k] || { usuario: h.usuario, oficina: h.pc_codigo || '', veces: 0 };
      m[k].veces++;
    });
    return Object.values(m).sort(function(a, b){ return b.veces - a.veces; });
  };
  return {
    cuenta: juntar(rc && rc.data, function(x){ return _bl24Destino(x.destino) === dn; }),
    titular: juntar(rt && rt.data, function(x){ return tn && _bl24Norm(x.titular) === tn; })
  };
}
window.nodoOtrasCuentasDeCobro = nodoOtrasCuentasDeCobro;
// Lo mismo, en castellano y corto, para pintar en el detalle del retiro.
function nodoOtrasCuentasHtml(r){
  if(!r) return '';
  const lista = function(xs){ return xs.slice(0, 6).map(function(x){ return escapeHtml(x.usuario) + (x.oficina ? ' (' + escapeHtml(x.oficina) + ')' : '') + ' ×' + x.veces; }).join(' · ') + (xs.length > 6 ? ' · y ' + (xs.length - 6) + ' más' : ''); };
  const nombresCuenta = {}; r.cuenta.forEach(function(x){ nombresCuenta[normalizar(x.usuario)] = 1; });
  const soloTitular = r.titular.filter(function(x){ return !nombresCuenta[normalizar(x.usuario)]; });
  if(!r.cuenta.length && !soloTitular.length) return '<div style="margin-top:5px;font-size:11px;color:#8b949e">Ningún otro usuario cobró a esta cuenta ni a este titular en 60 días.</div>';
  return '<div style="margin-top:6px;padding:7px 10px;border-radius:8px;background:rgba(168,85,247,.12);border:1px solid rgba(168,85,247,.5);color:#e9d5ff;font-size:12px;font-weight:700">'
    + '👥 Posibles segundas cuentas (60 días)'
    + (r.cuenta.length ? '<br><span style="font-weight:600">Cobraron a esta misma cuenta: ' + lista(r.cuenta) + '</span>' : '')
    + (soloTitular.length ? '<br><span style="font-weight:600">Cobraron a nombre del mismo titular: ' + lista(soloTitular) + '</span>' : '')
    + '</div>';
}
window.nodoOtrasCuentasHtml = nodoOtrasCuentasHtml;

// La búsqueda por persona no puede demorar el retiro: si no contesta en 5 s se sigue sin ella (y la luz lo dice).
function _retiro24hPersonaConTope(usuario, extra){
  let tope;
  const limite = new Promise(function(ok){ tope = setTimeout(function(){ ok({ sinComprobar: true }); }, 5000); });
  const busqueda = _retiro24hMismaPersona(usuario, extra)
    .catch(function(e){ console.warn('[retiro-24h] misma persona', e && e.message); return { sinComprobar: true }; });
  return Promise.race([busqueda, limite]).finally(function(){ clearTimeout(tope); });
}
async function _retiro24hSoloPersona(usuario, personaP, health){
  const p = await personaP;
  if(p && p.sinComprobar){ health?.record('DATA', 'DEGRADED', 'RETIRO_24H_PERSONA_SIN_COMPROBAR'); return { bloqueado: false }; }
  if(p && p.fila){ health?.record('DATA', 'OK', 'RETIRO_24H_MISMA_PERSONA'); return _retiro24hResultadoPersona(usuario, p); }
  return { bloqueado: false };
}

// extra (opcional): { destino, titular } del retiro que se está por pagar, si se conocen.
async function verificarRetiro24h(usuario, extra) {
  const health = window.NodoSalud?.begin('RETIROS');
  const personaP = _retiro24hPersonaConTope(usuario, extra);
  const bl = await _blacklistDelServidor(usuario);
  if(bl){
    health?.record('DATA', 'OK', bl.bloqueado ? 'RETIRO_24H_MATCH' : 'RETIRO_24H_CLEAR');
    if(!bl.bloqueado) return _retiro24hSoloPersona(usuario, personaP, health);
    const fecha = new Date(bl.retiro_at), proximo = new Date(bl.hasta), pasado = Date.now() - fecha.getTime();
    return {
      bloqueado: true, advertencia: true, usuario,
      horasRestantes: Math.max(0, Math.ceil((proximo.getTime() - Date.now()) / 3600000)),
      monto: bl.monto, fecha: bl.retiro_at, proximoRetiro: proximo.toISOString(),
      billetera_nombre: bl.billetera_nombre || null, origen: 'BLACKLIST', historial_id: bl.historial_id,
      mensaje: `${usuario} está en la blacklist: cobró un retiro hace ${Math.floor(pasado/3600000)}h ${Math.floor((pasado%3600000)/60000)}min · puede volver a las ${formatFecha(proximo.toISOString())}`
    };
  }
  const hace24h = new Date(Date.now() - 24 * 60 * 60 * 1000).getTime();
  const ahora   = Date.now();
  const usuarioNorm = normalizar(usuario);
  const candidatos  = [];
  // ilike sin comodines = match exacto SIN distinguir mayúsculas. Los retiros quedan guardados a
  // veces "Cristina0735" y a veces "cristina0735" (portal vs form manual) — con .eq el bloqueo 24h
  // no los cruzaba y el usuario podía retirar dos veces. Escapamos %/_ del patrón (portado de tu nodo).
  const _uPat = String(usuario).replace(/[\\%_]/g, function(c){ return '\\'+c; });

  // 1. Retiros del PORTAL. Antes esto miraba la tabla `solicitudes`, muerta desde el 30 de mayo:
  //    la fuente 1 del chequeo de 24 h no devolvía nunca nada. La regla igual funcionaba por la
  //    fuente 2 (historial_ops), pero un retiro del portal sin fila en el historial se colaba.
  // Si una fuente no contesta, "no encontré nada" no es "no hay": el semáforo lo tiene que decir.
  let _fuenteFallo = false;
  try {
    const { data: dataSol, error: _eSol } = await supabaseClient
      .from("landing_solicitudes")
      .select("id, created_at, monto")
      .ilike("usuario", _uPat)
      .eq("tipo", "RETIRO")
      .in("estado", ["PAGADA", "APROBADA", "ACREDITADA"])
      .gte("created_at", new Date(hace24h).toISOString())
      .order("created_at", { ascending: false })
      .limit(1);
    if(_eSol || !Array.isArray(dataSol)) _fuenteFallo = true;
    if(Array.isArray(dataSol) && dataSol.length)
      candidatos.push({ created_at: dataSol[0].created_at, monto: dataSol[0].monto, billetera_nombre: null, origen: "SOLICITUD" });
  } catch(_){ _fuenteFallo = true; }

  // 2. Buscar en historial_ops (retiros del form manual, chat rápido)
  try {
    const { data: dataH, error: _eH } = await supabaseClient
      .from("historial_ops")
      .select("id, created_at, monto, billetera_nombre, notas")
      .ilike("usuario", _uPat)
      .eq("tipo", "RETIRO")
      .eq("estado", "OK")
      .gte("created_at", new Date(hace24h).toISOString())
      .order("created_at", { ascending: false })
      .limit(8);
    // Excluir PARCIALES (tramos de un retiro grande) y los marcados [BL_EXCLUIDO]: no son un
    // retiro separado → tomamos el retiro REAL más reciente (no parcial, no excluido).
    const dhReal = (dataH||[]).find(function(r){ return !_blEsParcial(r) && !/\[BL_EXCLUIDO\]/.test(String(r.notas||'')); });
    if(_eH || !Array.isArray(dataH)) _fuenteFallo = true;
    if(dhReal)
      candidatos.push({ created_at: dhReal.created_at, monto: dhReal.monto, billetera_nombre: dhReal.billetera_nombre || null, origen: "HISTORIAL" });
  } catch(_){ _fuenteFallo = true; }

  // 3. Buscar en CSV importado (últimas 24h)
  if(retiros24hCSV && retiros24hCSV.length){
    const retiroCSV = retiros24hCSV.find(r => normalizar(r.alias) === usuarioNorm);
    if(retiroCSV){
      const t = ahora - new Date(retiroCSV.fecha).getTime();
      if(t < 24 * 60 * 60 * 1000)
        candidatos.push({ created_at: retiroCSV.fecha, monto: retiroCSV.monto, billetera_nombre: null, origen: "CSV" });
    }
  }

  if(candidatos.length) health?.record('DATA', _fuenteFallo?'DEGRADED':'OK',
    _fuenteFallo?'RETIRO_24H_MATCH_PARCIAL':'RETIRO_24H_MATCH');
  else health?.record('DATA', _fuenteFallo ? 'DEGRADED' : 'OK', _fuenteFallo ? 'RETIRO_24H_SIN_COMPROBAR' : 'RETIRO_24H_CLEAR');
  if(!candidatos.length) return _retiro24hSoloPersona(usuario, personaP, health);

  // Tomar el retiro más reciente de cualquier fuente
  candidatos.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const retiro = candidatos[0];

  const elapsed       = ahora - new Date(retiro.created_at).getTime();
  const horasElapsed  = Math.floor(elapsed / (60 * 60 * 1000));
  const minsElapsed   = Math.floor((elapsed % (60 * 60 * 1000)) / 60000);
  const horasRestantes= Math.ceil((24 * 60 * 60 * 1000 - elapsed) / (60 * 60 * 1000));
  const proximoRetiro = new Date(new Date(retiro.created_at).getTime() + 24 * 60 * 60 * 1000);

  return {
    bloqueado:        true,
    advertencia:      true,
    usuario,
    horasRestantes,
    monto:            retiro.monto,
    fecha:            retiro.created_at,
    proximoRetiro:    proximoRetiro.toISOString(),
    billetera_nombre: retiro.billetera_nombre || null,
    origen:           retiro.origen,
    mensaje:          `${usuario} ya retiró hace ${horasElapsed}h${minsElapsed > 0 ? ' ' + minsElapsed + 'min' : ''} · puede volver a las ${formatFecha(proximoRetiro.toISOString())}`
  };
}

// Modal de confirmación de retiro duplicado.
// Muestra los detalles del retiro anterior y pregunta si proceder.
// Devuelve Promise<true> si el operador elige proceder, Promise<false> si cancela.
function confirmarRetiroDuplicado(check) {
  return new Promise(function(resolve) {
    const fechaRet  = escapeHtml(formatFecha(check.fecha));
    const horaOk    = escapeHtml(formatFecha(check.proximoRetiro));
    const bilInfo   = check.billetera_nombre
      ? '<br><span class="small" style="color:#e0c070">Billetera: <b>' + escapeHtml(check.billetera_nombre) + '</b></span>'
      : '';

    const persona = check.origen === 'MISMA_PERSONA';
    const pasado  = Date.now() - new Date(check.fecha).getTime();
    const cabeza  = persona
      ? '<b>⚠️ Esta persona ya retiró desde otro usuario</b><br><br>' +
        '<b>' + escapeHtml(check.otroUsuario || '') + '</b> cobró hace <b>' + escapeHtml(_blFmtGap(pasado)) + '</b>'
          + (check.oficinaOtro ? ' (' + escapeHtml(check.oficinaOtro) + ')' : '') + ', '
          + (check.porCuenta ? 'a la misma cuenta de cobro' : 'a nombre del mismo titular') + ':<br>' +
        (check.titular ? '👤 Titular: <b>' + escapeHtml(check.titular) + '</b><br>' : '') +
        (check.destino ? '🏦 Cuenta: <b>' + escapeHtml(check.destino) + '</b><br>' : '')
      : '<b>⚠️ Retiro en las últimas 24hs</b><br><br>' +
        '<b>' + escapeHtml(check.usuario || '') + '</b> ya realizó un retiro:<br>';
    // El texto para el motivo del rechazo, listo para copiar (en el retiro del Portal, al cancelar se le manda solo).
    const motivo = String(check.mensaje || '');
    const copiar = motivo
      ? '<div style="margin:0 0 12px;padding:8px 10px;border-radius:8px;background:#0d1117;border:1px solid rgba(255,255,255,.12)">' +
          '<div class="small" style="color:#8b949e;font-weight:800;margin-bottom:4px">MENSAJE PARA EL RECHAZO</div>' +
          '<div style="font-size:13px;color:#e6edf3;margin-bottom:6px">' + escapeHtml(motivo) + '</div>' +
          '<button type="button" class="mini-btn" data-valor="' + escapeHtml(motivo) + '" onclick="portalCopiarCbu(this)" style="width:auto">📋 Copiar mensaje <span class="pcopy-ico"></span></button>' +
        '</div>'
      : '';
    const body =
      '<div class="alert-box" style="line-height:1.7;margin-bottom:14px">' +
        cabeza +
        '📅 Retiro anterior: <b>' + fechaRet + '</b><br>' +
        '🕐 Habilitado nuevamente: <b>' + horaOk + '</b><br>' +
        '💰 Monto anterior: <b>' + money(check.monto) + '</b>' + bilInfo +
      '</div>' +
      copiar +
      (check.origen === 'BLACKLIST'
        ? '<p style="color:#c0cad8;font-size:13px">Está en la <b>blacklist</b>: hasta esa hora no puede pedir otro retiro. '
          + 'Si revisaste el caso y corresponde pagarle, sacalo de la blacklist: queda destrabado también en el Portal.</p>'
        : '<p style="color:#c0cad8;font-size:13px">Podés proceder si verificaste el caso del usuario.</p>');

    abrirModal('⚠️ Retiro en 24hs', body, null, check.origen === 'BLACKLIST' ? 'Sacarlo de la blacklist y seguir' : 'Proceder igualmente');

    var saveBtn   = document.getElementById('modalSaveBtn');
    var cancelBtn = document.querySelector('#modalOverlay .btn-gray');

    function limpiarHandlers(){
      // Restaurar el modal a estado neutro para que el próximo abrirModal funcione limpio
      if(saveBtn)   saveBtn.onclick   = null;
      if(cancelBtn) cancelBtn.onclick = function(){ cerrarModal(); };
    }

    if(saveBtn) saveBtn.onclick = async function(){
      // Con la blacklist del servidor, seguir = sacarlo de la blacklist (lo mismo que el botón del cuadro).
      // Si no se puede guardar, no se sigue: quedaría pagado pero todavía bloqueado en el Portal.
      if(check.origen === 'BLACKLIST' && check.historial_id){
        if(saveBtn.disabled) return;
        saveBtn.disabled = true;
        let ok = false;
        try{
          const pc = (typeof pcOperativa !== 'undefined' && pcOperativa) || window.pcOperativa || '';
          const r = await window.panelAPI.rpc('nodo_beta_retiro_blacklist_excluir_v1', {
            p_pc_codigo: pc, p_historial_id: Number(check.historial_id),
            p_operador: (window.operador && (window.operador.usuario || window.operador.nombre)) || ''
          });
          let d = r && r.data; if(typeof d === 'string'){ try{ d = JSON.parse(d); }catch(_e){ d = null; } }
          ok = !!(r && !r.error && d && d.ok === true);
        }catch(_e){ ok = false; }
        saveBtn.disabled = false;
        if(!ok){ try{ toast('No se pudo sacar de la blacklist. No se siguió con el retiro: probá de nuevo.', 'red'); }catch(_e){} return; }
        try{ toast('Sacado de la blacklist: ya puede retirar.', 'green'); }catch(_e){}
      }
      limpiarHandlers();
      cerrarModal();
      resolve(true);
    };
    if(cancelBtn) cancelBtn.onclick = function(){
      limpiarHandlers();
      cerrarModal();
      resolve(false);
    };
  });
}

function esPendiente(s){const e=normalizar(s.ESTADO);return e.includes("PENDIENTE")||e==="NUEVA"||e==="NUEVO"||e==="EN_REVISION"}

// ── Sistema de lealtad ────────────────────────────────────────────────────────
// Lógica: el volumen exitoso pesa más que los rechazos.
// Los rechazos penalizan según su TASA (rechazados/total), no su cantidad absoluta.
// Ejemplo: 500 exitosas + 20 rechazadas → tasa 3.8% → penalización mínima → score alto.
function calcularLealtad(usuarioNombre){
  const todas = solicitudes.filter(s=>normalizar(s.USUARIO||s.USUARIO_JUGADOR||"")===normalizar(usuarioNombre));
  const aprobadas  = todas.filter(esRealizada).length;
  const rechazadas = todas.filter(s=>normalizar(s.ESTADO)==="RECHAZADA").length;
  const totalOps   = aprobadas + rechazadas;
  const totalMonto = todas.filter(esRealizada).reduce((a,s)=>a+Number(s.MONTO_REAL||s.MONTO_DECLARADO||s.MONTO||0),0);

  if(totalOps===0) return {score:5,nivel:"Nuevo",color:"muted",aprobadas:0,rechazadas:0,tasa:100,totalMonto:0};

  const tasaExito  = aprobadas/totalOps;                        // 0–1

  // Volumen: logarítmico, tope 35 pts. 10 ops → ~17pts, 100 ops → ~35pts, 500 → 35pts
  const volScore   = Math.min(Math.log10(aprobadas+1)*17.5, 35);

  // Tasa de éxito: pesa 45 pts — el factor más importante
  const rateScore  = tasaExito * 45;

  // Monto total operado: logarítmico, tope 20 pts
  const montoScore = Math.min(Math.log10(totalMonto/1000+1)*10, 20);

  const score = Math.round(Math.min(volScore+rateScore+montoScore, 100));

  let nivel,color;
  if(score<15){nivel="Nuevo";color="muted"}
  else if(score<35){nivel="Regular";color="blue"}
  else if(score<55){nivel="Confiable";color="green"}
  else if(score<75){nivel="Preferencial";color="purple"}
  else{nivel="VIP";color="yellow"}

  return {score,nivel,color,aprobadas,rechazadas,tasa:Math.round(tasaExito*100),totalMonto};
}

function scoreBadge(usuarioNombre){
  const l=calcularLealtad(usuarioNombre);
  const colores={muted:"#667085",blue:"#3d5afe",green:"#12b76a",purple:"#7c3aed",yellow:"#fdb022"};
  const bg={muted:"#2a2f3b",blue:"#16235f",green:"#11371f",purple:"#2e1a5e",yellow:"#3d2d00"};
  const color=colores[l.color]||colores.muted;
  const bgc=bg[l.color]||bg.muted;
  return `<span title="${l.aprobadas} aprobadas · ${l.rechazadas} rechazadas · ${l.tasa}% éxito" style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;background:${bgc};color:${color};cursor:help">${l.score}</span>`;
}
function esRealizada(s){const e=normalizar(s.ESTADO);return ["APROBADA_MANUAL","APROBADA_MANUAL_OK","ACREDITADA","PAGADA","APROBADA"].includes(e)}
function estadoBadge(e){const x=normalizar(e);if(esRealizada({ESTADO:e}))return`<span class="badge badge-ok">${e}</span>`;if(["RECHAZADA","ERROR"].includes(x))return`<span class="badge badge-danger">${e}</span>`;return`<span class="badge badge-pending">${e||"-"}</span>`}
function escapeHtml(text){return String(text||"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}

