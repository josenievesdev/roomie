-- Economía (Hito 1): dos monedas, la tienda por secciones, el premio diario
-- y vender lo que ya no quieres. Las reglas de siempre siguen: el dinero sólo
-- se mueve con `mover_saldo()`, en la misma transacción que su apunte, y
-- ningún saldo puede quedar en negativo (lo impide la propia tabla).

-- ------------------------------------------------------------ Dos monedas
--
-- 'monedas': se ganan jugando (el premio de bienvenida, el premio diario,
--            vender cosas; más adelante, los trabajos).
-- 'creditos': se comprarán con dinero real. Todavía no: falta el proveedor
--            de pagos, el permiso de los padres y la revisión legal. El libro
--            ya los distingue para que eso no obligue a rehacer nada.

alter table ledger add column currency text not null default 'monedas'
  check (currency in ('monedas', 'creditos'));

alter table balances add column currency text not null default 'monedas'
  check (currency in ('monedas', 'creditos'));
alter table balances drop constraint balances_pkey;
alter table balances add primary key (account_id, currency);

-- Se sustituye por la versión con moneda (la última, con 'monedas' por
-- defecto: todas las llamadas de antes siguen valiendo tal cual).
drop function mover_saldo(uuid, bigint, text, text, text);
create function mover_saldo(
  p_account  uuid,
  p_delta    bigint,
  p_reason   text,
  p_ref_type text default null,
  p_ref_id   text default null,
  p_currency text default 'monedas'
) returns bigint
language plpgsql
as $$
declare
  nuevo bigint;
begin
  insert into balances (account_id, currency, amount) values (p_account, p_currency, 0)
    on conflict (account_id, currency) do nothing;

  update balances
     set amount = amount + p_delta,
         updated_at = now()
   where account_id = p_account and currency = p_currency
  returning amount into nuevo;

  if nuevo is null then
    raise exception 'la cuenta % no existe', p_account;
  end if;

  insert into ledger (account_id, delta, reason, ref_type, ref_id, currency)
    values (p_account, p_delta, p_reason, p_ref_type, p_ref_id, p_currency);

  return nuevo;
end;
$$;

-- El saldo y el libro tienen que cuadrar, moneda a moneda
drop view saldos_descuadrados;
create view saldos_descuadrados as
  select b.account_id,
         b.currency,
         b.amount                             as saldo,
         coalesce(sum(l.delta), 0)            as segun_libro,
         b.amount - coalesce(sum(l.delta), 0) as diferencia
    from balances b
    left join ledger l on l.account_id = b.account_id and l.currency = b.currency
   group by b.account_id, b.currency, b.amount
  having b.amount <> coalesce(sum(l.delta), 0);

-- ------------------------------------------------------------ La tienda

-- En qué moneda se paga cada cosa, en qué sección va y en qué orden
alter table catalog_items add column currency text not null default 'monedas'
  check (currency in ('monedas', 'creditos'));
alter table catalog_items add column category text not null default 'deco'
  check (category in ('salon', 'dormitorio', 'fiesta', 'deco', 'pared'));
alter table catalog_items add column sort int not null default 0;

update catalog_items set category = 'salon',      sort = 1 where code = 'sofa';
update catalog_items set category = 'salon',      sort = 2 where code = 'mesa';
update catalog_items set category = 'salon',      sort = 3 where code = 'estanteria';
update catalog_items set category = 'dormitorio', sort = 1 where code = 'cama';
update catalog_items set category = 'dormitorio', sort = 2 where code = 'armario';
update catalog_items set category = 'fiesta',     sort = 1 where code = 'altavoz';
update catalog_items set category = 'fiesta',     sort = 2 where code = 'barra';
update catalog_items set category = 'fiesta',     sort = 3 where code = 'taburete';
update catalog_items set category = 'deco',       sort = 1 where code = 'planta';
update catalog_items set category = 'deco',       sort = 2 where code = 'lampara';
update catalog_items set category = 'deco',       sort = 3 where code = 'alfombra';
update catalog_items set category = 'deco',       sort = 9 where code = 'cajas';
update catalog_items set category = 'pared',      sort = 1 where code = 'cuadro';
update catalog_items set category = 'pared',      sort = 2 where code = 'poster';
update catalog_items set category = 'pared',      sort = 3 where code = 'reloj';
update catalog_items set category = 'pared',      sort = 4 where code = 'aplique';
update catalog_items set category = 'pared',      sort = 5 where code = 'estante';
update catalog_items set category = 'pared',      sort = 6 where code = 'ventana';
update catalog_items set category = 'pared',      sort = 7 where code = 'neon';

-- ------------------------------------------------------------ Premio diario

-- Uno por cuenta y día. El día es el de La Manzana (hora de Bogotá), el mismo
-- para todo el mundo. La clave primaria es lo que garantiza que no se cobra
-- dos veces, aunque lleguen dos peticiones a la vez.
create table premios_diarios (
  account_id uuid        not null references accounts(id) on delete cascade,
  dia        date        not null,
  created_at timestamptz not null default now(),
  primary key (account_id, dia)
);

-- Da el premio de hoy si no se había dado. Devuelve el saldo nuevo, o null
-- si hoy ya lo tenía.
create function premio_diario(p_account uuid, p_cantidad bigint) returns bigint
language plpgsql
as $$
declare
  hoy date := (now() at time zone 'America/Bogota')::date;
begin
  insert into premios_diarios (account_id, dia) values (p_account, hoy)
    on conflict do nothing;
  if not found then
    return null;
  end if;
  return mover_saldo(p_account, p_cantidad, 'diario', 'dia', hoy::text);
end;
$$;

-- ------------------------------------------------------------ Muebles puestos

-- Lo que no es alfombra va un piso por encima (stack 1), así una alfombra
-- puede ir debajo. Los muebles de regalo de las casas de antes estaban en 0.
update items i
   set stack = 1
  from catalog_items c
 where c.code = i.code and i.room_id is not null and i.stack = 0 and c.code <> 'alfombra';
