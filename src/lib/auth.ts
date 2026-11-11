// Login: hash de contraseñas, cookie de sesión firmada y límite de intentos.
import { aTextoUtc, ahoraUtc } from "./fechas";

// ───────────────────────── Utilidades de bytes ─────────────────────────

function aBase64(bytes: Uint8Array): string {
  let texto = "";
  for (const b of bytes) texto += String.fromCharCode(b);
  return btoa(texto);
}

function deBase64(texto: string): Uint8Array {
  const crudo = atob(texto); // lanza un error si no es base64 válido
  const bytes = new Uint8Array(crudo.length);
  for (let i = 0; i < crudo.length; i++) bytes[i] = crudo.charCodeAt(i);
  return bytes;
}

/** Base64 apto para URLs y cookies: sin "+", "/" ni "=". */
function aBase64Url(bytes: Uint8Array): string {
  return aBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function deBase64Url(texto: string): Uint8Array {
  return deBase64(texto.replaceAll("-", "+").replaceAll("_", "/"));
}

const aBytes = (texto: string): Uint8Array => new TextEncoder().encode(texto);

// ───────────────────────── Hash de contraseña ─────────────────────────
// Formato guardado:  pbkdf2$iteraciones$sal$hash   (sal y hash en base64)
// Es PBKDF2-HMAC-SHA256, igual que hashlib.pbkdf2_hmac("sha256", ...) en
// Python: scripts/crear_usuario.py genera hashes que esto sabe verificar.

/** 20 000 iteraciones cuestan ~3 ms de CPU (el plan gratuito da 10 ms). */
export const ITERACIONES = 20_000;
/** Cloudflare rechaza más de 100 000 iteraciones. */
const MAX_ITERACIONES = 100_000;

async function derivar(clave: string, sal: Uint8Array, iteraciones: number): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey("raw", aBytes(clave), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: sal, iterations: iteraciones },
    material,
    256, // 32 bytes
  );
  return new Uint8Array(bits);
}

/** Calcula el hash de una contraseña nueva, con sal aleatoria. */
export async function hashClave(clave: string, iteraciones = ITERACIONES): Promise<string> {
  const sal = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivar(clave, sal, iteraciones);
  return `pbkdf2$${iteraciones}$${aBase64(sal)}$${aBase64(hash)}`;
}

/** True si `clave` corresponde al hash guardado. Nunca lanza errores. */
export async function verificarClave(clave: string, guardado: string): Promise<boolean> {
  try {
    const partes = guardado.split("$");
    if (partes.length !== 4 || partes[0] !== "pbkdf2") return false;
    const iteraciones = Number(partes[1]);
    if (!Number.isInteger(iteraciones) || iteraciones < 1 || iteraciones > MAX_ITERACIONES) return false;

    const esperado = deBase64(partes[3] ?? "");
    const calculado = await derivar(clave, deBase64(partes[2] ?? ""), iteraciones);
    if (esperado.length !== calculado.length) return false;
    // Comparación en tiempo constante: no revela cuántos bytes coinciden.
    return crypto.subtle.timingSafeEqual(esperado, calculado);
  } catch {
    return false; // hash guardado con formato inválido
  }
}

/**
 * Hash que no corresponde a ninguna contraseña. Se verifica contra él cuando
 * el usuario no existe, para que la respuesta tarde lo mismo y no se pueda
 * deducir qué nombres de usuario existen.
 */
const HASH_SENUELO = `pbkdf2$${ITERACIONES}$${aBase64(new Uint8Array(16))}$${aBase64(new Uint8Array(32))}`;

// ───────────────────────── Cookie de sesión ─────────────────────────
// Valor:  idUsuario.vencimiento.firma
//   vencimiento = segundos desde 1970 (como time.time() en Python)
//   firma       = HMAC-SHA256 de "idUsuario.vencimiento" con SECRETO_SESION
// Sin el secreto nadie puede fabricar ni alterar una cookie válida.

/** El prefijo __Host- obliga al navegador a exigir Secure y Path=/. */
export const NOMBRE_COOKIE = "__Host-sesion";
export const DURACION_SESION_SEG = 30 * 24 * 60 * 60; // 30 días

// Secure: solo por https.  HttpOnly: JavaScript no puede leerla.
// SameSite=Lax: se envía al abrir el sitio desde fuera (toque NFC, QR, un
// link), pero no en formularios enviados desde otros sitios.
const ATRIBUTOS = "Path=/; Secure; HttpOnly; SameSite=Lax";

async function claveDeFirma(env: Env): Promise<CryptoKey> {
  if (typeof env.SECRETO_SESION !== "string" || env.SECRETO_SESION.length < 32) {
    throw new Error("Falta el secreto SECRETO_SESION o es demasiado corto");
  }
  return crypto.subtle.importKey(
    "raw", aBytes(env.SECRETO_SESION), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"],
  );
}

/** Segundos desde 1970. */
const ahoraSeg = (): number => Math.floor(Date.now() / 1000);

/** Arma el valor de la cookie para un usuario. `vence` solo lo usan los tests. */
export async function valorDeSesion(
  env: Env,
  idUsuario: number,
  vence = ahoraSeg() + DURACION_SESION_SEG,
): Promise<string> {
  const datos = `${idUsuario}.${vence}`;
  const firma = await crypto.subtle.sign("HMAC", await claveDeFirma(env), aBytes(datos));
  return `${datos}.${aBase64Url(new Uint8Array(firma))}`;
}

