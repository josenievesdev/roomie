-- Decoración de la Fase 5: una estantería y los primeros muebles de pared.
--
-- Igual que en 002: los `code` son los de `src/state/furniture-catalog.ts`.
-- Los de pared van con kind = 'wall' (cuelgan del muro de la fila 0 o de la
-- columna 0 y no ocupan celda). `npm run db:check` comprueba que el catálogo
-- de la tienda y lo que el cliente sabe dibujar coinciden.

insert into catalog_items (code, name, kind, price, tradable) values
  ('estanteria', 'Estantería',       'floor', 55, true),
  ('ventana',    'Ventana',          'wall',  45, true),
  ('cuadro',     'Cuadro',           'wall',  30, true),
  ('reloj',      'Reloj de pared',   'wall',  25, true),
  ('aplique',    'Aplique',          'wall',  20, true),
  ('estante',    'Balda con libros', 'wall',  30, true),
  ('neon',       'Neón',             'wall',  65, true),
  ('poster',     'Póster',           'wall',  15, true)
on conflict (code) do update
  set name     = excluded.name,
      kind     = excluded.kind,
      price    = excluded.price,
      tradable = excluded.tradable;
