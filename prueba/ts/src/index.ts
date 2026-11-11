// Worker de PRUEBA (paso 0). Rutas temporales para medir, se borra después.
interface Env {
  DB: D1Database;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // /hash?iter=N -> mide el costo de CPU de PBKDF2-SHA256 con N iteraciones
    if (url.pathname === "/hash") {
      const iter = Number(url.searchParams.get("iter") ?? "100000");
      try {
        const clave = await crypto.subtle.importKey(
          "raw", new TextEncoder().encode("una-contraseña-de-prueba"), "PBKDF2", false, ["deriveBits"]);
        const bits = await crypto.subtle.deriveBits(
          { name: "PBKDF2", hash: "SHA-256", salt: crypto.getRandomValues(new Uint8Array(16)), iterations: iter },
          clave, 256);
        return new Response(`ok ${iter} ${bits.byteLength}`);
      } catch (e) {
        return new Response(`error ${iter}: ${e}`, { status: 400 });
      }
    }

    // /maps?u=<link corto> -> qué devuelve Google cuando lo pide Cloudflare
    if (url.pathname === "/maps") {
      const u = url.searchParams.get("u") ?? "";
      if (!u.startsWith("https://maps.app.goo.gl/")) return new Response("no", { status: 400 });
      const r = await fetch(u, { redirect: "manual" });
      return new Response(`${r.status} ${r.headers.get("location") ?? ""}`);
    }

    let destino: string | null = null;
    try {
      const partes = url.pathname.split("/");
      if (partes.length === 3 && (partes[1] === "n" || partes[1] === "q")) {
        destino = await env.DB.prepare("SELECT destino FROM placas WHERE codigo = ?")
          .bind(partes[2].toUpperCase())
          .first<string>("destino");
      }
    } catch {
      destino = null;
    }
    return new Response("", {
      status: 302,
      headers: { Location: destino || "/", "Cache-Control": "no-store" },
    });
  },
};
