// Plataformas a las que puede apuntar una placa. Cada modelo es de una.
// Para añadir una plataforma nueva: agregarla en las tres listas de abajo.
import { esDominioDeGoogle } from "./maps";

export const PLATAFORMAS = ["google", "tripadvisor", "instagram", "facebook", "tiktok", "otra"] as const;
export type Plataforma = (typeof PLATAFORMAS)[number];

export const NOMBRE_PLATAFORMA: Record<Plataforma, string> = {
  google: "Google",
  tripadvisor: "Tripadvisor",
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  otra: "Otra",
};

// "google.com", "google.com.pe", "google.es", "google.co.uk"...
const TERMINACION = "(com|[a-z]{2}|com\\.[a-z]{2}|co\\.[a-z]{2})";

/** Para cada plataforma, una función que dice si un dominio es suyo. */
const ES_SU_DOMINIO: Record<Plataforma, (dominio: string) => boolean> = {
  google: esDominioDeGoogle,
  tripadvisor: (d) => new RegExp(`(^|\\.)tripadvisor\\.${TERMINACION}$`).test(d),
  instagram: (d) => /(^|\.)(instagram\.com|instagr\.am)$/.test(d),
  facebook: (d) => /(^|\.)(facebook\.com|fb\.com|fb\.me)$/.test(d),
  tiktok: (d) => /(^|\.)tiktok\.com$/.test(d),
  otra: () => true, // "Otra" acepta cualquier dominio
};

/** Convierte un texto en plataforma, o undefined si no es una de la lista. */
export function aPlataforma(texto: string | null | undefined): Plataforma | undefined {
  return PLATAFORMAS.find((p) => p === texto);
}

/** Nombre para mostrar. Si en la base hay un valor desconocido, lo muestra tal cual. */
export function nombreDePlataforma(texto: string): string {
  const plataforma = aPlataforma(texto);
  return plataforma === undefined ? texto : NOMBRE_PLATAFORMA[plataforma];
}

/**
 * True si el destino es de la plataforma del modelo.
 * Sirve para avisar, no para bloquear: un vendedor puede pegar un link
 * raro pero legítimo, y el dueño lo ve marcado en la lista de placas.
 */
export function destinoCoincide(plataforma: string, destino: string): boolean {
  let dominio: string;
  try {
    dominio = new URL(destino).hostname.toLowerCase();
  } catch {
    return false;
  }
  return ES_SU_DOMINIO[aPlataforma(plataforma) ?? "otra"](dominio);
}
