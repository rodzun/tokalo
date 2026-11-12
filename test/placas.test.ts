// Tests de la etapa 11: plataformas, lista de placas, cambio de destino,
// edición de datos, desactivar y reactivar.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { crearLote } from "../src/lib/lotes";
import { activarPlaca, cambiarDestino, listarPlacas } from "../src/lib/placas";
import { destinoCoincide } from "../src/lib/plataformas";
import { cabecerasConSesion, crearUsuario, enviar, escanear, pedir, vaciarBase } from "./ayudas";

const GOOGLE_1 = "https://search.google.com/local/writereview?placeid=ChIJd47f2fnXbZERrQZbyDhq2y0";
const GOOGLE_2 = "https://search.google.com/local/writereview?placeid=ChIJxYp2YMnVbZERVR0Z22bHb4s";
const LINK_MAPS_2 = "https://maps.google.com/?q=Otro&ftid=0x916dd5c960768ac5:0x8b6fc766db191d55";
const INSTAGRAM = "https://www.instagram.com/cafeqosqo/";
const TRIPADVISOR = "https://www.tripadvisor.com.pe/Restaurant_Review-g294314-d1234567";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const NEGOCIO = { negocio: "Café Qosqo", responsable: "María Quispe", telefono: "984123456" };

let idUsuario = 0;

/** Crea una placa del modelo dado y, si se indica destino, la activa. */
async function crearPlaca(codigo: string, modelo: string, destino?: string, negocio = "Café Qosqo"): Promise<void> {
  await crearLote(env.DB, modelo, 1, idUsuario, () => codigo);
  if (destino !== undefined) {
    await activarPlaca(env.DB, codigo, { ...NEGOCIO, negocio }, destino, idUsuario);
  }
}

/** Registra escaneos con fecha elegida: `dias` es hace cuántos días ocurrió cada uno. */
async function escaneos(codigo: string, canal: "n" | "q", dias: number[]): Promise<void> {
  for (const d of dias) {
    const fecha = new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 19) + "Z";
    await escanear(codigo, canal, fecha);
  }
}

async function fila(codigo: string): Promise<Record<string, unknown> | null> {
  return env.DB.prepare("SELECT estado, destino, negocio, responsable, telefono FROM placas WHERE codigo = ?").bind(codigo).first();
}

async function historial(codigo: string): Promise<Record<string, unknown>[]> {
  const { results } = await env.DB.prepare(
    "SELECT destino_anterior, destino_nuevo, usuario_id FROM cambios_destino WHERE codigo = ? ORDER BY id",
  )
    .bind(codigo)
    .all();
  return results;
}

async function ver(ruta: string): Promise<string> {
  return (await pedir(ruta, { headers: await cabecerasConSesion(idUsuario) })).text();
}

function oculto(cuerpo: string, nombre: string): string {
  const m = new RegExp(`name="${nombre}" value="([^"]*)"`).exec(cuerpo);
  return (m?.[1] ?? "").replaceAll("&amp;", "&");
}

beforeEach(async () => {
  await vaciarBase();
  await env.DB.prepare("DELETE FROM modelos WHERE id NOT IN ('D','E','F','G','H')").run();
  // Un modelo de Instagram y otro de Tripadvisor, además de los de Google.
  await env.DB.batch([
    env.DB.prepare("INSERT INTO modelos (id, nombre, tipo, plataforma, ancho_mm, alto_mm) VALUES ('DI', 'Tótem pavonado', 'totem', 'instagram', 80, 100)"),
    env.DB.prepare("INSERT INTO modelos (id, nombre, tipo, plataforma, ancho_mm, alto_mm) VALUES ('DT', 'Tótem pavonado', 'totem', 'tripadvisor', 80, 100)"),
  ]);
  idUsuario = await crearUsuario("rod", "Kx7mPq2RtW9zLb4N");
});

