// Configuración de los tests. Corren dentro del runtime real de Workers
// (el mismo que usa Cloudflare), leyendo la configuración de wrangler.toml.
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      // Leemos las migraciones aquí (en Node) y se las pasamos a los tests,
      // que las aplican sobre una base D1 local y vacía.
      const migraciones = await readD1Migrations("./migrations");
      return {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          bindings: {
            MIGRACIONES_TEST: migraciones,
            // Secreto de mentira, solo para los tests.
            SECRETO_SESION: "secreto-solo-para-tests-0123456789abcdef",
          },
        },
      };
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/preparar.ts"],
  },
});
