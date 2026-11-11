// Rutas del catálogo de modelos (todas exigen sesión).
import { crearModelo, eliminarModelo, listarModelos, validarModelo } from "../lib/modelos";
import { html, redirigirTrasEnvio } from "../lib/respuestas";
import { vistaConfirmar } from "../vistas/admin";
import { vistaModelos } from "../vistas/modelos";
import { leerFormulario, type PeticionAdmin } from "./tipos";

const AVISOS: Record<string, { texto: string; esError: boolean }> = {
  creado: { texto: "Modelo creado.", esError: false },
  eliminado: { texto: "Modelo eliminado.", esError: false },
  "no-eliminado": { texto: "No se eliminó: el modelo no existe o tiene lotes o placas.", esError: true },
};

async function paginaModelos(env: Env, aviso?: { texto: string; esError: boolean }, estado = 200): Promise<Response> {
  return html(vistaModelos(await listarModelos(env.DB), aviso), "no-store", estado);
}

/** Devuelve la respuesta si la ruta es de modelos, o null si no le corresponde. */
export async function rutasModelos(p: PeticionAdmin): Promise<Response | null> {
  const { env, ruta, metodo } = p;

  if (ruta === "/admin/modelos" && metodo === "GET") {
    return paginaModelos(env, AVISOS[p.url.searchParams.get("aviso") ?? ""]);
  }

  if (ruta === "/admin/modelos" && metodo === "POST") {
    const modelo = validarModelo(await leerFormulario(p.solicitud));
    if (typeof modelo === "string") {
      return paginaModelos(env, { texto: modelo, esError: true }, 400);
    }
    if (!(await crearModelo(env.DB, modelo))) {
      return paginaModelos(env, { texto: `Ya existe un modelo con el id ${modelo.id}.`, esError: true }, 400);
    }
    return redirigirTrasEnvio("/admin/modelos?aviso=creado");
  }

  const eliminar = /^\/admin\/modelos\/([A-Za-z0-9]{1,3})\/eliminar$/.exec(ruta);
  if (eliminar !== null) {
    const id = (eliminar[1] ?? "").toUpperCase();
    if (metodo === "POST") {
      const eliminado = await eliminarModelo(env.DB, id);
      return redirigirTrasEnvio(`/admin/modelos?aviso=${eliminado ? "eliminado" : "no-eliminado"}`);
    }
    if (metodo === "GET") {
      return html(
        vistaConfirmar(
          `Eliminar modelo ${id}`,
          "Solo se puede eliminar un modelo que no tenga lotes ni placas. No se puede deshacer.",
          `/admin/modelos/${id}/eliminar`,
          "/admin/modelos",
        ),
      );
    }
  }

  return null;
}
