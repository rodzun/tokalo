// Pantallas de placas: lista, formulario de activación, ficha y sus cambios.
import { aHoraPeru } from "../lib/fechas";
import { escapar } from "../lib/html";
import { type CambioDeDestino, ESTADOS, type Placa, type PlacaEnLista } from "../lib/placas";
import { destinoCoincide, NOMBRE_PLATAFORMA, nombreDePlataforma, PLATAFORMAS } from "../lib/plataformas";
import { mensaje, paginaAdmin } from "./admin";

const NOMBRE_ESTADO: Record<string, string> = {
  sin_activar: "Sin activar",
  activa: "Activa",
  desactivada: "Desactivada",
};

/** Etiqueta de color con el estado de la placa. */
function etiquetaEstado(estado: string): string {
  return `<span class="estado ${escapar(estado)}">${escapar(NOMBRE_ESTADO[estado] ?? estado)}</span>`;
}

/** Encabezado común: código, estado, modelo, plataforma y lote. */
function encabezado(placa: Placa): string {
  return `<p><span class="dato">${escapar(placa.codigo)}</span> ${etiquetaEstado(placa.estado)}<br>${escapar(placa.modelo)} · ${escapar(placa.nombre_modelo)} · ${escapar(nombreDePlataforma(placa.plataforma))} · lote ${placa.lote}</p>`;
}

// ───────────────────────── Formularios ─────────────────────────

/** Lo que un formulario necesita recordar entre un envío y el siguiente. */
export interface EstadoDelFormulario {
  /** Lo que la persona escribió (para no perderlo si hay un error). */
  campos: Record<string, string>;
  /** Mensaje de error, si lo hay. */
  error?: string;
  /** Destino ya revisado: aparece con "Probar" y el botón de guardar. */
  destino?: string;
  /** Aviso que no impide guardar (por ejemplo, link de otra plataforma). */
  advertencia?: string;
  /** Mostrar el campo para pegar el link de reseña a mano (solo Google). */
  pedirManual?: boolean;
}

/** Campo de texto, con el valor que ya se había escrito. */
function campo(nombre: string, rotulo: string, e: EstadoDelFormulario, atributos = ""): string {
  return `<label for="${nombre}">${escapar(rotulo)}</label>
<input id="${nombre}" name="${nombre}" value="${escapar(e.campos[nombre] ?? "")}" ${atributos}>`;
}

/** Los tres datos del negocio. */
function camposDeNegocio(e: EstadoDelFormulario): string {
  return `${campo("negocio", "Negocio", e, 'maxlength="80" required')}
${campo("responsable", "Responsable", e, 'maxlength="80" autocomplete="off" required')}
${campo("telefono", "Teléfono", e, 'type="tel" inputmode="tel" maxlength="20" autocomplete="off" required')}`;
}

const ATRIBUTOS_DE_LINK = 'inputmode="url" autocapitalize="none" autocorrect="off"';

/**
 * Campo del link, según la plataforma del modelo:
 *   Google  -> link de Google Maps (se convierte solo en link de reseña)
 *   otras   -> el link del negocio en esa plataforma, tal cual
 */
function camposDeLink(placa: Placa, e: EstadoDelFormulario): string {
  if (placa.plataforma !== "google") {
    return campo("link", `Link del negocio en ${nombreDePlataforma(placa.plataforma)}`, e, ATRIBUTOS_DE_LINK);
  }
  const manual = e.pedirManual === true ? campo("manual", "Link de reseña (pégalo tal cual)", e, ATRIBUTOS_DE_LINK) : "";
  return `${campo("link", "Link de Google Maps del negocio", e, ATRIBUTOS_DE_LINK)}\n${manual}`;
}

/**
 * Lo que aparece tras "Revisar link": el destino, el enlace Probar y el
 * botón que guarda. Los campos ocultos llevan el destino revisado y el link
 * del que salió, para comprobar al guardar que no se cambió después de probarlo.
 */
function bloqueRevisado(e: EstadoDelFormulario, accionGuardar: string, textoBoton: string): string {
  if (e.destino === undefined) return "";
  return `<p class="ok">Destino listo. Pruébalo antes de guardar.</p>
${e.advertencia === undefined ? "" : `<p class="aviso">${escapar(e.advertencia)}</p>`}
<div class="fila"><span class="rotulo">Destino</span><span class="valor">${escapar(e.destino)}</span>
<a href="${escapar(e.destino)}" target="_blank" rel="noopener noreferrer">Probar</a></div>
<input type="hidden" name="destino" value="${escapar(e.destino)}">
<input type="hidden" name="revisado" value="${escapar(e.campos["manual"] || e.campos["link"] || "")}">
<button formaction="${escapar(accionGuardar)}">${escapar(textoBoton)}</button>
<p></p>`;
}

