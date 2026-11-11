// Tests de la etapa 10: activación de una placa y ficha.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { crearLote } from "../src/lib/lotes";
import { cabecerasConSesion, crearUsuario, enviar, pedir, vaciarBase } from "./ayudas";

const CODIGO = "XK7P2M";
const LINK_MAPS = "https://maps.google.com/?q=Negocio&ftid=0x916dd7f9d9df8e77:0x2ddb6a38c85b06ad";
const DESTINO = "https://search.google.com/local/writereview?placeid=ChIJd47f2fnXbZERrQZbyDhq2y0";
const TRIPADVISOR = "https://www.tripadvisor.com.pe/UserReviewEdit-g294314-d1234567";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";

const NEGOCIO = { negocio: "Café Qosqo", responsable: "María Quispe", telefono: "+51 984 123 456" };

let idUsuario = 0;

interface FilaPlaca {
  estado: string;
  destino: string | null;
  negocio: string | null;
  responsable: string | null;
  telefono: string | null;
  activada_por: number | null;
  activada_en: string | null;
}

async function placa(): Promise<FilaPlaca | null> {
  return env.DB.prepare(
    "SELECT estado, destino, negocio, responsable, telefono, activada_por, activada_en FROM placas WHERE codigo = ?",
  )
    .bind(CODIGO)
    .first<FilaPlaca>();
}

async function historial(): Promise<Record<string, unknown>[]> {
  const { results } = await env.DB.prepare(
    "SELECT codigo, destino_anterior, destino_nuevo, usuario_id FROM cambios_destino ORDER BY id",
  ).all();
  return results;
}

/** Saca el valor de un campo oculto del HTML del formulario. */
function oculto(cuerpo: string, nombre: string): string {
  const m = new RegExp(`name="${nombre}" value="([^"]*)"`).exec(cuerpo);
  return (m?.[1] ?? "").replaceAll("&amp;", "&");
}

/** Hace el recorrido completo: revisar y luego activar con lo que devolvió la revisión. */
async function revisarYActivar(campos: Record<string, string>): Promise<Response> {
  const revision = await (await enviar(`/admin/placas/${CODIGO}/revisar`, campos, idUsuario)).text();
  return enviar(
    `/admin/placas/${CODIGO}/activar`,
    { ...campos, destino: oculto(revision, "destino"), revisado: oculto(revision, "revisado") },
    idUsuario,
  );
}

beforeEach(async () => {
  await vaciarBase();
  idUsuario = await crearUsuario("rod", "Kx7mPq2RtW9zLb4N");
  await crearLote(env.DB, "D", 1, idUsuario, () => CODIGO);
});

describe("formulario de activación", () => {
  it("al escanear con sesión una placa sin activar, aparece el formulario con el código puesto", async () => {
    const cabeceras = await cabecerasConSesion(idUsuario);
    const escaneo = await pedir(`/n/${CODIGO.toLowerCase()}`, { headers: cabeceras });
    expect(escaneo.headers.get("Location")).toBe(`/admin/placas/${CODIGO}`);

    const cuerpo = await (await pedir(`/admin/placas/${CODIGO}`, { headers: cabeceras })).text();
    expect(cuerpo).toContain("Activar placa");
    expect(cuerpo).toContain(`<span class="dato">${CODIGO}</span>`);
    expect(cuerpo).toContain("D · Tótem pavonado");
    for (const nombre of ["negocio", "responsable", "telefono", "link"]) {
      expect(cuerpo).toContain(`name="${nombre}"`);
    }
    expect(cuerpo).not.toContain("dni");
    // Sin revisar todavía no se puede activar.
    expect(cuerpo).not.toContain("/activar");
  });

  it("sin sesión, todo redirige al login y no cambia nada", async () => {
    expect((await pedir(`/admin/placas/${CODIGO}`)).headers.get("Location")).toBe("/admin/login");
    const r = await pedir(`/admin/placas/${CODIGO}/activar`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...NEGOCIO, link: LINK_MAPS, destino: DESTINO, revisado: LINK_MAPS }).toString(),
    });
    expect(r.headers.get("Location")).toBe("/admin/login");
    expect((await placa())?.estado).toBe("sin_activar");
  });
});

