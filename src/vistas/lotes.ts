// Pantalla de lotes: crear, listar, descargar CSV y eliminar.
import { aHoraPeru } from "../lib/fechas";
import { escapar } from "../lib/html";
import { MAX_POR_LOTE } from "../lib/lotes";
import type { Modelo } from "../lib/modelos";
import { nombreDePlataforma } from "../lib/plataformas";
import { mensaje, paginaAdmin } from "./admin";

/** Un lote tal como se muestra en la lista. */
export interface LoteEnLista {
  id: number;
  modelo: string;
  nombre_modelo: string;
  cantidad: number;
  creado_en: string;
  /** "generado" o "impreso". */
  estado: string;
  /** Placas del lote que ya fueron activadas alguna vez. */
  usadas: number;
}

/** Etiqueta de color con el estado de impresión del lote. */
function etiquetaDeLote(estado: string): string {
  return estado === "impreso"
    ? '<span class="estado activa">Impreso</span>'
    : '<span class="estado">Generado</span>';
}

export function vistaLotes(
  lotes: readonly LoteEnLista[],
  modelos: readonly Modelo[],
  aviso?: { texto: string; esError: boolean },
): string {
  const opciones = modelos
    .map((m) => `<option value="${escapar(m.id)}">${escapar(m.id)} · ${escapar(m.nombre)} · ${escapar(nombreDePlataforma(m.plataforma))}</option>`)
    .join("");

  const filas = lotes
    .map((l) => {
      // Solo se puede eliminar un lote que sigue en "Generado".
      const eliminar =
        l.estado === "generado"
          ? `<a class="peligro" href="/admin/lotes/${l.id}/eliminar">Eliminar</a>`
          : "";
      return `<div class="fila">
<strong>Lote ${l.id} · ${escapar(l.modelo)} · ${escapar(l.nombre_modelo)}</strong>
<span>${l.cantidad} placas · ${l.usadas} activadas · ${escapar(aHoraPeru(l.creado_en))}</span>
<span>${etiquetaDeLote(l.estado)}</span>
<a href="/admin/lotes/${l.id}">Códigos y QR</a><a href="/admin/lotes/${l.id}.csv">Descargar CSV</a>${eliminar}
</div>`;
    })
    .join("\n");

  return paginaAdmin(
    "Lotes",
    `<h2>Crear lote</h2>
${mensaje(aviso?.texto, aviso?.esError)}
<form method="post" action="/admin/lotes">
<label for="modelo">Modelo</label>
<select id="modelo" name="modelo" required>${opciones}</select>
<label for="cantidad">Cantidad de placas (máximo ${MAX_POR_LOTE})</label>
<input id="cantidad" name="cantidad" type="number" inputmode="numeric" min="1" max="${MAX_POR_LOTE}" required>
<button>Crear lote</button>
</form>
<h2 style="margin-top:2rem">Lotes</h2>
${filas === "" ? "<p>Todavía no hay lotes.</p>" : filas}`,
  );
}

/** Una placa en la lista de códigos de un lote. */
export interface PlacaDeLote {
  codigo: string;
  estado: string;
}

const NOMBRE_ESTADO: Record<string, string> = {
  sin_activar: "Sin activar",
  activa: "Activa",
  desactivada: "Desactivada",
};

/** Datos de un lote para su pantalla, con el estado de impresión. */
export interface LoteConEstado {
  id: number;
  modelo: string;
  nombre_modelo: string;
  estado: string;
  /** Cuándo cambió el estado por última vez (UTC), o null si nunca cambió. */
  estado_cambiado_en: string | null;
  /** Nombre de quien lo cambió. */
  estado_cambiado_por: string | null;
}

/** Pantalla de un lote: estado de impresión y lista de códigos con su QR. */
export function vistaCodigosDeLote(
  lote: LoteConEstado,
  placas: readonly PlacaDeLote[],
  aviso?: { texto: string; esError: boolean },
): string {
  const filas = placas
    .map(
      (p) => `<div class="fila">
<strong class="dato">${escapar(p.codigo)}</strong>
<span>${escapar(NOMBRE_ESTADO[p.estado] ?? p.estado)}</span>
<a href="/admin/placas/${escapar(p.codigo)}/qr.svg">Ver QR</a><a href="/admin/placas/${escapar(p.codigo)}/qr.svg?descargar=1">Descargar QR</a>
</div>`,
    )
    .join("\n");

  const cambio =
    lote.estado_cambiado_en === null
      ? ""
      : ` · ${escapar(aHoraPeru(lote.estado_cambiado_en))} por ${escapar(lote.estado_cambiado_por ?? "—")}`;
  // El estado se cambia a mano con un botón (es un formulario: cambia datos).
  const boton =
    lote.estado === "impreso"
      ? `<form method="post" action="/admin/lotes/${lote.id}/generado"><button class="secundario">Volver a Generado</button></form>`
      : `<form method="post" action="/admin/lotes/${lote.id}/impreso"><button>Marcar como impreso</button></form>`;

  return paginaAdmin(
    `Lote ${lote.id}`,
    `<h2>Lote ${lote.id}</h2>
${mensaje(aviso?.texto, aviso?.esError)}
<p>${escapar(lote.modelo)} · ${escapar(lote.nombre_modelo)} · ${placas.length} placas</p>
<div class="fila">
<span class="rotulo">Estado de impresión</span>
<span>${etiquetaDeLote(lote.estado)}${cambio}</span>
${boton}
</div>
<p><a href="/admin/lotes/${lote.id}.csv">Descargar CSV</a> · <a href="/admin/lotes">Volver a lotes</a></p>
${filas}`,
  );
}
