// Rutas de una placa: formulario de activación y ficha (exigen sesión).
// Aquí llega quien escanea una placa con la sesión iniciada.
import { normalizarCodigo } from "../lib/codigos";
import { convertirLinkDeMaps } from "../lib/maps";
import { activarPlaca, buscarPlaca, esDestinoValido, validarNegocio } from "../lib/placas";
import { html, redirigirTrasEnvio } from "../lib/respuestas";
import { vistaAviso } from "../vistas/admin";
import { type EstadoDelFormulario, vistaActivacion, vistaFicha } from "../vistas/placas";
import { leerFormulario, type PeticionAdmin } from "./tipos";

/**
 * Calcula el destino a partir de lo escrito en el formulario.
 * Si hay link manual, manda ese; si no, se convierte el link de Maps.
 * Devuelve el estado con que debe mostrarse el formulario.
 */
async function revisar(campos: Record<string, string>): Promise<EstadoDelFormulario> {
  const manual = campos["manual"] ?? "";
  const link = campos["link"] ?? "";

  if (manual !== "") {
    if (!esDestinoValido(manual)) {
      return { campos, pedirManual: true, error: "El link de reseña debe empezar por https://" };
    }
    return { campos, pedirManual: true, destino: manual };
  }

  if (link === "") {
    return { campos, pedirManual: true, error: "Pega el link de Google Maps del negocio o su link de reseña." };
  }

  const conversion = await convertirLinkDeMaps(link);
  if (conversion.ok) return { campos, destino: conversion.destino };

  // No se pudo convertir: se pide el link de reseña a mano. Si lo pegado ya
  // era un link https (por ejemplo de Tripadvisor), se propone tal cual
  // para no tener que escribirlo de nuevo.
  return {
    campos: { ...campos, manual: esDestinoValido(link) ? link : "" },
    pedirManual: true,
    error: `${conversion.motivo} Pega abajo el link de reseña y pulsa "Revisar link".`,
  };
}

/** Devuelve la respuesta si la ruta es de una placa, o null si no. */
export async function rutasPlacas(p: PeticionAdmin): Promise<Response | null> {
  const coincide = /^\/admin\/placas\/([^/]+)(\/revisar|\/activar)?$/.exec(p.ruta);
  if (coincide === null) return null;
  const accion = coincide[2] ?? "";

  const codigo = normalizarCodigo(coincide[1] ?? "");
  const placa = codigo === null ? null : await buscarPlaca(p.env.DB, codigo);
  if (placa === null) {
    return html(vistaAviso("Placa no encontrada", "Ese código no existe."), "no-store", 404);
  }
  const fichaUrl = `/admin/placas/${placa.codigo}`;

  // GET /admin/placas/CODIGO : formulario si está sin activar; si no, ficha.
  if (accion === "" && p.metodo === "GET") {
    if (placa.estado === "sin_activar") return html(vistaActivacion(placa));
    const aviso = p.url.searchParams.get("aviso") === "activada" ? "Placa activada." : undefined;
    return html(vistaFicha(placa, aviso));
  }

  if (p.metodo !== "POST" || accion === "") return null;

  // Los dos envíos del formulario solo valen para una placa sin activar.
  if (placa.estado !== "sin_activar") return redirigirTrasEnvio(fichaUrl);

  const campos = await leerFormulario(p.solicitud);
  const datos = validarNegocio(campos);
  if (typeof datos === "string") {
    return html(vistaActivacion(placa, { campos, pedirManual: campos["manual"] !== undefined, error: datos }), "no-store", 400);
  }

  // POST .../revisar : convierte el link y muestra el destino. No guarda nada.
  if (accion === "/revisar") {
    const estado = await revisar(campos);
    return html(vistaActivacion(placa, estado), "no-store", estado.error === undefined ? 200 : 400);
  }

  // POST .../activar : guarda. Solo si el destino viene de una revisión y el
  // link no se cambió después de probarlo; si no, se revisa otra vez.
  const destino = campos["destino"] ?? "";
  const linkActual = campos["manual"] || campos["link"] || "";
  if (destino === "" || campos["revisado"] !== linkActual || !esDestinoValido(destino)) {
    const estado = await revisar(campos);
    if (estado.error === undefined) estado.error = "El link cambió. Prueba el destino otra vez antes de activar.";
    return html(vistaActivacion(placa, estado), "no-store", 400);
  }

  await activarPlaca(p.env.DB, placa.codigo, datos, destino, p.usuario.id);
  return redirigirTrasEnvio(`${fichaUrl}?aviso=activada`);
}