/** Botón "Revisar link": principal antes de revisar, secundario después. */
function botonRevisar(e: EstadoDelFormulario): string {
  return `<button class="${e.destino === undefined ? "" : "secundario"}">Revisar link</button>`;
}

/**
 * Formulario de activación. Tiene dos botones:
 *   "Revisar link"   -> calcula el destino y lo muestra para probarlo
 *   "Activar placa"  -> solo aparece tras revisar; guarda todo
 */
export function vistaActivacion(placa: Placa, e: EstadoDelFormulario = { campos: {} }): string {
  const base = `/admin/placas/${placa.codigo}`;
  return paginaAdmin(
    `Activar ${placa.codigo}`,
    `<h2>Activar placa</h2>
${encabezado(placa)}
${mensaje(e.error, true)}
<form method="post" action="${base}/revisar">
${camposDeNegocio(e)}
${camposDeLink(placa, e)}
${bloqueRevisado(e, `${base}/activar`, "Activar placa")}
${botonRevisar(e)}
</form>`,
  );
}

/** Formulario para cambiar el destino de una placa activa. Mismo flujo de revisar y guardar. */
export function vistaCambioDestino(placa: Placa, e: EstadoDelFormulario = { campos: {} }): string {
  const base = `/admin/placas/${placa.codigo}`;
  return paginaAdmin(
    `Destino de ${placa.codigo}`,
    `<h2>Cambiar destino</h2>
${encabezado(placa)}
<div class="fila"><span class="rotulo">Destino actual</span><span class="valor">${escapar(placa.destino ?? "—")}</span></div>
${mensaje(e.error, true)}
<form method="post" action="${base}/destino/revisar">
${camposDeLink(placa, e)}
${bloqueRevisado(e, `${base}/destino/guardar`, "Guardar destino")}
${botonRevisar(e)}
</form>
<p style="margin-top:1rem"><a href="${base}">Volver a la ficha</a></p>`,
  );
}

/** Formulario para corregir los datos del negocio. */
export function vistaEditar(placa: Placa, e: EstadoDelFormulario): string {
  const base = `/admin/placas/${placa.codigo}`;
  return paginaAdmin(
    `Datos de ${placa.codigo}`,
    `<h2>Editar datos</h2>
${encabezado(placa)}
${mensaje(e.error, true)}
<form method="post" action="${base}/editar">
${camposDeNegocio(e)}
<button>Guardar datos</button>
</form>
<p style="margin-top:1rem"><a href="${base}">Volver a la ficha</a></p>`,
  );
}

// ───────────────────────── Ficha ─────────────────────────

/** Una línea de la ficha: rótulo pequeño arriba y valor debajo. */
function linea(rotulo: string, valor: string | null): string {
  return `<p><span class="rotulo">${escapar(rotulo)}</span><span class="valor">${escapar(valor ?? "—")}</span></p>`;
}

/** Aviso rojo si el destino no es de la plataforma del modelo. */
function avisoNoCoincide(plataforma: string, destino: string | null): string {
  if (destino === null || destinoCoincide(plataforma, destino)) return "";
  return `<span class="estado desactivada">No es de ${escapar(nombreDePlataforma(plataforma))}</span>`;
}

/** Ficha de una placa activa o desactivada, con su historial y sus acciones. */
export function vistaFicha(placa: Placa, historial: readonly CambioDeDestino[], aviso?: string): string {
  const base = `/admin/placas/${placa.codigo}`;
  const probar =
    placa.destino === null
      ? ""
      : `<a href="${escapar(placa.destino)}" target="_blank" rel="noopener noreferrer">Probar destino</a>`;

  // Acciones según el estado. Lo que cambia algo va por formulario (POST).
  const acciones =
    placa.estado === "activa"
      ? `<p><a href="${base}/destino">Cambiar destino</a> · <a href="${base}/editar">Editar datos</a> · <a class="peligro" href="${base}/desactivar">Desactivar</a></p>`
      : `<form method="post" action="${base}/reactivar"><button>Reactivar placa</button></form>
<p style="margin-top:1rem"><a href="${base}/editar">Editar datos</a></p>`;

  const cambios = historial
    .map(
      (c) => `<div class="fila">
<span>${escapar(aHoraPeru(c.cambiado_en))} · ${escapar(c.nombre_usuario)}</span>
${c.destino_anterior === null ? "" : linea("Antes", c.destino_anterior)}
${linea(c.destino_anterior === null ? "Destino inicial" : "Después", c.destino_nuevo)}
</div>`,
    )
    .join("\n");

  return paginaAdmin(
    `Placa ${placa.codigo}`,
    `<h2>Placa</h2>
${mensaje(aviso)}
${encabezado(placa)}
<div class="fila">
${linea("Negocio", placa.negocio)}
${linea("Responsable", placa.responsable)}
${linea("Teléfono", placa.telefono)}
${linea("Destino", placa.destino)}
${avisoNoCoincide(placa.plataforma, placa.destino)}
${linea("Activada", placa.activada_en === null ? null : `${aHoraPeru(placa.activada_en)} por ${placa.activada_por_nombre ?? "—"}`)}
${probar}<a href="${base}/qr.svg">Ver QR</a>
</div>
${acciones}
<h2 style="margin-top:2rem">Historial de destinos</h2>
${cambios === "" ? "<p>Sin cambios registrados.</p>" : cambios}`,
  );
}

