// Catálogo de modelos de placa.

export const TIPOS = ["totem", "mesa", "tarjeta"] as const;
export type Tipo = (typeof TIPOS)[number];

export interface Modelo {
  id: string;
  nombre: string;
  tipo: Tipo;
  ancho_mm: number;
  alto_mm: number;
  version: number;
}

/** Todos los modelos, en orden alfabético de id. */
export async function listarModelos(db: D1Database): Promise<Modelo[]> {
  const { results } = await db
    .prepare("SELECT id, nombre, tipo, ancho_mm, alto_mm, version FROM modelos ORDER BY id")
    .all<Modelo>();
  return results;
}

/** Convierte un texto en entero dentro de [min, max], o null si no lo es. */
export function enteroEntre(texto: string, min: number, max: number): number | null {
  if (!/^\d{1,6}$/.test(texto)) return null;
  const n = Number(texto);
  return n >= min && n <= max ? n : null;
}

/**
 * Valida los campos del formulario de modelo.
 * Devuelve el modelo listo para guardar, o un texto con el error.
 */
export function validarModelo(campos: Record<string, string>): Modelo | string {
  const id = (campos["id"] ?? "").toUpperCase();
  const nombre = campos["nombre"] ?? "";
  const tipo = TIPOS.find((t) => t === campos["tipo"]);
  const ancho = enteroEntre(campos["ancho_mm"] ?? "", 1, 2000);
  const alto = enteroEntre(campos["alto_mm"] ?? "", 1, 2000);
  const version = enteroEntre(campos["version"] ?? "", 1, 999);

  if (!/^[A-Z0-9]{1,3}$/.test(id)) return "El id debe tener de 1 a 3 letras o números.";
  if (nombre.length < 1 || nombre.length > 60) return "El nombre debe tener de 1 a 60 caracteres.";
  if (tipo === undefined) return "Elige un tipo válido.";
  if (ancho === null || alto === null) return "Ancho y alto deben ser números enteros en milímetros.";
  if (version === null) return "La versión debe ser un número entero.";
  return { id, nombre, tipo, ancho_mm: ancho, alto_mm: alto, version };
}

/** Guarda un modelo nuevo. Devuelve false si ya existía uno con ese id. */
export async function crearModelo(db: D1Database, m: Modelo): Promise<boolean> {
  const resultado = await db
    .prepare(
      "INSERT INTO modelos (id, nombre, tipo, ancho_mm, alto_mm, version) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING",
    )
    .bind(m.id, m.nombre, m.tipo, m.ancho_mm, m.alto_mm, m.version)
    .run();
  return resultado.meta.changes > 0;
}

/** Elimina un modelo solo si ningún lote ni placa lo usa. Devuelve true si se eliminó. */
export async function eliminarModelo(db: D1Database, id: string): Promise<boolean> {
  const resultado = await db
    .prepare(
      `DELETE FROM modelos WHERE id = ?1
       AND NOT EXISTS (SELECT 1 FROM lotes WHERE modelo = ?1)
       AND NOT EXISTS (SELECT 1 FROM placas WHERE modelo = ?1)`,
    )
    .bind(id)
    .run();
  return resultado.meta.changes > 0;
}
