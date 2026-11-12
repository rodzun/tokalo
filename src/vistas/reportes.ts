// Pantallas de reportes: escaneos por código y canal, y activaciones.
import { aHoraPeru, diaLegible } from "../lib/fechas";
import { escapar } from "../lib/html";
import { NOMBRE_PLATAFORMA, nombreDePlataforma, PLATAFORMAS } from "../lib/plataformas";
import {
  type Agrupacion,
  type FiltrosDeActivaciones,
  MAX_DIAS,
  MAX_FILAS,
  MAX_FILAS_CSV,
  periodoLegible,
  type Rango,
  type ReporteDeActivaciones,
  type ReporteDeEscaneos,
} from "../lib/reportes";
import { paginaAdmin } from "./admin";

/** <option> de un desplegable, marcada si es la elegida. */
function opcion(valor: string, texto: string, elegido: string): string {
  return `<option value="${escapar(valor)}"${valor === elegido ? " selected" : ""}>${escapar(texto)}</option>`;
}

/** Pestañas para pasar de un reporte a otro. */
function pestanas(actual: "escaneos" | "activaciones"): string {
  const enlace = (id: string, texto: string): string =>
    id === actual ? `<strong>${texto}</strong>` : `<a href="/admin/reportes/${id}">${texto}</a>`;
  return `<p>${enlace("escaneos", "Escaneos")} · ${enlace("activaciones", "Activaciones")}</p>`;
}

/** Campos de fecha (días de Perú) y de plataforma, comunes a los dos reportes. */
function camposComunes(rango: Rango, plataforma: string): string {
  return `<div class="dos">
<div><label for="desde">Desde</label><input id="desde" name="desde" type="date" value="${escapar(rango.desde)}"></div>
<div><label for="hasta">Hasta</label><input id="hasta" name="hasta" type="date" value="${escapar(rango.hasta)}"></div>
</div>
<label for="plataforma">Plataforma</label>
<select id="plataforma" name="plataforma">${opcion("", "Todas", plataforma)}${PLATAFORMAS.map((p) => opcion(p, NOMBRE_PLATAFORMA[p], plataforma)).join("")}</select>
${rango.recortado === true ? `<p class="aviso">El rango máximo es de ${MAX_DIAS} días: se muestra desde el ${escapar(diaLegible(rango.desde))}.</p>` : ""}`;
}

/** Aviso cuando la tabla llegó al tope de filas. */
function avisoDeTope(filas: number): string {
  return filas >= MAX_FILAS
    ? `<p class="aviso">Se muestran las primeras ${MAX_FILAS} filas (los totales son de todo el rango). El CSV trae hasta ${MAX_FILAS_CSV}; para ver el resto, acorta el rango de fechas.</p>`
    : "";
}

/** Reporte de lecturas por placa, separadas por canal. `urlCsv` descarga lo mismo en CSV. */
export function vistaReporteDeEscaneos(r: ReporteDeEscaneos, rango: Rango, plataforma: string, urlCsv: string): string {
  const filas = r.filas
    .map(
      (f) => `<tr><td><a href="/admin/placas/${escapar(f.codigo)}">${escapar(f.codigo)}</a></td>
<td>${escapar(f.negocio ?? "—")}</td><td>${escapar(nombreDePlataforma(f.plataforma))}</td>
<td class="num">${f.nfc}</td><td class="num">${f.qr}</td><td class="num">${f.total}</td></tr>`,
    )
    .join("\n");

  return paginaAdmin(
    "Escaneos",
    `<h2>Reportes</h2>
${pestanas("escaneos")}
<form method="get" action="/admin/reportes/escaneos">
${camposComunes(rango, plataforma)}
<button class="secundario">Ver</button>
</form>
<p style="margin-top:1.5rem">${r.totales.total} lecturas en ${r.totales.placas} placas · <a href="${escapar(urlCsv)}">Descargar CSV</a></p>
${avisoDeTope(r.filas.length)}
<div class="tabla"><table>
<thead><tr><th>Código</th><th>Negocio</th><th>Plataforma</th><th class="num">NFC</th><th class="num">QR</th><th class="num">Total</th></tr></thead>
<tbody>
${filas === "" ? '<tr><td colspan="6">Sin lecturas en ese rango.</td></tr>' : filas}
</tbody>
<tfoot><tr><td colspan="3">Total</td><td class="num">${r.totales.nfc}</td><td class="num">${r.totales.qr}</td><td class="num">${r.totales.total}</td></tr></tfoot>
</table></div>`,
  );
}

