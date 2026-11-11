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