describe("plataformas", () => {
  it("reconoce si un destino es de la plataforma del modelo", () => {
    const casos: Array<[string, string, boolean]> = [
      ["google", GOOGLE_1, true],
      ["google", "https://g.page/r/CVUdGdtmx2-LEAI/review", true],
      ["google", TRIPADVISOR, false],
      ["tripadvisor", TRIPADVISOR, true],
      ["tripadvisor", "https://www.tripadvisor.es/Hotel_Review-x", true],
      ["tripadvisor", "https://tripadvisor.com.estafa.example/x", false],
      ["instagram", INSTAGRAM, true],
      ["instagram", "https://instagram.com.estafa.example/cafe", false],
      ["instagram", GOOGLE_1, false],
      ["facebook", "https://www.facebook.com/cafeqosqo", true],
      ["tiktok", "https://www.tiktok.com/@cafeqosqo", true],
      ["otra", "https://cualquier-sitio.example/", true],
      ["google", "esto no es un link", false],
    ];
    for (const [plataforma, destino, esperado] of casos) {
      expect(destinoCoincide(plataforma, destino), `${plataforma} ${destino}`).toBe(esperado);
    }
  });

  it("una placa de modelo Instagram pide el link de Instagram y lo usa tal cual", async () => {
    await crearPlaca("XK7P2M", "DI");
    const formulario = await ver("/admin/placas/XK7P2M");
    expect(formulario).toContain("Link del negocio en Instagram");
    expect(formulario).toContain("DI · Tótem pavonado · Instagram");
    expect(formulario).not.toContain("Google Maps");

    const revision = await (await enviar("/admin/placas/XK7P2M/revisar", { ...NEGOCIO, link: INSTAGRAM }, idUsuario)).text();
    expect(revision).toContain(`href="${INSTAGRAM}" target="_blank"`);
    expect(revision).not.toContain("no parece de Instagram");

    await enviar(
      "/admin/placas/XK7P2M/activar",
      { ...NEGOCIO, link: INSTAGRAM, destino: oculto(revision, "destino"), revisado: oculto(revision, "revisado") },
      idUsuario,
    );
    expect(await fila("XK7P2M")).toMatchObject({ estado: "activa", destino: INSTAGRAM });
  });

  it("si el link no es de la plataforma del modelo, avisa pero deja guardar", async () => {
    await crearPlaca("XK7P2M", "DI");
    const r = await enviar("/admin/placas/XK7P2M/revisar", { ...NEGOCIO, link: TRIPADVISOR }, idUsuario);
    expect(r.status).toBe(200);
    const cuerpo = await r.text();
    expect(cuerpo).toContain("Este link no parece de Instagram.");
    expect(cuerpo).toContain('formaction="/admin/placas/XK7P2M/activar"');
  });

  it("en una placa que no es de Google también exige https", async () => {
    await crearPlaca("XK7P2M", "DI");
    const r = await enviar("/admin/placas/XK7P2M/revisar", { ...NEGOCIO, link: "http://instagram.com/cafe" }, idUsuario);
    expect(r.status).toBe(400);
    expect(await r.text()).not.toContain("/activar");
  });
});

