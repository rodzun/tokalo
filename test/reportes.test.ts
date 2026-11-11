// Tests de la etapa 12: reportes de escaneos y de activaciones.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { aCsv, leerRango, reporteDeActivaciones, reporteDeEscaneos } from "../src/lib/reportes";
import { cabecerasConSesion, crearUsuario, pedir, vaciarBase } from "./ayudas";

const DESTINO = "https://search.google.com/local/writereview?placeid=ChIJd47f2fnXbZERrQZbyDhq2y0";
const NOVIEMBRE = { desde: "2026-11-01", hasta: "2026-11-30" };

let rod = 0;
let ana = 0;

/** Inserta una placa activada en la fecha UTC indicada. */
async function placa(codigo: string, modelo: string, negocio: string, activadaEn: string, usuario: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO placas (codigo, modelo, lote, estado, destino, negocio, activada_por, activada_en, creada_en)
     VALUES (?, ?, 1, 'activa', ?, ?, ?, ?, '2026-10-01T00:00:00Z')`,
  )
    .bind(codigo, modelo, DESTINO, negocio, usuario, activadaEn)
    .run();
}

async function escaneo(codigo: string, canal: "n" | "q", fecha: string): Promise<void> {
  await env.DB.prepare("INSERT INTO escaneos (codigo, canal, fecha, pais, sistema) VALUES (?, ?, ?, 'PE', 'ios')")
    .bind(codigo, canal, fecha)
    .run();
}

async function ver(ruta: string): Promise<Response> {
  return pedir(ruta, { headers: await cabecerasConSesion(rod) });
}

beforeEach(async () => {
  await vaciarBase();
  await env.DB.prepare("DELETE FROM modelos WHERE id NOT IN ('D','E','F','G','H')").run();
  await env.DB.prepare(
    "INSERT INTO modelos (id, nombre, tipo, plataforma, ancho_mm, alto_mm) VALUES ('DI', 'Tótem pavonado', 'totem', 'instagram', 80, 100)",
  ).run();
  rod = await crearUsuario("rod", "Kx7mPq2RtW9zLb4N");
  ana = await crearUsuario("ana", "Zb8nQw3TyR5vMc7K");
  await env.DB.prepare(
    "INSERT INTO lotes (id, modelo, cantidad, creado_por, creado_en) VALUES (1, 'D', 5, ?, '2026-10-01T00:00:00Z')",
  ).bind(rod).run();

  // Activaciones. Ojo con la hora de Perú (UTC-5):
  //   2026-11-10T03:00Z es todavía lunes 9 de noviembre a las 22:00 en Lima.
  await placa("XK7P2M", "D", "Café Qosqo", "2026-11-09T15:00:00Z", rod); // lunes 9
  await placa("4TQW9B", "D", "Hostal Inti", "2026-11-10T03:00:00Z", rod); // lunes 9, 22:00 en Lima
  await placa("HG3NZ8", "DI", "Pollería Raymi", "2026-11-10T15:00:00Z", ana); // martes 10
  await placa("7BCD2F", "D", "Bar Chicha", "2026-11-16T04:59:00Z", ana); // domingo 15, 23:59 en Lima
  await placa("9NBWKG", "D", "Tienda Killa", "2026-12-01T12:00:00Z", rod); // 1 de diciembre

  // Lecturas de noviembre, y una de octubre que no debe contarse.
  await escaneo("XK7P2M", "n", "2026-11-12T10:00:00Z");
  await escaneo("XK7P2M", "n", "2026-11-13T10:00:00Z");
  await escaneo("XK7P2M", "q", "2026-11-14T10:00:00Z");
  await escaneo("HG3NZ8", "q", "2026-11-12T10:00:00Z");
  await escaneo("XK7P2M", "n", "2026-10-20T10:00:00Z");
  // 1 de diciembre a las 02:00 UTC = 30 de noviembre a las 21:00 en Lima: sí cuenta.
  await escaneo("4TQW9B", "n", "2026-12-01T02:00:00Z");
});

describe("rango de fechas", () => {
  it("lee desde y hasta; si vienen al revés, los intercambia", () => {
    expect(leerRango(new URLSearchParams("desde=2026-11-01&hasta=2026-11-30"))).toEqual(NOVIEMBRE);
    expect(leerRango(new URLSearchParams("desde=2026-11-30&hasta=2026-11-01"))).toEqual(NOVIEMBRE);
  });

  it("sin fechas o con fechas inválidas, usa los últimos 30 días", () => {
    for (const q of ["", "desde=ayer&hasta=2026-13-45"]) {
      const r = leerRango(new URLSearchParams(q));
      expect(r.hasta).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const dias = (Date.parse(r.hasta) - Date.parse(r.desde)) / 86_400_000;
      expect(dias).toBe(29);
    }
  });
});

describe("reporte de escaneos por código y canal", () => {
  it("suma las lecturas NFC y QR de cada placa dentro del rango, en hora de Perú", async () => {
    const r = await reporteDeEscaneos(env.DB, NOVIEMBRE);
    expect(r.filas).toEqual([
      { codigo: "XK7P2M", negocio: "Café Qosqo", plataforma: "google", nfc: 2, qr: 1, total: 3 },
      { codigo: "4TQW9B", negocio: "Hostal Inti", plataforma: "google", nfc: 1, qr: 0, total: 1 },
      { codigo: "HG3NZ8", negocio: "Pollería Raymi", plataforma: "instagram", nfc: 0, qr: 1, total: 1 },
    ]);
    expect(r.totales).toEqual({ nfc: 3, qr: 2, total: 5, placas: 3 });
  });

  it("filtra por plataforma", async () => {
    const r = await reporteDeEscaneos(env.DB, NOVIEMBRE, "instagram");
    expect(r.filas.map((f) => f.codigo)).toEqual(["HG3NZ8"]);
    expect(r.totales).toEqual({ nfc: 0, qr: 1, total: 1, placas: 1 });
  });

  it("un rango sin lecturas da ceros, no un error", async () => {
    const r = await reporteDeEscaneos(env.DB, { desde: "2025-01-01", hasta: "2025-01-31" });
    expect(r).toEqual({ filas: [], totales: { nfc: 0, qr: 0, total: 0, placas: 0 } });
  });

  it("la página muestra la tabla con totales y el enlace al CSV", async () => {
    const cuerpo = await (await ver("/admin/reportes/escaneos?desde=2026-11-01&hasta=2026-11-30")).text();
    expect(cuerpo).toContain("5 lecturas en 3 placas");
    expect(cuerpo).toContain('<td class="num">2</td><td class="num">1</td><td class="num">3</td>');
    expect(cuerpo).toContain('<tfoot><tr><td colspan="3">Total</td><td class="num">3</td><td class="num">2</td><td class="num">5</td></tr></tfoot>');
    expect(cuerpo).toContain("formato=csv");
  });

  it("descarga el mismo reporte en CSV", async () => {
    const r = await ver("/admin/reportes/escaneos?desde=2026-11-01&hasta=2026-11-30&formato=csv");
    expect(r.headers.get("Content-Type")).toContain("text/csv");
    expect(r.headers.get("Content-Disposition")).toBe('attachment; filename="tokalo-escaneos-2026-11-01-a-2026-11-30.csv"');
    expect(await r.text()).toBe(
      "codigo,negocio,plataforma,nfc,qr,total\r\n" +
        "XK7P2M,Café Qosqo,Google,2,1,3\r\n" +
        "4TQW9B,Hostal Inti,Google,1,0,1\r\n" +
        "HG3NZ8,Pollería Raymi,Instagram,0,1,1\r\n",
    );
  });
});

describe("reporte de activaciones", () => {
  const base = { rango: NOVIEMBRE, porUsuario: false } as const;

  it("por día, en hora de Perú", async () => {
    const r = await reporteDeActivaciones(env.DB, { ...base, agrupar: "dia" });
    expect(r.agrupadas).toEqual([
      { periodo: "2026-11-15", usuario: null, activaciones: 1 },
      { periodo: "2026-11-10", usuario: null, activaciones: 1 },
      { periodo: "2026-11-09", usuario: null, activaciones: 2 }, // incluye la de las 22:00
    ]);
    expect(r.total).toBe(4); // la de diciembre queda fuera
  });

  it("por semana, de lunes a domingo", async () => {
    const r = await reporteDeActivaciones(env.DB, { ...base, agrupar: "semana" });
    // Lunes 9, lunes 9, martes 10 y domingo 15: las cuatro son de la semana del lunes 9.
    expect(r.agrupadas).toEqual([{ periodo: "2026-11-09", usuario: null, activaciones: 4 }]);
  });

  it("por mes", async () => {
    const r = await reporteDeActivaciones(env.DB, {
      rango: { desde: "2026-11-01", hasta: "2026-12-31" },
      porUsuario: false,
      agrupar: "mes",
    });
    expect(r.agrupadas).toEqual([
      { periodo: "2026-12", usuario: null, activaciones: 1 },
      { periodo: "2026-11", usuario: null, activaciones: 4 },
    ]);
  });

  it("separado por usuario", async () => {
    const r = await reporteDeActivaciones(env.DB, { rango: NOVIEMBRE, agrupar: "semana", porUsuario: true });
    expect(r.agrupadas).toEqual([
      { periodo: "2026-11-09", usuario: "Persona ana", activaciones: 2 },
      { periodo: "2026-11-09", usuario: "Persona rod", activaciones: 2 },
    ]);
    const porDia = await reporteDeActivaciones(env.DB, { rango: NOVIEMBRE, agrupar: "dia", porUsuario: true });
    expect(porDia.agrupadas).toContainEqual({ periodo: "2026-11-09", usuario: "Persona rod", activaciones: 2 });
  });

  it("filtra por usuario y por plataforma", async () => {
    const deAna = await reporteDeActivaciones(env.DB, { ...base, agrupar: "mes", usuario: ana });
    expect(deAna.total).toBe(2);
    const instagram = await reporteDeActivaciones(env.DB, { ...base, agrupar: "mes", plataforma: "instagram" });
    expect(instagram.agrupadas).toEqual([{ periodo: "2026-11", usuario: null, activaciones: 1 }]);
    const cruzado = await reporteDeActivaciones(env.DB, { ...base, agrupar: "mes", usuario: rod, plataforma: "instagram" });
    expect(cruzado.total).toBe(0);
  });

  it("sin agrupar lista placa por placa, de la más reciente a la más antigua", async () => {
    const r = await reporteDeActivaciones(env.DB, { ...base, agrupar: "detalle" });
    expect(r.detalle.map((d) => d.codigo)).toEqual(["7BCD2F", "HG3NZ8", "4TQW9B", "XK7P2M"]);
    expect(r.detalle[0]).toEqual({
      activada_en: "2026-11-16T04:59:00Z",
      codigo: "7BCD2F",
      negocio: "Bar Chicha",
      plataforma: "google",
      usuario: "Persona ana",
    });
  });

  it("una placa desactivada después sigue contando; una sin activar, no", async () => {
    await env.DB.prepare("UPDATE placas SET estado = 'desactivada' WHERE codigo = 'XK7P2M'").run();
    await env.DB.prepare(
      "INSERT INTO placas (codigo, modelo, lote, estado, creada_en) VALUES ('SFXPXP', 'D', 1, 'sin_activar', '2026-11-05T00:00:00Z')",
    ).run();
    expect((await reporteDeActivaciones(env.DB, { ...base, agrupar: "dia" })).total).toBe(4);
  });

  it("la página muestra la tabla con los filtros elegidos", async () => {
    const cuerpo = await (
      await ver(`/admin/reportes/activaciones?desde=2026-11-01&hasta=2026-11-30&agrupar=semana&por_usuario=1&usuario=${ana}`)
    ).text();
    expect(cuerpo).toContain("2 placas activadas");
    expect(cuerpo).toContain("<td>Semana del 09/11/2026</td><td>Persona ana</td><td class=\"num\">2</td>");
    expect(cuerpo).toContain('<option value="semana" selected>');
    expect(cuerpo).toContain(`<option value="${ana}" selected>Persona ana</option>`);
    expect(cuerpo).toContain('name="por_usuario" value="1" checked');
  });

  it("la vista sin agrupar muestra la fecha en hora de Perú", async () => {
    const cuerpo = await (await ver("/admin/reportes/activaciones?desde=2026-11-01&hasta=2026-11-30&agrupar=detalle")).text();
    expect(cuerpo).toContain("<td>15/11/2026 23:59</td>");
    expect(cuerpo).toContain("<td>09/11/2026 22:00</td>");
  });

  it("descarga en CSV, agrupado y sin agrupar", async () => {
    const agrupado = await ver("/admin/reportes/activaciones?desde=2026-11-01&hasta=2026-11-30&agrupar=dia&por_usuario=1&formato=csv");
    expect(await agrupado.text()).toBe(
      "periodo,usuario,activaciones\r\n" +
        "15/11/2026,Persona ana,1\r\n" +
        "10/11/2026,Persona ana,1\r\n" +
        "09/11/2026,Persona rod,2\r\n",
    );
    const detalle = await ver("/admin/reportes/activaciones?desde=2026-11-09&hasta=2026-11-09&agrupar=detalle&formato=csv");
    expect(await detalle.text()).toBe(
      "activada,codigo,negocio,plataforma,usuario\r\n" +
        "09/11/2026 22:00,4TQW9B,Hostal Inti,Google,Persona rod\r\n" +
        "09/11/2026 10:00,XK7P2M,Café Qosqo,Google,Persona rod\r\n",
    );
  });

  it("valores raros en los filtros se ignoran sin dar error", async () => {
    const r = await ver("/admin/reportes/activaciones?agrupar=%27%3B+DROP+TABLE&usuario=abc&plataforma=myspace&desde=x");
    expect(r.status).toBe(200);
  });
});

describe("reportes en /admin", () => {
  it("sin sesión redirigen al login", async () => {
    for (const ruta of ["/admin/reportes", "/admin/reportes/escaneos", "/admin/reportes/activaciones?formato=csv"]) {
      expect((await pedir(ruta)).headers.get("Location"), ruta).toBe("/admin/login");
    }
  });

  it("/admin/reportes lleva al de escaneos", async () => {
    expect((await ver("/admin/reportes")).headers.get("Location")).toBe("/admin/reportes/escaneos");
  });
});

describe("CSV", () => {
  it("encierra entre comillas lo que lleva comas o comillas, y desarma fórmulas", () => {
    expect(aCsv([["a", "b"], ['Café "El Sol", sede 2', 5], ["=HYPERLINK(1)", null], ["-3 puntos", -3]])).toBe(
      'a,b\r\n"Café ""El Sol"", sede 2",5\r\n\'=HYPERLINK(1),\r\n\'-3 puntos,-3\r\n',
    );
  });
});
