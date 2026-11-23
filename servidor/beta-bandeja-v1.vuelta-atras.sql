-- Vuelta atrás de beta-bandeja-v1.sql: sin la función, las oficinas en los canales nuevos vuelven a bajar la bandeja
-- entera por panel_v15_5_listar_solicitudes_portal (NODO lo hace solo: nodo_beta_capacidades_v1 deja de anunciarla).
drop function if exists public.nodo_beta_bandeja_v1(text, text, jsonb, integer, jsonb);
