// Respuestas HTTP que se repiten en todo el Worker.

/** Redirección temporal (302). `no-store` evita que el navegador la recuerde. */
export function redirigir(destino: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: destino, "Cache-Control": "no-store" },
  });
}

/**
 * Redirección tras enviar un formulario (303): el navegador pide la nueva
 * página con GET, y recargarla no reenvía el formulario.
 * `cookie` permite iniciar o cerrar la sesión en la misma respuesta.
 */
export function redirigirTrasEnvio(destino: string, cookie?: string): Response {
  const cabeceras = new Headers({ Location: destino, "Cache-Control": "no-store" });
  if (cookie !== undefined) cabeceras.set("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers: cabeceras });
}

/**
 * Respuesta HTML.
 * `cache` es el valor de Cache-Control; por defecto no se guarda nada.
 */
export function html(cuerpo: string, cache = "no-store", estado = 200): Response {
  return new Response(cuerpo, {
    status: estado,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": cache,
      // Cabeceras de seguridad básicas:
      "X-Content-Type-Options": "nosniff", // no adivinar el tipo de contenido
      "X-Frame-Options": "DENY", // no dejar que otro sitio nos incruste
      "Referrer-Policy": "strict-origin-when-cross-origin",
    },
  });
}

/** Página fija de respaldo: se usa solo si falla la propia landing ("/"). */
export function paginaDeRespaldo(): Response {
  return html(`<!doctype html>
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
</html>`);
}
