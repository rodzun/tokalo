// Tests de la etapa 9: conversión de links de Google Maps a link de reseña.
import { beforeEach, describe, expect, it } from "vitest";
import {
  type Buscador,
  convertirLinkDeMaps,
  esDominioDeGoogle,
  linkGPageDesdeCid,
  placeIdDesdePar,
} from "../src/lib/maps";
import { cabecerasConSesion, crearUsuario, enviar, pedir, vaciarBase } from "./ayudas";

const RESENA = "https://search.google.com/local/writereview?placeid=";

// Respuestas reales de Google (cabecera Location del 302), grabadas el
// 2026-11-11 al pedir cada link corto compartido desde un iPhone.
const COLA =
  "&entry=gps&shh=CAE&lucs=,94297699,94231188,100821555,47071704,94218641,94282134,94286869,100820247,100822504,100804976,100838877,121816461,100798797&g_ep=CAISEjI2LjQ1LjEuMDExNzM4Mjc5MBgAIIgnKnwsOTQyOTc2OTksOTQyMzExODgsMTAwODIxNTU1LDQ3MDcxNzA0LDk0MjE4NjQxLDk0MjgyMTM0LDk0Mjg2ODY5LDEwMDgyMDI0NywxMDA4MjI1MDQsMTAwODA0OTc2LDEwMDgzODg3NywxMjE4MTY0NjEsMTAwNzk4Nzk3QgJQRQ%3D%3D";
const GRABADAS: Record<string, string> = {
  "https://maps.app.goo.gl/RJbtcYKLeMyt1ZmC7?g_st=ic":
    "https://maps.google.com?q=Krusty+Krab+Cusco,+Jr,+Los+Lirios+L-13,+Cusco+08002&ftid=0x916dd5c960768ac5:0x8b6fc766db191d55" + COLA + "&skid=bcc83a14-09bd-48c0-9513-099faf159c8b&g_st=ic",
  "https://maps.app.goo.gl/MGk8Lf7nyjZouva6A?g_st=ic":
    "https://maps.google.com?q=Hostal+Ukumari+Andino,+Avenida+Ausangate,+Pasaje+San+Sebastian+n%C2%B0+788,+08000&ftid=0x916e7f3cd605f33d:0x62e3b416032d74e9" + COLA + "&skid=1b06b2fd-f0b5-4b34-8f3a-5465e5a1ceb9&g_st=ic",
  "https://maps.app.goo.gl/3UHa7c6Afyg8s2iB6?g_st=ic":
    "https://maps.google.com?q=Morena+Peruvian+Kitchen,+plaza+de+armas,+Portal+Harinas+181,+Cusco+08001&ftid=0x916dd673c0967bcb:0xfac43d1ccc1a2820" + COLA + "&skid=4b49c026-a44f-4cca-bb20-28e1e7bbdf0a&g_st=ic",
};

/** URLs que el código pidió durante un test. */
let pedidas: string[] = [];

/** Google de mentira: responde 302 según la tabla `redirecciones`. */
function googleFalso(redirecciones: Record<string, string>): Buscador {
  return async (url, opciones) => {
    pedidas.push(url);
    expect(opciones.redirect).toBe("manual"); // nunca seguir redirecciones a ciegas
    const destino = redirecciones[url];
    return destino === undefined
      ? new Response("no encontrado", { status: 404 })
      : new Response(null, { status: 302, headers: { Location: destino } });
  };
}

/** Buscador que hace fallar el test si se usa: para links que no deben pedir nada. */
const sinRed: Buscador = async (url) => {
  throw new Error(`No debía pedirse ${url}`);
};

beforeEach(() => {
  pedidas = [];
});

describe("cálculo del Place ID", () => {
  it("caso verificado", () => {
    expect(placeIdDesdePar(0x916dd7f9d9df8e77n, 0x2ddb6a38c85b06adn)).toBe("ChIJd47f2fnXbZERrQZbyDhq2y0");
  });

  it("link g.page a partir del CID (comprobado contra Google: redirige a la reseña)", () => {
    expect(linkGPageDesdeCid(0x8b6fc766db191d55n)).toBe("https://g.page/r/CVUdGdtmx2-LEAI/review");
  });
});