describe("lista de placas", () => {
  beforeEach(async () => {
    await crearPlaca("XK7P2M", "D", GOOGLE_1, "Café Qosqo");
    await crearPlaca("4TQW9B", "DI", INSTAGRAM, "Hostal Inti");
    await crearPlaca("HG3NZ8", "D", TRIPADVISOR, "Pollería Raymi"); // modelo Google, destino Tripadvisor
    await crearPlaca("7BCD2F", "G"); // sin activar
    await escaneos("XK7P2M", "n", [0, 1, 5, 45, 90]);
    await escaneos("XK7P2M", "q", [2, 60]);
    await escaneos("4TQW9B", "q", [3]);
  });

  it("sin sesión redirige al login", async () => {
    expect((await pedir("/admin/placas")).headers.get("Location")).toBe("/admin/login");
  });

  it("cuenta escaneos totales, de los últimos 30 días y por canal", async () => {
    const { placas } = await listarPlacas(env.DB, { pagina: 1 });
    const porCodigo = Object.fromEntries(placas.map((p) => [p.codigo, p]));
    expect(porCodigo["XK7P2M"]).toMatchObject({ total: 7, ultimos30: 4, nfc: 5 });
    expect(porCodigo["4TQW9B"]).toMatchObject({ total: 1, ultimos30: 1, nfc: 0 });
    expect(porCodigo["7BCD2F"]).toMatchObject({ total: 0, ultimos30: 0, nfc: 0, estado: "sin_activar" });
    expect(placas).toHaveLength(4);
  });

  it("muestra cada placa con su destino, su plataforma y sus conteos", async () => {
    const cuerpo = await ver("/admin/placas");
    expect(cuerpo).toContain('<a href="/admin/placas/XK7P2M">XK7P2M</a>');
    expect(cuerpo).toContain("Café Qosqo");
    expect(cuerpo).toContain(`href="${GOOGLE_1}"`);
    expect(cuerpo).toContain("D · Tótem pavonado · Google");
    expect(cuerpo).toContain("DI · Tótem pavonado · Instagram");
    expect(cuerpo).toContain("Escaneos: 7 · últimos 30 días: 4 · NFC: 5 · QR: 2");
    expect(cuerpo).toContain("Escaneos: 0 · últimos 30 días: 0 · NFC: 0 · QR: 0");
  });

  it("marca solo el destino que no es de la plataforma de su modelo", async () => {
    const cuerpo = await ver("/admin/placas");
    expect(cuerpo.match(/No es de Google/g)).toHaveLength(1); // la de Tripadvisor en modelo Google
    expect(cuerpo).not.toContain("No es de Instagram"); // Instagram en modelo Instagram está bien
  });

  it("filtra por estado, por plataforma y por texto", async () => {
    const codigos = async (f: Parameters<typeof listarPlacas>[1]): Promise<string[]> =>
      (await listarPlacas(env.DB, f)).placas.map((p) => p.codigo).sort();

    expect(await codigos({ pagina: 1, estado: "sin_activar" })).toEqual(["7BCD2F"]);
    expect(await codigos({ pagina: 1, estado: "activa" })).toEqual(["4TQW9B", "HG3NZ8", "XK7P2M"]);
    expect(await codigos({ pagina: 1, plataforma: "instagram" })).toEqual(["4TQW9B"]);
    expect(await codigos({ pagina: 1, busqueda: "hostal" })).toEqual(["4TQW9B"]);
    expect(await codigos({ pagina: 1, busqueda: "xk7" })).toEqual(["XK7P2M"]);
    expect(await codigos({ pagina: 1, busqueda: "%" })).toEqual([]); // % se busca como texto, no como comodín
    expect(await codigos({ pagina: 1, soloNoCoinciden: true })).toEqual(["HG3NZ8"]);
    expect(await codigos({ pagina: 1, estado: "activa", plataforma: "google", busqueda: "café" })).toEqual(["XK7P2M"]);
    // Valores de filtro inválidos se ignoran en vez de dar error.
    expect(await codigos({ pagina: 1, estado: "'; DROP TABLE placas; --" })).toHaveLength(4);
  });

  it("los filtros funcionan desde la URL y se conservan en el formulario", async () => {
    const cuerpo = await ver("/admin/placas?estado=activa&plataforma=instagram&q=inti&revisar=");
    expect(cuerpo).toContain("Hostal Inti");
    expect(cuerpo).not.toContain("Café Qosqo");
    expect(cuerpo).toContain('<option value="activa" selected>');
    expect(cuerpo).toContain('<option value="instagram" selected>');
    expect(cuerpo).toContain('name="q" value="inti"');

    expect(await ver("/admin/placas?revisar=1")).toContain("Pollería Raymi");
    expect(await ver("/admin/placas?revisar=1")).not.toContain("Hostal Inti");
    expect(await ver("/admin/placas?q=nadie")).toContain("No hay placas con esos filtros.");
  });

  it("pagina de 50 en 50", async () => {
    await crearLote(env.DB, "E", 60, idUsuario);
    const uno = await listarPlacas(env.DB, { pagina: 1 });
    const dos = await listarPlacas(env.DB, { pagina: 2 });
    expect(uno.placas).toHaveLength(50);
    expect(uno.hayMas).toBe(true);
    expect(dos.placas).toHaveLength(14);
    expect(dos.hayMas).toBe(false);
    // Las activadas salen primero.
    expect(uno.placas.slice(0, 3).every((p) => p.estado === "activa")).toBe(true);

    const cuerpo = await ver("/admin/placas?estado=sin_activar");
    expect(cuerpo).toContain('href="/admin/placas?estado=sin_activar&amp;pagina=2">Siguientes');
  });
});

