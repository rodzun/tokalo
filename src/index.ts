// Entrada del Worker. Cloudflare llama a `fetch` una vez por cada solicitud.
//
// Este archivo hace dos cosas:
//   1. `enrutar`: decide qué responder según la ruta.
//   2. `atender`: red de seguridad. Si `enrutar` lanza una excepción, la
//      registra y responde algo razonable. El público nunca ve un error 500.

/** Firma de un enrutador: recibe la solicitud y devuelve la respuesta. */
export type Enrutador = (
  solicitud: Request,
  env: Env,
  ctx: ExecutionContext,
) => Promise<Response>;

/** Redirección temporal (302). `no-store` evita que el navegador la recuerde. */
export function redirigir(destino: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: destino, "Cache-Control": "no-store" },
  });
}

/** Página fija de respaldo: se usa solo si falla la propia landing ("/"). */
export function paginaDeRespaldo(): Response {
  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tokalo</title>
</head>
<body>
<h1>Tokalo</h1>
<p>Vuelve a intentarlo en un momento.</p>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/** Rutas del sitio. Por ahora solo existe la landing provisional. */
export const enrutar: Enrutador = async (solicitud) => {
  const ruta = new URL(solicitud.url).pathname;

  if (ruta === "/") {
    return new Response("Tokalo", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  // Cualquier ruta desconocida vuelve a la landing.
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
