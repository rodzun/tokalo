// Rutas de reportes (exigen sesión). Con ?formato=csv devuelven el mismo
// reporte como archivo CSV.
import { aHoraPeru } from "../lib/fechas";
import { nombreDePlataforma } from "../lib/plataformas";
import {
  aCsv,
  AGRUPACIONES,
  type FiltrosDeActivaciones,
  leerRango,
  MAX_FILAS,
  MAX_FILAS_CSV,
  periodoLegible,
  reporteDeActivaciones,
  reporteDeEscaneos,
} from "../lib/reportes";
import { html, redirigirTrasEnvio } from "../lib/respuestas";
import { vistaReporteDeActivaciones, vistaReporteDeEscaneos } from "../vistas/reportes";
import type { PeticionAdmin } from "./tipos";

/** Respuesta que el navegador guarda como archivo CSV. */
function descargaCsv(nombre: string, filas: ReadonlyArray<ReadonlyArray<string | number | null>>): Response {
  return new Response(aCsv(filas), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nombre}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** La URL actual con &formato=csv añadido. */
function urlCsv(url: URL): string {
  const q = new URLSearchParams(url.searchParams);
  q.set("formato", "csv");
  return `${url.pathname}?${q.toString()}`;
}

/** Devuelve la respuesta si la ruta es de reportes, o null si no. */
export async function rutasReportes(p: PeticionAdmin): Promise<Response | null> {
  if (p.metodo !== "GET" || !p.ruta.startsWith("/admin/reportes")) return null;
  const q = p.url.searchParams;
  const rango = leerRango(q);
  const plataforma = q.get("plataforma") ?? "";
  const quiereCsv = q.get("formato") === "csv";
  const sufijo = `${rango.desde}-a-${rango.hasta}.csv`;
  const limite = quiereCsv ? MAX_FILAS_CSV : MAX_FILAS;

  if (p.ruta === "/admin/reportes") return redirigirTrasEnvio("/admin/reportes/escaneos");

  // Lecturas por placa y canal.
  if (p.ruta === "/admin/reportes/escaneos") {
    const reporte = await reporteDeEscaneos(p.env.DB, rango, plataforma, limite);
    if (quiereCsv) {
      return descargaCsv(`tokalo-escaneos-${sufijo}`, [
        ["codigo", "negocio", "plataforma", "nfc", "qr", "total"],
        ...reporte.filas.map((f) => [f.codigo, f.negocio, nombreDePlataforma(f.plataforma), f.nfc, f.qr, f.total]),
      ]);
    }
    return html(vistaReporteDeEscaneos(reporte, rango, plataforma, urlCsv(p.url)));
  }

  // Placas activadas por período y usuario.
  if (p.ruta === "/admin/reportes/activaciones") {
    const usuario = Number.parseInt(q.get("usuario") ?? "", 10);
    const filtros: FiltrosDeActivaciones = {
      rango,
      agrupar: AGRUPACIONES.find((a) => a === q.get("agrupar")) ?? "dia",
      porUsuario: q.get("por_usuario") === "1",
      usuario: Number.isInteger(usuario) && usuario > 0 ? usuario : undefined,
      plataforma,
    };
    const reporte = await reporteDeActivaciones(p.env.DB, filtros, limite);

    if (quiereCsv) {
      if (filtros.agrupar === "detalle") {
        return descargaCsv(`tokalo-activaciones-${sufijo}`, [
          ["activada", "codigo", "negocio", "plataforma", "usuario"],
          ...reporte.detalle.map((d) => [aHoraPeru(d.activada_en), d.codigo, d.negocio, nombreDePlataforma(d.plataforma), d.usuario]),
        ]);
      }
      const agrupar = filtros.agrupar;
      return descargaCsv(`tokalo-activaciones-${sufijo}`, [
        filtros.porUsuario ? ["periodo", "usuario", "activaciones"] : ["periodo", "activaciones"],
        ...reporte.agrupadas.map((a) =>
          filtros.porUsuario
            ? [periodoLegible(a.periodo, agrupar), a.usuario, a.activaciones]
            : [periodoLegible(a.periodo, agrupar), a.activaciones],
        ),
      ]);
    }

    const { results: usuarios } = await p.env.DB.prepare("SELECT id, nombre FROM usuarios ORDER BY nombre").all<{
      id: number;
      nombre: string;
    }>();
    return html(vistaReporteDeActivaciones(reporte, filtros, usuarios, urlCsv(p.url)));
  }

  return null;
}
