import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql, conexion, cerrar } from "./index.ts";

// Ejecutor de migraciones. Cada .sql de db/migrations se aplica UNA vez, en
// orden de nombre, y queda anotado en `_migrations`.
//
// Cada migración va dentro de su propia transacción: si algo falla a mitad, no
// queda medio aplicada. Es la diferencia entre poder repetir el comando sin
// miedo y tener que reparar el esquema a mano.

const AQUI = dirname(fileURLToPath(import.meta.url));
const DIR = join(AQUI, "..", "..", "..", "db", "migrations");

export async function migrar(): Promise<void> {
  await sql`
    create table if not exists _migrations (
      name       text primary key,
      applied_at timestamptz not null default now()
    )
  `;

  const aplicadas = new Set(
    (await sql<{ name: string }[]>`select name from _migrations`).map((r) => r.name),
  );

  const ficheros = readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let nuevas = 0;
  for (const fichero of ficheros) {
    if (aplicadas.has(fichero)) {
      console.log(`  ·  ${fichero} (ya estaba)`);
      continue;
    }
    const cuerpo = readFileSync(join(DIR, fichero), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(cuerpo);
      await tx`insert into _migrations (name) values (${fichero})`;
    });
    console.log(`  ✓  ${fichero}`);
    nuevas++;
  }

  console.log(nuevas === 0 ? "\nSin cambios: el esquema ya estaba al día." : `\n${nuevas} migración(es) aplicada(s).`);
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  console.log(`Migrando contra ${conexion.host}${conexion.pooler ? " (pooler)" : ""}\n`);
  try {
    await migrar();
  } catch (e) {
    console.error(`\nFALLÓ: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  } finally {
    await cerrar();
  }
}
