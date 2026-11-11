// Tests de la etapa 6: login, cookie de sesión, límite de intentos y las
// cuatro combinaciones de sesión/estado al escanear una placa.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { NOMBRE_COOKIE, verificarClave } from "../src/lib/auth";
import { cabecerasConSesion, crearUsuario, pedir, vaciarBase } from "./ayudas";

const CLAVE = "Kx7mPq2RtW9zLb4N";
const DESTINO = "https://search.google.com/local/writereview?placeid=ChIJd47f2fnXbZERrQZbyDhq2y0";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";

let idUsuario = 0;

/** Envía el formulario de login como lo haría el navegador. */
function entrar(usuario: string, clave: string, origen = "https://tokaloperu.com"): Promise<Response> {
  return pedir("/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: origen },
    body: new URLSearchParams({ usuario, clave }).toString(),
  });
}

async function contarEscaneos(): Promise<number> {
  return (await env.DB.prepare("SELECT COUNT(*) AS n FROM escaneos").first<number>("n")) ?? -1;
}

beforeEach(async () => {
  await vaciarBase();
  idUsuario = await crearUsuario("rod", CLAVE);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO lotes (id, modelo, cantidad, creado_por, creado_en) VALUES (1, 'D', 3, ?, '2026-11-11T00:00:00Z')",
    ).bind(idUsuario),
    env.DB.prepare(
      "INSERT INTO placas (codigo, modelo, lote, estado, destino, creada_en) VALUES ('9M8CQ2', 'D', 1, 'activa', ?, '2026-11-11T00:00:00Z')",
    ).bind(DESTINO),
    env.DB.prepare(
      "INSERT INTO placas (codigo, modelo, lote, estado, creada_en) VALUES ('SFXPXP', 'D', 1, 'sin_activar', '2026-11-11T00:00:00Z')",
    ),
  ]);
});

describe("login", () => {
  it("con usuario y contraseña correctos crea la cookie y va al admin", async () => {
    const r = await entrar("rod", CLAVE);
    expect(r.status).toBe(303);
    expect(r.headers.get("Location")).toBe("/admin");

    const cookie = r.headers.get("Set-Cookie") ?? "";
    expect(cookie).toMatch(new RegExp(`^${NOMBRE_COOKIE}=\\d+\\.\\d+\\.[\\w-]+;`));
    expect(cookie).toContain("Max-Age=2592000"); // 30 días
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("HttpOnly");
    // Lax: la cookie viaja cuando el navegador se abre desde un toque NFC o un QR.
    expect(cookie).toContain("SameSite=Lax");
  });

  it("la cookie recibida da acceso al admin", async () => {
    const cookie = ((await entrar("rod", CLAVE)).headers.get("Set-Cookie") ?? "").split(";")[0] ?? "";
    const r = await pedir("/admin", { headers: { Cookie: cookie } });
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("Hola, Persona rod");
  });

  it("acepta el usuario con mayúsculas o espacios alrededor", async () => {
    expect((await entrar("  ROD ", CLAVE)).status).toBe(303);
  });

  it("contraseña incorrecta o usuario inexistente: mismo mensaje, sin cookie", async () => {
    const mala = await entrar("rod", "otra-clave");
    const inexistente = await entrar("nadie", CLAVE);
    for (const r of [mala, inexistente]) {
      expect(r.status).toBe(401);
      expect(r.headers.get("Set-Cookie")).toBeNull();
      expect(await r.text()).toContain("Usuario o contraseña incorrectos.");
    }
  });

  it("un usuario inactivo no entra aunque la contraseña sea correcta", async () => {
    await crearUsuario("exvendedor", CLAVE, false);
    const r = await entrar("exvendedor", CLAVE);
    expect(r.status).toBe(401);
    expect(r.headers.get("Set-Cookie")).toBeNull();
  });

  it("rechaza un formulario enviado desde otro sitio", async () => {
    const r = await entrar("rod", CLAVE, "https://sitio-malo.example");
    expect(r.headers.get("Set-Cookie")).toBeNull();
    expect(r.headers.get("Location")).toBe("/admin/login");
  });

  it("verifica un hash generado por scripts/crear_usuario.py", async () => {
    // Salida real de hash_clave('clave-de-prueba-123', bytes(range(16))) en Python.
    const dePython = "pbkdf2$25000$AAECAwQFBgcICQoLDA0ODw==$EhLXNrTDWYsKab9zZxgAnQdr1BjCW7NBQSLQABKTQ4k=";
    expect(await verificarClave("clave-de-prueba-123", dePython)).toBe(true);
    expect(await verificarClave("clave-de-prueba-124", dePython)).toBe(false);
    expect(await verificarClave("x", "formato-invalido")).toBe(false);
  });
});

