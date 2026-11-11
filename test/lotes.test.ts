// Tests de la etapa 7: generación de códigos, lotes, CSV y modelos.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { ALFABETO, generarCodigo, generarCodigosUnicos } from "../src/lib/codigos";
import { aHoraPeru } from "../src/lib/fechas";
import { crearLote, csvDeLote, eliminarLote } from "../src/lib/lotes";
import { cabecerasConSesion, crearUsuario, enviar, pedir, vaciarBase } from "./ayudas";

let idUsuario = 0;

async function contar(tabla: "lotes" | "placas"): Promise<number> {
  return (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).first<number>("n")) ?? -1;
}

async function codigosDelLote(numero: number): Promise<string[]> {
  const { results } = await env.DB.prepare("SELECT codigo FROM placas WHERE lote = ? ORDER BY codigo")
    .bind(numero)
    .all<{ codigo: string }>();
  return results.map((f) => f.codigo);
}

/** Generador de mentira: devuelve los códigos de la lista, en orden. */
function generadorFijo(codigos: string[]): () => string {
  let i = 0;
  return () => codigos[i++] ?? "ZZZZZZ";
}

beforeEach(async () => {
  await vaciarBase();
  // Los tests de modelos crean modelos extra: se limpian aquí.
  await env.DB.prepare("DELETE FROM modelos WHERE id NOT IN ('D','E','F','G','H')").run();
  idUsuario = await crearUsuario("rod", "Kx7mPq2RtW9zLb4N");
});

describe("generación de códigos", () => {
  it("el alfabeto son 28 caracteres: sin vocales, sin L, sin 0 ni 1", () => {
    expect(ALFABETO).toHaveLength(28);
    expect(new Set(ALFABETO).size).toBe(28);
    expect(ALFABETO).not.toMatch(/[AEIOUL01]/);
  });

  it("cada código tiene 6 caracteres del alfabeto", () => {
    for (let i = 0; i < 2000; i++) {
      expect(generarCodigo()).toMatch(/^[BCDFGHJKMNPQRSTVWXYZ2-9]{6}$/);
    }
  });

  it("usa todos los caracteres, en proporciones parecidas", () => {
    const veces = new Map<string, number>();
    for (let i = 0; i < 5000; i++) {
      for (const c of generarCodigo()) veces.set(c, (veces.get(c) ?? 0) + 1);
    }
    // 30 000 caracteres entre 28: se esperan ~1071 de cada uno.
    expect(veces.size).toBe(28);
    for (const n of veces.values()) {
      expect(n).toBeGreaterThan(850);
      expect(n).toBeLessThan(1300);
    }
  });

  it("no son secuenciales: dos seguidos no se parecen", () => {
    // Si fueran un contador, códigos consecutivos compartirían casi todo.
    let iguales = 0;
    for (let i = 0; i < 500; i++) {
      const a = generarCodigo();
      const b = generarCodigo();
      if (a.slice(0, 5) === b.slice(0, 5)) iguales++;
    }
    expect(iguales).toBe(0);
  });

  it("generarCodigosUnicos no repite dentro de la tanda ni usa los que debe evitar", () => {
    const tanda = generarCodigosUnicos(3, generadorFijo(["BBBBBB", "BBBBBB", "CCCCCC", "DDDDDD", "FFFFFF"]), new Set(["CCCCCC"]));
    expect(tanda).toEqual(["BBBBBB", "DDDDDD", "FFFFFF"]);
  });
});

describe("crear lote", () => {
  it("guarda el lote y todas sus placas, sin activar y con códigos únicos", async () => {
    const numero = await crearLote(env.DB, "D", 500, idUsuario);
    const codigos = await codigosDelLote(numero);
    expect(codigos).toHaveLength(500);
    expect(new Set(codigos).size).toBe(500);

    const lote = await env.DB.prepare("SELECT modelo, cantidad, creado_por FROM lotes WHERE id = ?").bind(numero).first();
    expect(lote).toEqual({ modelo: "D", cantidad: 500, creado_por: idUsuario });

    const estados = await env.DB.prepare("SELECT DISTINCT estado, modelo, destino FROM placas").all();
    expect(estados.results).toEqual([{ estado: "sin_activar", modelo: "D", destino: null }]);
  });

  it("si un código ya existe, la clave primaria lo rechaza y se regenera solo ese", async () => {
    const primero = await crearLote(env.DB, "D", 1, idUsuario, generadorFijo(["XK7P2M"]));
    // El generador propone XK7P2M (repetido) y 4TQW9B; al reintentar da HG3NZ8.
    const segundo = await crearLote(env.DB, "E", 2, idUsuario, generadorFijo(["XK7P2M", "4TQW9B", "HG3NZ8"]));

    expect(await codigosDelLote(primero)).toEqual(["XK7P2M"]);
    expect(await codigosDelLote(segundo)).toEqual(["4TQW9B", "HG3NZ8"]);
    expect(await contar("lotes")).toBe(2); // el intento fallido no dejó un lote huérfano
  });

  it("si no logra códigos libres, falla sin dejar nada a medias", async () => {
    await crearLote(env.DB, "D", 1, idUsuario, generadorFijo(["XK7P2M"]));
    const siempreElMismo = (): string => "XK7P2M";
    await expect(crearLote(env.DB, "D", 1, idUsuario, siempreElMismo)).rejects.toThrow();
    expect(await contar("lotes")).toBe(1);
    expect(await contar("placas")).toBe(1);
  });

  it("es una transacción: si el lote no puede guardarse, no queda ninguna placa", async () => {
    await expect(crearLote(env.DB, "NO-EXISTE", 5, idUsuario)).rejects.toThrow();
    expect(await contar("lotes")).toBe(0);
    expect(await contar("placas")).toBe(0);
  });

  it("el número de un lote eliminado no se reutiliza", async () => {
    const a = await crearLote(env.DB, "D", 1, idUsuario);
    expect(await eliminarLote(env.DB, a)).toBe(true);
    const b = await crearLote(env.DB, "D", 1, idUsuario);
    expect(b).toBeGreaterThan(a);
  });
});