// ───────────────────────── Lista ─────────────────────────

/** Filtros tal como llegan en la URL, para volver a mostrarlos en el formulario. */
export interface FiltrosEnPantalla {
  estado: string;
  plataforma: string;
  busqueda: string;
  soloNoCoinciden: boolean;
  pagina: number;
}

/** Arma la URL de la lista con los filtros actuales y la página indicada. */
function urlDeLista(f: FiltrosEnPantalla, pagina: number): string {
  const q = new URLSearchParams();
  if (f.estado !== "") q.set("estado", f.estado);
  if (f.plataforma !== "") q.set("plataforma", f.plataforma);
  if (f.busqueda !== "") q.set("q", f.busqueda);
  if (f.soloNoCoinciden) q.set("revisar", "1");
  if (pagina > 1) q.set("pagina", String(pagina));
  const texto = q.toString();
  return texto === "" ? "/admin/placas" : `/admin/placas?${texto}`;
}

/** <option> de un desplegable, marcada si es la elegida. */
function opcion(valor: string, texto: string, elegido: string): string {
  return `<option value="${escapar(valor)}"${valor === elegido ? " selected" : ""}>${escapar(texto)}</option>`;
}

/** Lista de placas: una tarjeta por placa, con su destino y sus escaneos a la vista. */
export function vistaLista(placas: readonly PlacaEnLista[], f: FiltrosEnPantalla, hayMas: boolean): string {
  const tarjetas = placas
    .map((p) => {
      const destino =
        p.destino === null
          ? ""
          : `<p><span class="rotulo">Destino</span><a class="valor" href="${escapar(p.destino)}" target="_blank" rel="noopener noreferrer">${escapar(p.destino)}</a>${avisoNoCoincide(p.plataforma, p.destino)}</p>`;
      return `<div class="fila">
<strong><a href="/admin/placas/${escapar(p.codigo)}">${escapar(p.codigo)}</a> ${etiquetaEstado(p.estado)}</strong>
<span>${escapar(p.negocio ?? "—")}</span>
<span>${escapar(p.modelo)} · ${escapar(p.nombre_modelo)} · ${escapar(nombreDePlataforma(p.plataforma))}</span>
${destino}
<span>Escaneos: ${p.total} · últimos 30 días: ${p.ultimos30} · NFC: ${p.nfc} · QR: ${p.total - p.nfc}</span>
</div>`;
    })
    .join("\n");

  const paginas = `${f.pagina > 1 ? `<a href="${escapar(urlDeLista(f, f.pagina - 1))}">← Anteriores</a> ` : ""}${hayMas ? `<a href="${escapar(urlDeLista(f, f.pagina + 1))}">Siguientes →</a>` : ""}`;

  return paginaAdmin(
    "Placas",
    `<h2>Placas</h2>
<form method="get" action="/admin/placas">
<div class="dos">
<div><label for="estado">Estado</label>
<select id="estado" name="estado">${opcion("", "Todos", f.estado)}${ESTADOS.map((e) => opcion(e, NOMBRE_ESTADO[e] ?? e, f.estado)).join("")}</select></div>
<div><label for="plataforma">Plataforma</label>
<select id="plataforma" name="plataforma">${opcion("", "Todas", f.plataforma)}${PLATAFORMAS.map((p) => opcion(p, NOMBRE_PLATAFORMA[p], f.plataforma)).join("")}</select></div>
</div>
<label for="q">Buscar por código o negocio</label>
<input id="q" name="q" value="${escapar(f.busqueda)}" autocapitalize="none" autocomplete="off">
<label class="casilla"><input type="checkbox" name="revisar" value="1"${f.soloNoCoinciden ? " checked" : ""}> Solo destinos que no son de la plataforma de su modelo</label>
<button class="secundario">Filtrar</button>
</form>
<div style="margin-top:1.5rem">
${tarjetas === "" ? "<p>No hay placas con esos filtros.</p>" : tarjetas}
</div>
<p>${paginas}</p>`,
  );
}
