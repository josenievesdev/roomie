-- Casas (Hito 1, "Mi primer piso"). Cada cuenta tiene como mucho un piso
-- propio: una sala 'personal' con su dueño. La portería de la Plaza de la
-- Llave da las llaves una sola vez; este índice es lo que lo garantiza aunque
-- el servidor se equivocara (o llegaran dos peticiones a la vez).
create unique index rooms_una_casa_por_cuenta on rooms (owner_id) where kind = 'personal';

-- Hay cosas que se regalan y no se venden: las cajas de la mudanza.
alter table catalog_items add column for_sale boolean not null default true;

-- Lo que trae el piso recién mudado. La cama y el armario se podrán comprar
-- más adelante; las cajas, no.
insert into catalog_items (code, name, kind, price, tradable, for_sale) values
  ('cama',    'Cama',             'floor', 120, true,  true),
  ('armario', 'Armario',          'floor',  95, true,  true),
  ('cajas',   'Cajas de mudanza', 'floor',   0, false, false)
on conflict (code) do update
  set name     = excluded.name,
      kind     = excluded.kind,
      price    = excluded.price,
      tradable = excluded.tradable,
      for_sale = excluded.for_sale;