describe("links cortos compartidos desde el celular", () => {
  it.each([
    ["https://maps.app.goo.gl/RJbtcYKLeMyt1ZmC7?g_st=ic", "ChIJxYp2YMnVbZERVR0Z22bHb4s", "Krusty Krab Cusco, Jr, Los Lirios L-13, Cusco 08002"],
    ["https://maps.app.goo.gl/MGk8Lf7nyjZouva6A?g_st=ic", "ChIJPfMF1jx_bpER6XQtAxa042I", "Hostal Ukumari Andino, Avenida Ausangate, Pasaje San Sebastian n° 788, 08000"],
    ["https://maps.app.goo.gl/3UHa7c6Afyg8s2iB6?g_st=ic", "ChIJy3uWwHPWbZERICgazBw9xPo", "Morena Peruvian Kitchen, plaza de armas, Portal Harinas 181, Cusco 08001"],
  ])("%s", async (corto, placeId, nombre) => {
    const r = await convertirLinkDeMaps(corto, googleFalso(GRABADAS));
    expect(r).toEqual({ ok: true, destino: RESENA + placeId, origen: "par", nombre });
    expect(pedidas).toEqual([corto]); // un solo salto
  });

  it("acepta texto antes del link, como lo pega WhatsApp", async () => {
    const r = await convertirLinkDeMaps(
      "Krusty Krab Cusco\nhttps://maps.app.goo.gl/RJbtcYKLeMyt1ZmC7?g_st=ic",
      googleFalso(GRABADAS),
    );
    expect(r).toMatchObject({ ok: true, destino: RESENA + "ChIJxYp2YMnVbZERVR0Z22bHb4s" });
  });

  it("sigue hasta 3 saltos, pero no más", async () => {
    const cadena = {
      "https://goo.gl/maps/a": "https://maps.app.goo.gl/b",
      "https://maps.app.goo.gl/b": "https://maps.app.goo.gl/c",
      "https://maps.app.goo.gl/c": "https://www.google.com/maps?ftid=0x916dd7f9d9df8e77:0x2ddb6a38c85b06ad",
    };
    expect(await convertirLinkDeMaps("https://goo.gl/maps/a", googleFalso(cadena))).toMatchObject({
      ok: true,
      destino: RESENA + "ChIJd47f2fnXbZERrQZbyDhq2y0",
    });

    pedidas = [];
    const bucle = { "https://maps.app.goo.gl/x": "https://maps.app.goo.gl/x" };
    expect(await convertirLinkDeMaps("https://maps.app.goo.gl/x", googleFalso(bucle))).toMatchObject({ ok: false });
    expect(pedidas).toHaveLength(3);
  });

  it("no sigue una redirección que sale de Google", async () => {
    const trampa = { "https://maps.app.goo.gl/x": "https://sitio-malo.example/?ftid=0x1:0x2" };
    const r = await convertirLinkDeMaps("https://maps.app.goo.gl/x", googleFalso(trampa));
    expect(r).toEqual({ ok: false, motivo: "El link no es de Google Maps." });
    expect(pedidas).toEqual(["https://maps.app.goo.gl/x"]); // el sitio ajeno nunca se pidió
  });

  it("si Google no responde, lo dice sin lanzar un error", async () => {
    const caido: Buscador = async () => {
      throw new Error("sin conexión");
    };
    const r = await convertirLinkDeMaps("https://maps.app.goo.gl/x", caido);
    expect(r).toEqual({ ok: false, motivo: "No se pudo consultar el link corto. Inténtalo de nuevo." });
  });

  it("si el link corto ya no existe, no se encuentra el negocio", async () => {
    const r = await convertirLinkDeMaps("https://maps.app.goo.gl/borrado", googleFalso({}));
    expect(r).toEqual({ ok: false, motivo: "No se encontró el negocio en ese link." });
  });
});

