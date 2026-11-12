// Reportes del admin: escaneos por código y canal, y activaciones por período.
import { diaLegible, esDia, hoyEnPeru, inicioDelDiaPeru, sumarDias } from "./fechas";
import { aPlataforma } from "./plataformas";

// ───────────────────────── Rango de fechas ─────────────────────────

/** Rango de días de Perú, ambos incluidos. */
export interface Rango {
  desde: string; // "AAAA-MM-DD"
  hasta: string;
  /** Presente (true) si se pidió un rango más largo que el máximo y se acortó. */
  recortado?: true;
}

/** Rango máximo de un reporte, en días. Pone techo a las filas que lee de la base. */
export const MAX_DIAS = 366;

/**
 * Lee el rango pedido en la URL (?desde=...&hasta=...). Si falta o es
 * inválido, usa los últimos 30 días. Si vienen al revés, los intercambia.
 * Si abarca más de MAX_DIAS, conserva el final y acorta el inicio.
 */
export function leerRango(q: URLSearchParams): Rango {
  const hoy = hoyEnPeru();
  let desde = q.get("desde") ?? "";
  let hasta = q.get("hasta") ?? "";
  if (!esDia(hasta)) hasta = hoy;
  if (!esDia(desde)) desde = sumarDias(hasta, -29);
  if (desde > hasta) [desde, hasta] = [hasta, desde];
  const minimo = sumarDias(hasta, -(MAX_DIAS - 1));
  return desde < minimo ? { desde: minimo, hasta, recortado: true } : { desde, hasta };
}

/** Límites del rango en UTC, para comparar con las fechas de la base: [inicio, fin). */
function limitesUtc(r: Rango): [string, string] {
  return [inicioDelDiaPeru(r.desde), inicioDelDiaPeru(sumarDias(r.hasta, 1))];
}

// ───────────────────────── Escaneos por código y canal ─────────────────────────

export interface FilaDeEscaneos {
  codigo: string;
  negocio: string | null;
  plataforma: string;
  nfc: number;
  qr: number;
  total: number;
}

export interface ReporteDeEscaneos {
  filas: FilaDeEscaneos[];
  /** Totales de TODO el rango, aunque la tabla muestre solo las primeras filas. */
  totales: { nfc: number; qr: number; total: number; placas: number };
}

/**
 * Máximo de filas por reporte. En pantalla son menos porque armar el HTML
 * de cada fila gasta CPU (con 500 filas se medían picos de 11 a 15 ms; el
 * límite del plan gratuito es 10). El CSV es más barato y admite más.
 * Los totales siempre son de todo el rango, no solo de las filas mostradas.
 */
export const MAX_FILAS = 200;
export const MAX_FILAS_CSV = 500;

/**
 * Lecturas por placa en el rango, separadas por canal, de más a menos.
 *
 * Lee solo el resumen diario (`escaneos_diarios`), en una sola pasada:
 *   - `suma`: recorre las placas en orden de código y, para cada una, va
 *     directo a sus filas del rango por la clave primaria (codigo, dia,
 *     canal). Así lee solo las filas del rango y no necesita ordenar aparte
 *     para agrupar (ordenar aparte le costaba a D1 el doble de lecturas);
 *   - `primeras`: las placas con más lecturas, hasta el límite. Las columnas
 *     "OVER ()" traen en cada fila el total de TODAS las placas de `suma`
 *     (no solo de las mostradas), así no hace falta una segunda consulta;
 *   - al final se busca la plataforma solo de las placas mostradas.
 */
export async function reporteDeEscaneos(
  db: D1Database,
  rango: Rango,
  plataforma?: string,
  limite = MAX_FILAS,
): Promise<ReporteDeEscaneos> {
  const conFiltro = aPlataforma(plataforma) !== undefined;
  const filtro = conFiltro ? "WHERE p.modelo IN (SELECT id FROM modelos WHERE plataforma = ?3)" : "";
  const { results } = await db
    .prepare(
      `WITH suma AS (
         SELECT p.codigo, p.negocio, p.modelo,
                SUM(CASE WHEN d.canal = 'n' THEN d.cantidad ELSE 0 END) AS nfc,
                SUM(CASE WHEN d.canal = 'q' THEN d.cantidad ELSE 0 END) AS qr,
                SUM(d.cantidad) AS total
         FROM placas p
         JOIN escaneos_diarios d ON d.codigo = p.codigo AND d.dia >= ?1 AND d.dia <= ?2
         ${filtro}
         GROUP BY p.codigo
       ),
       primeras AS (
         SELECT codigo, negocio, modelo, nfc, qr, total,
                SUM(nfc) OVER () AS t_nfc, SUM(qr) OVER () AS t_qr, COUNT(*) OVER () AS t_placas
         FROM suma
         ORDER BY total DESC, codigo LIMIT ${Math.floor(limite)}
       )
       SELECT f.codigo, f.negocio, m.plataforma, f.nfc, f.qr, f.total, f.t_nfc, f.t_qr, f.t_placas
       FROM primeras f JOIN modelos m ON m.id = f.modelo
       ORDER BY f.total DESC, f.codigo`,
    )
    .bind(...(conFiltro ? [rango.desde, rango.hasta, plataforma] : [rango.desde, rango.hasta]))
    .all<FilaDeEscaneos & { t_nfc: number; t_qr: number; t_placas: number }>();

  // Los totales vienen repetidos en cada fila: se toman de la primera.
  const t = results[0];
  const nfc = t?.t_nfc ?? 0;
  const qr = t?.t_qr ?? 0;
  return {
    filas: results.map((f) => ({ codigo: f.codigo, negocio: f.negocio, plataforma: f.plataforma, nfc: f.nfc, qr: f.qr, total: f.total })),
    totales: { nfc, qr, total: nfc + qr, placas: t?.t_placas ?? 0 },
  };
}

