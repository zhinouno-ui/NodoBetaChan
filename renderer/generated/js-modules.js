// Funciones sin DOM ni estado del panel. Los Intl se crean una sola vez, al usarlos.
(function(root, factory){
  if(typeof module==='object' && module.exports && typeof window==='undefined') module.exports=factory();
  else (root.NodoDomain||(root.NodoDomain={})).formatos=factory();
})(globalThis, function(){
  'use strict';
  const ZONA_AR='America/Argentina/Buenos_Aires';
  let moneda, fechaHora, horaChat, diaArgentina, miles;

  function money(v){
    moneda ||= new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0});
    return moneda.format(Number(v||0));
  }
  function normalizar(v){ return String(v||'').trim().toUpperCase(); }
  function formatFecha(fechaRaw){
    if(!fechaRaw) return '';
    try{
      const fecha=new Date(fechaRaw);
      if(isNaN(fecha)) return String(fechaRaw||'');
      fechaHora ||= new Intl.DateTimeFormat('es-AR',{
        timeZone:ZONA_AR, day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false
      });
      return fechaHora.format(fecha).replace(',', ' ·');
    }catch(_e){ return String(fechaRaw||''); }
  }
  function formatearHoraChat(fechaRaw){
    if(!fechaRaw) return '';
    try{
      const fecha=new Date(fechaRaw);
      if(isNaN(fecha)) return '';
      horaChat ||= new Intl.DateTimeFormat('es-AR',{
        timeZone:ZONA_AR, hour:'2-digit', minute:'2-digit', hour12:false
      });
      return horaChat.format(fecha);
    }catch(_e){ return ''; }
  }
  // `ahora` explícito permite verificar límites sin cambiar el reloj del sistema.
  function inicioDiaArgentina(ahora=Date.now()){
    diaArgentina ||= new Intl.DateTimeFormat('en-CA',{
      timeZone:ZONA_AR, year:'numeric', month:'2-digit', day:'2-digit'
    });
    const partes=diaArgentina.formatToParts(new Date(ahora));
    const get=tipo=>partes.find(p=>p.type===tipo).value;
    return new Date(get('year')+'-'+get('month')+'-'+get('day')+'T00:00:00-03:00');
  }
  // Exportación de agentes: MM/DD/YYYY HH:MM:SS interpretado en Argentina.
  function parseFechaCSV(str){
    if(!str) return null;
    const s=String(str).trim();
    const m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if(m){
      const iso=m[3]+'-'+m[1].padStart(2,'0')+'-'+m[2].padStart(2,'0')+'T'
        +(m[4]||'00').padStart(2,'0')+':'+(m[5]||'00').padStart(2,'0')+':'+(m[6]||'00').padStart(2,'0')+'-03:00';
      const fecha=new Date(iso);
      if(!isNaN(fecha)) return fecha;
    }
    const fecha=new Date(s);
    return isNaN(fecha)?null:fecha;
  }
  function getTurno(fechaISO){
    if(!fechaISO) return 'TN';
    const h=new Date(new Date(fechaISO).getTime()-3*60*60*1000).getUTCHours();
    return h>=6&&h<14?'TM':h>=14&&h<22?'TT':'TN';
  }
  function soloDigitos(v){ return Math.abs(Number(String(v==null?'':v).replace(/[^\d]/g,''))||0); }
  function formatMiles(n){
    miles ||= new Intl.NumberFormat('es-AR');
    return miles.format(n);
  }
  function cotejoFmtMiles(v){ const n=soloDigitos(v); return n?formatMiles(n):''; }
  function fmtMilesConSigno(v){
    const neg=/^\s*-/.test(String(v==null?'':v)), n=soloDigitos(v);
    return n?(neg?'-':'')+formatMiles(n):(neg?'-':'');
  }
  function parseMontoConSigno(v){ return /^\s*-/.test(String(v==null?'':v))?-soloDigitos(v):soloDigitos(v); }

  return Object.freeze({money, normalizar, formatFecha, formatearHoraChat, inicioDiaArgentina,
    parseFechaCSV, getTurno, cotejoFmtMiles, fmtMilesConSigno, parseMontoConSigno});
});
// Importación: convierte texto en datos; el adaptador del panel administra archivos y Supabase.
(function(root, factory){
  if(typeof module==='object' && module.exports && typeof window==='undefined') module.exports=factory(require('./formatos.js'));
  else (root.NodoDomain||(root.NodoDomain={})).csv=factory(root.NodoDomain.formatos);
})(globalThis, function(formatos){
  'use strict';
  function parseCSV(text){
    if(text.charCodeAt(0)===0xFEFF) text=text.slice(1);
    const rows=[];
    let row=[], cur='', inQuotes=false;
    for(let i=0;i<text.length;i++){
      const c=text[i];
      if(inQuotes){
        if(c==='"'&&text[i+1]==='"'){ cur+='"'; i++; }
        else if(c==='"') inQuotes=false;
        else cur+=c;
      }else{
        if(c==='"') inQuotes=true;
        else if(c===','){ row.push(cur); cur=''; }
        else if(c==='\n'||c==='\r'){
          row.push(cur); rows.push(row); row=[]; cur='';
          if(c==='\r'&&text[i+1]==='\n') i++;
        }else cur+=c;
      }
    }
    if(cur||row.length||text.endsWith('"')){ row.push(cur); rows.push(row); }
    return rows;
  }
  function cleanPhone(v){ return v?(String(v).replace(/[^\d]/g,'')||null):null; }
  function parseNumCsv(v){
    if(v===undefined||v===null||v==='') return 0;
    const n=Number(String(v).replace(/\./g,'').replace(',','.'));
    return Number.isFinite(n)?n:0;
  }
  function parseIntCsv(v){
    if(v===undefined||v===null||v==='') return 0;
    const n=parseInt(String(v).trim(),10);
    return Number.isFinite(n)?n:0;
  }
  function columnas(headers){
    const indices=new Map(headers.map((h,i)=>[String(h||'').trim().toLowerCase(),i]));
    return (row,name)=>{ const i=indices.get(name); return i===undefined?'':(row[i]??''); };
  }
  function prepararJugadores(rows, pc){
    if(!rows.length) return [];
    const getCol=columnas(rows[0]), registros=[];
    for(let i=1;i<rows.length;i++){
      const r=rows[i];
      if(!r||!r.length) continue;
      const usuario=String(getCol(r,'usuarios')||'').trim();
      if(!usuario||/^\d{4}-\d{2}-\d{2}t/i.test(usuario)||(/^\d+$/.test(usuario)&&usuario.length>=10)) continue;
      const alias=String(getCol(r,'alias')||'').trim();
      const reg={
        usuario:usuario.toLowerCase(), nombre:alias||usuario.toLowerCase(), alias:alias||null,
        estado_revision:String(getCol(r,'estado de revision')||'').trim()||null,
        estado_actual:String(getCol(r,'estado actual')||'').trim()||null,
        cargas_hist:parseIntCsv(getCol(r,'cargas')), descargas_hist:parseIntCsv(getCol(r,'descargas')),
        neto:parseNumCsv(getCol(r,'neto')), score_hist:parseNumCsv(getCol(r,'score')),
        lealtad:parseIntCsv(getCol(r,'lealtad')),
        ultima_actividad:String(getCol(r,'ultima actividad')||'').trim()||null,
        contactado_por:String(getCol(r,'ya contactados')||'').trim()||null,
        recuperado_por:String(getCol(r,'recuperados!')||'').trim()||null, pc_codigo:pc
      };
      const tel=cleanPhone(getCol(r,'telefono'));
      if(tel) reg.telefono=tel;
      registros.push(reg);
    }
    return registros;
  }
  function prepararOperaciones(text, ahora=Date.now()){
    // La declaración opcional de Excel no es un registro CSV.
    text=text.replace(/^\uFEFF/, '').replace(/^\s*sep=,[ \t]*(?:\r\n|\r|\n|$)/i, '');
    const rows=parseCSV(text), aliasSet=new Set(), retiros=[];
    if(!rows.length) return {aliases:[], retiros, totalRows:0};
    const getCol=columnas(rows[0]), desde=new Date(ahora).getTime()-24*60*60*1000;
    let totalRows=0;
    for(let i=1;i<rows.length;i++){
      const row=rows[i], alias=String(getCol(row,'alias')||'').trim().toLowerCase();
      if(!alias||alias==='donplata') continue;
      aliasSet.add(alias); totalRows++;
      const tipo=String(getCol(row,'tipo')||'').trim();
      const cantidad=parseFloat(String(getCol(row,'cantidad')).replace(/,/g,'.')||'0');
      const fecha=getCol(row,'fecha');
      if(tipo==='Deposito de un jugador'&&cantidad<0&&fecha){
        const date=formatos.parseFechaCSV(fecha);
        if(date&&date.getTime()>=desde) retiros.push({alias, fecha:date.toISOString(), monto:Math.abs(cantidad)});
      }
    }
    return {aliases:[...aliasSet], retiros, totalRows};
  }
  return Object.freeze({parseCSV, cleanPhone, parseNumCsv, parseIntCsv, prepararJugadores, prepararOperaciones});
});
// Motor puro: recibe casos/historial; no consulta DOM, red, billeteras ni almacenamiento.
(function(root, factory){
  if(typeof module==='object' && module.exports && typeof window==='undefined') module.exports=factory();
  else (root.NodoDomain||(root.NodoDomain={})).conciliacion=factory();
})(globalThis, function(){
  'use strict';
  const HORA=60*60*1000, OFFSET_AR=-3*HORA;
  function turno(ts=Date.now()){
    // Trabajar en UTC sobre la hora desplazada evita depender del TZ de Windows.
    const d=new Date(new Date(ts).getTime()+OFFSET_AR), h=d.getUTCHours();
    let franja, inicio;
    if(h>=22){ franja='22-06'; inicio=22; }
    else if(h<6){ franja='22-06'; inicio=22; d.setUTCDate(d.getUTCDate()-1); }
    else if(h<14){ franja='06-14'; inicio=6; }
    else{ franja='14-22'; inicio=14; }
    const id=d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0')+'-'+String(d.getUTCDate()).padStart(2,'0')+'_'+franja;
    d.setUTCHours(inicio,0,0,0);
    return {id, inicioMs:d.getTime()-OFFSET_AR};
  }
  function turnoId(ts){ return turno(ts).id; }
  function inicioTurnoMs(ts){ return turno(ts).inicioMs; }
  function agregar(map, key, value){
    const values=map.get(key);
    if(values) values.push(value); else map.set(key,[value]);
  }
  function match(casos, movs){
    casos=Array.isArray(casos)?casos:[]; movs=Array.isArray(movs)?movs:[];
    const falt=[], sobr=[], sobrPorMonto=new Map(), retiros=new Map(), deposPorMonto=new Map();
    for(const c of casos){
      const monto=Number(c.monto_disponible);
      if(!(monto>0)) continue;
      if(c.tipo==='FALTANTE') falt.push(c);
      if(c.tipo==='SOBRANTE'){ sobr.push(c); agregar(sobrPorMonto,monto,c); }
    }
    // Una sola pasada sobre movimientos, en vez de filtrarlos por cada caso.
    for(const mov of movs){
      const tipo=String(mov.tipo||'').toUpperCase(), monto=Math.abs(Number(mov.monto));
      if(tipo==='RETIRO'&&!mov.esTransferenciaInterna){
        const wallet=String(mov.billetera_id);
        if(!retiros.has(wallet)) retiros.set(wallet,new Map());
        agregar(retiros.get(wallet),monto,mov);
      }else if(tipo==='DEPOSITO_SR'&&!(mov.usuario&&String(mov.usuario).trim())) agregar(deposPorMonto,monto,mov);
    }
    const sugerencias=[], combinaciones=[], explicaciones=[], usadosSobr=new Set();
    for(const f of falt){
      const monto=Number(f.monto_disponible);
      const pares=(sobrPorMonto.get(monto)||[]).filter(s=>!usadosSobr.has(s.case_id)&&s.wallet_id!==f.wallet_id);
      if(pares.length){
        const s=pares[0];
        if(pares.length===1) usadosSobr.add(s.case_id);
        const candidatos=(retiros.get(String(s.wallet_id))?.get(monto)||[]).slice();
        sugerencias.push({tipo:'MOVER_RETIRO', confianza:pares.length===1&&candidatos.length===1?'EXACTA':'AMBIGUA',
          caso_faltante:f.case_id, caso_sobrante:s.case_id, pares_posibles:pares.map(p=>p.case_id), candidatos});
        continue;
      }
      // Se mantiene orden y aritmética original: combinaciones sólo sugeridas, nunca aplicadas.
      for(let i=0;i<sobr.length;i++) for(let j=i+1;j<sobr.length;j++){
        if(Number(sobr[i].monto_disponible)+Number(sobr[j].monto_disponible)===monto)
          combinaciones.push({tipo:'COMBINACION',caso:f.case_id,partes:[sobr[i].case_id,sobr[j].case_id]});
      }
    }
    for(const s of sobr){
      if(usadosSobr.has(s.case_id)) continue;
      const candidatos=deposPorMonto.get(Number(s.monto_disponible));
      if(candidatos?.length) explicaciones.push({tipo:'DEPO_EXISTENTE',caso:s.case_id,candidatos:candidatos.slice()});
    }
    return {sugerencias, combinaciones, explicaciones};
  }
  function movimientosTurno(historial, inicioMs, estados=['OK','ACREDITADA','PAGADA','COMPLETADA','APROBADA']){
    const permitidos=new Set(estados), movimientos=[];
    for(const h of historial){
      const ts=h.created_at?new Date(h.created_at).getTime():0;
      if(!(ts>=inicioMs)||!permitidos.has(String(h.estado||'').toUpperCase())) continue;
      movimientos.push({id:h.id,tipo:String(h.tipo||'').toUpperCase(),billetera_id:String(h.billetera_id||''),
        billetera_nombre:h.billetera_nombre||'',monto:Math.abs(Number(h.monto||0)),usuario:h.usuario||'',
        esTransferenciaInterna:/transfer/i.test(String(h.origen||'')+' '+String(h.notas||'')),
        chunior_movimiento_id:h.chunior_movimiento_id||null,ts,_fila:h});
    }
    return movimientos;
  }
  function indexarMovimientos(movimientos){
    const porBilletera=new Map();
    for(const mov of movimientos) agregar(porBilletera,String(mov.billetera_id),mov);
    return porBilletera;
  }
  function declaracion(saldo, valor){
    const decl=Math.abs(Number(String(valor).replace(/[^\d]/g,''))||0);
    const chunior=Number(saldo.saldo_chunior||0), dif=Math.round(decl-chunior);
    const resid=+(decl-chunior-dif).toFixed(2);
    return {wallet_id:saldo.wallet_id,nombre:saldo.nombre,chunior,decl,dif,resid};
  }
  return Object.freeze({turnoId, inicioTurnoMs, match, movimientosTurno, indexarMovimientos, declaracion});
});
// Caja negra de las operaciones contra Agentes.
//
// No adivina el error: guarda el CAMINO. No se puede escribir de antemano el cartel de una falla
// que todavía no ocurrió, así que en vez de eso se anota cada paso que se dio. Cuando algo corta,
// lo que sirve es saber hasta dónde llegó y de qué capa salió el corte.
//
// Módulo puro: no toca DOM, ni red, ni localStorage. El adaptador del panel decide qué guardar y
// dónde. Acá no entra NADA sensible: el adaptador nunca pasa argumentos de operación (una clave
// viaja en los argumentos de iniciarSesion), y por si acaso todo texto se recorta.
(function(root, factory){
  if(typeof module==='object' && module.exports && typeof window==='undefined') module.exports=factory();
  else (root.NodoDomain||(root.NodoDomain={})).cajaNegra=factory();
})(globalThis, function(){
  'use strict';

  const TOPE_PASOS  = 200;   // pasos que se recuerdan
  const TOPE_FALLAS = 20;    // fallas con su rastro, para consultar después
  const RASTRO      = 12;    // cuántos pasos se guardan con cada falla
  const MAX_TEXTO   = 300;

  function texto(v){
    if(v === null || v === undefined) return '';
    const s = typeof v === 'string' ? v : (v.message || String(v));
    return s.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXTO);
  }

  // De quién es la falla. NO es un catálogo de errores previstos: son las firmas de quien EMITE el
  // mensaje, que es un dato del sistema, no un pronóstico. Lo que no se reconoce queda
  // 'desconocida' a propósito — mejor eso que atribuirlo mal.
  function capaDeError(mensaje){
    const m = texto(mensaje);
    if(!m) return 'desconocida';
    if(/^Timeout: la automatizaci/i.test(m))                      return 'main';       // requests.run de main
    if(/se recarg[oó] durante la operaci/i.test(m))               return 'main';       // did-navigate de main
    if(/La ventana de Agentes se cerr/i.test(m))                  return 'main';
    if(/M[eé]todo no permitido/i.test(m))                         return 'contrato';   // panel↔preload desalineados
    if(/no se ejecut[oó]/i.test(m) && /Sesi[oó]n de Agentes/i.test(m)) return 'panel'; // cortacircuitos de la cola
    if(/super[oó] \d+s .*destrab/i.test(m))                       return 'panel';      // tope de tarea de la cola
    if(/Operaci[oó]n frenada por el operador/i.test(m))            return 'operador';
    if(/session is invalid|Se cay[oó] la sesi[oó]n de Agentes/i.test(m)) return 'agentes';
    if(/No se encontr[oó]|no mostraba|no apareci[oó]|tapado|selector/i.test(m)) return 'preload';
    return 'desconocida';
  }

  function crear(opciones){
    const o = opciones || {};
    const ahora = typeof o.ahora === 'function' ? o.ahora : Date.now;
    const topePasos  = o.topePasos  > 0 ? o.topePasos  : TOPE_PASOS;
    const topeFallas = o.topeFallas > 0 ? o.topeFallas : TOPE_FALLAS;
    let contexto = {};
    const pasos = [];
    const fallas = [];

    // El contexto es quién está operando: pc, operador, backend, versión. Va con cada falla para
    // poder mirarlo PC por PC.
    function contextoActual(nuevo){
      if(nuevo && typeof nuevo === 'object'){
        for(const k of Object.keys(nuevo)){
          const v = nuevo[k];
          if(v !== null && v !== undefined && v !== '') contexto[k] = texto(v);
        }
      }
      return Object.assign({}, contexto);
    }

    function anotar(paso){
      const p = paso || {};
      const fila = {
        t: ahora(),
        paso: texto(p.paso) || '(sin nombre)',
        capa: texto(p.capa) || 'panel',
        estado: texto(p.estado) || 'inicio'
      };
      if(p.ms !== null && p.ms !== undefined && isFinite(Number(p.ms))) fila.ms = Math.round(Number(p.ms));
      const d = texto(p.detalle);
      if(d) fila.detalle = d;
      // Lo que devuelve el preload al fallar dice DÓNDE quedó la pantalla: eso es lo que no se
      // puede reconstruir después.
      if(p.pantalla) fila.pantalla = texto(p.pantalla);
      pasos.push(fila);
      if(pasos.length > topePasos) pasos.splice(0, pasos.length - topePasos);
      return fila;
    }

    // Una falla congela el rastro del momento. Sin esto, los pasos que vienen después la tapan y
    // cuando se va a mirar ya no está el camino que importaba.
    function anotarFalla(datos){
      const d = datos || {};
      const mensaje = texto(d.mensaje);
      const falla = {
        t: ahora(),
        paso: texto(d.paso) || '(sin nombre)',
        mensaje,
        capa: texto(d.capa) || capaDeError(mensaje),
        contexto: contextoActual(),
        rastro: pasos.slice(-RASTRO)
      };
      if(d.pantalla) falla.pantalla = texto(d.pantalla);
      fallas.push(falla);
      if(fallas.length > topeFallas) fallas.splice(0, fallas.length - topeFallas);
      return falla;
    }

    function ultimoPaso(){ return pasos.length ? pasos[pasos.length - 1] : null; }

    // Una línea para leer de un vistazo: hasta dónde llegó y de quién fue.
    function resumen(falla){
      const f = falla || (fallas.length ? fallas[fallas.length - 1] : null);
      if(!f) return 'sin fallas registradas';
      const partes = ['cortó en "' + f.paso + '"', 'capa: ' + f.capa];
      const previos = f.rastro.filter(p => p.paso !== f.paso && p.estado === 'ok').slice(-2).map(p => p.paso);
      if(previos.length) partes.push('lo último que sí anduvo: ' + previos.join(' → '));
      if(f.pantalla) partes.push('pantalla: ' + f.pantalla);
      if(f.mensaje) partes.push('dijo: ' + f.mensaje);
      return partes.join(' · ');
    }

    function exportar(){
      return { contexto: contextoActual(), pasos: pasos.slice(), fallas: fallas.slice() };
    }

    function importar(guardado){
      const g = guardado || {};
      if(g.contexto && typeof g.contexto === 'object') contextoActual(g.contexto);
      if(Array.isArray(g.pasos))  pasos.push(...g.pasos.slice(-topePasos));
      if(Array.isArray(g.fallas)) fallas.push(...g.fallas.slice(-topeFallas));
    }

    function limpiar(){ pasos.length = 0; fallas.length = 0; contexto = {}; }

    return { anotar, anotarFalla, ultimoPaso, resumen, exportar, importar, limpiar,
             contexto: contextoActual,
             get pasos(){ return pasos.slice(); },
             get fallas(){ return fallas.slice(); } };
  }

  return { crear, capaDeError };
});
// Decisión: ¿qué retiros pagándose por partes hay que cerrar porque el jugador volvió a cargar?
//
// El caso que lo originó (Maria6981x, 26/9): tenía un retiro parcial abierto, se jugó las fichas
// del retiro y volvió a cargar. El parcial siguió vivo pidiendo el resto de una plata que ya no
// correspondía, y el operador lo cerró siete veces.
//
// Decisión de Juan (26/9): al entrar la carga, el parcial se cierra SOLO, sin confirmar. Queda
// pagado lo que se pagó y el resto se da de baja con motivo automático.
//
// Módulo puro: decide, no escribe. El adaptador del panel hace el cierre y el aviso.
(function(root, factory){
  if(typeof module==='object' && module.exports && typeof window==='undefined') module.exports=factory();
  else (root.NodoDomain||(root.NodoDomain={})).parciales=factory();
})(globalThis, function(){
  'use strict';

  const MOTIVO = 'CARGO_DE_NUEVO';
  const ETIQUETA = 'Volvió a cargar con el retiro a medio pagar';

  function texto(v){ return String(v == null ? '' : v).trim(); }
  function usuarioDe(s){ return texto(s && (s.USUARIO || s.USUARIO_JUGADOR)).toLowerCase(); }
  function tipoDe(s){ return texto(s && (s.TIPO || s.TIPO_SOLICITUD)).toUpperCase(); }
  function idDe(s){ return texto(s && (s.ID || s.SOLICITUD_ID || s.id)); }
  function fechaDe(s){
    const v = s && (s.FECHA_CREACION || s.created_at || s.FECHA);
    const t = new Date(v || 0).getTime();
    return Number.isFinite(t) ? t : 0;
  }

  // `info` y `cerrado` los pone el panel: son las mismas funciones con las que pinta la caja, así
  // que esto no puede opinar distinto que lo que el operador ve en pantalla.
  function aCerrarPorCarga(opciones){
    const o = opciones || {};
    const solicitudes = Array.isArray(o.solicitudes) ? o.solicitudes : [];
    const info = typeof o.info === 'function' ? o.info : function(){ return null; };
    const cerrado = typeof o.cerrado === 'function' ? o.cerrado : function(){ return false; };
    const yaVistos = o.yaVistos instanceof Set ? o.yaVistos : new Set();

    // Las cargas, agrupadas por jugador y ordenadas: alcanza con la más nueva posterior al retiro.
    const cargasPorUsuario = new Map();
    for(const s of solicitudes){
      if(tipoDe(s) !== 'CARGA') continue;
      const u = usuarioDe(s); if(!u) continue;
      if(!cargasPorUsuario.has(u)) cargasPorUsuario.set(u, []);
      cargasPorUsuario.get(u).push(s);
    }

    const salida = [];
    for(const s of solicitudes){
      if(tipoDe(s) !== 'RETIRO') continue;
      const id = idDe(s); if(!id || yaVistos.has(id)) continue;
      // Un cierre deliberado (a mano o de antes) no se vuelve a tocar: es definitivo.
      if(cerrado(s)) continue;
      const estado = texto(s && s.ESTADO).toUpperCase();
      if(/RECHAZ|CANCEL/.test(estado)) continue;
      const pp = info(s);
      // Sólo los que se están pagando POR PARTES y todavía deben plata. Un retiro común no entra
      // acá, y uno ya saldado tampoco: cerrarlo no cambiaría nada y ensuciaría el historial.
      if(!pp || !pp.hasProg || !(pp.total > 0) || !(pp.restante > 0.5)) continue;

      const desde = fechaDe(s);
      // La carga tiene que ser POSTERIOR al retiro. Sin esto, una carga vieja del mismo jugador
      // cerraría el parcial apenas se abre — que es exactamente al revés de lo que se busca.
      let carga = null;
      for(const c of (cargasPorUsuario.get(usuarioDe(s)) || [])){
        const t = fechaDe(c);
        if(t <= desde) continue;
        if(!carga || t > fechaDe(carga)) carga = c;
      }
      if(!carga) continue;

      salida.push({
        id: id,
        solicitud: s,
        cargaId: idDe(carga),
        cargaMonto: Number(carga.MONTO_REAL || carga.MONTO || carga.MONTO_DECLARADO || 0) || 0,
        cargaFecha: fechaDe(carga),
        pagado: pp.pagado, total: pp.total, restante: pp.restante,
        motivo: MOTIVO, etiqueta: ETIQUETA
      });
    }
    return salida;
  }

  // Estados que el panel considera "cerrada". Copia de data.js: el llamador puede pasar la suya
  // (requests-view lo hace) y esa manda, así no pueden divergir.
  const CERRADOS = ['ACREDITADA','PAGADA','APROBADA','RECHAZADA','CANCELADA','CERRADA','FINALIZADA'];
  function cerradoPorDefecto(e){ return CERRADOS.indexOf(texto(e).toUpperCase()) >= 0; }

  // ¿Este retiro va a la caja de "pagándose por partes"?
  //
  // UN solo criterio, compartido por los dos lugares que lo usan: el render del Inicio (que arma la
  // lista y el contador) y el modal (que la muestra). Estaban escritos aparte y se contradecían.
  //
  // OJO: los que ya cobraron todo pero NADIE cerró siguen entrando a propósito. Es el único lugar
  // desde donde se los puede cerrar; sacarlos de acá los manda a tapar la lista principal, que es
  // el problema que la caja vino a resolver.
  function enProceso(s, opciones){
    const o = opciones || {};
    const info = typeof o.info === 'function' ? o.info : function(){ return null; };
    const cerrado = typeof o.cerrado === 'function' ? o.cerrado : function(){ return false; };
    const estadoCerrado = typeof o.estadoCerrado === 'function' ? o.estadoCerrado : cerradoPorDefecto;
    const sigueAbierto = typeof o.sigueAbierto === 'function' ? o.sigueAbierto : function(){ return false; };
    try{
      if(tipoDe(s) !== 'RETIRO') return false;
      if(/RECHAZ|CANCEL/.test(texto(s && s.ESTADO).toUpperCase())) return false;
      // Cerrado a mano (o solo): es definitivo, no vuelve.
      if(cerrado(s)) return false;
      // La misma regla con la que el Inicio decide si una solicitud sigue abierta. Sin esto, un
      // retiro PAGADA y cobrado entero se quedaba en la caja diciendo "falta $38.907" (D-108).
      if(estadoCerrado(s && s.ESTADO) && !sigueAbierto(s)) return false;
      const pp = info(s);
      return !!(pp && pp.hasProg && pp.total > 0);
    }catch(_e){ return false; }
  }

  // La nota que queda registrada y que ve el jugador. Sin nombres de operadores ni billeteras.
  function notaCierre(caso, money){
    const m = typeof money === 'function' ? money : function(n){ return String(n); };
    return 'Cerrado automáticamente: se registró una carga nueva (' + m(caso.cargaMonto) + ') '
         + 'con el retiro a medio pagar. Cobrado ' + m(caso.pagado) + ' de ' + m(caso.total)
         + '; quedaron sin pagar ' + m(caso.restante) + '.';
  }

  return { aCerrarPorCarga, enProceso, notaCierre, MOTIVO, ETIQUETA };
});
// Qué muestra NODO en Discord. Dos renglones, nada más:
//
//   NODO OPERATIVO            ← el nombre de la app, sale de Discord
//   3 solicitudes pendientes  ← details
//   Última carga hace 3 min   ← state
//
// Los retiros que se están pagando POR PARTES NO cuentan como pendientes: son una solicitud que ya
// se aceptó y se está trabajando, no algo esperando que alguien la agarre (Juan, 26/9).
//
// Módulo puro: decide el texto. El adaptador lo manda; main lo publica.
(function(root, factory){
  if(typeof module==='object' && module.exports && typeof window==='undefined') module.exports=factory();
  else (root.NodoDomain||(root.NodoDomain={})).presencia=factory();
})(globalThis, function(){
  'use strict';

  function texto(v){ return String(v == null ? '' : v).trim(); }
  function tipoDe(s){ return texto(s && (s.TIPO || s.TIPO_SOLICITUD)).toUpperCase(); }
  function estadoDe(s){ return texto(s && s.ESTADO).toUpperCase(); }
  function fechaDe(s){
    const t = new Date((s && (s.FECHA_CREACION || s.created_at || s.FECHA)) || 0).getTime();
    return Number.isFinite(t) ? t : 0;
  }

  // "recién", "hace 3 min", "hace 1 h 5 min", "hace 2 d".
  function hace(ms){
    if(!(ms >= 0)) return '';
    const min = Math.floor(ms / 60000);
    if(min < 1)  return 'recién';
    if(min < 60) return 'hace ' + min + ' min';
    const h = Math.floor(min / 60), resto = min % 60;
    if(h < 24)   return 'hace ' + h + ' h' + (resto ? ' ' + resto + ' min' : '');
    const d = Math.floor(h / 24);
    return 'hace ' + d + ' d';
  }

  function armar(opciones){
    const o = opciones || {};
    const solicitudes = Array.isArray(o.solicitudes) ? o.solicitudes : [];
    const ahora = Number(o.ahora) || Date.now();
    // Mismo criterio que la caja de Parciales: no puede opinar distinto que la pantalla.
    const esParcial = typeof o.esParcial === 'function' ? o.esParcial : function(){ return false; };

    let pendientes = 0;
    let ultimaCarga = 0;
    for(const s of solicitudes){
      const tipo = tipoDe(s);
      if(tipo === 'SOPORTE') continue;                       // el soporte va al chat, no es una operación
      const estado = estadoDe(s);
      if(tipo === 'CARGA' && /ACREDITADA|APROBADA|PAGADA/.test(estado)){
        const t = fechaDe(s);
        if(t > ultimaCarga) ultimaCarga = t;
      }
      if(/RECHAZ|CANCEL|ACREDITADA|APROBADA|PAGADA|CERRAD|FINALIZ/.test(estado)) continue;
      if(esParcial(s)) continue;                             // ya aceptada y en curso: no está esperando
      pendientes++;
    }

    const details = pendientes === 0 ? 'Sin solicitudes pendientes'
      : pendientes === 1 ? '1 solicitud pendiente'
      : pendientes + ' solicitudes pendientes';

    const state = ultimaCarga > 0 ? ('Última carga ' + hace(ahora - ultimaCarga))
                                  : 'Sin cargas todavía';

    const pc = texto(o.pc);
    return {
      details: details,
      state: state,
      // Lo que se ve al pasar el mouse por el ícono.
      largeText: 'NODO' + (o.version ? ' ' + texto(o.version) : '') + (pc ? ' · ' + pc : ''),
      pendientes: pendientes,
      ultimaCarga: ultimaCarga || null
    };
  }

  // ¿Cambió algo que valga la pena publicar? Discord limita a un update cada ~15 s, y mandar lo
  // mismo una y otra vez es puro ruido.
  function distinta(a, b){
    if(!a || !b) return true;
    return a.details !== b.details || a.state !== b.state || a.largeText !== b.largeText;
  }

  return { armar, distinta, hace };
});
(function(root, factory){
  if(typeof module === 'object' && module.exports) module.exports = factory();
  else root.NodoRefresh = factory();
})(globalThis, function(){
  'use strict';

  // Sólo lecturas: agrupa ráfagas y garantiza una lectura final si llegó un evento
  // durante una petición. Nunca usar para acciones monetarias ni escrituras.
  function create(tasks, { timers = globalThis, delay = 80, onError = () => {} } = {}) {
    const entries = new Map();
    let disposed = false;
    for(const [name, task] of Object.entries(tasks)) {
      entries.set(name, { task, timer: null, running: false, dirty: false });
    }
    function request(name) {
      const entry = entries.get(name);
      if(!entry) throw new Error('Lectura desconocida: ' + name);
      if(disposed) return;
      entry.dirty = true;
      if(entry.running || entry.timer !== null) return;
      entry.timer = timers.setTimeout(() => {
        entry.timer = null;
        if(disposed) return;
        entry.dirty = false;
        entry.running = true;
        Promise.resolve().then(() => {
          if(!disposed) return entry.task();
        }).catch(error => {
          try { onError(error, name); } catch(_) {}
        }).finally(() => {
          entry.running = false;
          if(entry.dirty && !disposed) request(name);
        });
      }, delay);
    }
    function dispose() {
      disposed = true;
      for(const entry of entries.values()) {
        if(entry.timer !== null) timers.clearTimeout(entry.timer);
        entry.timer = null;
        entry.dirty = false;
      }
    }
    return { request, dispose };
  }
  return { create };
});
(function(root, factory){
  if(typeof module === 'object' && module.exports) module.exports = factory(require('./refresh-coordinator.js'));
  else root.NodoRealtime = factory(root.NodoRefresh);
})(globalThis, function(Refresh){
  'use strict';

  function create({ client, getOffice, getAliases, hasOpenChat, refresh,
    notify = () => {}, playSound = () => {}, logger = console, timers = globalThis }) {
    const channels = new Map();
    const intervals = [];
    let stopped = false;
    const reads = Refresh.create({
      requests: refresh.requests, wallets: refresh.wallets, chats: refresh.chats,
      conversation: () => { if(hasOpenChat()) return refresh.conversation(); }
    }, { timers, onError: (error, name) => logger.warn('[RT] lectura ' + name, error) });

    function isMyOffice(pc) {
      const eventPc = String(pc || '').toUpperCase().trim();
      if(!eventPc) return true;
      let aliases;
      try { aliases = getAliases(); } catch(_) { aliases = [getOffice()]; }
      aliases = (aliases || []).map(x => String(x).toUpperCase().trim()).filter(Boolean);
      return !aliases.length || aliases.includes(eventPc);
    }
    function remove(key) {
      const channel = channels.get(key);
      channels.delete(key);
      if(channel) {
        try { Promise.resolve(client.removeChannel(channel)).catch(error => logger.warn('[RT] cierre', error)); }
        catch(error) { logger.warn('[RT] cierre', error); }
      }
    }
    function subscribe(key, name, type, filter, handler) {
      if(stopped || !client) return;
      remove(key);
      try {
        // Un callback de una suscripción reemplazada no debe disparar nuevas lecturas.
        const channel = client.channel(name);
        channels.set(key, channel);
        channel.on(type, filter, payload => {
          if(!stopped && channels.get(key) === channel) handler(payload);
        }).subscribe();
      } catch(error) { logger.warn('[RT] suscripción ' + name, error); }
    }
    function inserted() { notify('🔔 Nueva solicitud'); playSound('solicitud'); }
    function subscribeRequests() {
      subscribe('requests', 'solicitudes_' + getOffice(), 'postgres_changes', {
        event: '*', schema: 'public', table: 'solicitudes', filter: 'pc_codigo=eq.' + getOffice()
      }, payload => {
        reads.request('requests');
        if(payload.eventType === 'INSERT') inserted();
      });
    }
    function subscribeRequestBroadcast() {
      subscribe('requestBroadcast', 'nodo:solicitudes', 'broadcast', { event: 'cambio' }, msg => {
        const payload = msg && msg.payload;
        if(!isMyOffice(payload && payload.pc)) return;
        reads.request('requests');
        if(payload && String(payload.op) === 'INSERT') inserted();
      });
    }
    function subscribeChatBroadcast() {
      subscribe('chatBroadcast', 'nodo:chat', 'broadcast', { event: 'cambio' }, msg => {
        if(!isMyOffice(msg && msg.payload && msg.payload.pc)) return;
        reads.request('chats');
        if(hasOpenChat()) reads.request('conversation');
      });
    }
    function startPolling() {
      if(stopped || intervals.length) return;
      intervals.push(timers.setInterval(() => reads.request('requests'), 60000));
      intervals.push(timers.setInterval(() => reads.request('wallets'), 20000));
      intervals.push(timers.setInterval(() => {
        if(hasOpenChat()) reads.request('conversation');
      }, 3500));
    }
    function stop() {
      if(stopped) return;
      stopped = true;
      reads.dispose();
      intervals.forEach(id => timers.clearInterval(id));
      intervals.length = 0;
      for(const key of channels.keys()) remove(key);
    }
    return { isMyOffice, subscribeRequests, subscribeRequestBroadcast,
      subscribeChatBroadcast, startPolling, stop };
  }
  return { create };
});
(function(root, factory){
  if(typeof module === 'object' && module.exports) module.exports = factory();
  else root.NodoChatMetrics = factory();
})(globalThis, function(){
  'use strict';
  const upper = value => String(value ?? '').trim().toUpperCase();
  const date = value => { const d = new Date(value || 0); return Number.isNaN(d.getTime()) ? 0 : d.getTime(); };
  function chatKey(ticket) {
    const id = ticket?.masterId || ticket?.solicitudId || ticket?.usuario || 'chat';
    return upper(ticket?.usuario || 'usuario') + '_' + String(id).replace(/[^A-Z0-9]/gi, '_');
  }
  function snapshot(tickets, marks) {
    const byUser = new Map(), unread = new Map(), signatures = [];
    let total = 0, accepted = 0;
    for(const ticket of tickets) {
      const name = upper(ticket.usuario);
      if(!byUser.has(name)) byUser.set(name, ticket);
      let count = 0;
      if(ticket.accepted) {
        accepted++;
        const readAt = date(marks[chatKey(ticket)]);
        for(const message of ticket.thread || []) {
          if(upper(message.origen) === 'USUARIO' && date(message.fecha) > readAt) count++;
        }
      }
      unread.set(ticket, count);
      total += count;
      const thread = ticket.thread || [], last = thread[thread.length - 1] || {};
      signatures.push([ticket.usuario, ticket.accepted ? 'A' : 'E', ticket.masterId || ticket.solicitudId || '',
        thread.length, count, last.fecha || '', last.mensaje || ''].join(':'));
    }
    return { byUser, unread, total, accepted, signature: signatures.join('||') };
  }
  function create({ getTickets, readMarks, now = Date.now }) {
    let lastTotal = null, lastAt = 0;
    function read() { return snapshot(getTickets() || [], readMarks() || {}); }
    function stableTotal(real) {
      const current = now();
      if(lastTotal > 0 && real === 0 && current - lastAt < 2200) return lastTotal;
      if(real !== lastTotal) { lastTotal = real; lastAt = current; }
      return real;
    }
    return { read, stableTotal };
  }
  return { create, snapshot, chatKey };
});
