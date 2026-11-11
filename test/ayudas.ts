// Funciones compartidas por los tests.
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import worker from "../src/index";

const BASE = "https://tokaloperu.com";

/**
 * Llama al Worker completo, igual que lo haría Cloudflare.
 * `ruta` puede ser una ruta ("/n/XXXXXX") o una URL completa.
 * `entorno` permite pasar un `env` alterado (por ejemplo, con la base rota).
 */
export async function pedir(ruta: string, opciones?: RequestInit, entorno: Env = env): Promise<Response> {
  const ctx = createExecutionContext();
  const respuesta = await worker.fetch(new Request(ruta.startsWith("/") ? BASE + ruta : ruta, opciones), entorno, ctx);
  await waitOnExecutionContext(ctx);
  return respuesta;
}

/** Inserta un usuario y un lote mínimos, necesarios para crear placas. */
export async function crearLoteBase(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO usuarios (id, nombre, usuario, hash_clave, creado_en) VALUES (1, 'Test', 'test', '!', '2026-11-11T00:00:00Z')",
    ),
    env.DB.prepare(
      "INSERT INTO lotes (id, modelo, cantidad, creado_por, creado_en) VALUES (1, 'D', 1, 1, '2026-11-11T00:00:00Z')",
    ),
  ]);
}

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
