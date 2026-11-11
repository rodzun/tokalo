// Lotes: tandas de códigos generadas desde el admin.
import { type Generador, generarCodigo, generarCodigosUnicos } from "./codigos";
import { ahoraUtc } from "./fechas";

/** Máximo de placas por lote. */
export const MAX_POR_LOTE = 500;

/** Veces que se reintenta si algún código generado ya existía. */
const MAX_REINTENTOS = 5;

/** True si el error viene de la clave primaria de placas (código repetido). */
function esCodigoRepetido(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed: placas.codigo");
}

/**
 * Crea un lote con `cantidad` placas sin activar y devuelve su número.
 *
 * Todo ocurre en UNA transacción (`batch`): se inserta el lote y todas sus
 * placas, o no se inserta nada. Si algún código ya existía, la clave
 * primaria rechaza la transacción entera; entonces se cambian solo los
 * repetidos y se vuelve a intentar.
 */
export async function crearLote(
  db: D1Database,
  modelo: string,
  cantidad: number,
  idUsuario: number,
  generador: Generador = generarCodigo,
): Promise<number> {
  let codigos = generarCodigosUnicos(cantidad, generador);

  for (let intento = 0; intento < MAX_REINTENTOS; intento++) {
    const ahora = ahoraUtc();
    try {
      const [lote] = await db.batch([
        db.prepare("INSERT INTO lotes (modelo, cantidad, creado_por, creado_en) VALUES (?, ?, ?, ?)")
          .bind(modelo, cantidad, idUsuario, ahora),
        // Una sola sentencia inserta todas las placas: json_each convierte la
        // lista JSON de códigos en filas. El lote recién creado es el de
        // número más alto (estamos dentro de la misma transacción).
        db.prepare(
          `INSERT INTO placas (codigo, modelo, lote, estado, creada_en)
           SELECT value, ?, (SELECT MAX(id) FROM lotes), 'sin_activar', ?
           FROM json_each(?)`,
        ).bind(modelo, ahora, JSON.stringify(codigos)),
      ]);
      const numero = lote?.meta.last_row_id;
      if (typeof numero !== "number") throw new Error("La base no devolvió el número de lote");
      return numero;
    } catch (error) {
      if (!esCodigoRepetido(error)) throw error;

      // Averiguamos cuáles chocaron y generamos reemplazos solo para esos.
      const { results } = await db
        .prepare("SELECT codigo FROM placas WHERE codigo IN (SELECT value FROM json_each(?))")
        .bind(JSON.stringify(codigos))
        .all<{ codigo: string }>();
      const repetidos = new Set(results.map((fila) => fila.codigo));
      const conservados = codigos.filter((codigo) => !repetidos.has(codigo));
      const nuevos = generarCodigosUnicos(repetidos.size, generador, new Set(conservados));
      codigos = [...conservados, ...nuevos];
    }
  }
  throw new Error("No se pudo crear el lote: demasiados códigos repetidos");
}

// ───────────────────────── Estado de impresión ─────────────────────────
// "generado": recién creado, todavía no se fabricó. Se puede eliminar.
// "impreso":  ya se mandó a fabricar. No se puede eliminar.

/**
 * Condición SQL: "el lote ?1 tiene alguna placa usada", es decir, activada
 * alguna vez (activa o desactivada) o con escaneos registrados.
 */
const TIENE_PLACAS_USADAS = `EXISTS (
  SELECT 1 FROM placas p WHERE p.lote = ?1
  AND (p.estado != 'sin_activar' OR EXISTS (SELECT 1 FROM escaneos e WHERE e.codigo = p.codigo))
)`;

/** Marca un lote como impreso, anotando quién y cuándo. Devuelve true si cambió. */
export async function marcarImpreso(db: D1Database, numero: number, idUsuario: number): Promise<boolean> {
  const r = await db
    .prepare(
      `UPDATE lotes SET estado = 'impreso', estado_cambiado_en = ?2, estado_cambiado_por = ?3
       WHERE id = ?1 AND estado = 'generado'`,
    )
    .bind(numero, ahoraUtc(), idUsuario)
    .run();
  return r.meta.changes > 0;
}

/**
 * Devuelve un lote a "generado". Solo si ninguna de sus placas fue activada
 * ni tiene escaneos: si alguna ya está en uso, el lote existe físicamente.
 */
export async function desmarcarImpreso(db: D1Database, numero: number, idUsuario: number): Promise<boolean> {
  const r = await db
    .prepare(
      `UPDATE lotes SET estado = 'generado', estado_cambiado_en = ?2, estado_cambiado_por = ?3
       WHERE id = ?1 AND estado = 'impreso' AND NOT ${TIENE_PLACAS_USADAS}`,
    )
    .bind(numero, ahoraUtc(), idUsuario)
    .run();
  return r.meta.changes > 0;
}

/**
 * Elimina un lote y sus placas. Solo si está en "generado" (y, por
 * seguridad, si ninguna placa fue usada). Devuelve true si se eliminó.
 * Las dos sentencias van en una transacción y cada una vuelve a comprobar
 * la condición, así que nunca borra a medias.
 */
export async function eliminarLote(db: D1Database, numero: number): Promise<boolean> {
  const [, lote] = await db.batch([
    db.prepare(
      `DELETE FROM placas WHERE lote = ?1
       AND EXISTS (SELECT 1 FROM lotes WHERE id = ?1 AND estado = 'generado')
       AND NOT ${TIENE_PLACAS_USADAS}`,
    ).bind(numero),
    db.prepare(
      `DELETE FROM lotes WHERE id = ?1 AND estado = 'generado'
       AND NOT EXISTS (SELECT 1 FROM placas WHERE lote = ?1)`,
    ).bind(numero),
  ]);
  return (lote?.meta.changes ?? 0) > 0;
}

/**
 * Texto del CSV de un lote: codigo, url_nfc, url_qr.
 * La URL del QR va entera en MAYÚSCULAS: así el QR puede usar el modo
 * alfanumérico, que ocupa menos y da un código más fácil de leer.
 */
export function csvDeLote(codigos: readonly string[], urlBase: string): string {
  const lineas = ["codigo,url_nfc,url_qr"];
  for (const codigo of codigos) {
    lineas.push(`${codigo},${urlBase}/n/${codigo},${`${urlBase}/q/${codigo}`.toUpperCase()}`);
  }
  // CRLF es el salto de línea estándar de CSV; Excel lo abre sin problemas.
  return lineas.join("\r\n") + "\r\n";
}
