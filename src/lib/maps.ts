// Convierte un link de Google Maps en el link para escribir una reseña,
// sin usar ninguna API de pago.
//
// La idea: todo negocio de Google tiene un identificador interno formado
// por dos números en hexadecimal, "0xAAAA:0xBBBB". Los links de Maps lo
// traen dentro, y a partir de él se calcula el "Place ID" (ChIJ...) que
// usa el link oficial de reseñas:
//     https://search.google.com/local/writereview?placeid=ChIJ...
//
// El formato no está documentado por Google y podría cambiar. Por eso,
// cuando algo no encaja, esta función dice "no se pudo" y el formulario
// pide el link de reseña a mano.

/** Resultado de la conversión. */
export type Conversion =
  | {
      ok: true;
      destino: string;
      /** De dónde salió el dato. */
      origen: "ya-era-resena" | "par" | "cid";
      /**
       * Nombre del negocio tal como viene escrito en el link, si lo trae.
       * Es solo una ayuda visual: no está confirmado por Google.
       */
      nombre?: string;
    }
  | { ok: false; motivo: string };

/** Función para pedir una URL. Es `fetch`; los tests pasan una de mentira. */
export type Buscador = (url: string, opciones: RequestInit) => Promise<Response>;

const MAX_SALTOS = 3;

/** True si el texto es una URL válida que empieza por https://. */
export function esHttps(texto: string | null): texto is string {
  if (texto === null) return false;
  try {
    return new URL(texto).protocol === "https:";
  } catch {
    return false; // no es una URL válida
  }
}

// ───────────────────────── Qué dominios son de Google ─────────────────────────

/** True si el dominio es de Google: google.com, maps.google.com.pe, goo.gl, g.page... */
export function esDominioDeGoogle(dominio: string): boolean {
  return /^(.+\.)?(google\.(com|[a-z]{2}|com\.[a-z]{2}|co\.[a-z]{2})|goo\.gl|g\.page|g\.co|share\.google)$/.test(dominio);
}

/** Dominios de links cortos: no traen el dato, hay que seguir su redirección. */
function esLinkCorto(url: URL): boolean {
  return ["maps.app.goo.gl", "goo.gl", "g.co", "share.google"].includes(url.hostname);
}

// ───────────────────────── Cálculo de identificadores ─────────────────────────

/** Escribe un número de 64 bits en 8 bytes, del menos al más significativo. */
function uint64LittleEndian(n: bigint): number[] {
  const bytes: number[] = [];
  for (let i = 0n; i < 8n; i++) bytes.push(Number((n >> (8n * i)) & 0xffn));
  return bytes;
}

function base64Url(bytes: number[]): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/**
 * Place ID a partir del par hexadecimal.
 * Es base64url de:  0x0A 0x12 0x09 + AAAA (8 bytes) + 0x11 + BBBB (8 bytes)
 * Ejemplo verificado:
 *   0x916dd7f9d9df8e77:0x2ddb6a38c85b06ad -> ChIJd47f2fnXbZERrQZbyDhq2y0
 */
export function placeIdDesdePar(a: bigint, b: bigint): string {
  return base64Url([0x0a, 0x12, 0x09, ...uint64LittleEndian(a), 0x11, ...uint64LittleEndian(b)]);
}

/** Link de reseña a partir del Place ID. */
export function linkDeResena(placeId: string): string {
  return `https://search.google.com/local/writereview?placeid=${placeId}`;
}

/**
 * Link oficial "g.page" a partir solo del segundo número (el "CID").
 * Sirve cuando el link de Maps no trae el par completo. Google lo redirige
 * al mismo formulario de reseña.
 * El token es base64url de:  0x09 + CID (8 bytes) + 0x10 0x02
 */
export function linkGPageDesdeCid(cid: bigint): string {
  return `https://g.page/r/${base64Url([0x09, ...uint64LittleEndian(cid), 0x10, 0x02])}/review`;
}

// ───────────────────────── Lectura de una URL ─────────────────────────

const MAX_64_BITS = (1n << 64n) - 1n;

/**
 * Nombre del negocio según el link. No cuesta nada: ya viene en la URL.
 *   links de celular:     ?q=Nombre+del+negocio,+dirección
 *   links de computadora: /maps/place/Nombre+del+negocio/...
 */
export function nombreSegunElLink(url: URL): string | undefined {
  let nombre = url.searchParams.get("q") ?? "";
  if (nombre === "") {
    const enRuta = /\/maps\/place\/([^/@]+)/.exec(url.pathname);
    try {
      // En la ruta, los espacios vienen como "+" y lo demás como %XX.
      nombre = enRuta === null ? "" : decodeURIComponent((enRuta[1] ?? "").replaceAll("+", " "));
    } catch {
      nombre = "";
    }
  }
  nombre = nombre.trim().slice(0, 120);
  // "place_id:ChIJ..." o unas coordenadas no son un nombre.
  if (nombre === "" || /^place_id:/i.test(nombre) || /^[-\d.,\s]+$/.test(nombre)) return undefined;
  return nombre;
}