describe("revisar el link", () => {
  it("convierte el link de Maps y muestra el destino con el botón Probar, sin guardar", async () => {
    const r = await enviar(`/admin/placas/${CODIGO}/revisar`, { ...NEGOCIO, link: LINK_MAPS }, idUsuario);
    expect(r.status).toBe(200);
    const cuerpo = await r.text();
    expect(cuerpo).toContain(`href="${DESTINO}" target="_blank"`);
    expect(cuerpo).toContain(">Probar</a>");
    expect(cuerpo).toContain(`formaction="/admin/placas/${CODIGO}/activar"`);
    expect(cuerpo).toContain('value="Café Qosqo"'); // conserva lo escrito
    expect((await placa())?.estado).toBe("sin_activar");
  });

  it("si no puede convertir, pide el link de reseña a mano y propone el que se pegó", async () => {
    const r = await enviar(`/admin/placas/${CODIGO}/revisar`, { ...NEGOCIO, link: TRIPADVISOR }, idUsuario);
    expect(r.status).toBe(400);
    const cuerpo = await r.text();
    expect(cuerpo).toContain("El link no es de Google Maps.");
    expect(cuerpo).toContain(`name="manual" value="${TRIPADVISOR}"`);
    expect(cuerpo).not.toContain("/activar"); // falta revisarlo
  });

  it("un link manual https se acepta tal cual; uno http, no", async () => {
    const bien = await enviar(`/admin/placas/${CODIGO}/revisar`, { ...NEGOCIO, link: "", manual: TRIPADVISOR }, idUsuario);
    expect(await bien.text()).toContain(`href="${TRIPADVISOR}" target="_blank"`);

    const mal = await enviar(
      `/admin/placas/${CODIGO}/revisar`,
      { ...NEGOCIO, link: "", manual: "http://sin-cifrar.example/resena" },
      idUsuario,
    );
    expect(mal.status).toBe(400);
    const cuerpo = await mal.text();
    expect(cuerpo).toContain("debe empezar por https://");
    expect(cuerpo).not.toContain("/activar");
  });

  it("rechaza datos del negocio incompletos o un teléfono inválido", async () => {
    for (const cambio of [{ negocio: "" }, { responsable: "" }, { telefono: "" }, { telefono: "abc" }, { telefono: "12" }]) {
      const r = await enviar(`/admin/placas/${CODIGO}/revisar`, { ...NEGOCIO, link: LINK_MAPS, ...cambio }, idUsuario);
      expect(r.status, JSON.stringify(cambio)).toBe(400);
      expect(await r.text(), JSON.stringify(cambio)).not.toContain("/activar");
    }
  });

  it("sin link de Maps ni link manual, lo pide", async () => {
    const r = await enviar(`/admin/placas/${CODIGO}/revisar`, { ...NEGOCIO, link: "" }, idUsuario);
    expect(r.status).toBe(400);
    expect(await r.text()).toContain("Pega el link de Google Maps");
  });
});

