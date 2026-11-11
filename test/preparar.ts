// Se ejecuta antes de cada archivo de tests: crea las tablas en la base
// local aplicando las mismas migraciones que usa Cloudflare.
import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll } from "vitest";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.MIGRACIONES_TEST);
});
