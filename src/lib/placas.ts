// Placas: ficha, activación, cambios y lista.
import { ahoraUtc, hoyEnPeru, sumarDias } from "./fechas";
import { esHttps } from "./maps";
import { aPlataforma, destinoCoincide } from "./plataformas";

/** Todo lo que se muestra de una placa en el admin. */
export interface Placa {
  codigo: string;
  modelo: string;
  nombre_modelo: string;
  /** Plataforma del modelo: "google", "instagram"... */
  plataforma: string;
  lote: number;
  estado: "sin_activar" | "activa" | "desactivada";
  destino: string | null;
  negocio: string | null;
  responsable: string | null;
  telefono: string | null;
  activada_en: string | null;
  /** Nombre de quien la activó. */
  activada_por_nombre: string | null;
}

export async function buscarPlaca(db: D1Database, codigo: string): Promise<Placa | null> {
  return db
    .prepare(
      `SELECT p.codigo, p.modelo, m.nombre AS nombre_modelo, m.plataforma, p.lote, p.estado, p.destino,
              p.negocio, p.responsable, p.telefono, p.activada_en, u.nombre AS activada_por_nombre
       FROM placas p
       JOIN modelos m ON m.id = p.modelo
       LEFT JOIN usuarios u ON u.id = p.activada_por
       WHERE p.codigo = ?`,
    )
    .bind(codigo)
    .first<Placa>();
}

/** Datos del negocio que se piden al activar. No se pide ni se guarda DNI. */
export interface DatosDeNegocio {
  negocio: string;
  responsable: string;
  telefono: string;
}

/**
 * Valida los datos del negocio.
 * Devuelve los datos limpios, o un texto con el error.
 */
export function validarNegocio(campos: Record<string, string>): DatosDeNegocio | string {
  const negocio = campos["negocio"] ?? "";
  const responsable = campos["responsable"] ?? "";
  const telefono = campos["telefono"] ?? "";
  if (negocio.length < 1 || negocio.length > 80) return "Escribe el nombre del negocio (máximo 80 caracteres).";
  if (responsable.length < 1 || responsable.length > 80) return "Escribe el nombre del responsable (máximo 80 caracteres).";
  // Teléfono: dígitos, con espacios o guiones opcionales y "+" opcional al inicio.
  if (!/^\+?[\d\s-]{6,20}$/.test(telefono) || telefono.replace(/\D/g, "").length < 6) {
    return "Escribe un teléfono válido (solo números, espacios y +).";
  }
  return { negocio, responsable, telefono };
}

/** Largo máximo de un destino. Los links de reseña reales miden menos de 100. */
export const MAX_LARGO_DESTINO = 500;

/** True si el destino se puede guardar: una URL https de largo razonable. */
export function esDestinoValido(destino: string): boolean {
  return destino.length <= MAX_LARGO_DESTINO && esHttps(destino);
}

/**
 * Activa una placa: guarda los datos, el destino, quién y cuándo, anota el
 * primer destino en el historial y marca su lote como impreso. Todo en una
 * transacción.
 *
 * Solo actúa si la placa sigue "sin_activar": un doble envío del formulario
 * no hace nada la segunda vez. Devuelve true si la placa quedó activada.
 */
export async function activarPlaca(
  db: D1Database,
  codigo: string,
  datos: DatosDeNegocio,
  destino: string,
  idUsuario: number,
): Promise<boolean> {
  if (!esDestinoValido(destino)) throw new Error("El destino debe ser un link https");
  const ahora = ahoraUtc();
  const [placa] = await db.batch([
    db.prepare(
      `UPDATE placas
       SET estado = 'activa', destino = ?, negocio = ?, responsable = ?, telefono = ?,
           activada_por = ?, activada_en = ?
       WHERE codigo = ? AND estado = 'sin_activar'`,
    ).bind(destino, datos.negocio, datos.responsable, datos.telefono, idUsuario, ahora, codigo),
    // changes() = filas que modificó la sentencia anterior. Si la placa no
    // se activó (0 filas), esto no inserta nada en el historial.
    db.prepare(
      `INSERT INTO cambios_destino (codigo, destino_anterior, destino_nuevo, usuario_id, cambiado_en)
       SELECT ?, NULL, ?, ?, ? WHERE changes() > 0`,
    ).bind(codigo, destino, idUsuario, ahora),
    // Si se activó una placa, su lote existe físicamente: pasa a "impreso"
    // (si no lo estaba ya). Así un lote "generado" nunca tiene placas activadas.
    db.prepare(
      `UPDATE lotes SET estado = 'impreso', estado_cambiado_en = ?1, estado_cambiado_por = ?2
       WHERE estado = 'generado'
       AND id = (SELECT lote FROM placas WHERE codigo = ?3 AND estado != 'sin_activar')`,
    ).bind(ahora, idUsuario, codigo),
  ]);
  return (placa?.meta.changes ?? 0) > 0;
}

