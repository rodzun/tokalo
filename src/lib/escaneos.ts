// Estadísticas: registro de cada escaneo del público.
//
// Qué se guarda: placa, canal, fecha UTC, país y sistema operativo.
// Qué NO se guarda: IP ni user-agent (del user-agent solo sale el sistema).
import { ahoraUtc, diaEnPeru } from "./fechas";

/** Canal por el que llegó la persona: "n" = chip NFC, "q" = código QR. */
export type Canal = "n" | "q";

export type Sistema = "ios" | "android" | "otro";

// Trozos de texto que delatan a un programa automático en el user-agent:
// rastreadores de buscadores, vistas previas de links (WhatsApp, Facebook,
// iMessage, Telegram, Slack...) y herramientas de línea de comandos.
// "(?<!cu)bot" = "bot" salvo en "Cubot", que es una marca de celulares.
const PATRON_BOT = new RegExp(
  [
    "(?<!cu)bot", "crawl", "spider", "slurp", "preview",
    "facebookexternalhit", "meta-external", "whatsapp",
    "google-", "mediapartners", "embedly", "vkshare",
    "curl", "wget", "python", "go-http", "okhttp", "java/", "axios", "node",
    "httpclient", "libwww", "scrapy",
    "headless", "lighthouse", "pingdom", "uptime", "monitor",
  ].join("|"),
  "i", // sin distinguir mayúsculas
);

/** True si el user-agent parece de un bot. Sin user-agent también cuenta como bot. */
export function esBot(userAgent: string | null): boolean {
  if (userAgent === null || userAgent.trim() === "") return true;
  return PATRON_BOT.test(userAgent);
}

/** Deduce el sistema operativo a partir del user-agent. */
export function sistemaDe(userAgent: string | null): Sistema {
  if (userAgent === null) return "otro";
  if (/iphone|ipad|ipod/i.test(userAgent)) return "ios";
  if (/android/i.test(userAgent)) return "android";
  return "otro";
}

/** True si el navegador está precargando la página sin que nadie la abra. */
function esPrecarga(solicitud: Request): boolean {
  const proposito =
    solicitud.headers.get("Sec-Purpose") ??
    solicitud.headers.get("Purpose") ??
    solicitud.headers.get("X-Purpose") ??
    solicitud.headers.get("X-Moz") ??
    "";
  return /prefetch|prerender|preview/i.test(proposito);
}

/**
 * Decide si una solicitud cuenta como escaneo real.
 * No cuentan los HEAD, las precargas ni los bots. (Quien tiene sesión
 * iniciada tampoco cuenta: eso se resuelve antes de llegar aquí.)
 */
export function debeContarse(solicitud: Request): boolean {
  if (solicitud.method !== "GET") return false;
  if (esPrecarga(solicitud)) return false;
  return !esBot(solicitud.headers.get("User-Agent"));
}

/** País según Cloudflare (dos letras, como "PE"), o null si no lo sabe. */
function paisDe(solicitud: Request): string | null {
  const pais = solicitud.cf?.country;
  return typeof pais === "string" && /^[A-Z0-9]{2}$/.test(pais) ? pais : null;
}

/**
 * Las tres sentencias que registran un escaneo:
 *   1. el escaneo en sí (detalle: país y sistema);
 *   2. +1 en el resumen del día de Perú, para esa placa y canal;
 *   3. +1 en el total de siempre, para esa placa y canal.
 * Se ejecutan juntas con `db.batch`, que es una transacción: o se guardan
 * las tres o ninguna. Por eso el resumen nunca se desfasa de los escaneos.
 *
 * "ON CONFLICT ... DO UPDATE": si la fila del resumen ya existe, le suma 1;
 * si no existe, la crea con 1.
 */
export function sentenciasDeEscaneo(
  db: D1Database,
  codigo: string,
  canal: Canal,
  fechaUtc: string,
  pais: string | null,
  sistema: Sistema,
): D1PreparedStatement[] {
  return [
    db.prepare("INSERT INTO escaneos (codigo, canal, fecha, pais, sistema) VALUES (?, ?, ?, ?, ?)")
      .bind(codigo, canal, fechaUtc, pais, sistema),
    db.prepare(
      `INSERT INTO escaneos_diarios (codigo, dia, canal, cantidad) VALUES (?, ?, ?, 1)
       ON CONFLICT (codigo, dia, canal) DO UPDATE SET cantidad = cantidad + 1`,
    ).bind(codigo, diaEnPeru(fechaUtc), canal),
    db.prepare(
      `INSERT INTO escaneos_totales (codigo, canal, cantidad) VALUES (?, ?, 1)
       ON CONFLICT (codigo, canal) DO UPDATE SET cantidad = cantidad + 1`,
    ).bind(codigo, canal),
  ];
}

/**
 * Guarda un escaneo en la base y lo suma a los resúmenes.
 * Es `async` a propósito: cualquier fallo sale como promesa rechazada, que
 * quien la llama puede ignorar sin que afecte a la redirección.
 */
export async function registrarEscaneo(
  db: D1Database,
  codigo: string,
  canal: Canal,
  solicitud: Request,
): Promise<void> {
  await db.batch(
    sentenciasDeEscaneo(db, codigo, canal, ahoraUtc(), paisDe(solicitud), sistemaDe(solicitud.headers.get("User-Agent"))),
  );
}
