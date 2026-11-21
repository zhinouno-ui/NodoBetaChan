-- SIN PUBLICAR (21/11/2026): el despliegue se rechazó; falta el OK de Juan.
-- Cotejo de cargas: el servidor no deja entrar una fila COTEJO de un movimiento de Chunior que ya tiene su fila
-- (21/11/2026). La 2.1.9 leía el historial de NODO de la más vieja a la más nueva con tope de 400: en una oficina
-- con movimiento (P4) las cargas de la última hora quedaban afuera, NODO no las encontraba y creaba una fila
-- COTEJO repetida por cada una (295 el 19-21/11). Esta red frena eso en las PC que todavía tienen la 2.1.9,
-- sin esperar a que se actualicen: la fila repetida simplemente no entra (el panel lo toma como "no se pudo").
-- Vuelta atrás: drop trigger trg_historial_cotejo_sin_repetidas on public.historial_ops;
--              drop function public._historial_cotejo_sin_repetidas();
create or replace function public._historial_cotejo_sin_repetidas()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.origen = 'COTEJO' and new.chunior_movimiento_id is not null
     and exists (select 1 from public.historial_ops o where o.chunior_movimiento_id = new.chunior_movimiento_id) then
    return null;
  end if;
  return new;
end $$;

drop trigger if exists trg_historial_cotejo_sin_repetidas on public.historial_ops;
create trigger trg_historial_cotejo_sin_repetidas
  before insert on public.historial_ops
  for each row execute function public._historial_cotejo_sin_repetidas();
