// Rutas de lotes (todas exigen sesión; eso lo comprueba rutas/admin.ts).
import { normalizarCodigo } from "../lib/codigos";
import { csvDeLote, crearLote, eliminarLote, MAX_POR_LOTE } from "../lib/lotes";
import { enteroEntre, listarModelos } from "../lib/modelos";
import { qrSvg, urlParaQr } from "../lib/qr";
import { html, redirigirTrasEnvio } from "../lib/respuestas";
import { vistaAviso, vistaConfirmar } from "../vistas/admin";
import { type LoteEnLista, type PlacaDeLote, vistaCodigosDeLote, vistaLotes } from "../vistas/lotes";
import { leerFormulario, type PeticionAdmin } from "./tipos";

// Mensajes que se muestran tras una acción, según ?aviso=... en la URL.
const AVISOS: Record<string, { texto: string; esError: boolean }> = {
  creado: { texto: "Lote creado.", esError: false },
  eliminado: { texto: "Lote eliminado.", esError: false },
  "no-eliminado": { texto: "No se eliminó: el lote no existe o tiene placas activadas.", esError: true },
};

async function paginaLotes(env: Env, aviso?: { texto: string; esError: boolean }, estado = 200): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT l.id, l.modelo, m.nombre AS nombre_modelo, l.cantidad, l.creado_en,
            (SELECT COUNT(*) FROM placas p WHERE p.lote = l.id AND p.estado != 'sin_activar') AS usadas
     FROM lotes l JOIN modelos m ON m.id = l.modelo
     ORDER BY l.id DESC LIMIT 200`,
  ).all<LoteEnLista>();
  return html(vistaLotes(results, await listarModelos(env.DB), aviso), "no-store", estado);
}

/** Devuelve la respuesta si la ruta es de lotes, o null si no le corresponde. */
export async function rutasLotes(p: PeticionAdmin): Promise<Response | null> {
  const { env, ruta, metodo } = p;

  // GET /admin/lotes : lista y formulario.
  if (ruta === "/admin/lotes" && metodo === "GET") {
    return paginaLotes(env, AVISOS[p.url.searchParams.get("aviso") ?? ""]);
  }

  // POST /admin/lotes : crear un lote.
  if (ruta === "/admin/lotes" && metodo === "POST") {
    const campos = await leerFormulario(p.solicitud);
    const cantidad = enteroEntre(campos["cantidad"] ?? "", 1, MAX_POR_LOTE);
    const modelo = (await listarModelos(env.DB)).find((m) => m.id === campos["modelo"]);
    if (modelo === undefined) {
      return paginaLotes(env, { texto: "Elige un modelo de la lista.", esError: true }, 400);
    }
    if (cantidad === null) {
      return paginaLotes(env, { texto: `La cantidad debe estar entre 1 y ${MAX_POR_LOTE}.`, esError: true }, 400);
    }
    await crearLote(env.DB, modelo.id, cantidad, p.usuario.id);
    return redirigirTrasEnvio("/admin/lotes?aviso=creado");
  }

  // GET /admin/lotes/12.csv : descarga con codigo, url_nfc, url_qr.
  const csv = /^\/admin\/lotes\/(\d{1,9})\.csv$/.exec(ruta);
  if (csv !== null && metodo === "GET") {
    const numero = Number(csv[1]);
    const lote = await env.DB.prepare("SELECT modelo FROM lotes WHERE id = ?").bind(numero).first<string>("modelo");
    if (lote === null) return html(vistaAviso("Lote no encontrado", "Ese lote no existe."), "no-store", 404);
    const { results } = await env.DB.prepare("SELECT codigo FROM placas WHERE lote = ? ORDER BY codigo")
      .bind(numero)
      .all<{ codigo: string }>();
    return new Response(csvDeLote(results.map((f) => f.codigo), env.URL_BASE), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="tokalo-lote-${numero}-${lote}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  // GET /admin/lotes/12 : los códigos del lote, con el enlace a cada QR.
  const detalle = /^\/admin\/lotes\/(\d{1,9})$/.exec(ruta);
  if (detalle !== null && metodo === "GET") {
    const numero = Number(detalle[1]);
    const lote = await env.DB.prepare(
      "SELECT l.modelo, m.nombre FROM lotes l JOIN modelos m ON m.id = l.modelo WHERE l.id = ?",
    )
      .bind(numero)
      .first<{ modelo: string; nombre: string }>();
    if (lote === null) return html(vistaAviso("Lote no encontrado", "Ese lote no existe."), "no-store", 404);
    const { results } = await env.DB.prepare("SELECT codigo, estado FROM placas WHERE lote = ? ORDER BY codigo")
      .bind(numero)
      .all<PlacaDeLote>();
    return html(vistaCodigosDeLote(numero, `${lote.modelo} · ${lote.nombre}`, results));
  }

  // GET /admin/placas/XK7P2M/qr.svg : el QR de una placa.
  // Con ?descargar=1 el navegador lo guarda como archivo en vez de mostrarlo.
  const qr = /^\/admin\/placas\/([^/]+)\/qr\.svg$/.exec(ruta);
  if (qr !== null && metodo === "GET") {
    const codigo = normalizarCodigo(qr[1] ?? "");
    const existe =
      codigo !== null &&
      (await env.DB.prepare("SELECT 1 AS si FROM placas WHERE codigo = ?").bind(codigo).first("si")) !== null;
    if (codigo === null || !existe) {
      return html(vistaAviso("Placa no encontrada", "Ese código no existe."), "no-store", 404);
    }
    const cabeceras = new Headers({
      "Content-Type": "image/svg+xml",
      // El QR de un código no cambia nunca: el navegador puede guardarlo un día.
      "Cache-Control": "private, max-age=86400",
    });
    if (p.url.searchParams.get("descargar") === "1") {
      cabeceras.set("Content-Disposition", `attachment; filename="tokalo-${codigo}.svg"`);
    }
    return new Response(qrSvg(urlParaQr(env.URL_BASE, codigo)), { headers: cabeceras });
  }

  // GET /admin/lotes/12/eliminar : pide confirmación.  POST: elimina.
  const eliminar = /^\/admin\/lotes\/(\d{1,9})\/eliminar$/.exec(ruta);
  if (eliminar !== null) {
    const numero = Number(eliminar[1]);
    if (metodo === "POST") {
      const eliminado = await eliminarLote(env.DB, numero);
      return redirigirTrasEnvio(`/admin/lotes?aviso=${eliminado ? "eliminado" : "no-eliminado"}`);
    }
    if (metodo === "GET") {
      const cantidad = await env.DB.prepare("SELECT cantidad FROM lotes WHERE id = ?").bind(numero).first<number>("cantidad");
      if (cantidad === null) return redirigirTrasEnvio("/admin/lotes?aviso=no-eliminado");
      return html(
        vistaConfirmar(
          `Eliminar lote ${numero}`,
          `Se borrarán el lote y sus ${cantidad} placas sin activar. Si esos códigos ya se imprimieron o se grabaron en chips, dejarán de funcionar. No se puede deshacer.`,
          `/admin/lotes/${numero}/eliminar`,
          "/admin/lotes",
        ),
      );
    }
  }

  return null;
}
