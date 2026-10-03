-- ════════════════════════════════════════════════════════════════════════════════════════
-- Borrar el chat de PRUEBAS que quedó en chat_sesiones / chat_mensajes
--
-- Son las conversaciones de cuando se probó el camino nuevo del chat, entre mayo y hoy. Al
-- hacer que NODO lea ese canal, estas volvían a aparecer en la bandeja de los operadores:
-- 19 en P3, 10 en P4, 7 en P1, 3 en P2 y 3 en P5. Ruido del que después genera un reporte
-- de algo que no está roto (Juan, 2/10: "elimina desde supa los mensajes esos, no sirven").
--
-- VERIFICADO ANTES DE ESCRIBIR ESTO: las once cuentas que hay son todas de prueba y no hay
-- ningún jugador real.
--
--   aitana63 · Mate3462 · noex90 · probando4 · prueba100 · prueba5
--   pruebaalv · pruebaf · pruebasan · pruebaxx · zzprueba_chat
--
--   117 conversaciones · 436 mensajes · del 16/05 al 02/10
--
-- (zzprueba_chat la creé yo el 2/10 probando que el camino nuevo funcionara.)
--
-- Correr los cuatro pasos en orden. El 1 y el 4 son para mirar, no cambian nada.
-- ════════════════════════════════════════════════════════════════════════════════════════

-- ── 1) MIRAR primero. Si acá aparece algún usuario que NO sea de prueba, FRENAR. ──────────
select cs.usuario, cs.pc_codigo, count(*) sesiones,
       max(cs.created_at at time zone 'America/Argentina/Buenos_Aires')::date ultima
from public.chat_sesiones cs
group by cs.usuario, cs.pc_codigo
order by cs.usuario;


-- ── 2) Los mensajes ──────────────────────────────────────────────────────────────────────
-- Primero los mensajes y después las sesiones: al revés quedarían mensajes sin su conversación.
delete from public.chat_mensajes
 where chat_id in (select chat_id::text from public.chat_sesiones);


-- ── 3) Las conversaciones ────────────────────────────────────────────────────────────────
delete from public.chat_sesiones;


-- ── 4) Comprobar que no quedó nada ───────────────────────────────────────────────────────
select (select count(*) from public.chat_sesiones) sesiones_que_quedaron,
       (select count(*) from public.chat_mensajes) mensajes_que_quedaron;
-- Las dos tienen que dar 0.


-- ════════════════════════════════════════════════════════════════════════════════════════
-- NO HACE FALTA CORRERLO HOY.
--
-- El panel ya está blindado por dos lados: el canal nuevo sale APAGADO, y aunque se prenda
-- no vuelve nada con más de 7 días sin actividad. Así que esto es limpieza, no urgencia.
--
-- Pero conviene hacerlo antes de apagar el camino viejo: cuando el canal nuevo sea el único,
-- ese filtro de 7 días deja de ser una red y pasa a ser lo único que separa lo de verdad de
-- las pruebas de mayo.
-- ════════════════════════════════════════════════════════════════════════════════════════
