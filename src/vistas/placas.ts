// Pantallas de una placa: formulario de activación y ficha.
import { aHoraPeru } from "../lib/fechas";
import { escapar } from "../lib/html";
import type { Placa } from "../lib/placas";
import { mensaje, paginaAdmin } from "./admin";

/** Lo que el formulario necesita recordar entre un envío y el siguiente. */
export interface EstadoDelFormulario {
  /** Lo que la persona escribió (para no perderlo si hay un error). */
  campos: Record<string, string>;
  /** Mensaje de error, si lo hay. */
  error?: string;
  /** Destino ya revisado: aparece con "Probar" y el botón de activar. */
  destino?: string;
  /** Mostrar el campo para pegar el link de reseña a mano. */
  pedirManual?: boolean;
}

/** Campo de texto del formulario, con el valor que ya se había escrito. */
function campo(nombre: string, rotulo: string, e: EstadoDelFormulario, atributos = ""): string {
  return `<label for="${nombre}">${escapar(rotulo)}</label>
<input id="${nombre}" name="${nombre}" value="${escapar(e.campos[nombre] ?? "")}" ${atributos}>`;
}

/**
 * Formulario de activación. Tiene dos botones:
 *   "Revisar link"   -> convierte el link y muestra el destino para probarlo
 *   "Activar placa"  -> solo aparece tras revisar; guarda todo
 */
export function vistaActivacion(placa: Placa, e: EstadoDelFormulario = { campos: {} }): string {
  const base = `/admin/placas/${placa.codigo}`;

  const manual =
    e.pedirManual === true
      ? campo("manual", "Link de reseña (pégalo tal cual)", e, 'inputmode="url" autocapitalize="none" autocorrect="off"')
      : "";

  // Tras revisar: el destino, el botón Probar y el botón que guarda.
  // Los campos ocultos llevan el destino revisado y el link del que salió,
  // para comprobar al guardar que no se cambió el link después de probarlo.
  const revisado =
    e.destino === undefined
      ? ""
      : `<p class="ok">Destino listo. Pruébalo antes de activar.</p>
<div class="fila"><span class="rotulo">Destino</span><span class="valor">${escapar(e.destino)}</span>
<a href="${escapar(e.destino)}" target="_blank" rel="noopener noreferrer">Probar</a></div>
<input type="hidden" name="destino" value="${escapar(e.destino)}">
<input type="hidden" name="revisado" value="${escapar(e.campos["manual"] || e.campos["link"] || "")}">
<button formaction="${base}/activar">Activar placa</button>
<p></p>`;

  return paginaAdmin(
    `Activar ${placa.codigo}`,
    `<h2>Activar placa</h2>
<p><span class="dato">${escapar(placa.codigo)}</span><br>${escapar(placa.modelo)} · ${escapar(placa.nombre_modelo)} · lote ${placa.lote}</p>
${mensaje(e.error, true)}
<form method="post" action="${base}/revisar">
${campo("negocio", "Negocio", e, 'maxlength="80" required')}
${campo("responsable", "Responsable", e, 'maxlength="80" autocomplete="off" required')}
${campo("telefono", "Teléfono", e, 'type="tel" inputmode="tel" maxlength="20" autocomplete="off" required')}
${campo("link", "Link de Google Maps del negocio", e, 'inputmode="url" autocapitalize="none" autocorrect="off"')}
${manual}
${revisado}
<button class="${e.destino === undefined ? "" : "secundario"}">Revisar link</button>
</form>`,
  );
}

const NOMBRE_ESTADO: Record<string, string> = {
  sin_activar: "Sin activar",
  activa: "Activa",
  desactivada: "Desactivada",
};

/** Una línea de la ficha: rótulo pequeño arriba y valor debajo. */
function linea(rotulo: string, valor: string | null): string {
  return `<p><span class="rotulo">${escapar(rotulo)}</span><span class="valor">${escapar(valor ?? "—")}</span></p>`;
}

/** Ficha de una placa activa o desactivada (solo lectura). */
export function vistaFicha(placa: Placa, aviso?: string): string {
  const probar =
    placa.destino === null
      ? ""
      : `<a href="${escapar(placa.destino)}" target="_blank" rel="noopener noreferrer">Probar destino</a>`;
  return paginaAdmin(
    `Placa ${placa.codigo}`,
    `<h2>Placa</h2>
${mensaje(aviso)}
<p><span class="dato">${escapar(placa.codigo)}</span> <span class="estado ${escapar(placa.estado)}">${escapar(NOMBRE_ESTADO[placa.estado] ?? placa.estado)}</span><br>${escapar(placa.modelo)} · ${escapar(placa.nombre_modelo)} · lote ${placa.lote}</p>
<div class="fila">
${linea("Negocio", placa.negocio)}
${linea("Responsable", placa.responsable)}
${linea("Teléfono", placa.telefono)}
${linea("Destino", placa.destino)}
${linea("Activada", placa.activada_en === null ? null : `${aHoraPeru(placa.activada_en)} por ${placa.activada_por_nombre ?? "—"}`)}
${probar}<a href="/admin/placas/${escapar(placa.codigo)}/qr.svg">Ver QR</a>
</div>`,
  );
}