/** Cabecera Set-Cookie que inicia la sesión por 30 días. */
export async function cookieDeSesion(env: Env, idUsuario: number): Promise<string> {
  return `${NOMBRE_COOKIE}=${await valorDeSesion(env, idUsuario)}; Max-Age=${DURACION_SESION_SEG}; ${ATRIBUTOS}`;
}

/** Cabecera Set-Cookie que borra la sesión. */
export function cookieBorrada(): string {
  return `${NOMBRE_COOKIE}=; Max-Age=0; ${ATRIBUTOS}`;
}

/** Devuelve el valor de la cookie de sesión, o null si la solicitud no la trae. */
function leerCookie(solicitud: Request): string | null {
  const cabecera = solicitud.headers.get("Cookie");
  if (cabecera === null) return null;
  for (const trozo of cabecera.split(";")) {
    const [nombre, ...resto] = trozo.trim().split("=");
    if (nombre === NOMBRE_COOKIE) return resto.join("=");
  }
  return null;
}

/** True si la solicitud trae cookie de sesión (válida o no). */
export function traeCookie(solicitud: Request): boolean {
  return leerCookie(solicitud) !== null;
}

/** Usuario con sesión iniciada. */
export interface Usuario {
  id: number;
  nombre: string;
  usuario: string;
}

/**
 * Devuelve el usuario de la sesión, o null si no hay sesión válida.
 * Comprueba, en orden: formato, firma, vencimiento y que el usuario siga
 * activo en la base. Sin cookie no consulta la base.
 */
export async function leerSesion(solicitud: Request, env: Env): Promise<Usuario | null> {
  const valor = leerCookie(solicitud);
  if (valor === null) return null;

  const partes = valor.split(".");
  const [id, vence, firma] = partes;
  if (partes.length !== 3 || id === undefined || vence === undefined || firma === undefined) return null;
  if (!/^\d{1,15}$/.test(id) || !/^\d{1,15}$/.test(vence)) return null;

  let firmaBytes: Uint8Array;
  try {
    firmaBytes = deBase64Url(firma);
  } catch {
    return null;
  }
  const firmaValida = await crypto.subtle.verify(
    "HMAC", await claveDeFirma(env), firmaBytes, aBytes(`${id}.${vence}`),
  );
  if (!firmaValida) return null;
  if (Number(vence) <= ahoraSeg()) return null; // vencida

  // La cookie es auténtica; falta ver que el usuario no haya sido desactivado.
  return env.DB.prepare("SELECT id, nombre, usuario FROM usuarios WHERE id = ? AND activo = 1")
    .bind(Number(id))
    .first<Usuario>();
}

// ───────────────────────── Límite de intentos ─────────────────────────
// 5 contraseñas incorrectas seguidas bloquean ese nombre de usuario durante
// 15 minutos. Se lleva la cuenta también de nombres que no existen, para
// que el comportamiento no revele cuáles existen.

export const MAX_FALLOS = 5;
export const BLOQUEO_MIN = 15;

async function estaBloqueado(db: D1Database, usuario: string): Promise<boolean> {
  const hasta = await db
    .prepare("SELECT bloqueado_hasta FROM intentos_login WHERE usuario = ?")
    .bind(usuario)
    .first<string | null>("bloqueado_hasta");
  // Las fechas ISO en UTC se pueden comparar como texto.
  return typeof hasta === "string" && hasta > ahoraUtc();
}

async function anotarFallo(db: D1Database, usuario: string): Promise<void> {
  const finDelBloqueo = aTextoUtc(new Date(Date.now() + BLOQUEO_MIN * 60_000));
  // Una sola sentencia: crea la fila o le suma un fallo. Al llegar a 5 pone
  // el bloqueo; si ya venía de un bloqueo anterior (fallos = 5), reinicia.
  // Dentro del UPDATE, "fallos" es el valor ANTERIOR de la fila.
  await db
    .prepare(
      `INSERT INTO intentos_login (usuario, fallos, bloqueado_hasta) VALUES (?1, 1, NULL)
       ON CONFLICT (usuario) DO UPDATE SET
         bloqueado_hasta = CASE WHEN fallos = ?2 - 1 THEN ?3 ELSE NULL END,
         fallos          = CASE WHEN fallos >= ?2 THEN 1 ELSE fallos + 1 END`,
    )
    .bind(usuario, MAX_FALLOS, finDelBloqueo)
    .run();
}

export type ResultadoLogin =
  | { ok: true; usuario: Usuario }
  | { ok: false; motivo: "bloqueado" | "incorrecto" };

/** Comprueba usuario y contraseña, aplicando el límite de intentos. */
export async function iniciarSesion(db: D1Database, usuario: string, clave: string): Promise<ResultadoLogin> {
  if (await estaBloqueado(db, usuario)) return { ok: false, motivo: "bloqueado" };

  const fila = await db
    .prepare("SELECT id, nombre, usuario, hash_clave, activo FROM usuarios WHERE usuario = ?")
    .bind(usuario)
    .first<Usuario & { hash_clave: string; activo: number }>();

  // Siempre se calcula un hash, exista o no el usuario (ver HASH_SENUELO).
  const claveCorrecta = await verificarClave(clave, fila?.hash_clave ?? HASH_SENUELO);

  if (fila === null || fila.activo !== 1 || !claveCorrecta) {
    await anotarFallo(db, usuario);
    return { ok: false, motivo: "incorrecto" };
  }

  // Entró bien: se olvida la cuenta de fallos.
  await db.prepare("DELETE FROM intentos_login WHERE usuario = ?").bind(usuario).run();
  return { ok: true, usuario: { id: fila.id, nombre: fila.nombre, usuario: fila.usuario } };
}