/** Añade el nombre al resultado, si la conversión salió bien y el link lo trae. */
function conNombre(resultado: Conversion, url: URL): Conversion {
  if (!resultado.ok) return resultado;
  const nombre = nombreSegunElLink(url);
  return nombre === undefined ? resultado : { ...resultado, nombre };
}

/** Busca el identificador del negocio dentro de una URL de Google. */
function extraer(url: URL): Conversion | null {
  // Los links traen símbolos codificados (%3A en vez de ":"): se decodifican.
  let texto = url.href;
  try {
    texto = decodeURIComponent(texto);
  } catch {
    // Codificación rota: se busca en el texto tal cual.
  }

  // El par aparece como "ftid=0x..:0x.." (links de celular) o "!1s0x..:0x.."
  // (links de computadora). Se prueban esos dos sitios y luego cualquier otro.
  const par =
    /[?&]ftid=(0x[0-9a-f]{1,16}):(0x[0-9a-f]{1,16})/i.exec(texto) ??
    /!1s(0x[0-9a-f]{1,16}):(0x[0-9a-f]{1,16})/i.exec(texto) ??
    /(0x[0-9a-f]{1,16}):(0x[0-9a-f]{1,16})/i.exec(texto);
  if (par !== null) {
    const a = BigInt(par[1] ?? "0");
    const b = BigInt(par[2] ?? "0");
    if (a !== 0n && b !== 0n) {
      return { ok: true, destino: linkDeResena(placeIdDesdePar(a, b)), origen: "par" };
    }
    // Primer número en cero: solo sirve el segundo, que es el CID.
    if (b !== 0n) return { ok: true, destino: linkGPageDesdeCid(b), origen: "cid" };
  }

  // Links antiguos: "?cid=1234567890" (el CID en decimal).
  const cid = url.searchParams.get("cid");
  if (cid !== null && /^\d{1,20}$/.test(cid)) {
    const numero = BigInt(cid);
    if (numero !== 0n && numero <= MAX_64_BITS) {
      return { ok: true, destino: linkGPageDesdeCid(numero), origen: "cid" };
    }
  }
  return null;
}

/** Si la URL ya es un link de reseña, lo devuelve limpio. */
function siYaEsResena(url: URL): Conversion | null {
  if (url.hostname === "search.google.com" && url.pathname === "/local/writereview") {
    const placeId = url.searchParams.get("placeid") ?? "";
    if (/^[\w-]{20,200}$/.test(placeId)) {
      return { ok: true, destino: linkDeResena(placeId), origen: "ya-era-resena" };
    }
  }
  const gPage = /^\/r\/([\w-]{8,40})\/review\/?$/.exec(url.pathname);
  if (url.hostname === "g.page" && gPage !== null) {
    return { ok: true, destino: `https://g.page/r/${gPage[1]}/review`, origen: "ya-era-resena" };
  }
  return null;
}

// ───────────────────────── Función principal ─────────────────────────

/**
 * Convierte lo que pegó la persona (un link de Maps, corto o largo) en un
 * link de reseña. Nunca lanza errores: si no puede, lo dice en `motivo`.
 */
export async function convertirLinkDeMaps(pegado: string, buscar: Buscador = fetch): Promise<Conversion> {
  // Al compartir desde el celular a veces viene texto antes del link
  // ("Nombre del negocio https://maps.app.goo.gl/..."): se toma solo el link.
  const encontrado = /https?:\/\/\S+/i.exec(pegado);
  if (encontrado === null) return { ok: false, motivo: "No parece un link. Debe empezar por https://" };

  let url: URL;
  try {
    url = new URL(encontrado[0]);
  } catch {
    return { ok: false, motivo: "El link no es válido." };
  }

  // Se sigue la cadena de redirecciones a mano, revisando cada paso.
  for (let salto = 0; salto <= MAX_SALTOS; salto++) {
    if (url.protocol !== "https:") return { ok: false, motivo: "El link debe empezar por https://" };
    if (!esDominioDeGoogle(url.hostname)) {
      return { ok: false, motivo: "El link no es de Google Maps." };
    }

    const yaEsResena = siYaEsResena(url);
    if (yaEsResena !== null) return yaEsResena;
    const resultado = extraer(url);
    if (resultado !== null) return conNombre(resultado, url);

    // Sin dato y sin ser un link corto: no hay de dónde sacarlo.
    if (!esLinkCorto(url) || salto === MAX_SALTOS) break;

    // Link corto: se pide SIN seguir la redirección automáticamente
    // ("manual"), para comprobar a dónde apunta antes de continuar.
    let siguiente: string | null;
    try {
      const respuesta = await buscar(url.href, { redirect: "manual", signal: AbortSignal.timeout(5000) });
      siguiente = respuesta.status >= 300 && respuesta.status < 400 ? respuesta.headers.get("Location") : null;
    } catch {
      return { ok: false, motivo: "No se pudo consultar el link corto. Inténtalo de nuevo." };
    }
    if (siguiente === null) break;
    try {
      url = new URL(siguiente, url); // el segundo argumento resuelve rutas relativas
    } catch {
      break;
    }
  }

  return { ok: false, motivo: "No se encontró el negocio en ese link." };
}
