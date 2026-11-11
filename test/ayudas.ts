// Funciones compartidas por los tests.
import { env } from "cloudflare:workers";

/**
 * Vacía todas las tablas de datos (el catálogo de modelos se conserva).
 * La base local no se reinicia sola entre un test y el siguiente.
 * El orden importa: primero las tablas que apuntan a otras.
 */
export async function vaciarBase(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM escaneos"),
    env.DB.prepare("DELETE FROM cambios_destino"),
    env.DB.prepare("DELETE FROM placas"),
    env.DB.prepare("DELETE FROM lotes"),
    env.DB.prepare("DELETE FROM intentos_login"),
    env.DB.prepare("DELETE FROM usuarios"),
  ]);
}

/** Ejecuta un archivo SQL entero: quita comentarios y separa por ";". */
export async function ejecutarSql(sql: string): Promise<void> {
  const sentencias = sql
    .split("\n")
    .filter((linea) => !linea.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  await env.DB.batch(sentencias.map((s) => env.DB.prepare(s)));
}
