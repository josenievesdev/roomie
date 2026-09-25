-- Roomie · núcleo de la base de datos
--
-- Siete tablas. A propósito.
--
-- No intenta abarcar trabajos, licencias, amigos ni grupos: esas se añaden
-- encima sin tocar nada de aquí. Lo que sí está resuelto desde el principio es
-- lo que resulta carísimo cambiar después:
--
--   1. IDENTIDAD estable (un id de cuenta que nunca cambia).
--   2. El DINERO como libro mayor, no como una columna "saldo". Con un saldo
--      mutable no se puede auditar, no se detecta la duplicación y un fallo de
--      concurrencia imprime dinero en silencio. Aquí el saldo es una caché que
--      sólo se toca dentro de la misma transacción que el apunte.
--   3. Cada objeto es UNA FILA, no una cantidad. "Tienes 3 sofás" se puede
--      duplicar; tres filas con su id, no.
--   4. Un objeto está O en tu inventario O colocado en una sala, nunca en los
--      dos sitios. Eso lo fuerza el esquema, no el código.

create extension if not exists pgcrypto; -- gen_random_uuid()

-- ---------------------------------------------------------------- Identidad

create table accounts (
  id            uuid primary key default gen_random_uuid(),
  username      text        not null check (length(username) between 3 and 16),
  password_hash text        not null,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);

-- Nombres únicos sin distinguir mayúsculas: "Pedro" y "pedro" son el mismo
create unique index accounts_username_lower on accounts ((lower(username)));

-- Separado de la cuenta desde ya: el día que quieras varios personajes por
-- cuenta, o renombrar sin perder el historial, no hay que migrar nada.
create table avatars (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid        not null references accounts(id) on delete cascade,
  nickname   text        not null check (length(nickname) between 1 and 16),
  look       jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index avatars_nickname_lower on avatars ((lower(nickname)));
create index avatars_account on avatars (account_id);

-- ------------------------------------------------------------------- Mundo

create table rooms (
  id         uuid primary key default gen_random_uuid(),
  slug       text        not null unique, -- "plaza-central", "club-neon"
  name       text        not null,
  kind       text        not null default 'public' check (kind in ('public', 'personal')),
  owner_id   uuid        references accounts(id) on delete cascade,
  theme      text        not null default 'salon',
  cols       int         not null check (cols between 4 and 64),
  rows       int         not null check (rows between 4 and 64),
  layout     jsonb       not null, -- suelo + colisiones, como los JSON de Tiled
  created_at timestamptz not null default now(),

  -- Una sala pública no tiene dueño; una personal siempre lo tiene
  constraint rooms_dueno_segun_tipo check (
    (kind = 'public'   and owner_id is null) or
    (kind = 'personal' and owner_id is not null)
  )
);

create index rooms_owner on rooms (owner_id) where owner_id is not null;

-- ----------------------------------------------------------------- Objetos

-- El catálogo de la tienda. `code` casa con las claves de
-- src/state/furniture-catalog.ts, que es lo que sabe dibujar el cliente.
create table catalog_items (
  code     text primary key,
  name     text    not null,
  kind     text    not null default 'floor' check (kind in ('floor', 'wall')),
  price    int     not null check (price >= 0),
  tradable boolean not null default true,
  meta     jsonb   not null default '{}'::jsonb
);

-- Cada mueble del mundo es una fila con identidad propia: así se puede seguir
-- quién lo tuvo, dónde está, y no se puede duplicar.
create table items (
  id         uuid primary key default gen_random_uuid(),
  code       text        not null references catalog_items(code),
  owner_id   uuid        not null references accounts(id) on delete cascade,

  -- room_id NULL  =  está en el inventario
  room_id    uuid        references rooms(id) on delete set null,
  col        int,
  "row"      int,
  rot        smallint    not null default 0 check (rot between 0 and 7),
  -- Altura de apilado: la alfombra va en 0 y el sofá encima en 1
  stack      smallint    not null default 0 check (stack between 0 and 8),
  created_at timestamptz not null default now(),

  -- O guardado o colocado, nunca a medias
  constraint items_colocado_entero check (
    (room_id is null     and col is null     and "row" is null) or
    (room_id is not null and col is not null and "row" is not null)
  )
);

create index items_inventario on items (owner_id) where room_id is null;
create index items_sala       on items (room_id)  where room_id is not null;

-- Dos muebles no pueden ocupar la misma casilla Y la misma altura
create unique index items_celda_unica
  on items (room_id, col, "row", stack)
  where room_id is not null;

-- ------------------------------------------------------------------ Dinero

-- Libro mayor: sólo se añade, nunca se modifica ni se borra. Es el registro
-- de la verdad; si el saldo y el libro discrepan, manda el libro.
create table ledger (
  id         bigserial primary key,
  account_id uuid        not null references accounts(id) on delete cascade,
  delta      bigint      not null check (delta <> 0),
  reason     text        not null, -- 'alta', 'compra', 'venta', 'trabajo'...
  ref_type   text,                 -- 'item', 'room'...
  ref_id     text,
  created_at timestamptz not null default now()
);

create index ledger_cuenta on ledger (account_id, id desc);

-- Caché del saldo. Nunca se toca sola: siempre por `mover_saldo`, dentro de
-- la misma transacción que su apunte en el libro.
create table balances (
  account_id uuid primary key references accounts(id) on delete cascade,
  amount     bigint      not null default 0 check (amount >= 0),
  updated_at timestamptz not null default now()
);

-- Único camino para mover dinero.
--
-- El `check (amount >= 0)` de la tabla aborta la transacción si no hay fondos,
-- así que quedarse en negativo es imposible por construcción: no depende de
-- que el código se acuerde de comprobarlo.
create or replace function mover_saldo(
  p_account  uuid,
  p_delta    bigint,
  p_reason   text,
  p_ref_type text default null,
  p_ref_id   text default null
) returns bigint
language plpgsql
as $$
declare
  nuevo bigint;
begin
  insert into balances (account_id, amount) values (p_account, 0)
    on conflict (account_id) do nothing;

  update balances
     set amount = amount + p_delta,
         updated_at = now()
   where account_id = p_account
  returning amount into nuevo;

  if nuevo is null then
    raise exception 'la cuenta % no existe', p_account;
  end if;

  insert into ledger (account_id, delta, reason, ref_type, ref_id)
    values (p_account, p_delta, p_reason, p_ref_type, p_ref_id);

  return nuevo;
end;
$$;

-- Comprobación de integridad: el saldo tiene que cuadrar con el libro.
-- Devuelve las cuentas que NO cuadran; vacío es lo correcto.
create or replace view saldos_descuadrados as
  select b.account_id,
         b.amount                        as saldo,
         coalesce(sum(l.delta), 0)       as segun_libro,
         b.amount - coalesce(sum(l.delta), 0) as diferencia
    from balances b
    left join ledger l on l.account_id = b.account_id
   group by b.account_id, b.amount
  having b.amount <> coalesce(sum(l.delta), 0);
