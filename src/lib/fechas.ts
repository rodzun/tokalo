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

// ───────────────────────── Días en hora de Perú ─────────────────────────
// Los filtros de los reportes usan días de Perú ("2026-11-11"). Como la
// base guarda UTC, cada día de Perú va de las 05:00 UTC de ese día a las
// 05:00 UTC del siguiente.

/** El día de hoy en Perú, como "AAAA-MM-DD". */
export function hoyEnPeru(): string {
  return new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Día de Perú al que pertenece un instante UTC: "2026-11-12T03:00:00Z" -> "2026-11-11". */
export function diaEnPeru(textoUtc: string): string {
  return new Date(Date.parse(textoUtc) - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** True si el texto es un día válido con formato "AAAA-MM-DD". */
export function esDia(texto: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(texto) && !Number.isNaN(Date.parse(`${texto}T00:00:00Z`));
}

/** Suma (o resta, con negativo) días a un día "AAAA-MM-DD". */
export function sumarDias(dia: string, cantidad: number): string {
  return new Date(Date.parse(`${dia}T00:00:00Z`) + cantidad * 86_400_000).toISOString().slice(0, 10);
}

/** Instante UTC en que empieza un día de Perú: medianoche de Lima = 05:00 UTC. */
export function inicioDelDiaPeru(dia: string): string {
  return `${dia}T05:00:00Z`;
}

/** "2026-11-11" -> "11/11/2026" */
export function diaLegible(dia: string): string {
  const [anio, mes, d] = dia.split("-");
  return `${d}/${mes}/${anio}`;
}
