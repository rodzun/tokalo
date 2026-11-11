// Rutas de /admin: login, cierre de sesión y páginas que exigen sesión.
import {
  BLOQUEO_MIN,
  cookieBorrada,
  cookieDeSesion,
  iniciarSesion,
  leerSesion,
  traeCookie,
} from "../lib/auth";
import { normalizarCodigo } from "../lib/codigos";
import { html, redirigirTrasEnvio } from "../lib/respuestas";
import { vistaAviso, vistaInicio, vistaLogin, vistaPlacaProvisional } from "../vistas/admin";

/**
 * True si un formulario fue enviado desde nuestro propio sitio.
 * Los navegadores mandan la cabecera Origin en los POST; si viene de otro
 * sitio, es un intento de enviar el formulario a espaldas del usuario.
 */
function vieneDeNuestroSitio(solicitud: Request, url: URL): boolean {
  const origen = solicitud.headers.get("Origin");
  return origen === null || origen === url.origin;
}

/** POST /admin/login */
async function procesarLogin(solicitud: Request, env: Env): Promise<Response> {
  const formulario = await solicitud.formData();
  const campoUsuario = formulario.get("usuario");
  const campoClave = formulario.get("clave");
  // Los nombres de usuario se guardan en minúsculas y sin espacios alrededor.
  const usuario = typeof campoUsuario === "string" ? campoUsuario.trim().toLowerCase() : "";
  const clave = typeof campoClave === "string" ? campoClave : "";

  // Entradas vacías o absurdamente largas: ni se consulta la base.
  if (usuario === "" || clave === "" || usuario.length > 64 || clave.length > 200) {
    return html(vistaLogin("Usuario o contraseña incorrectos."), "no-store", 401);
  }

  const resultado = await iniciarSesion(env.DB, usuario, clave);
  if (resultado.ok) {
    return redirigirTrasEnvio("/admin", await cookieDeSesion(env, resultado.usuario.id));
  }
  if (resultado.motivo === "bloqueado") {
    return html(vistaLogin(`Demasiados intentos. Espera ${BLOQUEO_MIN} minutos.`), "no-store", 429);
  }
  // Mismo mensaje exista o no el usuario.
  return html(vistaLogin("Usuario o contraseña incorrectos."), "no-store", 401);
}

/** Atiende todo lo que empieza por /admin. */
export async function enrutarAdmin(solicitud: Request, env: Env, url: URL): Promise<Response> {
  const ruta = url.pathname.replace(/\/+$/, ""); // "/admin/" -> "/admin"
  const metodo = solicitud.method;

  // Ningún formulario se acepta si lo envía otro sitio.
  if (metodo === "POST" && !vieneDeNuestroSitio(solicitud, url)) {
    return redirigirTrasEnvio("/admin/login");
  }

  const usuario = await leerSesion(solicitud, env);

  // ── Rutas que no exigen sesión ──
  if (ruta === "/admin/login") {
    if (metodo === "POST") return procesarLogin(solicitud, env);
    if (usuario !== null) return redirigirTrasEnvio("/admin"); // ya está dentro
    return html(vistaLogin());
  }
  if (ruta === "/admin/salir" && metodo === "POST") {
    return redirigirTrasEnvio("/admin/login", cookieBorrada());
  }

  // ── De aquí en adelante, solo con sesión ──
  if (usuario === null) {
    // Si traía una cookie que ya no vale, se la borramos.
    return redirigirTrasEnvio("/admin/login", traeCookie(solicitud) ? cookieBorrada() : undefined);
  }

  if (metodo === "GET" || metodo === "HEAD") {
    if (ruta === "/admin") return html(vistaInicio(usuario.nombre));

    // /admin/placas/CODIGO : a donde llega quien escanea una placa con sesión.
    const coincide = /^\/admin\/placas\/([^/]+)$/.exec(ruta);
    if (coincide !== null) {
      const codigo = normalizarCodigo(coincide[1] ?? "");
      const estado =
        codigo === null
          ? null
          : await env.DB.prepare("SELECT estado FROM placas WHERE codigo = ?").bind(codigo).first<string>("estado");
      if (codigo === null || estado === null) {
        return html(vistaAviso("Placa no encontrada", "Ese código no existe."), "no-store", 404);
      }
      return html(vistaPlacaProvisional(codigo, estado));
    }
  }

  // Ruta del admin que no existe: al inicio.
  return redirigirTrasEnvio("/admin");
}
