import postgres from "postgres";

// Conexión a Postgres.
//
// El servidor de juego habla con la base de datos DIRECTO, no por PostgREST ni
// supabase-js: ya tiene una conexión persistente, y hacer HTTP+JSON por cada
// consulta sería tirar latencia a la basura.
//
// El navegador NO toca la base de datos. Todo pasa por este servidor, que es
// la autoridad — igual que con las posiciones. Si el cliente pudiera escribir,
// se perdería el modelo anti-trampas.
//
// La cadena de conexión se lee de DATABASE_URL (fichero `server/.env`, que
// está en .gitignore). Nunca se escribe en el código.

const url = process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    "Falta DATABASE_URL.\n" +
      "Crea server/.env con la cadena de conexión de Supabase:\n" +
      "  DATABASE_URL=postgresql://postgres.xxxx:CONTRASEÑA@aws-0-eu-central-1.pooler.supabase.com:6543/postgres\n",
  );
}

const esLocal = /@(localhost|127\.0\.0\.1)/.test(url);
// El pooler de transacciones de Supabase (puerto 6543) no admite sentencias
// preparadas. Con `prepare: true` la primera consulta falla y cuesta entender
// por qué, así que se detecta aquí.
const esPooler = /:6543|pooler\./.test(url);

export const sql = postgres(url, {
  prepare: !esPooler,
  ssl: esLocal ? false : "require",
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const conexion = {
  local: esLocal,
  pooler: esPooler,
  /** El host, sin credenciales: para poder registrarlo sin filtrar nada */
  host: url.replace(/^.*@/, "").replace(/\/.*$/, ""),
};

export async function cerrar(): Promise<void> {
  await sql.end({ timeout: 5 });
}
