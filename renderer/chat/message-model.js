(function(root, factory){
  if(typeof module === 'object' && module.exports) module.exports = factory();
  else root.NodoChatMessage = factory();
})(globalThis, function(){
  'use strict';
  const upper = value => String(value ?? '').trim().toUpperCase();
  const COPIA_SEGUNDOS = 10, CHAT_VIGENTE_MS = 3 * 24 * 60 * 60 * 1000;
  function sourceType(m){
    const explicit = m.origen || m.tipo_emisor || m.TIPO_EMISOR || m.emisor_tipo;
    if(explicit) return upper(explicit);
    const known = /^(USUARIO|USER|CLIENTE|PORTAL|BOT|ASISTENTE|AUTOMATICO|SISTEMA|SYSTEM|OPERADOR|OPERATOR|PANEL|ADMIN)$/;
    // En mensajes antiguos emisor contiene el rol; tipo puede ser TEXTO o IMAGEN.
    for(const value of [m.tipo,m.emisor,m.EMISOR]) if(known.test(upper(value))) return upper(value);
    return '';
  }
  function metadata(message){
    const raw = message?.metadata ?? message?.METADATA ?? {};
    if(typeof raw === 'string'){ try{ return JSON.parse(raw) || {}; }catch(_){ return {}; } }
    return raw && typeof raw === 'object' ? raw : {};
  }
  function role(message){
    const m = message || {}, meta = metadata(m);
    const type = sourceType(m);
    // El nombre de un jugador nunca convierte su mensaje en uno del asistente.
    if(['USUARIO','USER','CLIENTE','PORTAL'].includes(type)) return 'USUARIO';
    const auto = m.auto ?? m.AUTO ?? meta.auto;
    if(auto === true || auto === 'true' || ['BOT','ASISTENTE','AUTOMATICO'].includes(type)) return 'BOT';
    if(/^(SIST|SYSTEM)/.test(type)) return 'SISTEMA';
    if(upper(m.operador || m.emisor || m.EMISOR || meta.operador) === 'NODO') return 'BOT';
    if(/OPER|PANEL|ADMIN/.test(type)) return 'OPERADOR';
    return 'USUARIO';
  }
  function normalize(message){
    const m = message || {}, meta = metadata(m);
    const out = Object.assign({}, m, {
      origen: sourceType(m) || role(m),
      usuario: String(m.usuario || ''),
      operador: String(m.operador || m.emisor || m.EMISOR || meta.operador || ''),
      mensaje: String(m.mensaje ?? m.MENSAJE ?? ''),
      fecha: m.fecha || m.created_at || m.FECHA || '',
      solicitud_id: m.solicitud_id || m.solicitudId || null
    });
    if(m.auto !== undefined || m.AUTO !== undefined || meta.auto !== undefined) out.auto = m.auto ?? m.AUTO ?? meta.auto;
    if(m.auto_caso || meta.auto_caso) out.auto_caso = m.auto_caso || meta.auto_caso;
    const img = m.imagen_url || m.imagen || m.IMAGEN_URL || meta.imagen_url || meta.comprobante_url || m.comprobante_url || m.COMPROBANTE_URL;
    if(img) out.imagen_url = img;
    return out;
  }
  function author(message, user){
    const type = role(message);
    if(type === 'BOT') return 'Asistente automático';
    if(type === 'SISTEMA') return 'Sistema';
    if(type === 'USUARIO') return String(user || message?.usuario || 'Usuario');
    const name = String(message?.operador || message?.emisor || message?.EMISOR || '').trim();
    return name && !['PANEL','OPERADOR'].includes(upper(name)) ? 'Operador · ' + name : 'Operador';
  }
  function className(message){ return { USUARIO:'user', OPERADOR:'op', BOT:'bot', SISTEMA:'system' }[role(message)]; }
  function key(message){
    const m = normalize(message);
    return [role(m), m.fecha, m.mensaje, m.imagen_url || ''].join('|');
  }
  // Textos que el sistema puso en boca del jugador: una solicitud sin mensaje se rellenaba con esto
  // y quedaba guardado en el hilo con origen USUARIO. El jugador nunca lo escribió (D-130).
  const FILLER = /^(consulta desde portal( v16)?|\[conversaci[oó]n iniciada por el operador[^\]]*\])$/i;
  function isFiller(message){
    const m = normalize(message);
    return role(m) === 'USUARIO' && !m.imagen_url && FILLER.test(m.mensaje.trim());
  }
  // El chat se guarda en dos lados: la tabla nueva y una copia en el hilo de la solicitud, que es lo
  // único que leen los NODO sin actualizar. Por el canal nuevo llegan las dos cosas: si esta oficina
  // ya anda por ahí, la copia sobra. Mismo lado, mismo texto y mismo segundo. Lo que existe sólo en
  // el hilo sigue saliendo.
  function sinCopias(hilo, filas){
    const segundo = v => { const t = Date.parse(String(v || '').slice(0, 19) + 'Z'); return Number.isFinite(t) ? t / 1000 : null; };
    const lado = m => (role(m) === 'USUARIO' ? 'U|' : 'O|') + String(m.mensaje ?? '').trim();
    const ya = new Map();
    for(const f of filas || []){
      const s = segundo(f.created_at || f.fecha);
      if(s !== null) ya.set(lado(f), (ya.get(lado(f)) || []).concat(s));
    }
    return (hilo || []).filter(m => {
      const s = segundo(m.fecha);
      return !(s !== null && (ya.get(lado(m)) || []).some(x => Math.abs(x - s) <= COPIA_SEGUNDOS));
    });
  }
  // El chat que el jugador está leyendo es el último que abrió, si sigue abierto y con movimiento.
  // Uno abierto de hace meses no lo lee nadie: escribir ahí dejaba el mensaje donde nadie mira y NODO
  // igual decía "enviado". Sin chat vigente, el mensaje va al hilo que el Portal lee por usuario.
  function chatVigente(sesiones, usuario, ahora){
    const u = upper(usuario);
    const propias = (sesiones || []).filter(s => u && upper(s.usuario || s.USUARIO) === u);
    if(!propias.length) return '';
    const ultima = propias.reduce((a, b) => Number(b.sesion_id || b.id || 0) > Number(a.sesion_id || a.id || 0) ? b : a);
    if(['CERRADO','RESUELTA'].includes(upper(ultima.estado))) return '';
    const cuando = Date.parse(ultima.updated_at || ultima.fecha_ultimo || ultima.created_at || '');
    return Number.isFinite(cuando) && ahora - cuando <= CHAT_VIGENTE_MS ? String(ultima.chat_id || '') : '';
  }
  // Una conversación, un solo escritor. Todo chat abierto desde el Portal tiene una solicitud puente
  // para las PCs viejas. Si el puente decidía, el mensaje siempre iba al hilo viejo y el canal nuevo
  // no escribía nunca. Con NODO en el canal nuevo y el chat abierto escribe el canal nuevo. El estado
  // de la bandeja se sigue guardando aparte, sin el mensaje.
  function escritor(ticket, hayMensaje){
    const t = ticket || {};
    if(!t._canalNuevo) return 'HILO';
    if(!t._legacyOwner) return 'CANAL';
    return hayMensaje && t._beta === true && !t.cerrado ? 'CANAL' : 'HILO';
  }
  // Cerrar una consulta es cerrar al jugador, no una sesión suelta. Quedan chats abiertos de meses
  // atrás del mismo usuario y cada uno es una fila: al cerrar uno aparecía el siguiente con el mismo
  // nombre, y parecía que el botón no andaba. 107 jugadores tenían más de uno abierto el 1/11.
  function chatsDeLaConsulta(ticket, abiertos){
    if(!ticket?._chatId) return [];
    const usuario = upper(ticket.usuario), porChat = new Map([[String(ticket._chatId), ticket]]);
    for(const t of abiertos || []){
      if(t?._chatId && usuario && upper(t.usuario) === usuario && !porChat.has(String(t._chatId))) porChat.set(String(t._chatId), t);
    }
    return [...porChat.values()];
  }
  function merge(existing, incoming){
    const result = Object.assign({}, existing);
    for(const [name,value] of Object.entries(incoming || {})){
      if(value !== undefined && value !== null && value !== '') result[name] = value;
    }
    if(existing?.metadata || incoming?.metadata) result.metadata = Object.assign({}, metadata(existing), metadata(incoming));
    return result;
  }
  // Lo que el Portal convierte en botones o en negrita se le muestra al operador en palabras: la marca ⟦INGRESAR:…⟧ y
  // los *asteriscos* salían tal cual en la conversación (Juan, 23/11: "ni se muestra bien").
  function visibleText(message){
    const text = String(message?.mensaje ?? message?.MENSAJE ?? '');
    if(role(message) === 'USUARIO') return text;
    return text.replace(/⟦AYUDA:inicio⟧/g, '[Botón: Ver opciones de ayuda]')
      .replace(/⟦AYUDA:revisar_envio⟧/g, '[Botón: Revisar una transferencia enviada]')
      .replace(/⟦INGRESAR:[^⟧]*⟧/g, '[Botón: Ingresar al portal]')
      .replace(/⟦[A-Z_]+(?::[^⟧]*)?⟧/g, '')
      .replace(/\*([^*\n]+)\*/g, '$1');
  }
  // El adelanto de la lista: una línea, sin marcas, y de quién es si no es del jugador (el asistente, los avisos de
  // NODO o un operador). Así se distingue de un vistazo lo que espera respuesta de lo que ya se contestó solo.
  function preview(message){
    const quien = role(message);
    const texto = visibleText(message).replace(/\[Botón: [^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
    if(quien === 'BOT') return '🤖 ' + texto;
    if(quien === 'OPERADOR' || quien === 'SISTEMA') return '↩ ' + texto;
    return texto;
  }
  // El pedido a una persona que arma el asistente del Portal ("Pido hablar con mi cajero. Tema: … Resumen del
  // asistente: · Última carga: $2.000 · 23/11 10:27 · no aprobada · pedido 520466 …") se lee como una ficha (Juan,
  // 23/11: "hay que mejorar estos mensajes"). Devuelve null si el mensaje no es eso.
  function resumenAsistente(message){
    const text = String(message?.mensaje ?? message?.MENSAJE ?? '');
    if(!/^\s*Pido hablar con mi cajero/i.test(text)) return null;
    const tema = ((text.match(/Tema:\s*([^\n]+?)\.?\s*(?:\n|$)/i) || [])[1] || '').trim();
    const out = { tema, eligio: '', operaciones: [], enCurso: '', resto: '' };
    const resto = [];
    text.split(/\n/).slice(1).forEach(linea => {
      const l = linea.trim();
      if(!l || /^Tema:/i.test(l) || /^Resumen del asistente:?$/i.test(l)) return;
      let m;
      if((m = l.match(/^·\s*Eligió:\s*(.+)$/i))) { out.eligio = m[1].trim(); return; }
      if((m = l.match(/^·\s*En curso:\s*(.+)$/i))) { out.enCurso = m[1].trim(); return; }
      if((m = l.match(/^·\s*(Última carga|Último retiro):\s*(.+)$/i))){
        const partes = m[2].split('·').map(x => x.trim()).filter(Boolean);
        const pedido = ((partes.find(p => /^pedido\s+\d+/i.test(p)) || '').match(/\d+/) || [''])[0];
        out.operaciones.push({ tipo: /retiro/i.test(m[1]) ? 'RETIRO' : 'CARGA', monto: partes[0] || '', fecha: partes[1] || '',
          estado: partes.find((p, i) => i >= 2 && !/^pedido/i.test(p)) || '', pedido });
        return;
      }
      resto.push(l);
    });
    out.resto = resto.join(' ');
    return out;
  }
  return Object.freeze({ role, normalize, author, className, key, isFiller, sinCopias, chatVigente, escritor, chatsDeLaConsulta, merge, visibleText, preview, resumenAsistente });
});
