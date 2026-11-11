// Tests de la etapa 1: enrutador mínimo y red de seguridad.
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { atender, type Enrutador } from "../src/index";

const BASE = "https://tokaloperu.com";

/** Llama al Worker completo, igual que lo haría Cloudflare. */
async function pedir(ruta: string, opciones?: RequestInit): Promise<Response> {
  const ctx = createExecutionContext();
  const respuesta = await worker.fetch(new Request(BASE + ruta, opciones), env, ctx);
  await waitOnExecutionContext(ctx);
  return respuesta;
}

/** Llama a `atender` con un enrutador que siempre falla. */
async function pedirConFallo(ruta: string): Promise<Response> {
  const roto: Enrutador = async () => {
    throw new Error("fallo forzado");
  };
  const ctx = createExecutionContext();
  const respuesta = await atender(new Request(BASE + ruta), env, ctx, roto);
  await waitOnExecutionContext(ctx);
  return respuesta;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("enrutador", () => {
  it("GET / responde 200", async () => {
    const r = await pedir("/");
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("Tokalo");
  });

  it("una ruta desconocida redirige a la landing", async () => {
    const r = await pedir("/no-existe");
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")).toBe("/");
    expect(r.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("red de seguridad", () => {
  it("un error en una ruta cualquiera redirige a la landing, sin 500", async () => {
    const registro = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await pedirConFallo("/n/XK7P2M");
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")).toBe("/");
    expect(registro).toHaveBeenCalledOnce();
  });

  it("un error al servir / responde la página fija, sin redirigir a /", async () => {
    const registro = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await pedirConFallo("/");
    expect(r.status).toBe(200);
    expect(r.headers.get("Location")).toBeNull();
    expect(r.headers.get("Content-Type")).toContain("text/html");
    expect(await r.text()).toContain("Tokalo");
    expect(registro).toHaveBeenCalledOnce();
  });

  it("el error atrapado queda registrado con ruta y mensaje", async () => {
    const registro = vi.spyOn(console, "error").mockImplementation(() => {});
    await pedirConFallo("/n/XK7P2M?dato=secreto");
    expect(registro).toHaveBeenCalledWith(
      "error_atrapado",
      expect.objectContaining({ metodo: "GET", ruta: "/n/XK7P2M", mensaje: "fallo forzado" }),
    );
  });
});
