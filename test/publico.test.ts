// Tests de la etapa 3: redirección pública (sin sesión) y landing.
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizarCodigo } from "../src/lib/codigos";
import { crearLoteBase, pedir, vaciarBase } from "./ayudas";

const DESTINO = "https://search.google.com/local/writereview?placeid=ChIJd47f2fnXbZERrQZbyDhq2y0";

/** Inserta una placa con el estado y destino indicados. */
async function crearPlaca(codigo: string, estado: string, destino: string | null): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO placas (codigo, modelo, lote, estado, destino, creada_en) VALUES (?, 'D', 1, ?, ?, '2026-11-11T00:00:00Z')",
  )
    .bind(codigo, estado, destino)
    .run();
}

/** Comprueba que la respuesta es una redirección a `destino`, sin caché. */
function esperarRedireccion(r: Response, destino: string): void {
  expect(r.status).toBe(302);
  expect(r.headers.get("Location")).toBe(destino);
  expect(r.headers.get("Cache-Control")).toBe("no-store");
}

beforeEach(async () => {
  await vaciarBase();
  await crearLoteBase();
  await crearPlaca("9M8CQ2", "activa", DESTINO);
  await crearPlaca("SFXPXP", "sin_activar", null);
  await crearPlaca("5FD9CX", "desactivada", DESTINO);
  await crearPlaca("PQJFT7", "activa", "http://sin-cifrar.example/");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("escaneo sin sesión", () => {
  it("placa activa: redirige a su destino por NFC y por QR", async () => {
    esperarRedireccion(await pedir("/n/9M8CQ2"), DESTINO);
    esperarRedireccion(await pedir("/q/9M8CQ2"), DESTINO);
  });

  it("placa sin activar: va a la landing", async () => {
    esperarRedireccion(await pedir("/n/SFXPXP"), "/");
  });

  it("placa desactivada: va a la landing aunque conserve su destino", async () => {
    esperarRedireccion(await pedir("/q/5FD9CX"), "/");
  });

  it("código inexistente: va a la landing", async () => {
    esperarRedireccion(await pedir("/n/ZZZZZZ"), "/");
  });

  it("no distingue mayúsculas de minúsculas en el código", async () => {
    esperarRedireccion(await pedir("/n/9m8cq2"), DESTINO);
    esperarRedireccion(await pedir("/q/9m8Cq2"), DESTINO);
  });

  it("acepta la ruta en mayúsculas, como va en el QR", async () => {
    esperarRedireccion(await pedir("/Q/9M8CQ2"), DESTINO);
    esperarRedireccion(await pedir("/N/9M8CQ2"), DESTINO);
  });

  it("un destino que no es https nunca se usa", async () => {
    esperarRedireccion(await pedir("/n/PQJFT7"), "/");
  });

  it("un código con formato inválido va a la landing sin consultar la base", async () => {
    const consulta = vi.spyOn(env.DB, "prepare");
    esperarRedireccion(await pedir("/n/ABC123"), "/"); // tiene vocal y un 1
    esperarRedireccion(await pedir("/n/9M8CQ"), "/"); // 5 caracteres
    esperarRedireccion(await pedir("/n/9M8CQ2X"), "/"); // 7 caracteres
    esperarRedireccion(await pedir("/n/%27%20OR%201"), "/"); // intento de inyección
    expect(consulta).not.toHaveBeenCalled();
  });

  it("si la base falla: va a la landing, sin 500, y el error queda registrado", async () => {
    const registro = vi.spyOn(console, "error").mockImplementation(() => {});
    const baseRota = {
      prepare() {
        throw new Error("base caída");
      },
    } as unknown as D1Database;

    const r = await pedir("/n/9M8CQ2", undefined, { ...env, DB: baseRota });
    esperarRedireccion(r, "/");
    expect(registro).toHaveBeenCalledWith(
      "error_atrapado",
      expect.objectContaining({ ruta: "/n/9M8CQ2", mensaje: "base caída" }),
    );
  });

  it("otros métodos (POST) no redirigen al destino", async () => {
    esperarRedireccion(await pedir("/n/9M8CQ2", { method: "POST" }), "/");
  });
});

describe("landing", () => {
  it("GET / muestra la página con el botón de WhatsApp", async () => {
    const r = await pedir("/");
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toContain("text/html");
    const cuerpo = await r.text();
    expect(cuerpo).toContain("Tokalo");
    expect(cuerpo).toContain("https://wa.me/51913629134?text=");
  });

  it("lleva el icono incrustado, para no gastar otra solicitud", async () => {
    const cuerpo = await (await pedir("/")).text();
    expect(cuerpo).toContain('<link rel="icon" href="data:image/svg+xml,');
  });
});

describe("archivos que piden los navegadores y los bots", () => {
  it("/favicon.ico responde el icono directamente, sin redirigir", async () => {
    const r = await pedir("/favicon.ico");
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(r.headers.get("Cache-Control")).toContain("max-age=604800");
  });

  it("/robots.txt pide no rastrear placas ni admin", async () => {
    const r = await pedir("/robots.txt");
    expect(r.status).toBe(200);
    const cuerpo = await r.text();
    expect(cuerpo).toContain("Disallow: /n/");
    expect(cuerpo).toContain("Disallow: /q/");
    expect(cuerpo).toContain("Disallow: /admin");
  });
});

describe("normalizarCodigo", () => {
  it("pasa a mayúsculas y valida el alfabeto de 28", () => {
    expect(normalizarCodigo("9m8cq2")).toBe("9M8CQ2");
    expect(normalizarCodigo("SFXPXP")).toBe("SFXPXP");
    expect(normalizarCodigo("SFXPXA")).toBeNull(); // vocal
    expect(normalizarCodigo("SFXPXL")).toBeNull(); // L
    expect(normalizarCodigo("SFXPX0")).toBeNull(); // cero
    expect(normalizarCodigo("SFXPX1")).toBeNull(); // uno
    expect(normalizarCodigo("")).toBeNull();
  });
});