// ───────────────────────── Cambios sobre una placa ya activada ─────────────────────────

/**
 * Cambia el destino de una placa activa y lo anota en el historial
 * (destino anterior, nuevo, quién y cuándo). Todo en una transacción.
 * Devuelve true si hubo cambio; false si la placa no está activa o el
 * destino es el mismo que ya tenía.
 */
export async function cambiarDestino(
  db: D1Database,
  codigo: string,
  destino: string,
  idUsuario: number,
): Promise<boolean> {
  if (!esDestinoValido(destino)) throw new Error("El destino debe ser un link https");
  const [historial] = await db.batch([
    // Primero el historial: aquí todavía se lee el destino anterior de la
    // placa. Solo inserta si la placa está activa y el destino es distinto.
    db.prepare(
      `INSERT INTO cambios_destino (codigo, destino_anterior, destino_nuevo, usuario_id, cambiado_en)
       SELECT codigo, destino, ?1, ?2, ?3 FROM placas
       WHERE codigo = ?4 AND estado = 'activa' AND destino IS NOT ?1`,
    ).bind(destino, idUsuario, ahoraUtc(), codigo),
    db.prepare("UPDATE placas SET destino = ?1 WHERE codigo = ?2 AND estado = 'activa'").bind(destino, codigo),
  ]);
  return (historial?.meta.changes ?? 0) > 0;
}

/** Corrige los datos del negocio de una placa ya activada (activa o desactivada). */
export async function editarNegocio(db: D1Database, codigo: string, datos: DatosDeNegocio): Promise<void> {
  await db
    .prepare("UPDATE placas SET negocio = ?, responsable = ?, telefono = ? WHERE codigo = ? AND estado != 'sin_activar'")
    .bind(datos.negocio, datos.responsable, datos.telefono, codigo)
    .run();
}

/**
 * Desactiva una placa activa: conserva todos sus datos, pero el público
 * que la escanee irá a la landing. Devuelve true si cambió.
 */
export async function desactivarPlaca(db: D1Database, codigo: string): Promise<boolean> {
  const r = await db.prepare("UPDATE placas SET estado = 'desactivada' WHERE codigo = ? AND estado = 'activa'").bind(codigo).run();
  return r.meta.changes > 0;
}

/** Vuelve a activar una placa desactivada, con el destino que tenía. */
export async function reactivarPlaca(db: D1Database, codigo: string): Promise<boolean> {
  const r = await db
    .prepare("UPDATE placas SET estado = 'activa' WHERE codigo = ? AND estado = 'desactivada' AND destino IS NOT NULL")
    .bind(codigo)
    .run();
  return r.meta.changes > 0;
}

/** Un renglón del historial de destinos de una placa. */
export interface CambioDeDestino {
  destino_anterior: string | null;
  destino_nuevo: string;
  cambiado_en: string;
  nombre_usuario: string;
}

/** Historial de destinos de una placa, del más reciente al más antiguo. */
export async function historialDe(db: D1Database, codigo: string): Promise<CambioDeDestino[]> {
  const { results } = await db
    .prepare(
      `SELECT c.destino_anterior, c.destino_nuevo, c.cambiado_en, u.nombre AS nombre_usuario
       FROM cambios_destino c JOIN usuarios u ON u.id = c.usuario_id
       WHERE c.codigo = ? ORDER BY c.id DESC LIMIT 50`,
    )
    .bind(codigo)
    .all<CambioDeDestino>();
  return results;
}

// ───────────────────────── Lista de placas ─────────────────────────

export const ESTADOS = ["sin_activar", "activa", "desactivada"] as const;
export const POR_PAGINA = 50;

/** Una placa en la lista, con sus conteos de escaneos. */
export interface PlacaEnLista {
  codigo: string;
  estado: string;
  negocio: string | null;
  destino: string | null;
  modelo: string;
  nombre_modelo: string;
  plataforma: string;
  /** Escaneos de siempre. */
  total: number;
  /** Escaneos de los últimos 30 días de Perú (hoy incluido). */
  ultimos30: number;
  /** Escaneos por chip NFC (los de QR son total - nfc). */
  nfc: number;
}

