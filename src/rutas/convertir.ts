// Ruta "Convertir link" (exige sesión).
import { convertirLinkDeMaps } from "../lib/maps";
import { html } from "../lib/respuestas";
import { vistaConvertir } from "../vistas/convertir";
import { leerFormulario, type PeticionAdmin } from "./tipos";

/** Devuelve la respuesta si la ruta es /admin/convertir, o null si no. */
export async function rutasConvertir(p: PeticionAdmin): Promise<Response | null> {
  if (p.ruta !== "/admin/convertir") return null;

  if (p.metodo === "GET") return html(vistaConvertir());

  if (p.metodo === "POST") {
    const pegado = ((await leerFormulario(p.solicitud))["link"] ?? "").slice(0, 2000);
    return html(vistaConvertir(pegado, await convertirLinkDeMaps(pegado)));
  }
  return null;
}
