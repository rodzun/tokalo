// Rutas de placas (exigen sesión): lista, activación, ficha y sus cambios.
// A /admin/placas/CODIGO llega quien escanea una placa con la sesión iniciada.
import { normalizarCodigo } from "../lib/codigos";
import { convertirLinkDeMaps } from "../lib/maps";
import {
  activarPlaca,
  buscarPlaca,
  cambiarDestino,
  desactivarPlaca,
  editarNegocio,
  esDestinoValido,
  historialDe,
  listarPlacas,
  type Placa,
  reactivarPlaca,
  validarNegocio,
} from "../lib/placas";
import { destinoCoincide, nombreDePlataforma } from "../lib/plataformas";
import { html, redirigirTrasEnvio } from "../lib/respuestas";
import { vistaAviso, vistaConfirmar } from "../vistas/admin";
import {
  type EstadoDelFormulario,
  type FiltrosEnPantalla,
  vistaActivacion,
  vistaCambioDestino,
  vistaEditar,
  vistaFicha,
  vistaLista,
} from "../vistas/placas";
import { leerFormulario, type PeticionAdmin } from "./tipos";

/** Mensajes de la ficha tras una acción, según ?aviso=... en la URL. */
const AVISOS: Record<string, string> = {
  activada: "Placa activada.",
  destino: "Destino cambiado.",
  "mismo-destino": "El destino ya era ese; no se cambió nada.",
  datos: "Datos guardados.",
  desactivada: "Placa desactivada. Quien la escanee irá a la página de inicio.",
  reactivada: "Placa reactivada.",
};

/**
 * Calcula el destino a partir de lo escrito en el formulario, según la
 * plataforma del modelo. Devuelve el estado con que debe mostrarse el formulario.
 */
async function revisar(campos: Record<string, string>, plataforma: string): Promise<EstadoDelFormulario> {
  const link = campos["link"] ?? "";
  const nombre = nombreDePlataforma(plataforma);

  // Plataformas que no son Google: el link del negocio se usa tal cual.
  if (plataforma !== "google") {
    if (link === "") return { campos, error: `Pega el link del negocio en ${nombre}.` };
    if (!esDestinoValido(link)) return { campos, error: "El link debe empezar por https://" };
    return {
      campos,
      destino: link,
      advertencia: destinoCoincide(plataforma, link) ? undefined : `Este link no parece de ${nombre}. Comprueba que sea el correcto.`,
    };
  }

  // Google: si hay link de reseña pegado a mano, manda ese.
  const manual = campos["manual"] ?? "";
  if (manual !== "") {
    if (!esDestinoValido(manual)) {
      return { campos, pedirManual: true, error: "El link de reseña debe empezar por https://" };
    }
    return {
      campos,
      pedirManual: true,
      destino: manual,
      advertencia: destinoCoincide("google", manual) ? undefined : "Este link no es de Google. Comprueba que sea el correcto.",
    };
  }
  if (link === "") {
    return { campos, pedirManual: true, error: "Pega el link de Google Maps del negocio o su link de reseña." };
  }

  const conversion = await convertirLinkDeMaps(link);
  if (conversion.ok) return { campos, destino: conversion.destino };

  // No se pudo convertir: se pide el link de reseña a mano. Si lo pegado ya
  // era un link https, se propone tal cual para no escribirlo de nuevo.
  return {
    campos: { ...campos, manual: esDestinoValido(link) ? link : "" },
    pedirManual: true,
    error: `${conversion.motivo} Pega abajo el link de reseña y pulsa "Revisar link".`,
  };
}

/**
 * Destino listo para guardar, o null si hay que revisar de nuevo: solo vale
 * el destino que salió de una revisión, y solo si el link no se cambió
 * después de probarlo.
 */
function destinoRevisado(campos: Record<string, string>): string | null {
  const destino = campos["destino"] ?? "";
  const linkActual = campos["manual"] || campos["link"] || "";
  if (destino === "" || campos["revisado"] !== linkActual || !esDestinoValido(destino)) return null;
  return destino;
}

/** Vuelve a mostrar un formulario pidiendo revisar el link otra vez. */
async function pedirRevision(campos: Record<string, string>, plataforma: string): Promise<EstadoDelFormulario> {
  const estado = await revisar(campos, plataforma);
  estado.error ??= "El link cambió. Prueba el destino otra vez antes de guardar.";
  return estado;
}

/** GET /admin/placas : la lista, con filtros. */
async function lista(p: PeticionAdmin): Promise<Response> {
  const q = p.url.searchParams;
  const filtros: FiltrosEnPantalla = {
    estado: q.get("estado") ?? "",
    plataforma: q.get("plataforma") ?? "",
    busqueda: (q.get("q") ?? "").trim().slice(0, 80),
    soloNoCoinciden: q.get("revisar") === "1",
    pagina: Math.min(Math.max(Number.parseInt(q.get("pagina") ?? "1", 10) || 1, 1), 10_000),
  };
  const { placas, hayMas } = await listarPlacas(p.env.DB, filtros);
  return html(vistaLista(placas, filtros, hayMas));
}

