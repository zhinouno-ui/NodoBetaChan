-- Vuelta atrás de beta-alta-por-version.sql: NODO deja de poder pedir su clave de canales nuevos.
-- Las claves que ya se dieron se apagan (las PCs vuelven a los canales viejos y, en esas oficinas, el bot de
-- palabras vuelve a contestar). La de P1, cargada a mano el 27/10, no se toca: su build es "nodo-beta-...".
drop function if exists public.panel_beta_alta_v1(text, text, text);
update nodo_beta.beta_clientes set enabled = false where active_build ~ '^nodo-[0-9]+\.[0-9]+\.[0-9]+';
