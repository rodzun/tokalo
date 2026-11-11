// Tests del estado de impresión del lote: "generado" e "impreso".
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { crearLote, desmarcarImpreso, eliminarLote, marcarImpreso } from "../src/lib/lotes";
import { activarPlaca } from "../src/lib/placas";
// La migración, como texto: se prueba su regla sobre datos ya existentes.
import migracion from "../migrations/0006_estado_de_impresion_del_lote.sql?raw";
import { cabecerasConSesion, crearUsuario, enviar, pedir, vaciarBase } from "./ayudas";

const DESTINO = "https://search.google.com/local/writereview?placeid=ChIJd47f2fnXbZERrQZbyDhq2y0";
const NEGOCIO = { negocio: "Café Qosqo", responsable: "María Quispe", telefono: "984123456" };

let rod = 0;
let ana = 0;

interface FilaLote {
  estado: string;
  estado_cambiado_en: string | null;
  estado_cambiado_por: number | null;
}

async function lote(numero: number): Promise<FilaLote | null> {
  return env.DB.prepare("SELECT estado, estado_cambiado_en, estado_cambiado_por FROM lotes WHERE id = ?")
    .bind(numero)
    .first<FilaLote>();
}

async function primerCodigo(numero: number): Promise<string> {
  return (await env.DB.prepare("SELECT codigo FROM placas WHERE lote = ? ORDER BY codigo").bind(numero).first<string>("codigo")) ?? "";
}

async function agregarEscaneo(codigo: string): Promise<void> {
  await env.DB.prepare("INSERT INTO escaneos (codigo, canal, fecha, pais, sistema) VALUES (?, 'n', '2026-11-11T10:00:00Z', 'PE', 'ios')")
    .bind(codigo)
    .run();
}

async function ver(ruta: string): Promise<string> {
  return (await pedir(ruta, { headers: await cabecerasConSesion(rod) })).text();
}

beforeEach(async () => {
  await vaciarBase();
  rod = await crearUsuario("rod", "Kx7mPq2RtW9zLb4N");
  ana = await crearUsuario("ana", "Zb8nQw3TyR5vMc7K");
});

describe("estado por defecto", () => {
  it("un lote nuevo nace en Generado, sin fecha ni usuario de cambio", async () => {
    const numero = await crearLote(env.DB, "D", 3, rod);
    expect(await lote(numero)).toEqual({ estado: "generado", estado_cambiado_en: null, estado_cambiado_por: null });
  });

  it("la base no acepta otros estados", async () => {
    const numero = await crearLote(env.DB, "D", 1, rod);
    await expect(env.DB.prepare("UPDATE lotes SET estado = 'enviado' WHERE id = ?").bind(numero).run()).rejects.toThrow();
  });
});