describe("límite de intentos", () => {
  it("al quinto fallo bloquea, y ni la contraseña correcta entra", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await entrar("rod", "mala")).status).toBe(401);
    }
    const bloqueado = await entrar("rod", CLAVE);
    expect(bloqueado.status).toBe(429);
    expect(bloqueado.headers.get("Set-Cookie")).toBeNull();
    expect(await bloqueado.text()).toContain("Demasiados intentos");
  });

  it("pasado el bloqueo se puede volver a entrar", async () => {
    for (let i = 0; i < 5; i++) await entrar("rod", "mala");
    // Simulamos que ya pasaron los 15 minutos.
    await env.DB.prepare("UPDATE intentos_login SET bloqueado_hasta = '2020-01-01T00:00:00Z'").run();
    expect((await entrar("rod", CLAVE)).status).toBe(303);
  });

  it("entrar bien borra la cuenta de fallos", async () => {
    for (let i = 0; i < 4; i++) await entrar("rod", "mala");
    expect((await entrar("rod", CLAVE)).status).toBe(303);
    for (let i = 0; i < 4; i++) await entrar("rod", "mala");
    expect((await entrar("rod", CLAVE)).status).toBe(303); // no llegó a 5 seguidos
  });

  it("también bloquea nombres que no existen, para no revelar cuáles existen", async () => {
    for (let i = 0; i < 5; i++) await entrar("nadie", "mala");
    expect((await entrar("nadie", "mala")).status).toBe(429);
  });
});

describe("admin sin sesión válida", () => {
  it("sin cookie redirige al login", async () => {
    for (const ruta of ["/admin", "/admin/", "/admin/placas/9M8CQ2", "/admin/lo-que-sea"]) {
      const r = await pedir(ruta);
      expect(r.status, ruta).toBe(303);
      expect(r.headers.get("Location"), ruta).toBe("/admin/login");
    }
  });

  it("GET /admin/login muestra el formulario", async () => {
    const r = await pedir("/admin/login");
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    expect(await r.text()).toContain('name="clave"');
  });

  it("una cookie alterada no vale y se borra", async () => {
    const buena = (await cabecerasConSesion(idUsuario)).Cookie ?? "";
    // Mismo texto pero con otro id de usuario: la firma ya no corresponde.
    const alterada = buena.replace(`=${idUsuario}.`, `=${idUsuario + 1}.`);
    const r = await pedir("/admin", { headers: { Cookie: alterada } });
    expect(r.headers.get("Location")).toBe("/admin/login");
    expect(r.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });

  it("una cookie vencida no vale", async () => {
    const ayer = Math.floor(Date.now() / 1000) - 86_400;
    const r = await pedir("/admin", { headers: await cabecerasConSesion(idUsuario, ayer) });
    expect(r.headers.get("Location")).toBe("/admin/login");
  });

  it("si desactivan al usuario, su cookie deja de valer en la siguiente solicitud", async () => {
    const cabeceras = await cabecerasConSesion(idUsuario);
    expect((await pedir("/admin", { headers: cabeceras })).status).toBe(200);

    await env.DB.prepare("UPDATE usuarios SET activo = 0 WHERE id = ?").bind(idUsuario).run();

    const r = await pedir("/admin", { headers: cabeceras });
    expect(r.headers.get("Location")).toBe("/admin/login");
    expect(r.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });

  it("cerrar sesión borra la cookie", async () => {
    const r = await pedir("/admin/salir", {
      method: "POST",
      headers: { ...(await cabecerasConSesion(idUsuario)), Origin: "https://tokaloperu.com" },
    });
    expect(r.status).toBe(303);
    expect(r.headers.get("Location")).toBe("/admin/login");
    expect(r.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });
});

describe("escanear una placa: las cuatro combinaciones", () => {
  it("sin sesión + placa activa: 302 al destino, y cuenta", async () => {
    const r = await pedir("/n/9M8CQ2", { headers: { "User-Agent": IPHONE } });
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")).toBe(DESTINO);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    expect(await contarEscaneos()).toBe(1);
  });

  it("sin sesión + sin activar: 302 a la landing", async () => {
    const r = await pedir("/n/SFXPXP", { headers: { "User-Agent": IPHONE } });
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")).toBe("/");
  });

  it("con sesión + sin activar: va a la página de la placa (activación)", async () => {
    const cabeceras = { ...(await cabecerasConSesion(idUsuario)), "User-Agent": IPHONE };
    const r = await pedir("/n/sfxpxp", { headers: cabeceras });
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")).toBe("/admin/placas/SFXPXP");

    const pagina = await pedir("/admin/placas/SFXPXP", { headers: cabeceras });
    expect(pagina.status).toBe(200);
    const cuerpo = await pagina.text();
    expect(cuerpo).toContain("SFXPXP");
    expect(cuerpo).toContain("Activar placa");
  });

  it("con sesión + placa activa: va a la ficha, no al destino, y no cuenta", async () => {
    const cabeceras = { ...(await cabecerasConSesion(idUsuario)), "User-Agent": IPHONE };
    const r = await pedir("/q/9M8CQ2", { headers: cabeceras });
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")).toBe("/admin/placas/9M8CQ2");

    const pagina = await pedir("/admin/placas/9M8CQ2", { headers: cabeceras });
    expect(await pagina.text()).toContain('<span class="estado activa">Activa</span>');
    expect(await contarEscaneos()).toBe(0);
  });

  it("con sesión + código inexistente: landing", async () => {
    const r = await pedir("/n/ZZZZZZ", { headers: await cabecerasConSesion(idUsuario) });
    expect(r.headers.get("Location")).toBe("/");
  });

  it("con cookie de un usuario desactivado: se trata como público, cuenta y borra la cookie", async () => {
    await env.DB.prepare("UPDATE usuarios SET activo = 0 WHERE id = ?").bind(idUsuario).run();
    const r = await pedir("/n/9M8CQ2", {
      headers: { ...(await cabecerasConSesion(idUsuario)), "User-Agent": IPHONE },
    });
    expect(r.headers.get("Location")).toBe(DESTINO);
    expect(r.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect(await contarEscaneos()).toBe(1);
  });
});
