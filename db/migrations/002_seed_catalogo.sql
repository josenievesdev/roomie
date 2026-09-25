-- Catálogo inicial de la tienda.
--
-- Los `code` son exactamente los de `src/state/furniture-catalog.ts`, que es
-- lo que el cliente sabe dibujar. Si añades un mueble allí y no aquí, no se
-- podrá comprar; si lo añades aquí y no allí, se comprará y no se verá. Esa
-- correspondencia la comprueba `npm run db:check`.

insert into catalog_items (code, name, kind, price, tradable) values
  ('sofa',     'Sofá',              'floor',  60, true),
  ('taburete', 'Taburete de barra', 'floor',  25, true),
  ('mesa',     'Mesa auxiliar',     'floor',  35, true),
  ('barra',    'Módulo de barra',   'floor',  80, true),
  ('planta',   'Planta',            'floor',  20, true),
  ('lampara',  'Lámpara de pie',    'floor',  30, true),
  ('altavoz',  'Altavoz',           'floor',  70, true),
  ('alfombra', 'Alfombra',          'floor',  10, true)
on conflict (code) do update
  set name     = excluded.name,
      kind     = excluded.kind,
      price    = excluded.price,
      tradable = excluded.tradable;
