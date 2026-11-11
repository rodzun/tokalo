// Fechas. En la base todo va en UTC (el estándar); la hora de Perú se
// calcula solo al mostrarla en el admin.

/** Convierte una fecha a texto UTC con segundos: 2026-11-11T07:30:00Z */
export function aTextoUtc(fecha: Date): string {
  return fecha.toISOString().slice(0, 19) + "Z";
}

/** Fecha y hora actual en UTC. */
export function ahoraUtc(): string {
  return aTextoUtc(new Date());
}

/**
 * Convierte una fecha UTC de la base a hora de Perú para mostrarla:
 * "2026-11-11T09:08:35Z" -> "11/11/2026 04:08".
 * Perú está siempre en UTC-5 (no tiene horario de verano).
 */
export function aHoraPeru(textoUtc: string): string {
  const ms = Date.parse(textoUtc);
  if (Number.isNaN(ms)) return textoUtc;
  const f = new Date(ms - 5 * 60 * 60 * 1000);
  const dos = (n: number): string => String(n).padStart(2, "0");
  return `${dos(f.getUTCDate())}/${dos(f.getUTCMonth() + 1)}/${f.getUTCFullYear()} ${dos(f.getUTCHours())}:${dos(f.getUTCMinutes())}`;
}