describe("cambiar destino", () => {
  beforeEach(async () => {
    await crearPlaca("XK7P2M", "D", GOOGLE_1);
  });

  it("revisar muestra el destino nuevo con Probar, sin guardar", async () => {
    const r = await enviar("/admin/placas/XK7P2M/destino/revisar", { link: LINK_MAPS_2 }, idUsuario);
    const cuerpo = await r.text();
    expect(cuerpo).toContain(`href="${GOOGLE_2}" target="_blank"`);
    expect(cuerpo).toContain('formaction="/admin/placas/XK7P2M/destino/guardar"');
    expect((await fila("XK7P2M"))?.["destino"]).toBe(GOOGLE_1);
  });

  it("guardar cambia el destino, lo anota en el historial y el público va al nuevo", async () => {
    const revision = await (await enviar("/admin/placas/XK7P2M/destino/revisar", { link: LINK_MAPS_2 }, idUsuario)).text();
    const r = await enviar(
      "/admin/placas/XK7P2M/destino/guardar",
      { link: LINK_MAPS_2, destino: oculto(revision, "destino"), revisado: oculto(revision, "revisado") },
      idUsuario,
    );
    expect(r.headers.get("Location")).toBe("/admin/placas/XK7P2M?aviso=destino");
    expect((await fila("XK7P2M"))?.["destino"]).toBe(GOOGLE_2);
    expect(await historial("XK7P2M")).toEqual([
      { destino_anterior: null, destino_nuevo: GOOGLE_1, usuario_id: idUsuario },
      { destino_anterior: GOOGLE_1, destino_nuevo: GOOGLE_2, usuario_id: idUsuario },
    ]);

    const publico = await pedir("/n/XK7P2M", { headers: { "User-Agent": IPHONE } });
    expect(publico.headers.get("Location")).toBe(GOOGLE_2);

    const ficha = await ver("/admin/placas/XK7P2M?aviso=destino");
    expect(ficha).toContain("Destino cambiado.");
    expect(ficha).toContain("Historial de destinos");
    expect(ficha).toContain("Destino inicial");
  });

  it("no guarda sin revisar, ni un destino http, ni si el link cambió después de probarlo", async () => {
    const intentos: Array<Record<string, string>> = [
      { link: LINK_MAPS_2 },
      { link: LINK_MAPS_2, destino: "http://sin-cifrar.example/", revisado: LINK_MAPS_2 },
      { link: LINK_MAPS_2, destino: GOOGLE_2, revisado: "https://otro-link.example/" },
    ];
    for (const campos of intentos) {
      const r = await enviar("/admin/placas/XK7P2M/destino/guardar", campos, idUsuario);
      expect(r.status, JSON.stringify(campos)).toBe(400);
    }
    expect((await fila("XK7P2M"))?.["destino"]).toBe(GOOGLE_1);
    expect(await historial("XK7P2M")).toHaveLength(1);
  });

  it("guardar el mismo destino no añade nada al historial", async () => {
    expect(await cambiarDestino(env.DB, "XK7P2M", GOOGLE_1, idUsuario)).toBe(false);
    expect(await historial("XK7P2M")).toHaveLength(1);
  });

  it("no cambia el destino de una placa sin activar ni desactivada", async () => {
    await crearPlaca("7BCD2F", "D");
    expect(await cambiarDestino(env.DB, "7BCD2F", GOOGLE_2, idUsuario)).toBe(false);
    expect((await fila("7BCD2F"))?.["destino"]).toBeNull();

    await enviar("/admin/placas/XK7P2M/desactivar", {}, idUsuario);
    expect(await cambiarDestino(env.DB, "XK7P2M", GOOGLE_2, idUsuario)).toBe(false);
    expect((await fila("XK7P2M"))?.["destino"]).toBe(GOOGLE_1);
  });

  it("sin sesión no cambia nada", async () => {
    const r = await pedir("/admin/placas/XK7P2M/destino/guardar", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ link: LINK_MAPS_2, destino: GOOGLE_2, revisado: LINK_MAPS_2 }).toString(),
    });
    expect(r.headers.get("Location")).toBe("/admin/login");
    expect((await fila("XK7P2M"))?.["destino"]).toBe(GOOGLE_1);
  });
});

