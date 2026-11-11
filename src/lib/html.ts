// Utilidades para armar HTML a mano, sin motor de plantillas.

/**
 * Escapa un texto para meterlo en HTML sin riesgo.
 * Todo dato que venga de la base o del usuario debe pasar por aquí.
 */
export function escapar(texto: string): string {
  return texto
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Icono del sitio: una "T" blanca sobre fondo oscuro, dibujada en SVG. */
export const ICONO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
  '<rect width="32" height="32" rx="7" fill="#111827"/>' +
  '<path d="M8 9h16v4h-6v11h-4V13H8z" fill="#fff"/></svg>';

/**
 * El mismo icono incrustado en la página como "data URI".
 * Así el navegador no hace una solicitud aparte para pedir /favicon.ico.
 */
export const ICONO_INCRUSTADO = "data:image/svg+xml," + encodeURIComponent(ICONO_SVG);

/** Estilos comunes a todas las páginas. Pensados primero para celular. */
const ESTILOS = `
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  color:#111827;background:#f9fafb;line-height:1.5}
main{max-width:32rem;margin:0 auto;padding:3rem 1.25rem;text-align:center}
h1{font-size:2.5rem;margin:0 0 .5rem;letter-spacing:-.02em}
p{font-size:1.125rem;color:#4b5563;margin:0 0 2rem}
.boton{display:inline-block;padding:.9rem 1.5rem;border-radius:.75rem;
  background:#16a34a;color:#fff;font-weight:600;font-size:1.125rem;text-decoration:none}
.boton:active{background:#15803d}
/* Admin: formularios y fichas */
h2{font-size:1.5rem;margin:0 0 1rem}
form{text-align:left}
label{display:block;font-weight:600;margin:0 0 .25rem}
input{display:block;width:100%;padding:.75rem;margin:0 0 1rem;font-size:1rem;
  border:1px solid #d1d5db;border-radius:.5rem;background:#fff}
button{display:block;width:100%;padding:.9rem;border:0;border-radius:.75rem;
  background:#111827;color:#fff;font-size:1.0625rem;font-weight:600}
button.secundario{background:#e5e7eb;color:#111827}
.aviso{background:#fef2f2;color:#991b1b;border-radius:.5rem;padding:.75rem;font-size:1rem;margin:0 0 1rem}
.dato{font-family:ui-monospace,monospace;font-size:1.5rem;letter-spacing:.1em;color:#111827}
`;

/** Envuelve un contenido en la estructura básica de una página. */
export function pagina(titulo: string, contenido: string): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapar(titulo)}</title>
<link rel="icon" href="${ICONO_INCRUSTADO}">
<style>${ESTILOS}</style>
</head>
<body>
<main>
${contenido}
</main>
</body>
</html>`;
}