describe("links largos (no hace falta pedir nada a Google)", () => {
  it("de computadora, con el par en !1s", async () => {
    const r = await convertirLinkDeMaps(
      "https://www.google.com/maps/place/Un+Negocio/@-13.5167,-71.9781,17z/data=!3m1!4b1!4m6!3m5!1s0x916dd7f9d9df8e77:0x2ddb6a38c85b06ad!8m2!3d-13.5167!4d-71.9755!16s%2Fg%2F11c5s8xyz?entry=ttu",
      sinRed,
    );
    expect(r).toEqual({ ok: true, destino: RESENA + "ChIJd47f2fnXbZERrQZbyDhq2y0", origen: "par", nombre: "Un Negocio" });
  });

  it("con el par codificado (%3A en lugar de dos puntos)", async () => {
    const r = await convertirLinkDeMaps(
      "https://maps.google.com/?q=Negocio&ftid=0x916dd7f9d9df8e77%3A0x2ddb6a38c85b06ad",
      sinRed,
    );
    expect(r).toMatchObject({ ok: true, destino: RESENA + "ChIJd47f2fnXbZERrQZbyDhq2y0" });
  });

  it("con dominio de Google de otro país", async () => {
    const r = await convertirLinkDeMaps(
      "https://www.google.com.pe/maps/place/X/data=!4m2!3m1!1s0x916dd7f9d9df8e77:0x2ddb6a38c85b06ad",
      sinRed,
    );
    expect(r).toMatchObject({ ok: true });
  });

  it("solo con cid=: arma el link oficial g.page", async () => {
    const r = await convertirLinkDeMaps("https://maps.google.com/?cid=10047468538263313749", sinRed);
    expect(r).toEqual({ ok: true, destino: "https://g.page/r/CVUdGdtmx2-LEAI/review", origen: "cid" });
  });

  it("con el primer número en cero: usa el segundo como CID", async () => {
    const r = await convertirLinkDeMaps(
      "https://www.google.com/maps/place//data=!4m2!3m1!1s0x0:0x8b6fc766db191d55",
      sinRed,
    );
    expect(r).toEqual({ ok: true, destino: "https://g.page/r/CVUdGdtmx2-LEAI/review", origen: "cid" });
  });

  it("un link de Maps sin negocio (una búsqueda) no se puede convertir", async () => {
    const r = await convertirLinkDeMaps("https://www.google.com/maps/search/restaurantes+cusco", sinRed);
    expect(r).toEqual({ ok: false, motivo: "No se encontró el negocio en ese link." });
  });
});

describe("nombre del negocio según el link", () => {
  it("no hay nombre cuando el link no lo trae", async () => {
    for (const link of [
      "https://maps.google.com/?cid=10047468538263313749",
      "https://www.google.com/maps/place//data=!4m2!3m1!1s0x916dd7f9d9df8e77:0x2ddb6a38c85b06ad",
      "https://www.google.com/maps?q=-13.5167,-71.9781&ftid=0x916dd7f9d9df8e77:0x2ddb6a38c85b06ad",
      "https://search.google.com/local/writereview?placeid=ChIJd47f2fnXbZERrQZbyDhq2y0",
    ]) {
      const r = await convertirLinkDeMaps(link, sinRed);
      expect(r.ok && r.nombre, link).toBeUndefined();
    }
  });

  it("decodifica tildes y símbolos del nombre en links de computadora", async () => {
    const r = await convertirLinkDeMaps(
      "https://www.google.com/maps/place/Caf%C3%A9+Qosqo+%26+Bar/@-13.5,-71.9,17z/data=!4m2!3m1!1s0x916dd7f9d9df8e77:0x2ddb6a38c85b06ad",
      sinRed,
    );
    expect(r).toMatchObject({ ok: true, nombre: "Café Qosqo & Bar" });
  });
});

