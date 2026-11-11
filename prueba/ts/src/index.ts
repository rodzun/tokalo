interface Env {
  DB: D1Database;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    let destino: string | null = null;
    try {
      const partes = new URL(request.url).pathname.split("/");
      // /n/CODIGO -> ['', 'n', 'CODIGO']
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
