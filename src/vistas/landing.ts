// Landing: la página pública de una sola pantalla.
import { escapar, pagina } from "../lib/html";

const MENSAJE_WHATSAPP = "Hola, quiero información sobre las placas Tokalo";

/**
 * Devuelve el HTML de la landing.
 * `whatsapp` es el número con código de país y solo dígitos (51913629134).
 */
export function landing(whatsapp: string): string {
  const enlace = `https://wa.me/${whatsapp}?text=${encodeURIComponent(MENSAJE_WHATSAPP)}`;
  return pagina(
    "Tokalo",
    `<h1>Tokalo</h1>
<p>Placas NFC y QR para que tus clientes te dejen reseñas.</p>
<a class="boton" href="${escapar(enlace)}">Escríbenos por WhatsApp</a>`,
  );
}