describe("links que ya son de reseña", () => {
  it("writereview se acepta y se limpia de parámetros extra", async () => {
    const r = await convertirLinkDeMaps(
      "https://search.google.com/local/writereview?placeid=ChIJd47f2fnXbZERrQZbyDhq2y0&source=g.page.m.kd._",
      sinRed,
    );
    expect(r).toEqual({ ok: true, destino: RESENA + "ChIJd47f2fnXbZERrQZbyDhq2y0", origen: "ya-era-resena" });
  });

  it("g.page/r/.../review se acepta tal cual", async () => {
    const r = await convertirLinkDeMaps("https://g.page/r/CVUdGdtmx2-LEAI/review", sinRed);
    expect(r).toEqual({ ok: true, destino: "https://g.page/r/CVUdGdtmx2-LEAI/review", origen: "ya-era-resena" });
  });
});

describe("links rechazados", () => {
  it.each([
    ["http://maps.app.goo.gl/RJbtcYKLeMyt1ZmC7", "El link debe empezar por https://"],
    ["https://www.tripadvisor.com.pe/Restaurant_Review-g294314", "El link no es de Google Maps."],
    ["https://google.com.sitio-malo.example/maps?ftid=0x1:0x2", "El link no es de Google Maps."],
    ["hola, no tengo link", "No parece un link. Debe empezar por https://"],
    ["", "No parece un link. Debe empezar por https://"],
  ])("%s", async (pegado, motivo) => {
    expect(await convertirLinkDeMaps(pegado, sinRed)).toEqual({ ok: false, motivo });
  });

  it("reconoce solo dominios de Google", () => {
    for (const d of ["google.com", "www.google.com", "maps.google.com", "maps.google.com.pe", "google.es", "google.co.uk", "maps.app.goo.gl", "goo.gl", "g.page", "g.co", "share.google"]) {
      expect(esDominioDeGoogle(d), d).toBe(true);
    }
    for (const d of ["google.com.evil.com", "evilgoogle.com", "google.evil.co", "goo.gl.evil.com", "notgoo.gl", "xg.page", "tripadvisor.com"]) {
      expect(esDominioDeGoogle(d), d).toBe(false);
    }
  });
});

describe("página Convertir link en /admin", () => {
  let idUsuario = 0;

  beforeEach(async () => {
    await vaciarBase();
    idUsuario = await crearUsuario("rod", "Kx7mPq2RtW9zLb4N");
  });

  it("sin sesión redirige al login", async () => {
    expect((await pedir("/admin/convertir")).headers.get("Location")).toBe("/admin/login");
  });

  it("muestra el formulario", async () => {
    const r = await pedir("/admin/convertir", { headers: await cabecerasConSesion(idUsuario) });
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('name="link"');
  });

  it("convierte un link largo y ofrece el botón Probar", async () => {
    const r = await enviar(
      "/admin/convertir",
      { link: "https://maps.google.com/?q=X&ftid=0x916dd7f9d9df8e77:0x2ddb6a38c85b06ad" },
      idUsuario,
    );
    const cuerpo = await r.text();
    expect(cuerpo).toContain("Link de reseña encontrado.");
    expect(cuerpo).toContain(`href="${RESENA}ChIJd47f2fnXbZERrQZbyDhq2y0" target="_blank"`);
    expect(cuerpo).toContain(">Probar</a>");
    expect(cuerpo).toContain("Negocio según el link:</strong> X");
  });

  it("si no puede, explica el motivo y pide el link a mano", async () => {
    const r = await enviar("/admin/convertir", { link: "https://www.tripadvisor.com.pe/algo" }, idUsuario);
    const cuerpo = await r.text();
    expect(cuerpo).toContain("El link no es de Google Maps.");
    expect(cuerpo).toContain("pégalo directamente");
    expect(cuerpo).not.toContain(">Probar</a>");
  });

  it("escapa lo que se pegó al volver a mostrarlo", async () => {
    const r = await enviar("/admin/convertir", { link: '"><script>alert(1)</script>' }, idUsuario);
    expect(await r.text()).not.toContain("<script>alert(1)</script>");
  });
});
