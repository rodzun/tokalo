// Placas: lectura de la ficha y activación.
import { ahoraUtc } from "./fechas";
import { esHttps } from "./maps";

/** Todo lo que se muestra de una placa en el admin. */
export interface Placa {
  codigo: string;
  modelo: string;
  nombre_modelo: string;
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
      `SELECT p.codigo, p.modelo, m.nombre AS nombre_modelo, p.lote, p.estado, p.destino,
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
 * Activa una placa: guarda los datos, el destino, quién y cuándo, y anota
 * el primer destino en el historial. Todo en una transacción.
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
  ]);
  return (placa?.meta.changes ?? 0) > 0;
}
