// Secretos del Worker. No están en wrangler.toml (no deben quedar en git):
// se suben con `wrangler secret put`, por eso se declaran aquí a mano.
// Se declara dos veces porque wrangler genera el tipo `Env` en dos sitios.

interface Env {
  /** Clave aleatoria con la que se firman las cookies de sesión. */
  SECRETO_SESION: string;
}

declare namespace Cloudflare {
  interface Env {
    SECRETO_SESION: string;
  }
}