/** Formularios de una placa SIN activar: revisar y activar. */
async function activacion(p: PeticionAdmin, placa: Placa, accion: string): Promise<Response> {
  const campos = await leerFormulario(p.solicitud);
  const datos = validarNegocio(campos);
  if (typeof datos === "string") {
    return html(vistaActivacion(placa, { campos, pedirManual: campos["manual"] !== undefined, error: datos }), "no-store", 400);
  }

  // POST .../revisar : calcula el destino y lo muestra. No guarda nada.
  if (accion === "/revisar") {
    const estado = await revisar(campos, placa.plataforma);
    return html(vistaActivacion(placa, estado), "no-store", estado.error === undefined ? 200 : 400);
  }

  // POST .../activar : guarda.
  const destino = destinoRevisado(campos);
  if (destino === null) {
    return html(vistaActivacion(placa, await pedirRevision(campos, placa.plataforma)), "no-store", 400);
  }
  await activarPlaca(p.env.DB, placa.codigo, datos, destino, p.usuario.id);
  return redirigirTrasEnvio(`/admin/placas/${placa.codigo}?aviso=activada`);
}

/** Devuelve la respuesta si la ruta es de placas, o null si no. */
export async function rutasPlacas(p: PeticionAdmin): Promise<Response | null> {
  if (p.ruta === "/admin/placas" && p.metodo === "GET") return lista(p);

  const coincide = /^\/admin\/placas\/([^/]+)((?:\/[a-z]+){0,2})$/.exec(p.ruta);
  if (coincide === null) return null;
  const accion = coincide[2] ?? "";

  const codigo = normalizarCodigo(coincide[1] ?? "");
  const placa = codigo === null ? null : await buscarPlaca(p.env.DB, codigo);
  if (placa === null) {
    return html(vistaAviso("Placa no encontrada", "Ese código no existe."), "no-store", 404);
  }
  const db = p.env.DB;
  const ficha = `/admin/placas/${placa.codigo}`;
  const esGet = p.metodo === "GET";
  const esPost = p.metodo === "POST";

  // GET /admin/placas/CODIGO : formulario si está sin activar; si no, ficha.
  if (accion === "" && esGet) {
    if (placa.estado === "sin_activar") return html(vistaActivacion(placa));
    return html(vistaFicha(placa, await historialDe(db, placa.codigo), AVISOS[p.url.searchParams.get("aviso") ?? ""]));
  }

  // ── Placa sin activar: solo admite revisar y activar ──
  if (placa.estado === "sin_activar") {
    if (esPost && (accion === "/revisar" || accion === "/activar")) return activacion(p, placa, accion);
    return redirigirTrasEnvio(ficha);
  }

  // ── Placa ya activada (activa o desactivada) ──

  // Editar los datos del negocio.
  if (accion === "/editar") {
    if (esGet) {
      const actuales = { negocio: placa.negocio ?? "", responsable: placa.responsable ?? "", telefono: placa.telefono ?? "" };
      return html(vistaEditar(placa, { campos: actuales }));
    }
    if (esPost) {
      const campos = await leerFormulario(p.solicitud);
      const datos = validarNegocio(campos);
      if (typeof datos === "string") return html(vistaEditar(placa, { campos, error: datos }), "no-store", 400);
      await editarNegocio(db, placa.codigo, datos);
      return redirigirTrasEnvio(`${ficha}?aviso=datos`);
    }
  }

  // Reactivar una placa desactivada.
  if (accion === "/reactivar" && esPost) {
    const hecho = await reactivarPlaca(db, placa.codigo);
    return redirigirTrasEnvio(hecho ? `${ficha}?aviso=reactivada` : ficha);
  }

  // Lo que sigue solo vale para una placa ACTIVA.
  if (placa.estado !== "activa") return redirigirTrasEnvio(ficha);

  // Desactivar: GET pide confirmación, POST desactiva.
  if (accion === "/desactivar") {
    if (esPost) {
      await desactivarPlaca(db, placa.codigo);
      return redirigirTrasEnvio(`${ficha}?aviso=desactivada`);
    }
    return html(
      vistaConfirmar(
        `Desactivar ${placa.codigo}`,
        `Quien escanee la placa de "${placa.negocio ?? ""}" irá a la página de inicio en vez de a su destino. Se conservan todos los datos y se puede reactivar después.`,
        `${ficha}/desactivar`,
        ficha,
        "Sí, desactivar",
      ),
    );
  }

  // Cambiar destino: mismo flujo que la activación (revisar, probar, guardar).
  if (accion === "/destino" && esGet) return html(vistaCambioDestino(placa));
  if ((accion === "/destino/revisar" || accion === "/destino/guardar") && esPost) {
    const campos = await leerFormulario(p.solicitud);
    if (accion === "/destino/revisar") {
      const estado = await revisar(campos, placa.plataforma);
      return html(vistaCambioDestino(placa, estado), "no-store", estado.error === undefined ? 200 : 400);
    }
    const destino = destinoRevisado(campos);
    if (destino === null) {
      return html(vistaCambioDestino(placa, await pedirRevision(campos, placa.plataforma)), "no-store", 400);
    }
    const cambio = await cambiarDestino(db, placa.codigo, destino, p.usuario.id);
    return redirigirTrasEnvio(`${ficha}?aviso=${cambio ? "destino" : "mismo-destino"}`);
  }

  return redirigirTrasEnvio(ficha);
}