describe("eliminar lote", () => {
  it("borra el lote y sus placas si ninguna fue activada", async () => {
    const numero = await crearLote(env.DB, "D", 10, idUsuario);
    expect(await eliminarLote(env.DB, numero)).toBe(true);
    expect(await contar("lotes")).toBe(0);
    expect(await contar("placas")).toBe(0);
  });

  it("no borra nada si alguna placa fue activada o desactivada", async () => {
    for (const estado of ["activa", "desactivada"]) {
      const numero = await crearLote(env.DB, "D", 3, idUsuario);
      const [codigo] = await codigosDelLote(numero);
      await env.DB.prepare("UPDATE placas SET estado = ? WHERE codigo = ?").bind(estado, codigo).run();

      expect(await eliminarLote(env.DB, numero), estado).toBe(false);
      expect(await codigosDelLote(numero), estado).toHaveLength(3);
    }
    expect(await contar("lotes")).toBe(2);
  });

  it("devuelve false si el lote no existe", async () => {
    expect(await eliminarLote(env.DB, 999_999)).toBe(false);
  });
});

describe("CSV", () => {
  it("tiene codigo, url_nfc y url_qr, con la del QR en mayúsculas", () => {
    expect(csvDeLote(["XK7P2M", "4TQW9B"], "https://tokaloperu.com")).toBe(
      "codigo,url_nfc,url_qr\r\n" +
        "XK7P2M,https://tokaloperu.com/n/XK7P2M,HTTPS://TOKALOPERU.COM/Q/XK7P2M\r\n" +
        "4TQW9B,https://tokaloperu.com/n/4TQW9B,HTTPS://TOKALOPERU.COM/Q/4TQW9B\r\n",
    );
  });
});

