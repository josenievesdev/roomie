-- Sesiones: para no pedir la contraseña en cada recarga.
--
-- El token en claro NO se guarda, sólo su SHA-256. Es el mismo razonamiento
-- que con las contraseñas: si algún día se filtra la base, los tokens
-- guardados no sirven para entrar en ninguna cuenta.
--
-- El token vive en el localStorage del navegador. Es lo único que el cliente
-- conserva de su identidad; el nombre, el aspecto y el saldo vienen siempre
-- del servidor.

create table sessions (
  id           uuid        primary key default gen_random_uuid(),
  account_id   uuid        not null references accounts(id) on delete cascade,
  token_hash   text        not null unique,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null
);

create index sessions_cuenta  on sessions (account_id);
create index sessions_caducan on sessions (expires_at);

-- Rastro mínimo de intentos de entrada. Sirve para dos cosas: limitar la
-- fuerza bruta y poder responder "¿alguien ha intentado entrar en mi cuenta?".
--
-- Se guarda el nombre TECLEADO, no la cuenta: así queda registro también de
-- los intentos contra usuarios que no existen, que es justo lo que hace un
-- ataque de diccionario.
create table login_attempts (
  id         bigserial   primary key,
  username   text        not null,
  ok         boolean     not null,
  created_at timestamptz not null default now()
);

create index login_attempts_reciente on login_attempts (lower(username), created_at desc);

-- Limpieza de lo que ya no sirve. Se llama desde el servidor de vez en
-- cuando; no hace falta un cron.
create or replace function purgar_caducado()
returns table (sesiones int, intentos int)
language plpgsql
as $$
declare
  s int;
  i int;
begin
  delete from sessions where expires_at < now();
  get diagnostics s = row_count;
  delete from login_attempts where created_at < now() - interval '30 days';
  get diagnostics i = row_count;
  return query select s, i;
end;
$$;
