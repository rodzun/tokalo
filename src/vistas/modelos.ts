// Pantalla de modelos: crear, listar y eliminar.
import { escapar } from "../lib/html";
import { type Modelo, TIPOS } from "../lib/modelos";
import { mensaje, paginaAdmin } from "./admin";

const NOMBRE_TIPO: Record<string, string> = { totem: "Tótem", mesa: "Mesa", tarjeta: "Tarjeta" };

export function vistaModelos(
  modelos: readonly Modelo[],
  aviso?: { texto: string; esError: boolean },
): string {
  const filas = modelos
    .map(
      (m) => `<div class="fila">
<strong>${escapar(m.id)} · ${escapar(m.nombre)}</strong>
<span>${escapar(NOMBRE_TIPO[m.tipo] ?? m.tipo)} · ${m.ancho_mm} x ${m.alto_mm} mm · versión ${m.version}</span>
<a class="peligro" href="/admin/modelos/${escapar(m.id)}/eliminar">Eliminar</a>
</div>`,
    )
    .join("\n");

  const opciones = TIPOS.map((t) => `<option value="${t}">${escapar(NOMBRE_TIPO[t] ?? t)}</option>`).join("");

  return paginaAdmin(
    "Modelos",
    `<h2>Modelos</h2>
${mensaje(aviso?.texto, aviso?.esError)}
${filas === "" ? "<p>Todavía no hay modelos.</p>" : filas}
<h2 style="margin-top:2rem">Crear modelo</h2>
<form method="post" action="/admin/modelos">
<label for="id">Id (1 a 3 letras o números)</label>
<input id="id" name="id" maxlength="3" autocapitalize="characters" autocomplete="off" required>
<label for="nombre">Nombre</label>
<input id="nombre" name="nombre" maxlength="60" autocomplete="off" required>
<label for="tipo">Tipo</label>
<select id="tipo" name="tipo" required>${opciones}</select>
<div class="dos">
<div><label for="ancho_mm">Ancho (mm)</label>
<input id="ancho_mm" name="ancho_mm" type="number" inputmode="numeric" min="1" max="2000" required></div>
<div><label for="alto_mm">Alto (mm)</label>
<input id="alto_mm" name="alto_mm" type="number" inputmode="numeric" min="1" max="2000" required></div>
</div>
<label for="version">Versión</label>
<input id="version" name="version" type="number" inputmode="numeric" min="1" max="999" value="1" required>
<button>Crear modelo</button>
</form>`,
  );
}
