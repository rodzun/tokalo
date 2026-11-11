// Rutas públicas: lo que ve cualquier persona, sin iniciar sesión.
import { normalizarCodigo } from "../lib/codigos";
import { type Canal, debeContarse, registrarEscaneo } from "../lib/escaneos";
import { ICONO_SVG } from "../lib/html";
import { html, redirigir } from "../lib/respuestas";
import { landing } from "../vistas/landing";

/** Lo que necesitamos saber de una placa para decidir a dónde mandar. */
interface PlacaParaRedirigir {
  estado: string;
  destino: string | null;
}

/** True si el texto es una URL que empieza por https://. */
export function esHttps(texto: string | null): texto is string {
  if (texto === null) return false;
  try {
    return new URL(texto).protocol === "https:";
  } catch {
    return false; // no es una URL válida
  }
}

/**
 * GET /n/:codigo (chip NFC) y GET /q/:codigo (QR).
 * Sin sesión: placa activa -> 302 a su destino; todo lo demás -> landing.
 * (El comportamiento con sesión llega con el login.)
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

  const placa = await env.DB.prepare("SELECT estado, destino FROM placas WHERE codigo = ?")
    .bind(codigo)
    .first<PlacaParaRedirigir>();

  // `placa` es null si el código no existe.
  if (placa === null || placa.estado !== "activa" || !esHttps(placa.destino)) {
    return redirigir("/");
  }

  // Estadísticas. `waitUntil` deja la escritura corriendo DESPUÉS de enviar
  // la respuesta: la persona no espera por ella. Si falla, solo queda en los
  // logs; la redirección ya salió y no depende de esto.
  const conSesion = false; // se sabrá de verdad cuando exista el login
  if (debeContarse(solicitud, conSesion)) {
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

  return redirigir(placa.destino);
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