describe("lotes en /admin", () => {
  it("sin sesión, todo redirige al login", async () => {
    await crearLote(env.DB, "D", 1, idUsuario);
    for (const ruta of ["/admin/lotes", "/admin/lotes/1.csv", "/admin/lotes/1/eliminar", "/admin/modelos"]) {
      const r = await pedir(ruta);
      expect(r.headers.get("Location"), ruta).toBe("/admin/login");
    }
    const post = await pedir("/admin/lotes", { method: "POST", body: "modelo=D&cantidad=5", headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    expect(post.headers.get("Location")).toBe("/admin/login");
    expect(await contar("lotes")).toBe(1);
  });

  it("crear desde el formulario, verlo en la lista y descargar su CSV", async () => {
    const r = await enviar("/admin/lotes", { modelo: "G", cantidad: "12" }, idUsuario);
    expect(r.status).toBe(303);
    expect(r.headers.get("Location")).toBe("/admin/lotes?aviso=creado");

    const numero = (await env.DB.prepare("SELECT id FROM lotes").first<number>("id")) ?? 0;
    const cabeceras = await cabecerasConSesion(idUsuario);

    const lista = await (await pedir("/admin/lotes?aviso=creado", { headers: cabeceras })).text();
    expect(lista).toContain("Lote creado.");
    expect(lista).toContain(`Lote ${numero} · G · Mesa espejo`);
    expect(lista).toContain("12 placas · 0 activadas");

    const csv = await pedir(`/admin/lotes/${numero}.csv`, { headers: cabeceras });
    expect(csv.status).toBe(200);
    expect(csv.headers.get("Content-Type")).toContain("text/csv");
    expect(csv.headers.get("Content-Disposition")).toBe(`attachment; filename="tokalo-lote-${numero}-G.csv"`);
    const lineas = (await csv.text()).trim().split("\r\n");
    expect(lineas).toHaveLength(13); // cabecera + 12 placas
    expect(lineas[0]).toBe("codigo,url_nfc,url_qr");
    expect(lineas[1]).toMatch(
      /^([BCDFGHJKMNPQRSTVWXYZ2-9]{6}),https:\/\/tokalo-dev\.tokaloperu\.workers\.dev\/n\/\1,HTTPS:\/\/TOKALO-DEV\.TOKALOPERU\.WORKERS\.DEV\/Q\/\1$/,
    );
  });

  it("rechaza cantidades fuera de rango y modelos que no existen", async () => {
    for (const campos of [
      { modelo: "D", cantidad: "0" },
      { modelo: "D", cantidad: "501" },
      { modelo: "D", cantidad: "diez" },
      { modelo: "D", cantidad: "-3" },
      { modelo: "X", cantidad: "5" },
    ]) {
      const r = await enviar("/admin/lotes", campos, idUsuario);
      expect(r.status, JSON.stringify(campos)).toBe(400);
    }
    expect(await contar("lotes")).toBe(0);
  });

  it("eliminar pide confirmación y luego borra", async () => {
    const numero = await crearLote(env.DB, "D", 4, idUsuario);
    const confirmar = await pedir(`/admin/lotes/${numero}/eliminar`, { headers: await cabecerasConSesion(idUsuario) });
    expect(await confirmar.text()).toContain("Sí, eliminar");
    expect(await contar("lotes")).toBe(1); // ver la confirmación no borra nada

    const r = await enviar(`/admin/lotes/${numero}/eliminar`, {}, idUsuario);
    expect(r.headers.get("Location")).toBe("/admin/lotes?aviso=eliminado");
    expect(await contar("placas")).toBe(0);
  });

  it("no elimina un lote con placas activadas", async () => {
    const numero = await crearLote(env.DB, "D", 2, idUsuario);
    await env.DB.prepare("UPDATE placas SET estado = 'activa' WHERE lote = ?").bind(numero).run();
    const r = await enviar(`/admin/lotes/${numero}/eliminar`, {}, idUsuario);
    expect(r.headers.get("Location")).toBe("/admin/lotes?aviso=no-eliminado");
    expect(await contar("placas")).toBe(2);
  });
});

describe("modelos en /admin", () => {
  const NUEVO = { id: "j", nombre: "Tarjeta negra", tipo: "tarjeta", plataforma: "instagram", ancho_mm: "86", alto_mm: "54", version: "1" };

  it("crea un modelo y lo muestra en la lista", async () => {
    const r = await enviar("/admin/modelos", NUEVO, idUsuario);
    expect(r.headers.get("Location")).toBe("/admin/modelos?aviso=creado");
    const fila = await env.DB.prepare("SELECT * FROM modelos WHERE id = 'J'").first();
    expect(fila).toEqual({ id: "J", nombre: "Tarjeta negra", tipo: "tarjeta", ancho_mm: 86, alto_mm: 54, version: 1, plataforma: "instagram" });

    const lista = await (await pedir("/admin/modelos", { headers: await cabecerasConSesion(idUsuario) })).text();
    expect(lista).toContain("J · Tarjeta negra");
    expect(lista).toContain("Instagram · Tarjeta · 86 x 54 mm · versión 1");
  });

  it("rechaza datos inválidos y un id repetido", async () => {
    for (const cambio of [{ id: "" }, { id: "ABCD" }, { id: "D" }, { nombre: "" }, { tipo: "llavero" }, { plataforma: "myspace" }, { plataforma: "" }, { ancho_mm: "0" }, { alto_mm: "x" }, { version: "" }]) {
      const r = await enviar("/admin/modelos", { ...NUEVO, ...cambio }, idUsuario);
      expect(r.status, JSON.stringify(cambio)).toBe(400);
    }
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM modelos").first("n")).toBe(5);
  });

  it("escapa el nombre al mostrarlo (no deja inyectar HTML)", async () => {
    await enviar("/admin/modelos", { ...NUEVO, nombre: "<script>alert(1)</script>" }, idUsuario);
    const lista = await (await pedir("/admin/modelos", { headers: await cabecerasConSesion(idUsuario) })).text();
    expect(lista).not.toContain("<script>alert(1)</script>");
    expect(lista).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("elimina un modelo sin uso, pero no uno con lotes", async () => {
    await enviar("/admin/modelos", NUEVO, idUsuario);
    const libre = await enviar("/admin/modelos/J/eliminar", {}, idUsuario);
    expect(libre.headers.get("Location")).toBe("/admin/modelos?aviso=eliminado");

    await crearLote(env.DB, "D", 1, idUsuario);
    const enUso = await enviar("/admin/modelos/D/eliminar", {}, idUsuario);
    expect(enUso.headers.get("Location")).toBe("/admin/modelos?aviso=no-eliminado");
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM modelos").first("n")).toBe(5);
  });
});

describe("hora de Perú", () => {
  it("convierte UTC a UTC-5, también cuando cambia el día", () => {
    expect(aHoraPeru("2026-11-11T09:08:35Z")).toBe("11/11/2026 04:08");
    expect(aHoraPeru("2026-11-11T03:00:00Z")).toBe("10/11/2026 22:00");
    expect(aHoraPeru("2027-01-01T04:59:00Z")).toBe("31/12/2026 23:59");
  });
});
