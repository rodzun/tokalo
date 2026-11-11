// Pantalla de lotes: crear, listar, descargar CSV y eliminar.
import { aHoraPeru } from "../lib/fechas";
import { escapar } from "../lib/html";
import { MAX_POR_LOTE } from "../lib/lotes";
import type { Modelo } from "../lib/modelos";
import { mensaje, paginaAdmin } from "./admin";

/** Un lote tal como se muestra en la lista. */
export interface LoteEnLista {
  id: number;
  modelo: string;
  nombre_modelo: string;
  cantidad: number;
  creado_en: string;
  /** Placas del lote que ya fueron activadas alguna vez. */
  usadas: number;
}

export function vistaLotes(
  lotes: readonly LoteEnLista[],
  modelos: readonly Modelo[],
  aviso?: { texto: string; esError: boolean },
): string {
  const opciones = modelos
    .map((m) => `<option value="${escapar(m.id)}">${escapar(m.id)} · ${escapar(m.nombre)}</option>`)
    .join("");

  const filas = lotes
    .map((l) => {
      // Solo se puede eliminar un lote si ninguna de sus placas fue activada.
      const eliminar =
        l.usadas === 0
          ? `<a class="peligro" href="/admin/lotes/${l.id}/eliminar">Eliminar</a>`
          : "";
      return `<div class="fila">
<strong>Lote ${l.id} · ${escapar(l.modelo)} · ${escapar(l.nombre_modelo)}</strong>
<span>${l.cantidad} placas · ${l.usadas} activadas · ${escapar(aHoraPeru(l.creado_en))}</span>
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

/** Lista de códigos de un lote, cada uno con su QR para ver o descargar. */
export function vistaCodigosDeLote(numero: number, modelo: string, placas: readonly PlacaDeLote[]): string {
  const filas = placas
    .map(
      (p) => `<div class="fila">
<strong class="dato">${escapar(p.codigo)}</strong>
<span>${escapar(NOMBRE_ESTADO[p.estado] ?? p.estado)}</span>
<a href="/admin/placas/${escapar(p.codigo)}/qr.svg">Ver QR</a><a href="/admin/placas/${escapar(p.codigo)}/qr.svg?descargar=1">Descargar QR</a>
</div>`,
    )
    .join("\n");

  return paginaAdmin(
    `Lote ${numero}`,
    `<h2>Lote ${numero}</h2>
<p>${escapar(modelo)} · ${placas.length} placas</p>
<p><a href="/admin/lotes/${numero}.csv">Descargar CSV</a> · <a href="/admin/lotes">Volver a lotes</a></p>
${filas}`,
  );
}