describe("activar", () => {
  it("guarda todo, anota el historial y la placa empieza a redirigir al público", async () => {
    const r = await revisarYActivar({ ...NEGOCIO, link: LINK_MAPS });
    expect(r.status).toBe(303);
    expect(r.headers.get("Location")).toBe(`/admin/placas/${CODIGO}?aviso=activada`);

    const fila = await placa();
    expect(fila).toMatchObject({
      estado: "activa",
      destino: DESTINO,
      negocio: "Café Qosqo",
      responsable: "María Quispe",
      telefono: "+51 984 123 456",
      activada_por: idUsuario,
    });
    expect(fila?.activada_en).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

    expect(await historial()).toEqual([
      { codigo: CODIGO, destino_anterior: null, destino_nuevo: DESTINO, usuario_id: idUsuario },
    ]);

    // El público (sin sesión) ya va a la reseña.
    const publico = await pedir(`/q/${CODIGO}`, { headers: { "User-Agent": IPHONE } });
    expect(publico.status).toBe(302);
    expect(publico.headers.get("Location")).toBe(DESTINO);
  });

  it("con link manual (Tripadvisor) también activa", async () => {
    await revisarYActivar({ ...NEGOCIO, link: "", manual: TRIPADVISOR });
    expect(await placa()).toMatchObject({ estado: "activa", destino: TRIPADVISOR });
  });

  it("no activa sin haber revisado", async () => {
    const r = await enviar(`/admin/placas/${CODIGO}/activar`, { ...NEGOCIO, link: LINK_MAPS }, idUsuario);
    expect(r.status).toBe(400);
    expect((await placa())?.estado).toBe("sin_activar");
    expect(await historial()).toEqual([]);
  });

  it("si el link se cambió después de probarlo, obliga a revisar otra vez", async () => {
    const r = await enviar(
      `/admin/placas/${CODIGO}/activar`,
      { ...NEGOCIO, link: "https://maps.google.com/?ftid=0x916dd5c960768ac5:0x8b6fc766db191d55", destino: DESTINO, revisado: LINK_MAPS },
      idUsuario,
    );
    expect(r.status).toBe(400);
    expect(await r.text()).toContain("El link cambió");
    expect((await placa())?.estado).toBe("sin_activar");
  });

  it("nunca guarda un destino que no sea https, aunque se manipule el formulario", async () => {
    const malo = "http://sin-cifrar.example/";
    const r = await enviar(
      `/admin/placas/${CODIGO}/activar`,
      { ...NEGOCIO, link: "", manual: malo, destino: malo, revisado: malo },
      idUsuario,
    );
    expect(r.status).toBe(400);
    expect((await placa())?.estado).toBe("sin_activar");

    const script = "javascript:alert(1)";
    await enviar(`/admin/placas/${CODIGO}/activar`, { ...NEGOCIO, link: LINK_MAPS, destino: script, revisado: LINK_MAPS }, idUsuario);
    expect((await placa())?.estado).toBe("sin_activar");
  });

  it("un doble envío no activa dos veces ni duplica el historial", async () => {
    const revision = await (await enviar(`/admin/placas/${CODIGO}/revisar`, { ...NEGOCIO, link: LINK_MAPS }, idUsuario)).text();
    const campos = { ...NEGOCIO, link: LINK_MAPS, destino: oculto(revision, "destino"), revisado: oculto(revision, "revisado") };
    await enviar(`/admin/placas/${CODIGO}/activar`, campos, idUsuario);
    const segundo = await enviar(`/admin/placas/${CODIGO}/activar`, { ...campos, negocio: "Otro nombre" }, idUsuario);

    expect(segundo.headers.get("Location")).toBe(`/admin/placas/${CODIGO}`);
    expect((await placa())?.negocio).toBe("Café Qosqo");
    expect(await historial()).toHaveLength(1);
  });
});

describe("ficha", () => {
  it("una placa activa muestra sus datos, el destino con Probar y el QR", async () => {
    await revisarYActivar({ ...NEGOCIO, link: LINK_MAPS });
    const cabeceras = await cabecerasConSesion(idUsuario);

    const escaneo = await pedir(`/n/${CODIGO}`, { headers: cabeceras });
    expect(escaneo.headers.get("Location")).toBe(`/admin/placas/${CODIGO}`); // no va a Google

    const cuerpo = await (await pedir(`/admin/placas/${CODIGO}?aviso=activada`, { headers: cabeceras })).text();
    expect(cuerpo).toContain("Placa activada.");
    expect(cuerpo).toContain('<span class="estado activa">Activa</span>');
    for (const texto of ["Café Qosqo", "María Quispe", "+51 984 123 456", "por Persona rod"]) {
      expect(cuerpo).toContain(texto);
    }
    expect(cuerpo).toContain(`href="${DESTINO}" target="_blank"`);
    expect(cuerpo).toContain(`/admin/placas/${CODIGO}/qr.svg`);
    expect(cuerpo).not.toContain("<form"); // solo lectura
  });

  it("escapa los datos del negocio (no deja inyectar HTML)", async () => {
    await revisarYActivar({ ...NEGOCIO, negocio: '<img src=x onerror="alert(1)">', link: LINK_MAPS });
    const cuerpo = await (await pedir(`/admin/placas/${CODIGO}`, { headers: await cabecerasConSesion(idUsuario) })).text();
    expect(cuerpo).not.toContain("<img src=x");
    expect(cuerpo).toContain("&lt;img src=x");
  });

  it("un código que no existe da 'no encontrada'", async () => {
    const r = await pedir("/admin/placas/ZZZZZZ", { headers: await cabecerasConSesion(idUsuario) });
    expect(r.status).toBe(404);
  });
});