describe("marcar como impreso", () => {
  it("cambia el estado y guarda fecha y usuario", async () => {
    const numero = await crearLote(env.DB, "D", 3, rod);
    expect(await marcarImpreso(env.DB, numero, ana)).toBe(true);
    const fila = await lote(numero);
    expect(fila).toMatchObject({ estado: "impreso", estado_cambiado_por: ana });
    expect(fila?.estado_cambiado_en).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it("marcar dos veces no cambia nada la segunda vez", async () => {
    const numero = await crearLote(env.DB, "D", 1, rod);
    await marcarImpreso(env.DB, numero, ana);
    expect(await marcarImpreso(env.DB, numero, rod)).toBe(false);
    expect((await lote(numero))?.estado_cambiado_por).toBe(ana); // sigue el primero
  });

  it("se marca a mano desde la pantalla del lote", async () => {
    const numero = await crearLote(env.DB, "D", 2, rod);
    const antes = await ver(`/admin/lotes/${numero}`);
    expect(antes).toContain('<span class="estado">Generado</span>');
    expect(antes).toContain(`action="/admin/lotes/${numero}/impreso"`);

    const r = await enviar(`/admin/lotes/${numero}/impreso`, {}, rod);
    expect(r.headers.get("Location")).toBe(`/admin/lotes/${numero}?aviso=impreso`);

    const despues = await ver(`/admin/lotes/${numero}?aviso=impreso`);
    expect(despues).toContain("Lote marcado como impreso.");
    expect(despues).toContain('<span class="estado activa">Impreso</span>');
    expect(despues).toContain("por Persona rod"); // quién lo cambió
    expect(despues).toMatch(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2} por Persona rod/); // y cuándo, en hora de Perú
    expect(despues).toContain(`action="/admin/lotes/${numero}/generado"`);
  });

  it("sin sesión no se puede marcar ni desmarcar", async () => {
    const numero = await crearLote(env.DB, "D", 1, rod);
    for (const accion of ["impreso", "generado"]) {
      const r = await pedir(`/admin/lotes/${numero}/${accion}`, { method: "POST" });
      expect(r.headers.get("Location")).toBe("/admin/login");
    }
    expect((await lote(numero))?.estado).toBe("generado");
  });
});

describe("eliminar según el estado", () => {
  it("un lote en Generado se puede eliminar", async () => {
    const numero = await crearLote(env.DB, "D", 5, rod);
    expect(await eliminarLote(env.DB, numero)).toBe(true);
    expect(await lote(numero)).toBeNull();
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM placas").first("n")).toBe(0);
  });

  it("un lote en Impreso no se puede eliminar, aunque ninguna placa esté activada", async () => {
    const numero = await crearLote(env.DB, "D", 5, rod);
    await marcarImpreso(env.DB, numero, rod);
    expect(await eliminarLote(env.DB, numero)).toBe(false);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM placas").first("n")).toBe(5);

    const r = await enviar(`/admin/lotes/${numero}/eliminar`, {}, rod);
    expect(r.headers.get("Location")).toBe("/admin/lotes?aviso=no-eliminado");
    expect(await lote(numero)).not.toBeNull();
  });

  it("al volver a Generado, se puede eliminar otra vez", async () => {
    const numero = await crearLote(env.DB, "D", 2, rod);
    await marcarImpreso(env.DB, numero, rod);
    await desmarcarImpreso(env.DB, numero, rod);
    expect(await eliminarLote(env.DB, numero)).toBe(true);
  });

  it("la lista ofrece Eliminar solo en los lotes en Generado", async () => {
    const generado = await crearLote(env.DB, "D", 1, rod);
    const impreso = await crearLote(env.DB, "E", 1, rod);
    await marcarImpreso(env.DB, impreso, rod);
    const lista = await ver("/admin/lotes");
    expect(lista).toContain(`href="/admin/lotes/${generado}/eliminar"`);
    expect(lista).not.toContain(`href="/admin/lotes/${impreso}/eliminar"`);
    expect(lista).toContain('<span class="estado activa">Impreso</span>');
    expect(lista).toContain('<span class="estado">Generado</span>');
  });
});

describe("volver a Generado", () => {
  it("se permite si ninguna placa está activada ni tiene escaneos, y guarda quién y cuándo", async () => {
    const numero = await crearLote(env.DB, "D", 3, rod);
    await marcarImpreso(env.DB, numero, rod);
    expect(await desmarcarImpreso(env.DB, numero, ana)).toBe(true);
    expect(await lote(numero)).toMatchObject({ estado: "generado", estado_cambiado_por: ana });
  });

  it("no se permite si alguna placa está activa", async () => {
    const numero = await crearLote(env.DB, "D", 3, rod);
    await activarPlaca(env.DB, await primerCodigo(numero), NEGOCIO, DESTINO, rod);
    expect(await desmarcarImpreso(env.DB, numero, rod)).toBe(false);
    expect((await lote(numero))?.estado).toBe("impreso");
  });

  it("no se permite si alguna placa está desactivada (fue activada alguna vez)", async () => {
    const numero = await crearLote(env.DB, "D", 3, rod);
    const codigo = await primerCodigo(numero);
    await activarPlaca(env.DB, codigo, NEGOCIO, DESTINO, rod);
    await env.DB.prepare("UPDATE placas SET estado = 'desactivada' WHERE codigo = ?").bind(codigo).run();
    expect(await desmarcarImpreso(env.DB, numero, rod)).toBe(false);
  });

  it("no se permite si alguna placa tiene escaneos, aunque ya no esté activada", async () => {
    const numero = await crearLote(env.DB, "D", 3, rod);
    await marcarImpreso(env.DB, numero, rod);
    await agregarEscaneo(await primerCodigo(numero)); // escaneo en una placa sin activar
    expect(await desmarcarImpreso(env.DB, numero, rod)).toBe(false);
    expect((await lote(numero))?.estado).toBe("impreso");
  });

  it("desde la pantalla: avisa cuando no se puede", async () => {
    const numero = await crearLote(env.DB, "D", 2, rod);
    await activarPlaca(env.DB, await primerCodigo(numero), NEGOCIO, DESTINO, rod);
    const r = await enviar(`/admin/lotes/${numero}/generado`, {}, rod);
    expect(r.headers.get("Location")).toBe(`/admin/lotes/${numero}?aviso=no-generado`);
    expect(await ver(`/admin/lotes/${numero}?aviso=no-generado`)).toContain("tiene placas activadas o con escaneos");

    const libre = await crearLote(env.DB, "E", 2, rod);
    await marcarImpreso(env.DB, libre, rod);
    const ok = await enviar(`/admin/lotes/${libre}/generado`, {}, rod);
    expect(ok.headers.get("Location")).toBe(`/admin/lotes/${libre}?aviso=generado`);
  });
});

describe("activar una placa marca su lote", () => {
  it("el lote pasa a Impreso solo, y ya no se puede eliminar", async () => {
    const numero = await crearLote(env.DB, "D", 3, rod);
    await activarPlaca(env.DB, await primerCodigo(numero), NEGOCIO, DESTINO, ana);
    expect(await lote(numero)).toMatchObject({ estado: "impreso", estado_cambiado_por: ana });
    expect(await eliminarLote(env.DB, numero)).toBe(false);
  });

  it("si el lote ya estaba Impreso, no cambia quién ni cuándo lo marcó", async () => {
    const numero = await crearLote(env.DB, "D", 3, rod);
    await marcarImpreso(env.DB, numero, rod);
    await activarPlaca(env.DB, await primerCodigo(numero), NEGOCIO, DESTINO, ana);
    expect((await lote(numero))?.estado_cambiado_por).toBe(rod);
  });

  it("no toca otros lotes", async () => {
    const uno = await crearLote(env.DB, "D", 1, rod);
    const dos = await crearLote(env.DB, "E", 1, rod);
    await activarPlaca(env.DB, await primerCodigo(uno), NEGOCIO, DESTINO, rod);
    expect((await lote(dos))?.estado).toBe("generado");
  });
});

describe("regla de la migración para lotes que ya existían", () => {
  it("quedan en Generado, salvo los que tienen placas activadas o con escaneos", async () => {
    // Cuatro lotes "antiguos": se les quita el estado, como si vinieran de antes.
    const sinUso = await crearLote(env.DB, "D", 2, rod);
    const conActiva = await crearLote(env.DB, "D", 2, rod);
    const conDesactivada = await crearLote(env.DB, "D", 2, rod);
    const conEscaneos = await crearLote(env.DB, "D", 2, rod);
    await env.DB.prepare("UPDATE placas SET estado = 'activa', destino = ? WHERE codigo = ?").bind(DESTINO, await primerCodigo(conActiva)).run();
    await env.DB.prepare("UPDATE placas SET estado = 'desactivada', destino = ? WHERE codigo = ?").bind(DESTINO, await primerCodigo(conDesactivada)).run();
    await agregarEscaneo(await primerCodigo(conEscaneos));
    await env.DB.prepare("UPDATE lotes SET estado = 'generado', estado_cambiado_en = NULL, estado_cambiado_por = NULL").run();

    // Se ejecuta la misma sentencia UPDATE que trae el archivo de migración.
    const sentencia = migracion.slice(migracion.indexOf("UPDATE lotes"));
    await env.DB.prepare(sentencia.replace(/;\s*$/, "")).run();

    expect((await lote(sinUso))?.estado).toBe("generado");
    expect((await lote(conActiva))?.estado).toBe("impreso");
    expect((await lote(conDesactivada))?.estado).toBe("impreso");
    expect((await lote(conEscaneos))?.estado).toBe("impreso");
    // En los migrados no se sabe quién ni cuándo.
    expect(await lote(conActiva)).toMatchObject({ estado_cambiado_en: null, estado_cambiado_por: null });
  });
});
