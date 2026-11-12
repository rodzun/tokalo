// Tests de las tablas resumen de escaneos (migración 0007): deben decir
// siempre lo mismo que contar la tabla `escaneos`.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import migracion from "../migrations/0007_resumen_de_escaneos.sql?raw";
import { diaEnPeru } from "../src/lib/fechas";
import { crearLote } from "../src/lib/lotes";
import { activarPlaca, listarPlacas } from "../src/lib/placas";
import { leerRango, MAX_DIAS, reporteDeEscaneos } from "../src/lib/reportes";
import { cabecerasConSesion, crearUsuario, escanear, pedir, vaciarBase } from "./ayudas";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const NEGOCIO = { negocio: "Café Qosqo", responsable: "María Quispe", telefono: "984123456" };
const DESTINO = "https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4";
const CODIGOS = ["XK7P2M", "4TQW9B", "RZ8D3H"];

let rod = 0;

/** Filas de una consulta, como texto, para comparar dos resultados enteros. */
async function filas(sql: string): Promise<string> {
  const { results } = await env.DB.prepare(sql).all();
  return JSON.stringify(results);
}

// Lo que dicen los resúmenes...
const DIARIOS = "SELECT codigo, dia, canal, cantidad FROM escaneos_diarios ORDER BY codigo, dia, canal";
const TOTALES = "SELECT codigo, canal, cantidad FROM escaneos_totales ORDER BY codigo, canal";
// ...y lo mismo, contado directamente en la tabla de escaneos.
const DIARIOS_CONTADOS =
  "SELECT codigo, date(fecha, '-5 hours') AS dia, canal, COUNT(*) AS cantidad FROM escaneos GROUP BY 1, 2, 3 ORDER BY 1, 2, 3";
const TOTALES_CONTADOS = "SELECT codigo, canal, COUNT(*) AS cantidad FROM escaneos GROUP BY 1, 2 ORDER BY 1, 2";

/** Una mezcla de escaneos: varias placas, canales y días, con varios repetidos. */
async function mezclaDeEscaneos(): Promise<number> {
  const lista: Array<[string, "n" | "q", string]> = [
    ["XK7P2M", "n", "2026-11-10T15:00:00Z"],
    ["XK7P2M", "n", "2026-11-10T16:30:00Z"],
    ["XK7P2M", "n", "2026-11-10T23:59:59Z"],
    ["XK7P2M", "q", "2026-11-10T17:00:00Z"],
    // 03:00 UTC del 11 son las 22:00 del 10 en Perú: cuenta para el día 10.
    ["XK7P2M", "q", "2026-11-11T03:00:00Z"],
    // 05:00 UTC del 11 es la medianoche de Perú: ya es el día 11.
    ["XK7P2M", "n", "2026-11-11T05:00:00Z"],
    ["4TQW9B", "q", "2026-11-10T12:00:00Z"],
    ["4TQW9B", "q", "2026-11-11T12:00:00Z"],
    ["4TQW9B", "q", "2026-11-11T12:00:01Z"],
    ["4TQW9B", "n", "2026-09-01T12:00:00Z"],
    ["4TQW9B", "n", "2026-01-01T04:59:59Z"], // 31 de diciembre de 2025 en Perú
  ];
  for (const [codigo, canal, fecha] of lista) await escanear(codigo, canal, fecha);
  return lista.length;
}

beforeEach(async () => {
  await vaciarBase();
  rod = await crearUsuario("rodzun", "clave-de-prueba-1");
  let i = 0;
  await crearLote(env.DB, "D", CODIGOS.length, rod, () => CODIGOS[i++] ?? "");
  for (const codigo of CODIGOS) await activarPlaca(env.DB, codigo, NEGOCIO, DESTINO, rod);
});

describe("día de Perú de un escaneo", () => {
  it("antes de las 05:00 UTC todavía es el día anterior en Perú", () => {
    expect(diaEnPeru("2026-11-11T04:59:59Z")).toBe("2026-11-10");
    expect(diaEnPeru("2026-11-11T05:00:00Z")).toBe("2026-11-11");
    expect(diaEnPeru("2026-01-01T02:00:00Z")).toBe("2025-12-31");
  });
});

