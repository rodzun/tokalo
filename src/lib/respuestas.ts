// Respuestas HTTP que se repiten en todo el Worker.

/** Redirección temporal (302). `no-store` evita que el navegador la recuerde. */
export function redirigir(destino: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: destino, "Cache-Control": "no-store" },
  });
}

/**
 * Respuesta HTML.
 * `cache` es el valor de Cache-Control; por defecto no se guarda nada.
 */
export function html(cuerpo: string, cache = "no-store"): Response {
  return new Response(cuerpo, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": cache,
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