// ───────────────────────── Activaciones ─────────────────────────

export const AGRUPACIONES = ["dia", "semana", "mes", "detalle"] as const;
export type Agrupacion = (typeof AGRUPACIONES)[number];

/**
 * Cómo se calcula el período de cada activación, en hora de Perú
 * ('-5 hours'). Son textos fijos elegidos de esta lista: nada que venga
 * de la URL se pega dentro del SQL.
 *   semana: 'weekday 0' avanza al domingo de esa semana y '-6 days'
 *           retrocede a su lunes. Las semanas van de lunes a domingo.
 */
const PERIODO_SQL: Record<Exclude<Agrupacion, "detalle">, string> = {
  dia: "date(p.activada_en, '-5 hours')",
  semana: "date(p.activada_en, '-5 hours', 'weekday 0', '-6 days')",
  mes: "strftime('%Y-%m', p.activada_en, '-5 hours')",
};

export interface FiltrosDeActivaciones {
  rango: Rango;
  agrupar: Agrupacion;
  /** Desglosar cada período por usuario. */
  porUsuario: boolean;
  /** Solo las activaciones de este usuario (id). */
  usuario?: number;
  plataforma?: string;
}

/** Una fila del reporte agrupado. */
export interface FilaDeActivaciones {
  /** "2026-11-11" (día o lunes de la semana) o "2026-11" (mes). */
  periodo: string;
  usuario: string | null;
  activaciones: number;
}

/** Una placa activada, para el reporte sin agrupar ("detalle"). */
export interface ActivacionDetallada {
  activada_en: string;
  codigo: string;
  negocio: string | null;
  plataforma: string;
  usuario: string | null;
}

export interface ReporteDeActivaciones {
  agrupadas: FilaDeActivaciones[];
  detalle: ActivacionDetallada[];
  total: number;
}

/**
 * Placas activadas en el rango. Cuenta la PRIMERA activación de cada placa
 * (la fecha `activada_en`): reactivar no suma, y una placa desactivada
 * después sigue contando en el día en que se activó.
 */
export async function reporteDeActivaciones(
  db: D1Database,
  f: FiltrosDeActivaciones,
  limite = MAX_FILAS,
): Promise<ReporteDeActivaciones> {
  const tope = Math.floor(limite);
  const [inicio, fin] = limitesUtc(f.rango);
  const condiciones = ["p.activada_en >= ?", "p.activada_en < ?"];
  const valores: Array<string | number> = [inicio, fin];
  if (f.usuario !== undefined) {
    condiciones.push("p.activada_por = ?");
    valores.push(f.usuario);
  }
  if (aPlataforma(f.plataforma) !== undefined) {
    condiciones.push("m.plataforma = ?");
    valores.push(f.plataforma ?? "");
  }
  const desde = `FROM placas p JOIN modelos m ON m.id = p.modelo LEFT JOIN usuarios u ON u.id = p.activada_por
                 WHERE ${condiciones.join(" AND ")}`;

  const total = (await db.prepare(`SELECT COUNT(*) AS n ${desde}`).bind(...valores).first<number>("n")) ?? 0;

  if (f.agrupar === "detalle") {
    const { results } = await db
      .prepare(
        `SELECT p.activada_en, p.codigo, p.negocio, m.plataforma, u.nombre AS usuario
         ${desde} ORDER BY p.activada_en DESC, p.codigo LIMIT ${tope}`,
      )
      .bind(...valores)
      .all<ActivacionDetallada>();
    return { agrupadas: [], detalle: results, total };
  }

  const periodo = PERIODO_SQL[f.agrupar];
  const { results } = await db
    .prepare(
      f.porUsuario
        ? `SELECT ${periodo} AS periodo, u.nombre AS usuario, COUNT(*) AS activaciones
           ${desde} GROUP BY periodo, p.activada_por ORDER BY periodo DESC, activaciones DESC, usuario LIMIT ${tope}`
        : `SELECT ${periodo} AS periodo, NULL AS usuario, COUNT(*) AS activaciones
           ${desde} GROUP BY periodo ORDER BY periodo DESC LIMIT ${tope}`,
    )
    .bind(...valores)
    .all<FilaDeActivaciones>();
  return { agrupadas: results, detalle: [], total };
}

/** Texto del período para mostrar: "11/11/2026", "Semana del 09/11/2026" o "11/2026". */
export function periodoLegible(periodo: string, agrupar: Agrupacion): string {
  if (agrupar === "mes") {
    const [anio, mes] = periodo.split("-");
    return `${mes}/${anio}`;
  }
  return agrupar === "semana" ? `Semana del ${diaLegible(periodo)}` : diaLegible(periodo);
}

// ───────────────────────── CSV ─────────────────────────

/** Prepara un valor para una celda de CSV. */
function celda(valor: string | number | null): string {
  let texto = valor === null ? "" : String(valor);
  // Un texto que empieza por = + - @ se interpretaría como fórmula al abrir
  // el archivo en Excel: se le antepone un apóstrofo para que sea solo texto.
  if (typeof valor === "string" && /^[=+\-@]/.test(texto)) texto = `'${texto}`;
  // Comillas, comas y saltos de línea obligan a encerrar el valor entre comillas.
  return /[",\r\n]/.test(texto) ? `"${texto.replaceAll('"', '""')}"` : texto;
}

/** Convierte filas en texto CSV. La primera fila son los títulos. */
export function aCsv(filas: ReadonlyArray<ReadonlyArray<string | number | null>>): string {
  return filas.map((fila) => fila.map(celda).join(",")).join("\r\n") + "\r\n";
}
