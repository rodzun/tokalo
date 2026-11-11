// Tests de la etapa 8: códigos QR en SVG.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { crearLote } from "../src/lib/lotes";
import { matrizQr, qrSvg, urlParaQr } from "../src/lib/qr";
import { cabecerasConSesion, crearUsuario, pedir, vaciarBase } from "./ayudas";

let idUsuario = 0;

beforeEach(async () => {
  await vaciarBase();
  idUsuario = await crearUsuario("rod", "Kx7mPq2RtW9zLb4N");
});

/** True si en (fila, columna) empieza un "ojo" del QR: el cuadrado de 7x7 de las esquinas. */
function hayOjo(m: boolean[][], fila: number, col: number): boolean {
  for (let f = 0; f < 7; f++) {
    for (let c = 0; c < 7; c++) {
      const borde = f === 0 || f === 6 || c === 0 || c === 6;
      const centro = f >= 2 && f <= 4 && c >= 2 && c <= 4;
      if (m[fila + f]?.[col + c] !== (borde || centro)) return false;
    }
  }
  return true;
}

describe("contenido del QR", () => {
  it("la URL va completa y en mayúsculas", () => {
    expect(urlParaQr("https://tokaloperu.com", "XK7P2M")).toBe("HTTPS://TOKALOPERU.COM/Q/XK7P2M");
  });

  it("usa modo alfanumérico con corrección M: cuadrícula de 25 x 25", () => {
    // La URL tiene 31 caracteres. Con corrección M:
    //   modo alfanumérico -> cabe en un QR "versión 2" (25 x 25, hasta 38 caracteres)
    //   modo normal (byte) -> necesitaría "versión 3" (29 x 29)
    // Y con corrección L (más débil) también cabría en 25 x 25 en modo byte,
    // así que comprobamos las dos cosas por separado.
    const url = urlParaQr("https://tokaloperu.com", "XK7P2M");
    expect(url).toHaveLength(31);
    expect(matrizQr(url)).toHaveLength(25);
    // 38 caracteres es el máximo de versión 2 con corrección M; con L serían 47.
    expect(matrizQr("A".repeat(38))).toHaveLength(25);
    expect(matrizQr("A".repeat(39))).toHaveLength(29);
    // El mismo texto en minúsculas no puede ir en alfanumérico: sale más grande.
    expect(matrizQr(url.toLowerCase())).toHaveLength(29);
  });

  it("tiene los tres ojos de las esquinas", () => {
    const m = matrizQr(urlParaQr("https://tokaloperu.com", "XK7P2M"));
    expect(hayOjo(m, 0, 0)).toBe(true); // arriba izquierda
    expect(hayOjo(m, 0, 18)).toBe(true); // arriba derecha
    expect(hayOjo(m, 18, 0)).toBe(true); // abajo izquierda
    expect(hayOjo(m, 18, 18)).toBe(false); // abajo derecha no lleva
  });

  it("códigos distintos dan QR distintos; el mismo código, el mismo QR", () => {
    const a = qrSvg(urlParaQr("https://tokaloperu.com", "XK7P2M"));
    expect(qrSvg(urlParaQr("https://tokaloperu.com", "XK7P2M"))).toBe(a);
    expect(qrSvg(urlParaQr("https://tokaloperu.com", "4TQW9B"))).not.toBe(a);
  });
});

describe("SVG", () => {
  it("es vectorial, con margen blanco de 4 cuadros y sin tamaño fijo", () => {
    const svg = qrSvg("HTTPS://TOKALOPERU.COM/Q/XK7P2M");
    // 25 cuadros + 4 de margen a cada lado = 33
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 33 33"/);
    expect(svg).toContain('<rect width="33" height="33" fill="#fff"/>');
    expect(svg).toContain('fill="#000"');
    expect(svg).not.toMatch(/<svg[^>]*\s(width|height)=/);
    // El primer trazo es el borde superior del ojo de arriba a la izquierda:
    // empieza en el margen (4,4) y mide 7 cuadros.
    expect(svg).toContain('d="M4 4h7v1h-7z');
  });

  it("el dibujo coincide cuadro por cuadro con la cuadrícula calculada", () => {
    const texto = "HTTPS://TOKALOPERU.COM/Q/XK7P2M";
    const matriz = matrizQr(texto);
    // Reconstruimos la cuadrícula a partir de los trazos del SVG.
    const pintado = matriz.map((fila) => fila.map(() => false));
    for (const [, x, y, ancho] of qrSvg(texto).matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
      for (let i = 0; i < Number(ancho); i++) {
        const fila = pintado[Number(y) - 4];
        if (fila !== undefined) fila[Number(x) - 4 + i] = true;
      }
    }
    expect(pintado).toEqual(matriz);
  });
});

describe("QR en /admin", () => {
  it("sin sesión redirige al login", async () => {
    const numero = await crearLote(env.DB, "D", 1, idUsuario, () => "XK7P2M");
    for (const ruta of ["/admin/placas/XK7P2M/qr.svg", `/admin/lotes/${numero}`]) {
      expect((await pedir(ruta)).headers.get("Location"), ruta).toBe("/admin/login");
    }
  });

  it("devuelve el SVG de la placa con la URL del entorno", async () => {
    await crearLote(env.DB, "D", 1, idUsuario, () => "XK7P2M");
    const r = await pedir("/admin/placas/xk7p2m/qr.svg", { headers: await cabecerasConSesion(idUsuario) });
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(r.headers.get("Content-Disposition")).toBeNull();
    expect(await r.text()).toBe(qrSvg("HTTPS://TOKALO-DEV.TOKALOPERU.WORKERS.DEV/Q/XK7P2M"));
  });

  it("con ?descargar=1 se guarda como archivo con el código en el nombre", async () => {
    await crearLote(env.DB, "D", 1, idUsuario, () => "XK7P2M");
    const r = await pedir("/admin/placas/XK7P2M/qr.svg?descargar=1", { headers: await cabecerasConSesion(idUsuario) });
    expect(r.headers.get("Content-Disposition")).toBe('attachment; filename="tokalo-XK7P2M.svg"');
  });

  it("un código que no existe o con formato inválido da 'no encontrada'", async () => {
    const cabeceras = await cabecerasConSesion(idUsuario);
    expect((await pedir("/admin/placas/XK7P2M/qr.svg", { headers: cabeceras })).status).toBe(404);
    expect((await pedir("/admin/placas/ABC123/qr.svg", { headers: cabeceras })).status).toBe(404);
  });

  it("la página del lote lista sus códigos con enlaces al QR", async () => {
    const numero = await crearLote(env.DB, "G", 3, idUsuario);
    const r = await pedir(`/admin/lotes/${numero}`, { headers: await cabecerasConSesion(idUsuario) });
    expect(r.status).toBe(200);
    const cuerpo = await r.text();
    expect(cuerpo).toContain(`Lote ${numero}`);
    expect(cuerpo).toContain("G · Mesa espejo · 3 placas");
    expect(cuerpo.match(/\/qr\.svg">Ver QR/g)).toHaveLength(3);
    expect(cuerpo.match(/\/qr\.svg\?descargar=1">Descargar QR/g)).toHaveLength(3);

    const noExiste = await pedir("/admin/lotes/999999", { headers: await cabecerasConSesion(idUsuario) });
    expect(noExiste.status).toBe(404);
  });
});
