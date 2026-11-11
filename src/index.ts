// Entrada del Worker. Cloudflare llama a `fetch` una vez por cada solicitud.
//
// Este archivo hace dos cosas:
//   1. `enrutar`: decide qué función responde según la ruta.
//   2. `atender`: red de seguridad. Si `enrutar` lanza una excepción, la
//      registra y responde algo razonable. El público nunca ve un error 500.
import { paginaDeRespaldo, redirigir } from "./lib/respuestas";
import { escaneo, icono, paginaLanding, robots } from "./rutas/publico";

/** Firma de un enrutador: recibe la solicitud y devuelve la respuesta. */
export type Enrutador = (
  solicitud: Request,
  env: Env,
  ctx: ExecutionContext,
) => Promise<Response>;

// /n/CODIGO o /q/CODIGO. La "i" final acepta también /N/ y /Q/, porque el
// QR lleva la URL entera en mayúsculas.
const RUTA_ESCANEO = /^\/([nq])\/([^/]+)\/?$/i;

/** Rutas del sitio. */
export const enrutar: Enrutador = async (solicitud, env, ctx) => {
  const url = new URL(solicitud.url);
  const ruta = url.pathname;

  // www.tokaloperu.com -> tokaloperu.com, para que haya una sola dirección.
  // 301 es redirección permanente: el navegador la recuerda.
  if (url.hostname.startsWith("www.")) {
    url.hostname = url.hostname.slice("www.".length);
    return new Response(null, { status: 301, headers: { Location: url.toString() } });
  }

  // Todas las rutas públicas son de solo lectura.
  // (HEAD es un GET sin cuerpo; lo usan algunos navegadores y bots.)
  if (solicitud.method === "GET" || solicitud.method === "HEAD") {
    if (ruta === "/") return paginaLanding(env);

    const coincide = RUTA_ESCANEO.exec(ruta);
    if (coincide !== null) {
      // coincide[1] es el canal y coincide[2] el código.
      const canal = coincide[1]?.toLowerCase() === "q" ? "q" : "n";
      return escaneo(solicitud, env, ctx, canal, coincide[2] ?? "");
    }

    if (ruta === "/favicon.ico") return icono();
    if (ruta === "/robots.txt") return robots();
  }

  // Cualquier otra cosa vuelve a la landing.
  return redirigir("/");
};

/**
 * Ejecuta un enrutador con red de seguridad.
 * Recibe el enrutador como parámetro para que los tests puedan pasar uno
 * que falle a propósito.
 */
export async function atender(
  solicitud: Request,
  env: Env,
  ctx: ExecutionContext,
  enrutador: Enrutador = enrutar,
): Promise<Response> {
  try {
    return await enrutador(solicitud, env, ctx);
  } catch (error) {
    // Sacamos la ruta con cuidado: este bloque no puede fallar.
    let ruta = "?";
    try {
      ruta = new URL(solicitud.url).pathname;
    } catch {
      // URL ilegible: dejamos "?".
    }

    // Todo error atrapado queda en los logs del Worker.
    // Solo la ruta, sin parámetros, para no guardar datos de más.
    console.error("error_atrapado", {
      metodo: solicitud.method,
      ruta,
      mensaje: error instanceof Error ? error.message : String(error),
      pila: error instanceof Error ? error.stack : undefined,
    });

    // Si lo que falló fue "/", redirigir a "/" sería un bucle:
    // respondemos una página fija que no depende de nada.
    if (ruta === "/" || ruta === "?") {
      return paginaDeRespaldo();
    }
    return redirigir("/");
  }
}

export default {
  fetch(solicitud: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return atender(solicitud, env, ctx);
  },
} satisfies ExportedHandler<Env>;