const NOMBRE_AGRUPACION: Record<Agrupacion, string> = {
  dia: "Por día",
  semana: "Por semana",
  mes: "Por mes",
  detalle: "Sin agrupar (placa por placa)",
};

/** Reporte de placas activadas, agrupado por período o placa por placa. */
export function vistaReporteDeActivaciones(
  r: ReporteDeActivaciones,
  f: FiltrosDeActivaciones,
  usuarios: ReadonlyArray<{ id: number; nombre: string }>,
  urlCsv: string,
): string {
  let tabla: string;
  if (f.agrupar === "detalle") {
    const filas = r.detalle
      .map(
        (d) => `<tr><td>${escapar(aHoraPeru(d.activada_en))}</td>
<td><a href="/admin/placas/${escapar(d.codigo)}">${escapar(d.codigo)}</a></td><td>${escapar(d.negocio ?? "—")}</td>
<td>${escapar(nombreDePlataforma(d.plataforma))}</td><td>${escapar(d.usuario ?? "—")}</td></tr>`,
      )
      .join("\n");
    tabla = `<thead><tr><th>Activada</th><th>Código</th><th>Negocio</th><th>Plataforma</th><th>Usuario</th></tr></thead>
<tbody>
${filas === "" ? '<tr><td colspan="5">Sin activaciones en ese rango.</td></tr>' : filas}
</tbody>`;
  } else {
    const agrupar = f.agrupar;
    const columnas = f.porUsuario ? 3 : 2;
    const filas = r.agrupadas
      .map(
        (a) => `<tr><td>${escapar(periodoLegible(a.periodo, agrupar))}</td>${f.porUsuario ? `<td>${escapar(a.usuario ?? "—")}</td>` : ""}<td class="num">${a.activaciones}</td></tr>`,
      )
      .join("\n");
    tabla = `<thead><tr><th>Período</th>${f.porUsuario ? "<th>Usuario</th>" : ""}<th class="num">Activaciones</th></tr></thead>
<tbody>
${filas === "" ? `<tr><td colspan="${columnas}">Sin activaciones en ese rango.</td></tr>` : filas}
</tbody>
<tfoot><tr><td colspan="${columnas - 1}">Total</td><td class="num">${r.total}</td></tr></tfoot>`;
  }

  const elegido = f.usuario === undefined ? "" : String(f.usuario);
  return paginaAdmin(
    "Activaciones",
    `<h2>Reportes</h2>
${pestanas("activaciones")}
<form method="get" action="/admin/reportes/activaciones">
${camposComunes(f.rango, f.plataforma ?? "")}
<label for="usuario">Usuario</label>
<select id="usuario" name="usuario">${opcion("", "Todos", elegido)}${usuarios.map((u) => opcion(String(u.id), u.nombre, elegido)).join("")}</select>
<label for="agrupar">Agrupar</label>
<select id="agrupar" name="agrupar">${(Object.keys(NOMBRE_AGRUPACION) as Agrupacion[]).map((a) => opcion(a, NOMBRE_AGRUPACION[a], f.agrupar)).join("")}</select>
<label class="casilla"><input type="checkbox" name="por_usuario" value="1"${f.porUsuario ? " checked" : ""}> Separar cada período por usuario</label>
<button class="secundario">Ver</button>
</form>
<p style="margin-top:1.5rem">${r.total} placas activadas · <a href="${escapar(urlCsv)}">Descargar CSV</a></p>
${avisoDeTope(Math.max(r.agrupadas.length, r.detalle.length))}
<div class="tabla"><table>
${tabla}
</table></div>`,
  );
}
