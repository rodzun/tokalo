// Códigos QR en SVG.
//
// Usa la librería `qrcode-generator` (sin dependencias propias): codificar
// un QR a mano son cientos de líneas de matemática fácil de romper.
import qrcode from "qrcode-generator";

/**
 * URL que va dentro del QR de una placa, entera en MAYÚSCULAS.
 * Un QR con solo mayúsculas, dígitos y unos pocos símbolos puede usar el
 * "modo alfanumérico", que ocupa menos: sale un QR con cuadros más
 * grandes, más fácil de leer impreso en pequeño.
 */
export function urlParaQr(urlBase: string, codigo: string): string {
  return `${urlBase}/q/${codigo}`.toUpperCase();
}

/** Caracteres que admite el modo alfanumérico de un QR. */
const SOLO_ALFANUMERICO = /^[0-9A-Z $%*+\-./:]*$/;

/** Cuadros blancos de margen alrededor del QR (el estándar pide 4). */
const MARGEN = 4;

/**
 * Calcula el QR de un texto, con corrección de errores M (se puede leer
 * aunque se dañe hasta un 15 %). Devuelve la cuadrícula como lista de filas;
 * true = cuadro negro.
 */
export function matrizQr(texto: string): boolean[][] {
  const qr = qrcode(0, "M"); // 0 = que elija el tamaño más pequeño posible
  qr.addData(texto, SOLO_ALFANUMERICO.test(texto) ? "Alphanumeric" : "Byte");
  qr.make();
  const lado = qr.getModuleCount();
  const filas: boolean[][] = [];
  for (let f = 0; f < lado; f++) {
    const fila: boolean[] = [];
    for (let c = 0; c < lado; c++) fila.push(qr.isDark(f, c));
    filas.push(fila);
  }
  return filas;
}

/**
 * Dibuja el QR como SVG: vectorial, negro sobre blanco y sin tamaño fijo,
 * así que se puede escalar a cualquier medida sin perder nitidez.
 * Cada unidad del dibujo es un cuadro del QR.
 */
export function qrSvg(texto: string): string {
  const matriz = matrizQr(texto);
  const lado = matriz.length + 2 * MARGEN;

  // Un rectángulo por cada tramo horizontal de cuadros negros seguidos.
  // "M x y" mueve el lápiz; "h" y "v" trazan líneas; "z" cierra la figura.
  let trazo = "";
  matriz.forEach((fila, f) => {
    let c = 0;
    while (c < fila.length) {
      if (fila[c] !== true) {
        c++;
        continue;
      }
      const inicio = c;
      while (c < fila.length && fila[c] === true) c++;
      trazo += `M${inicio + MARGEN} ${f + MARGEN}h${c - inicio}v1h-${c - inicio}z`;
    }
  });

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lado} ${lado}" shape-rendering="crispEdges">` +
    `<rect width="${lado}" height="${lado}" fill="#fff"/>` +
    `<path d="${trazo}" fill="#000"/></svg>`
  );
}