describe("el resumen coincide con contar la tabla de escaneos", () => {
  it("tras una mezcla de escaneos: por placa, canal y día, y en los totales", async () => {
    const cuantos = await mezclaDeEscaneos();
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM escaneos").first("n")).toBe(cuantos);
    expect(await filas(DIARIOS)).toBe(await filas(DIARIOS_CONTADOS));
    expect(await filas(TOTALES)).toBe(await filas(TOTALES_CONTADOS));
    // Y la suma de todo el resumen es el número de escaneos.
    expect(await env.DB.prepare("SELECT SUM(cantidad) AS n FROM escaneos_diarios").first("n")).toBe(cuantos);
    expect(await env.DB.prepare("SELECT SUM(cantidad) AS n FROM escaneos_totales").first("n")).toBe(cuantos);
  });

  it("los escaneos reales (por /n y /q) también suman en el resumen", async () => {
    for (const ruta of ["/n/XK7P2M", "/n/XK7P2M", "/q/XK7P2M", "/Q/4TQW9B"]) {
      expect((await pedir(ruta, { headers: { "User-Agent": IPHONE }, redirect: "manual" })).status).toBe(302);
    }
    expect(await filas(TOTALES)).toBe(
      JSON.stringify([
        { codigo: "4TQW9B", canal: "q", cantidad: 1 },
        { codigo: "XK7P2M", canal: "n", cantidad: 2 },
        { codigo: "XK7P2M", canal: "q", cantidad: 1 },
      ]),
    );
    expect(await filas(DIARIOS)).toBe(await filas(DIARIOS_CONTADOS));
  });

  it("lo que no cuenta como escaneo tampoco toca el resumen", async () => {
    await pedir("/n/XK7P2M", { headers: { "User-Agent": "curl/8.5.0" }, redirect: "manual" }); // bot
    await pedir("/n/XK7P2M", { headers: { "User-Agent": IPHONE, ...(await cabecerasConSesion(rod)) }, redirect: "manual" }); // con sesión
    expect(await filas(DIARIOS)).toBe("[]");
    expect(await filas(TOTALES)).toBe("[]");
  });

  it("si una de las tres escrituras falla, no se guarda ninguna", async () => {
    // Placa inexistente: la clave foránea rechaza el escaneo y los resúmenes.
    await expect(escanear("ZZZZZZ", "n", "2026-11-10T15:00:00Z")).rejects.toThrow();
    // Canal inválido: falla la primera sentencia.
    await expect(escanear("XK7P2M", "x" as "n", "2026-11-10T15:00:00Z")).rejects.toThrow();
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM escaneos").first("n")).toBe(0);
    expect(await filas(DIARIOS)).toBe("[]");
    expect(await filas(TOTALES)).toBe("[]");
  });
});

describe("regla de la migración para escaneos que ya existían", () => {
  it("rellena los dos resúmenes con los mismos números que deja el registro normal", async () => {
    await mezclaDeEscaneos();
    const diarios = await filas(DIARIOS);
    const totales = await filas(TOTALES);

    // Se vacían los resúmenes, como si los escaneos vinieran de antes...
    await env.DB.batch([env.DB.prepare("DELETE FROM escaneos_diarios"), env.DB.prepare("DELETE FROM escaneos_totales")]);
    // ...y se ejecutan las mismas sentencias INSERT que trae la migración.
    const relleno = migracion
      .slice(migracion.indexOf("INSERT INTO escaneos_diarios"))
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.startsWith("INSERT"));
    expect(relleno).toHaveLength(2);
    await env.DB.batch(relleno.map((s) => env.DB.prepare(s)));

    expect(await filas(DIARIOS)).toBe(diarios);
    expect(await filas(TOTALES)).toBe(totales);
  });
});

describe("las pantallas leen del resumen", () => {
  it("el reporte de escaneos da lo mismo que contar la tabla, y los totales son de todo el rango", async () => {
    await mezclaDeEscaneos();
    const r = await reporteDeEscaneos(env.DB, { desde: "2026-11-10", hasta: "2026-11-10" });
    expect(r.filas.map((f) => [f.codigo, f.nfc, f.qr, f.total])).toEqual([
      ["XK7P2M", 3, 2, 5],
      ["4TQW9B", 0, 1, 1],
    ]);
    expect(r.totales).toEqual({ nfc: 3, qr: 3, total: 6, placas: 2 });

    // Con límite de 1 fila, los totales siguen siendo de las dos placas.
    const corto = await reporteDeEscaneos(env.DB, { desde: "2026-11-10", hasta: "2026-11-10" }, undefined, 1);
    expect(corto.filas).toHaveLength(1);
    expect(corto.totales).toEqual({ nfc: 3, qr: 3, total: 6, placas: 2 });
  });

  it("el reporte y la lista siguen funcionando aunque la tabla de escaneos esté vacía", async () => {
    await mezclaDeEscaneos();
    await env.DB.prepare("DELETE FROM escaneos").run(); // prueba de que no la leen
    const r = await reporteDeEscaneos(env.DB, { desde: "2026-11-01", hasta: "2026-11-30" });
    expect(r.totales.total).toBe(9);
    const { placas } = await listarPlacas(env.DB, { pagina: 1 });
    const xk = placas.find((p) => p.codigo === "XK7P2M");
    expect([xk?.total, xk?.nfc]).toEqual([6, 4]);
    expect(placas.find((p) => p.codigo === "RZ8D3H")).toMatchObject({ total: 0, ultimos30: 0, nfc: 0 });
  });
});

describe("tope de 366 días en los reportes", () => {
  it("un rango más largo se acorta por el inicio y lo avisa", async () => {
    const r = leerRango(new URLSearchParams("desde=2020-01-01&hasta=2026-11-30"));
    expect(r).toEqual({ desde: "2025-11-30", hasta: "2026-11-30", recortado: true });
    expect((Date.parse(r.hasta) - Date.parse(r.desde)) / 86_400_000 + 1).toBe(MAX_DIAS);

    const pagina = await pedir("/admin/reportes/escaneos?desde=2020-01-01&hasta=2026-11-30", { headers: await cabecerasConSesion(rod) });
    expect(await pagina.text()).toContain("El rango máximo es de 366 días");
  });

  it("un rango de 366 días exactos no se toca", () => {
    expect(leerRango(new URLSearchParams("desde=2025-11-30&hasta=2026-11-30"))).toEqual({ desde: "2025-11-30", hasta: "2026-11-30" });
  });
});
