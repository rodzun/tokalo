// Pantalla "Convertir link": pegar un link de Maps y ver el link de reseña.
import { escapar } from "../lib/html";
import type { Conversion } from "../lib/maps";
import { mensaje, paginaAdmin } from "./admin";

/** Bloque con el link de reseña obtenido y el botón para probarlo. */
export function bloqueDestino(destino: string): string {
  return `<p class="ok">Link de reseña encontrado.</p>
<label for="destino">Destino</label>
<input id="destino" value="${escapar(destino)}" readonly>
<p><a class="boton" href="${escapar(destino)}" target="_blank" rel="noopener noreferrer">Probar</a></p>
<p>"Probar" abre el link en otra pestaña: debe aparecer el formulario de reseña del negocio correcto.</p>`;
}

export function vistaConvertir(pegado = "", resultado?: Conversion): string {
  let bloque = "";
  if (resultado !== undefined) {
    bloque = resultado.ok
      ? bloqueDestino(resultado.destino)
      : mensaje(`${resultado.motivo} Si el negocio te dio su link de reseña, pégalo directamente.`, true);
  }
  return paginaAdmin(
    "Convertir link",
    `<h2>Convertir link</h2>
<p>Pega el link de Google Maps del negocio (botón "Compartir" en Maps).</p>
<form method="post" action="/admin/convertir">
<label for="link">Link de Google Maps</label>
<input id="link" name="link" value="${escapar(pegado)}" inputmode="url" autocapitalize="none" autocorrect="off" required>
<button>Convertir</button>
</form>
<div style="margin-top:1.5rem">${bloque}</div>`,
  );
}
