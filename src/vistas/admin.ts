// Páginas del admin. Cada función devuelve el HTML completo de una pantalla.
import { escapar, pagina } from "../lib/html";

/** Menú que encabeza las páginas del admin. */
const MENU = `<nav><a href="/admin/placas">Placas</a><a href="/admin/lotes">Lotes</a><a href="/admin/modelos">Modelos</a><a href="/admin/reportes">Reportes</a><a href="/admin/convertir">Convertir</a><a href="/admin">Cuenta</a></nav>`;

/** Página del admin: con menú y alineada a la izquierda. */
export function paginaAdmin(titulo: string, contenido: string): string {
  return pagina(`${titulo} · Tokalo`, MENU + contenido, "admin");
}

/** Mensaje de resultado: verde si salió bien, rojo si es un error. */
export function mensaje(texto: string | undefined, esError = false): string {
  if (texto === undefined) return "";
  return `<p class="${esError ? "aviso" : "ok"}">${escapar(texto)}</p>`;
}

/** Formulario de login. `aviso` es el mensaje de error, si lo hay. */
export function vistaLogin(aviso?: string): string {
  return pagina(
    "Entrar · Tokalo",
    `<h2>Entrar</h2>
${aviso === undefined ? "" : `<p class="aviso">${escapar(aviso)}</p>`}
<form method="post" action="/admin/login">
<label for="usuario">Usuario</label>
<input id="usuario" name="usuario" autocomplete="username" autocapitalize="none" autocorrect="off" required>
<label for="clave">Contraseña</label>
<input id="clave" name="clave" type="password" autocomplete="current-password" required>
<button>Entrar</button>
</form>`,
  );
}

/** Botón para cerrar sesión (es un formulario: cerrar sesión cambia estado). */
const BOTON_SALIR = `<form method="post" action="/admin/salir">
<button class="secundario">Cerrar sesión</button>
</form>`;

/** Portada del admin. Provisional: la lista de placas llega más adelante. */
export function vistaInicio(nombre: string): string {
  return paginaAdmin(
    "Admin",
    `<h2>Hola, ${escapar(nombre)}</h2>
<p>Acerca el celular a una placa para activarla o ver su ficha.</p>
<p><a class="boton" href="/admin/placas">Ver todas las placas</a></p>
${BOTON_SALIR}`,
  );
}

/** Aviso genérico dentro del admin (por ejemplo, placa que no existe). */
export function vistaAviso(titulo: string, texto: string): string {
  return paginaAdmin(titulo, `<h2>${escapar(titulo)}</h2>\n<p>${escapar(texto)}</p>`);
}

/**
 * Pantalla de confirmación antes de una acción delicada (eliminar, desactivar).
 * `accion` es la ruta a la que se envía el formulario si se confirma.
 */
export function vistaConfirmar(
  titulo: string,
  texto: string,
  accion: string,
  volver: string,
  textoBoton = "Sí, eliminar",
): string {
  return paginaAdmin(
    titulo,
    `<h2>${escapar(titulo)}</h2>
<p>${escapar(texto)}</p>
<form method="post" action="${escapar(accion)}">
<button class="peligro">${escapar(textoBoton)}</button>
</form>
<p style="margin-top:1rem"><a href="${escapar(volver)}">No, volver</a></p>`,
  );
}
