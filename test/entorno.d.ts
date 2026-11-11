// Tipos extra que solo existen durante los tests.
import type { D1Migration } from "@cloudflare/vitest-plugin";

declare global {
  namespace Cloudflare {
    interface Env {
      /** Migraciones leídas en vitest.config.ts. */
      MIGRACIONES_TEST: D1Migration[];
    }
  }
}