describe("editar datos del negocio", () => {
  beforeEach(async () => {
    await crearPlaca("XK7P2M", "D", GOOGLE_1);
  });

  it("el formulario trae los datos actuales y guarda los nuevos", async () => {
    expect(await ver("/admin/placas/XK7P2M/editar")).toContain('name="negocio" value="Café Qosqo"');

    const r = await enviar(
      "/admin/placas/XK7P2M/editar",
      { negocio: "Café Qosqo Centro", responsable: "Juan Mamani", telefono: "+51 984 000 111" },
      idUsuario,
    );
    expect(r.headers.get("Location")).toBe("/admin/placas/XK7P2M?aviso=datos");
    expect(await fila("XK7P2M")).toMatchObject({
      negocio: "Café Qosqo Centro",
      responsable: "Juan Mamani",
      telefono: "+51 984 000 111",
      destino: GOOGLE_1, // el destino no se toca
      estado: "activa",
    });
  });

  it("rechaza datos inválidos", async () => {
    const r = await enviar("/admin/placas/XK7P2M/editar", { negocio: "", responsable: "X", telefono: "984123456" }, idUsuario);
    expect(r.status).toBe(400);
    expect((await fila("XK7P2M"))?.["negocio"]).toBe("Café Qosqo");
  });
});

describe("desactivar y reactivar", () => {
  beforeEach(async () => {
    await crearPlaca("XK7P2M", "D", GOOGLE_1);
  });

  it("desactivar pide confirmación; al confirmar, el público va a la landing y los datos se conservan", async () => {
    const confirmar = await ver("/admin/placas/XK7P2M/desactivar");
    expect(confirmar).toContain("Sí, desactivar");
    expect((await fila("XK7P2M"))?.["estado"]).toBe("activa"); // ver la confirmación no cambia nada

    const r = await enviar("/admin/placas/XK7P2M/desactivar", {}, idUsuario);
    expect(r.headers.get("Location")).toBe("/admin/placas/XK7P2M?aviso=desactivada");
    expect(await fila("XK7P2M")).toMatchObject({ estado: "desactivada", destino: GOOGLE_1, negocio: "Café Qosqo" });

    const publico = await pedir("/n/XK7P2M", { headers: { "User-Agent": IPHONE } });
    expect(publico.headers.get("Location")).toBe("/");
  });

  it("la ficha de una placa desactivada ofrece reactivarla, y al hacerlo vuelve a redirigir", async () => {
    await enviar("/admin/placas/XK7P2M/desactivar", {}, idUsuario);
    const ficha = await ver("/admin/placas/XK7P2M");
    expect(ficha).toContain('<span class="estado desactivada">Desactivada</span>');
    expect(ficha).toContain('action="/admin/placas/XK7P2M/reactivar"');
    expect(ficha).not.toContain("/destino");

    const r = await enviar("/admin/placas/XK7P2M/reactivar", {}, idUsuario);
    expect(r.headers.get("Location")).toBe("/admin/placas/XK7P2M?aviso=reactivada");
    expect((await fila("XK7P2M"))?.["estado"]).toBe("activa");

    const publico = await pedir("/q/XK7P2M", { headers: { "User-Agent": IPHONE } });
    expect(publico.headers.get("Location")).toBe(GOOGLE_1);
  });

  it("una placa sin activar no se puede desactivar ni reactivar", async () => {
    await crearPlaca("7BCD2F", "D");
    await enviar("/admin/placas/7BCD2F/desactivar", {}, idUsuario);
    await enviar("/admin/placas/7BCD2F/reactivar", {}, idUsuario);
    expect((await fila("7BCD2F"))?.["estado"]).toBe("sin_activar");
  });

  it("sin sesión no desactiva", async () => {
    const r = await pedir("/admin/placas/XK7P2M/desactivar", { method: "POST" });
    expect(r.headers.get("Location")).toBe("/admin/login");
    expect((await fila("XK7P2M"))?.["estado"]).toBe("activa");
  });
});
