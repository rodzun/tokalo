// Tests de la etapa 5: estadísticas de escaneos.
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { esBot, sistemaDe } from "../src/lib/escaneos";
import { crearLoteBase, pedir, vaciarBase } from "./ayudas";

const DESTINO = "https://search.google.com/local/writereview?placeid=ChIJd47f2fnXbZERrQZbyDhq2y0";

// User-agents reales de ejemplo.
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const WHATSAPP = "WhatsApp/2.23.20.0 A";
const IMESSAGE =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_1) AppleWebKit/601.2.4 (KHTML, like Gecko) Version/9.0.1 Safari/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0";
const GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

interface Escaneo {
  codigo: string;
  canal: string;
  fecha: string;
  pais: string | null;
  sistema: string;
}

/** Todos los escaneos guardados, en orden de llegada. */
async function escaneos(): Promise<Escaneo[]> {
  const { results } = await env.DB.prepare(
    "SELECT codigo, canal, fecha, pais, sistema FROM escaneos ORDER BY id",
  ).all<Escaneo>();
  return results;
}

/** Escanea una placa como lo haría un celular desde `pais`. */
function escanear(ruta: string, userAgent: string, pais = "PE", extra: RequestInit = {}): Promise<Response> {
  return pedir(ruta, {
    headers: { "User-Agent": userAgent },
    cf: { country: pais },
    ...extra,
  } as RequestInit);
}

beforeEach(async () => {
  await vaciarBase();
  await crearLoteBase();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO placas (codigo, modelo, lote, estado, destino, creada_en) VALUES ('9M8CQ2', 'D', 1, 'activa', ?, '2026-11-11T00:00:00Z')",
    ).bind(DESTINO),
    env.DB.prepare(
      "INSERT INTO placas (codigo, modelo, lote, estado, creada_en) VALUES ('SFXPXP', 'D', 1, 'sin_activar', '2026-11-11T00:00:00Z')",
    ),
    env.DB.prepare(
      "INSERT INTO placas (codigo, modelo, lote, estado, destino, creada_en) VALUES ('5FD9CX', 'D', 1, 'desactivada', ?, '2026-11-11T00:00:00Z')",
    ).bind(DESTINO),
  ]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("registro de escaneos", () => {
  it("guarda placa, canal, fecha UTC, país y sistema", async () => {
    await escanear("/n/9M8CQ2", IPHONE, "PE");
    await escanear("/q/9m8cq2", ANDROID, "CL");
    await escanear("/Q/9M8CQ2", WINDOWS, "US");

    const filas = await escaneos();
    expect(filas.map(({ fecha, ...resto }) => resto)).toEqual([
      { codigo: "9M8CQ2", canal: "n", pais: "PE", sistema: "ios" },
      { codigo: "9M8CQ2", canal: "q", pais: "CL", sistema: "android" },
      { codigo: "9M8CQ2", canal: "q", pais: "US", sistema: "otro" },
    ]);
    // Fecha en UTC con formato 2026-11-11T07:30:00Z
    expect(filas[0]?.fecha).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it("si Cloudflare no informa el país, lo deja vacío", async () => {
    await pedir("/n/9M8CQ2", { headers: { "User-Agent": IPHONE } });
    expect((await escaneos())[0]?.pais).toBeNull();
  });

  it("no cuenta bots ni vistas previas de links", async () => {
    for (const bot of [WHATSAPP, IMESSAGE, GOOGLEBOT, "curl/8.5.0"]) {
      const r = await escanear("/n/9M8CQ2", bot);
      expect(r.headers.get("Location")).toBe(DESTINO); // igual redirige
    }
    await pedir("/n/9M8CQ2"); // sin user-agent
    expect(await escaneos()).toHaveLength(0);
  });

  it("no cuenta solicitudes HEAD ni precargas del navegador", async () => {
    await escanear("/n/9M8CQ2", IPHONE, "PE", { method: "HEAD" });
    await pedir("/n/9M8CQ2", { headers: { "User-Agent": ANDROID, "Sec-Purpose": "prefetch" } });
    expect(await escaneos()).toHaveLength(0);
  });

  it("no cuenta placas sin activar, desactivadas ni inexistentes", async () => {
    await escanear("/n/SFXPXP", IPHONE);
    await escanear("/n/5FD9CX", IPHONE);
    await escanear("/n/ZZZZZZ", IPHONE);
    expect(await escaneos()).toHaveLength(0);
  });

  it("si la escritura falla, la redirección sale igual y el fallo queda registrado", async () => {
    const registro = vi.spyOn(console, "error").mockImplementation(() => {});
    // Base que permite leer pero falla al insertar.
    const baseSinEscritura = {
      prepare(sql: string) {
        if (sql.startsWith("INSERT")) throw new Error("sin escritura");
        return env.DB.prepare(sql);
      },
    } as unknown as D1Database;

    const r = await pedir(
      "/n/9M8CQ2",
      { headers: { "User-Agent": IPHONE } },
      { ...env, DB: baseSinEscritura },
    );

    expect(r.status).toBe(302);
    expect(r.headers.get("Location")).toBe(DESTINO);
    expect(await escaneos()).toHaveLength(0);
    expect(registro).toHaveBeenCalledWith(
      "escaneo_no_registrado",
      expect.objectContaining({ codigo: "9M8CQ2", canal: "n", mensaje: "sin escritura" }),
    );
  });
});

describe("detección de bots y de sistema", () => {
  it("reconoce navegadores reales, incluso dentro de otras apps", () => {
    expect(esBot(IPHONE)).toBe(false);
    expect(esBot(ANDROID)).toBe(false);
    expect(esBot(WINDOWS)).toBe(false);
    // Navegador interno de Instagram
    expect(esBot(IPHONE + " Instagram 300.0.0.0")).toBe(false);
    // App de Google en iPhone
    expect(esBot(IPHONE.replace("Version/18.1", "GSA/300.0.598994205"))).toBe(false);
    // Celular de marca Cubot: contiene "bot" pero no es un bot
    expect(esBot("Mozilla/5.0 (Linux; Android 11; CUBOT NOTE 20) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36")).toBe(false);
  });

  it("reconoce bots y vistas previas", () => {
    for (const bot of [
      WHATSAPP,
      IMESSAGE,
      GOOGLEBOT,
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      "TelegramBot (like TwitterBot)",
      "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
      "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
      "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)",
      "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
      "python-requests/2.32.0",
      "",
    ]) {
      expect(esBot(bot), bot).toBe(true);
    }
    expect(esBot(null)).toBe(true);
  });

  it("deduce el sistema", () => {
    expect(sistemaDe(IPHONE)).toBe("ios");
    expect(sistemaDe(ANDROID)).toBe("android");
    expect(sistemaDe(WINDOWS)).toBe("otro");
    expect(sistemaDe(null)).toBe("otro");
  });
});