export interface FiltrosDeLista {
  estado?: string;
  plataforma?: string;
  /** Texto a buscar en el código o en el nombre del negocio. */
  busqueda?: string;
  /** Solo placas cuyo destino no es de la plataforma de su modelo. */
  soloNoCoinciden?: boolean;
  /** Página a mostrar, empezando en 1. */
  pagina: number;
}

/**
 * Lista de placas según los filtros, de 50 en 50.
 *
 * Primero se eligen las placas de la página (`pagina`) y solo para esas se
 * buscan el modelo y los conteos. Los conteos salen de las tablas resumen
 * (`escaneos_totales` y `escaneos_diarios`), nunca de `escaneos`: por placa
 * se leen como mucho 2 filas de totales y 60 de los últimos 30 días.
 */
export async function listarPlacas(
  db: D1Database,
  f: FiltrosDeLista,
): Promise<{ placas: PlacaEnLista[]; hayMas: boolean }> {
  // Se arma el WHERE por partes. Los valores van siempre aparte (en
  // `valores`), nunca pegados dentro del texto SQL.
  const condiciones: string[] = [];
  const valores: Array<string | number> = [];

  if (ESTADOS.some((e) => e === f.estado)) {
    condiciones.push("p.estado = ?");
    valores.push(f.estado ?? "");
  }
  if (aPlataforma(f.plataforma) !== undefined) {
    condiciones.push("p.modelo IN (SELECT id FROM modelos WHERE plataforma = ?)");
    valores.push(f.plataforma ?? "");
  }
  if (f.busqueda !== undefined && f.busqueda !== "") {
    // En LIKE, % y _ son comodines: se escapan para buscarlos como texto.
    const texto = f.busqueda.replace(/[\\%_]/g, "\\$&");
    condiciones.push("(p.codigo LIKE ? ESCAPE '\\' OR p.negocio LIKE ? ESCAPE '\\')");
    valores.push(`${texto.toUpperCase()}%`, `%${texto}%`);
  }
  if (f.soloNoCoinciden === true) {
    // Saber si un destino "coincide" lo decide el código (destinoCoincide),
    // no SQL: se leen los destinos, se filtran aquí y se pasa la lista de
    // códigos a la consulta. Tope de 200 para no cargar la página.
    const [destinos, modelos] = await db.batch<Record<string, string>>([
      db.prepare("SELECT codigo, destino, modelo FROM placas WHERE destino IS NOT NULL"),
      db.prepare("SELECT id, plataforma FROM modelos"),
    ]);
    const plataformaDe = new Map((modelos?.results ?? []).map((m) => [m["id"], m["plataforma"] ?? ""]));
    const codigos = (destinos?.results ?? [])
      .filter((r) => !destinoCoincide(plataformaDe.get(r["modelo"]) ?? "", r["destino"] ?? ""))
      .map((r) => r["codigo"]);
    condiciones.push("p.codigo IN (SELECT value FROM json_each(?))");
    valores.push(JSON.stringify(codigos.slice(0, 200)));
  }

  const pagina = Math.max(1, Math.floor(f.pagina));
  valores.push(POR_PAGINA + 1, (pagina - 1) * POR_PAGINA); // una de más, para saber si hay otra página
  // "Últimos 30 días": hoy y los 29 días anteriores, en días de Perú.
  valores.push(sumarDias(hoyEnPeru(), -29));

  const orden = "activada_en IS NULL, activada_en DESC, creada_en DESC, codigo";
  const { results } = await db
    .prepare(
      `WITH pagina AS (
         SELECT p.codigo, p.estado, p.negocio, p.destino, p.modelo, p.activada_en, p.creada_en
         FROM placas p
         ${condiciones.length > 0 ? "WHERE " + condiciones.join(" AND ") : ""}
         ORDER BY ${orden}
         LIMIT ? OFFSET ?
       )
       SELECT g.codigo, g.estado, g.negocio, g.destino, g.modelo, m.nombre AS nombre_modelo, m.plataforma,
              COALESCE((SELECT SUM(t.cantidad) FROM escaneos_totales t WHERE t.codigo = g.codigo), 0) AS total,
              COALESCE((SELECT SUM(d.cantidad) FROM escaneos_diarios d WHERE d.codigo = g.codigo AND d.dia >= ?), 0) AS ultimos30,
              COALESCE((SELECT t.cantidad FROM escaneos_totales t WHERE t.codigo = g.codigo AND t.canal = 'n'), 0) AS nfc
       FROM pagina g JOIN modelos m ON m.id = g.modelo
       ORDER BY ${orden}`,
    )
    .bind(...valores)
    .all<PlacaEnLista>();

  return { placas: results.slice(0, POR_PAGINA), hayMas: results.length > POR_PAGINA };
}
