// Datos que recibe cada grupo de rutas del admin, ya con la sesión comprobada.
import type { Usuario } from "../lib/auth";

export interface PeticionAdmin {
  solicitud: Request;
  env: Env;
  url: URL;
  /** Ruta sin barra final: "/admin/lotes". */
  ruta: string;
  /** "GET", "POST"... (HEAD se trata como GET). */
  metodo: string;
  usuario: Usuario;
}

/**
 * Lee los campos de texto de un formulario enviado por POST.
 * Devuelve un diccionario {nombre: valor}, con los espacios de los extremos quitados.
 */
export async function leerFormulario(solicitud: Request): Promise<Record<string, string>> {
  const campos: Record<string, string> = {};
  for (const [nombre, valor] of await solicitud.formData()) {
    if (typeof valor === "string") campos[nombre] = valor.trim();
  }
  return campos;
}
