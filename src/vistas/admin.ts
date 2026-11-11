// Páginas del admin. Cada función devuelve el HTML completo de una pantalla.
import { escapar, pagina } from "../lib/html";

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
  return pagina(
    "Admin · Tokalo",
    `<h2>Hola, ${escapar(nombre)}</h2>
<p>Sesión iniciada. Acerca el celular a una placa para activarla o ver su ficha.</p>
${BOTON_SALIR}`,
  );
}

/** Página provisional de una placa. El formulario y la ficha llegan después. */
export function vistaPlacaProvisional(codigo: string, estado: string): string {
  const textos: Record<string, string> = {
    sin_activar: "Sin activar. Aquí irá el formulario de activación.",
    activa: "Activa. Aquí irá la ficha de la placa.",
    desactivada: "Desactivada. Aquí irá la ficha, con el botón para reactivarla.",
  };
  return pagina(
    `Placa ${codigo} · Tokalo`,
    `<h2>Placa</h2>
<p class="dato">${escapar(codigo)}</p>
<p>${escapar(textos[estado] ?? estado)}</p>
<p><a href="/admin">Volver al inicio</a></p>`,
  );
}

/** Aviso genérico dentro del admin (por ejemplo, placa que no existe). */
export function vistaAviso(titulo: string, mensaje: string): string {
  return pagina(
    `${titulo} · Tokalo`,
    `<h2>${escapar(titulo)}</h2>
<p>${escapar(mensaje)}</p>
<p><a href="/admin">Volver al inicio</a></p>`,
  );
}
