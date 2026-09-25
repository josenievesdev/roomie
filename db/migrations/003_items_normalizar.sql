-- Al borrar una sala, sus muebles deben VOLVER AL INVENTARIO de su dueño.
--
-- La clave foránea tiene `on delete set null`, que vacía `room_id` pero deja
-- `col` y `row` puestos — y eso viola el CHECK `items_colocado_entero`, así
-- que borrar una sala fallaba. Lo detectó `db:check` al limpiar sus datos.
--
-- La alternativa fácil habría sido `on delete cascade`, pero eso BORRA los
-- muebles: perderías lo que compraste porque alguien tiró la sala abajo.
--
-- Con un trigger el invariante se mantiene solo, venga el cambio de donde
-- venga: si no hay sala, no hay coordenadas. No depende de que ningún UPDATE
-- del código se acuerde de limpiar las tres columnas.

create or replace function items_normalizar()
returns trigger
language plpgsql
as $$
begin
  if new.room_id is null then
    new.col   := null;
    new."row" := null;
    new.stack := 0;
  end if;
  return new;
end;
$$;

drop trigger if exists items_normalizar_trg on items;

create trigger items_normalizar_trg
  before insert or update on items
  for each row
  execute function items_normalizar();
