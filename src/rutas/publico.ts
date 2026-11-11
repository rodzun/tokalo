// Rutas públicas: lo que ve cualquier persona, sin iniciar sesión.
import { cookieBorrada, leerSesion, traeCookie } from "../lib/auth";
import { normalizarCodigo } from "../lib/codigos";
import { type Canal, debeContarse, registrarEscaneo } from "../lib/escaneos";
import { ICONO_SVG } from "../lib/html";
import { esHttps } from "../lib/maps";
import { html, redirigir } from "../lib/respuestas";
import { landing } from "../vistas/landing";

/** Lo que necesitamos saber de una placa para decidir a dónde mandar. */
interface PlacaParaRedirigir {
  estado: string;
  destino: string | null;
}

/**
 * GET /n/:codigo (chip NFC) y GET /q/:codigo (QR).
 *
 *   sin sesión + placa activa      -> 302 a su destino (y cuenta como escaneo)
 *   sin sesión + cualquier otra    -> landing
 *   con sesión + placa existente   -> /admin/placas/CODIGO (formulario o ficha)
 *   código inexistente             -> landing, con o sin sesión
 */
export async function escaneo(
  solicitud: Request,
  env: Env,
  ctx: ExecutionContext,
  canal: Canal,
  codigoRecibido: string,
): Promise<Response> {
  // Si no tiene forma de código de Tokalo, ni consultamos la base.
  const codigo = normalizarCodigo(codigoRecibido);
  if (codigo === null) return redirigir("/");

  // Sin cookie, esto no consulta la base: el público no paga ese costo.
  const usuario = await leerSesion(solicitud, env);

  const placa = await env.DB.prepare("SELECT estado, destino FROM placas WHERE codigo = ?")
    .bind(codigo)
    .first<PlacaParaRedirigir>();

  // Con sesión: a la página de la placa en el admin. No cuenta como escaneo.
  if (usuario !== null) {
    return redirigir(placa === null ? "/" : `/admin/placas/${codigo}`);
  }

  const respuesta =
    placa !== null && placa.estado === "activa" && esHttps(placa.destino)
      ? redirigir(placa.destino)
      : redirigir("/");

  // Traía una cookie que ya no vale (vencida, alterada o de un usuario
  // desactivado): se trata como público y se le borra.
  if (traeCookie(solicitud)) {
    respuesta.headers.append("Set-Cookie", cookieBorrada());
  }

  // Estadísticas: solo redirecciones reales a un destino.
  // `waitUntil` deja la escritura corriendo DESPUÉS de enviar la respuesta:
  // la persona no espera por ella. Si falla, solo queda en los logs.
  const fueAlDestino = respuesta.headers.get("Location") !== "/";
  if (fueAlDestino && debeContarse(solicitud)) {
    ctx.waitUntil(
      registrarEscaneo(env.DB, codigo, canal, solicitud).catch((error: unknown) => {
        console.error("escaneo_no_registrado", {
          codigo,
          canal,
          mensaje: error instanceof Error ? error.message : String(error),
        });
      }),
    );
  }

  return respuesta;
}

/** GET / : la landing. El navegador puede guardarla 5 minutos. */
export function paginaLanding(env: Env): Response {
  return html(landing(env.WHATSAPP), "public, max-age=300");
}

/**
 * GET /favicon.ico : los navegadores lo piden solos. Respondemos el icono
 * directamente y por una semana, para no gastar solicitudes en redirigir.
 */
export function icono(): Response {
  return new Response(ICONO_SVG, {
    headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=604800" },
  });
}

/** GET /robots.txt : pide a los buscadores que no rastreen placas ni el admin. */
export function robots(): Response {
  return new Response("User-agent: *\nDisallow: /n/\nDisallow: /q/\nDisallow: /admin\n", {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=86400" },
  });
}
