-- Seguridad, sobre todo la de los niños y niñas (ver src/state/normas.ts).
--
-- La base guarda lo que las normas necesitan saber y lo que los moderadores
-- necesitan para actuar:
--   · la fecha de nacimiento de cada cuenta (nunca se enseña a nadie);
--   · si falta el permiso de un tutor (menores de 13);
--   · a quién ha bloqueado cada uno;
--   · los reportes, con el chat de alrededor como contexto;
--   · el registro del chat, que se borra solo a los 30 días.

-- ------------------------------------------------------------ Edad

-- Puede faltar en las cuentas de antes: el servidor la pide al entrar y no
-- deja jugar sin ella. Las fechas absurdas se paran aquí; la edad mínima
-- (que depende del día de hoy) la comprueba el servidor.
alter table accounts add column birth_date date
  check (birth_date is null or birth_date > date '1900-01-01');

-- 'no_necesita': 13 años o más. 'pendiente': falta el permiso de un padre,
-- madre o tutor. 'aprobado': lo dio.
alter table accounts add column consent text not null default 'no_necesita'
  check (consent in ('no_necesita', 'pendiente', 'aprobado'));

-- ------------------------------------------------------------ Bloqueos

create table blocks (
  account_id uuid        not null references accounts(id) on delete cascade,
  blocked_id uuid        not null references accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (account_id, blocked_id),
  constraint blocks_no_a_si_mismo check (account_id <> blocked_id)
);

-- ------------------------------------------------------------ Reportes

-- Si se borra una cuenta, el reporte se queda (es un registro de lo que pasó).
create table reports (
  id          bigserial   primary key,
  reporter_id uuid        references accounts(id) on delete set null,
  reported_id uuid        references accounts(id) on delete set null,
  reason      text        not null check (reason in ('acoso', 'lenguaje', 'datos', 'otro')),
  room        text,
  -- Las últimas líneas del chat de la sala, incluidas las que el filtro paró
  context     jsonb       not null default '[]'::jsonb,
  status      text        not null default 'nuevo' check (status in ('nuevo', 'revisado', 'descartado')),
  created_at  timestamptz not null default now()
);
create index reports_pendientes on reports (created_at) where status = 'nuevo';

-- ------------------------------------------------------------ Registro del chat

-- Lo que se escribe, tal cual (también lo que el filtro no dejó pasar): sin
-- esto un moderador no puede ver qué pasó. Se guarda poco tiempo a propósito.
create table chat_log (
  id         bigserial   primary key,
  account_id uuid        references accounts(id) on delete cascade,
  room       text        not null,
  text       text        not null,
  -- null: se entregó. 'datos' / 'sexual': el filtro lo paró.
  blocked    text        check (blocked is null or blocked in ('datos', 'sexual')),
  created_at timestamptz not null default now()
);
create index chat_log_reciente on chat_log (created_at);
create index chat_log_cuenta on chat_log (account_id, created_at desc);

create or replace function purgar_chat(dias int default 30)
returns int
language plpgsql
as $$
declare
  n int;
begin
  delete from chat_log where created_at < now() - make_interval(days => dias);
  get diagnostics n = row_count;
  return n;
end;
$$;
