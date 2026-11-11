// Configuración de los tests. Corren dentro del runtime real de Workers
// (el mismo que usa Cloudflare), leyendo la configuración de wrangler.toml.
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.toml" } })],
  test: { include: ["test/**/*.test.ts"] },
});
