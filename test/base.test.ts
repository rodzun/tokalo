// Tests de la etapa 2: esquema, catálogo de modelos y datos de prueba.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
// "?raw" importa el archivo como texto, sin interpretarlo.
import datosDePrueba from "../datos/prueba.sql?raw";
import { ejecutarSql, vaciarBase } from "./ayudas";

beforeEach(vaciarBase);

/** Crea lo mínimo para poder insertar placas: un usuario y un lote. */
async function crearLoteBase(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO usuarios (id, nombre, usuario, hash_clave, creado_en) VALUES (1, 'Test', 'test', '!', '2026-11-11T00:00:00Z')",
    ),
    env.DB.prepare(
      "INSERT INTO lotes (id, modelo, cantidad, creado_por, creado_en) VALUES (1, 'D', 1, 1, '2026-11-11T00:00:00Z')",
    ),
  ]);
}

const INSERTAR_PLACA =
  "INSERT INTO placas (codigo, modelo, lote, estado, creada_en) VALUES (?, ?, ?, ?, '2026-11-11T00:00:00Z')";

describe("catálogo de modelos", () => {
  it("tiene los cinco modelos con su tipo y medidas", async () => {
    const { results } = await env.DB.prepare(
      "SELECT id, nombre, tipo, ancho_mm, alto_mm, version FROM modelos ORDER BY id",
    ).all();
    expect(results).toEqual([
      { id: "D", nombre: "Tótem pavonado", tipo: "totem", ancho_mm: 80, alto_mm: 100, version: 1 },
      { id: "E", nombre: "Tótem espejo", tipo: "totem", ancho_mm: 80, alto_mm: 100, version: 1 },
      { id: "F", nombre: "Tótem verde", tipo: "totem", ancho_mm: 80, alto_mm: 100, version: 1 },
      { id: "G", nombre: "Mesa espejo", tipo: "mesa", ancho_mm: 80, alto_mm: 80, version: 1 },
      { id: "H", nombre: "Mesa verde", tipo: "mesa", ancho_mm: 80, alto_mm: 80, version: 1 },
    ]);
  });

  it("rechaza un tipo de modelo desconocido", async () => {
    await expect(
      env.DB.prepare(
        "INSERT INTO modelos (id, nombre, tipo, ancho_mm, alto_mm) VALUES ('Z', 'Raro', 'llavero', 10, 10)",
      ).run(),
    ).rejects.toThrow();
  });
});

describe("placas", () => {
  it("la clave primaria rechaza un código repetido", async () => {
    await crearLoteBase();
    await env.DB.prepare(INSERTAR_PLACA).bind("4P7ZQX", "D", 1, "sin_activar").run();
    await expect(
      env.DB.prepare(INSERTAR_PLACA).bind("4P7ZQX", "D", 1, "sin_activar").run(),
    ).rejects.toThrow();
  });

  it("rechaza un estado inválido", async () => {
    await crearLoteBase();
    await expect(
      env.DB.prepare(INSERTAR_PLACA).bind("VBXJDW", "D", 1, "rota").run(),
    ).rejects.toThrow();
  });

  it("rechaza un modelo o un lote que no existen", async () => {
    await crearLoteBase();
    await expect(
      env.DB.prepare(INSERTAR_PLACA).bind("VBXJDW", "X", 1, "sin_activar").run(),
    ).rejects.toThrow();
    await expect(
      env.DB.prepare(INSERTAR_PLACA).bind("VBXJDW", "D", 99, "sin_activar").run(),
    ).rejects.toThrow();
  });
});

describe("escaneos", () => {
  it("solo acepta los canales 'n' y 'q' y los sistemas conocidos", async () => {
    await crearLoteBase();
    await env.DB.prepare(INSERTAR_PLACA).bind("4P7ZQX", "D", 1, "activa").run();
    const insertar =
      "INSERT INTO escaneos (codigo, canal, fecha, pais, sistema) VALUES ('4P7ZQX', ?, '2026-11-11T00:00:00Z', 'PE', ?)";

    await env.DB.prepare(insertar).bind("n", "ios").run();
    await env.DB.prepare(insertar).bind("q", "android").run();
    await expect(env.DB.prepare(insertar).bind("x", "ios").run()).rejects.toThrow();
    await expect(env.DB.prepare(insertar).bind("n", "windows").run()).rejects.toThrow();
  });
});

describe("datos de prueba", () => {
  it("se cargan sin errores sobre una base recién migrada", async () => {
    await ejecutarSql(datosDePrueba);
    const { results } = await env.DB.prepare(
      "SELECT estado, COUNT(*) AS n FROM placas GROUP BY estado ORDER BY estado",
    ).all();
    expect(results).toEqual([
      { estado: "activa", n: 3 },
      { estado: "desactivada", n: 1 },
      { estado: "sin_activar", n: 2 },
    ]);
  });

  it("usan códigos válidos: 6 caracteres del alfabeto sin vocales", async () => {
    await ejecutarSql(datosDePrueba);
    const { results } = await env.DB.prepare("SELECT codigo FROM placas").all<{ codigo: string }>();
    for (const { codigo } of results) {
      expect(codigo).toMatch(/^[BCDFGHJKMNPQRSTVWXYZ2-9]{6}$/);
    }
  });
});
