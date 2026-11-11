// Códigos QR en SVG.
//
// Codificador propio, limitado a lo que Tokalo necesita:
//   - texto en "modo alfanumérico" (mayúsculas, dígitos y pocos símbolos),
//   - corrección de errores M (se lee aunque se dañe hasta un 15 %),
//   - QR de tamaño 1 a 3 (hasta 61 caracteres; nuestras URL tienen 31 a 51).
//
// ¿Por qué no una librería? La que se probó (qrcode-generator) gastaba de
// 3 a 33 ms de CPU por QR, y el plan gratuito de Cloudflare da 10 ms. Esta
// versión tarda menos de 1 ms. Esa librería se conserva solo para los
// tests, que comprueban que este archivo produce exactamente el mismo QR.

/**
 * URL que va dentro del QR de una placa, entera en MAYÚSCULAS: así puede
 * usar el modo alfanumérico, que ocupa menos y da cuadros más grandes,
 * más fáciles de leer impresos en pequeño.
 */
export function urlParaQr(urlBase: string, codigo: string): string {
  return `${urlBase}/q/${codigo}`.toUpperCase();
}

// ───────────────────────── 1. Texto -> bytes de datos ─────────────────────────

/** Los 45 caracteres del modo alfanumérico; la posición es su valor. */
const ALFANUMERICO = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

/**
 * Tamaños de QR admitidos ("versión" 1, 2 y 3) con corrección M.
 *   datos: bytes disponibles para el texto
 *   ec:    bytes de corrección de errores
 *   alineacion: fila/columna del cuadrito de alineación (0 = no tiene)
 */
const VERSIONES = [
  { datos: 16, ec: 10, alineacion: 0 },
  { datos: 28, ec: 16, alineacion: 18 },
  { datos: 44, ec: 26, alineacion: 22 },
] as const;

/** Bits que ocupa un texto: 4 de modo + 9 de longitud + 11 por par + 6 si sobra uno. */
function bitsNecesarios(largo: number): number {
  return 4 + 9 + 11 * Math.floor(largo / 2) + 6 * (largo % 2);
}

/** Convierte el texto en los bytes de datos del QR, rellenando hasta `capacidad`. */
function bytesDeDatos(texto: string, capacidad: number): number[] {
  const bits: number[] = [];
  /** Añade `valor` como `cantidad` bits, del más significativo al menos. */
  const poner = (valor: number, cantidad: number): void => {
    for (let i = cantidad - 1; i >= 0; i--) bits.push((valor >>> i) & 1);
  };

  poner(0b0010, 4); // indicador de modo alfanumérico
  poner(texto.length, 9);
  for (let i = 0; i < texto.length; i += 2) {
    const a = ALFANUMERICO.indexOf(texto.charAt(i));
    if (i + 1 < texto.length) {
      poner(a * 45 + ALFANUMERICO.indexOf(texto.charAt(i + 1)), 11); // un par
    } else {
      poner(a, 6); // el último, si la cantidad es impar
    }
  }

  // Terminador (4 ceros, si caben) y ceros hasta completar el byte.
  if (bits.length + 4 <= capacidad * 8) poner(0, 4);
  while (bits.length % 8 !== 0) bits.push(0);

  const bytes: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | (bits[i + j] ?? 0);
    bytes.push(byte);
  }
  // Relleno estándar: se alternan 0xEC y 0x11 hasta llenar la capacidad.
  for (let i = 0; bytes.length < capacidad; i++) bytes.push(i % 2 === 0 ? 0xec : 0x11);
  return bytes;
}

// ───────────────────────── 2. Corrección de errores ─────────────────────────
// Reed-Solomon: se añaden bytes calculados a partir de los datos, con los
// que el lector reconstruye el QR si una parte está dañada. La aritmética
// es la del "campo de Galois" de 256 elementos; las dos tablas permiten
// multiplicar sumando logaritmos.

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x;
  EXP[i + 255] = x;
  LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d; // polinomio del estándar QR
}

function multiplicar(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[(LOG[a] ?? 0) + (LOG[b] ?? 0)] ?? 0;
}

/** Calcula los `cantidad` bytes de corrección para `datos`. */
function bytesDeCorreccion(datos: readonly number[], cantidad: number): number[] {
  // Polinomio generador: (x - 2^0)(x - 2^1)...(x - 2^(cantidad-1)).
  let generador = [1];
  for (let i = 0; i < cantidad; i++) {
    const siguiente = new Array<number>(generador.length + 1).fill(0);
    generador.forEach((coef, j) => {
      siguiente[j] = (siguiente[j] ?? 0) ^ coef;
      siguiente[j + 1] = (siguiente[j + 1] ?? 0) ^ multiplicar(coef, EXP[i] ?? 0);
    });
    generador = siguiente;
  }
  // Resto de dividir los datos entre el generador: eso es la corrección.
  const resto = new Array<number>(cantidad).fill(0);
  for (const byte of datos) {
    const factor = byte ^ (resto.shift() ?? 0);
    resto.push(0);
    for (let j = 0; j < cantidad; j++) {
      resto[j] = (resto[j] ?? 0) ^ multiplicar(generador[j + 1] ?? 0, factor);
    }
  }
  return resto;
}

// ───────────────────────── 3. Cuadrícula ─────────────────────────
// La cuadrícula es una lista plana de lado x lado valores:
//   VACIO = todavía sin decidir, 0 = blanco, 1 = negro.

const VACIO = 2;

/** Las 8 "máscaras" del estándar: patrones que invierten cuadros para evitar zonas uniformes. */
const MASCARAS: ReadonlyArray<(f: number, c: number) => boolean> = [
  (f, c) => (f + c) % 2 === 0,
  (f) => f % 2 === 0,
  (_f, c) => c % 3 === 0,
  (f, c) => (f + c) % 3 === 0,
  (f, c) => (Math.floor(f / 2) + Math.floor(c / 3)) % 2 === 0,
  (f, c) => ((f * c) % 2) + ((f * c) % 3) === 0,
  (f, c) => (((f * c) % 2) + ((f * c) % 3)) % 2 === 0,
  (f, c) => (((f * c) % 3) + ((f + c) % 2)) % 2 === 0,
];

/** Los 15 bits de "formato": dicen al lector qué corrección y qué máscara se usó. */
function bitsDeFormato(mascara: number): number {
  // Nivel M se codifica como 00, así que el dato es solo el número de máscara.
  let resto = mascara << 10;
  for (let i = 14; i >= 10; i--) {
    if ((resto >>> i) & 1) resto ^= 0x537 << (i - 10);
  }
  return ((mascara << 10) | resto) ^ 0x5412;
}

/**
 * Arma la cuadrícula completa con una máscara.
 * `deVerdad = false` deja en blanco los bits de formato: así se comparan
 * las máscaras entre sí antes de elegir una.
 */
function armar(
  lado: number,
  alineacion: number,
  bytes: readonly number[],
  mascara: number,
  deVerdad: boolean,
): Uint8Array {
  const m = new Uint8Array(lado * lado).fill(VACIO);
  const poner = (f: number, c: number, negro: boolean): void => {
    m[f * lado + c] = negro ? 1 : 0;
  };

  // Los tres "ojos" de las esquinas (7x7) con su borde blanco alrededor.
  for (const [f0, c0] of [[0, 0], [lado - 7, 0], [0, lado - 7]] as const) {
    for (let f = -1; f <= 7; f++) {
      for (let c = -1; c <= 7; c++) {
        if (f0 + f < 0 || f0 + f >= lado || c0 + c < 0 || c0 + c >= lado) continue;
        const borde = f >= 0 && f <= 6 && c >= 0 && c <= 6 && (f === 0 || f === 6 || c === 0 || c === 6);
        const centro = f >= 2 && f <= 4 && c >= 2 && c <= 4;
        poner(f0 + f, c0 + c, borde || centro);
      }
    }
  }

  // Cuadrito de alineación (5x5), abajo a la derecha. El tamaño 1 no lleva.
  if (alineacion > 0) {
    for (let f = -2; f <= 2; f++) {
      for (let c = -2; c <= 2; c++) {
        poner(alineacion + f, alineacion + c, Math.abs(f) === 2 || Math.abs(c) === 2 || (f === 0 && c === 0));
      }
    }
  }

  // Líneas de sincronía: cuadros alternados en la fila 6 y la columna 6.
  for (let i = 8; i < lado - 8; i++) {
    poner(i, 6, i % 2 === 0);
    poner(6, i, i % 2 === 0);
  }

  // Bits de formato, repetidos en dos sitios, y el cuadro siempre negro.
  const formato = bitsDeFormato(mascara);
  for (let i = 0; i < 15; i++) {
    const negro = deVerdad && ((formato >>> i) & 1) === 1;
    poner(i < 6 ? i : i < 8 ? i + 1 : lado - 15 + i, 8, negro); // vertical
    poner(8, i < 8 ? lado - i - 1 : i < 9 ? 7 : 14 - i, negro); // horizontal
  }
  poner(lado - 8, 8, deVerdad);

  // Datos: se recorren las columnas de dos en dos, de derecha a izquierda,
  // subiendo y bajando en zigzag, y se llenan los cuadros aún vacíos.
  const enmascarar = MASCARAS[mascara] ?? (() => false);
  let direccion = -1;
  let fila = lado - 1;
  let bit = 0;
  for (let col = lado - 1; col > 0; col -= 2) {
    if (col === 6) col--; // la columna 6 es la línea de sincronía
    for (;;) {
      for (let k = 0; k < 2; k++) {
        const c = col - k;
        if (m[fila * lado + c] !== VACIO) continue;
        const byte = bytes[bit >>> 3];
        let negro = byte !== undefined && ((byte >>> (7 - (bit & 7))) & 1) === 1;
        if (enmascarar(fila, c)) negro = !negro;
        poner(fila, c, negro);
        bit++;
      }
      fila += direccion;
      if (fila < 0 || fila >= lado) {
        fila -= direccion;
        direccion = -direccion;
        break;
      }
    }
  }
  return m;
}

/**
 * Puntos de penalización de una cuadrícula: cuanto más bajo, más fácil de
 * leer. Mismas cuatro reglas que qrcode-generator, para elegir la misma máscara.
 */
function penalizacion(m: Uint8Array, lado: number): number {
  const en = (f: number, c: number): number => m[f * lado + c] ?? 0;
  let puntos = 0;

  // Regla 1: cuadros rodeados de muchos vecinos de su mismo color.
  for (let f = 0; f < lado; f++) {
    for (let c = 0; c < lado; c++) {
      const color = en(f, c);
      let iguales = 0;
      for (let df = -1; df <= 1; df++) {
        if (f + df < 0 || f + df >= lado) continue;
        for (let dc = -1; dc <= 1; dc++) {
          if (c + dc < 0 || c + dc >= lado || (df === 0 && dc === 0)) continue;
          if (en(f + df, c + dc) === color) iguales++;
        }
      }
      if (iguales > 5) puntos += 3 + iguales - 5;
    }
  }

  // Regla 2: bloques de 2x2 de un solo color.
  for (let f = 0; f < lado - 1; f++) {
    for (let c = 0; c < lado - 1; c++) {
      const suma = en(f, c) + en(f + 1, c) + en(f, c + 1) + en(f + 1, c + 1);
      if (suma === 0 || suma === 4) puntos += 3;
    }
  }

  // Regla 3: secuencias negro-blanco-negro-negro-negro-blanco-negro, que
  // se parecen a un "ojo" y confunden al lector. En filas y en columnas.
  for (let a = 0; a < lado; a++) {
    for (let b = 0; b < lado - 6; b++) {
      if (en(a, b) && !en(a, b + 1) && en(a, b + 2) && en(a, b + 3) && en(a, b + 4) && !en(a, b + 5) && en(a, b + 6)) {
        puntos += 40;
      }
      if (en(b, a) && !en(b + 1, a) && en(b + 2, a) && en(b + 3, a) && en(b + 4, a) && !en(b + 5, a) && en(b + 6, a)) {
        puntos += 40;
      }
    }
  }

  // Regla 4: que la proporción de negros se aleje del 50 %.
  let negros = 0;
  for (const valor of m) negros += valor;
  puntos += (Math.abs((100 * negros) / lado / lado - 50) / 5) * 10;

  return puntos;
}

/**
 * Calcula el QR de un texto. Devuelve la cuadrícula como lista de filas;
 * true = cuadro negro. Lanza un error si el texto no cabe o tiene
 * caracteres fuera del modo alfanumérico.
 */
export function matrizQr(texto: string): boolean[][] {
  for (const caracter of texto) {
    if (!ALFANUMERICO.includes(caracter)) {
      throw new Error(`El QR solo admite mayúsculas, dígitos y $%*+-./: (sobra "${caracter}")`);
    }
  }
  // El tamaño más pequeño en el que quepa el texto.
  const indice = VERSIONES.findIndex((v) => bitsNecesarios(texto.length) <= v.datos * 8);
  const version = VERSIONES[indice];
  if (version === undefined) throw new Error("Texto demasiado largo para el QR (máximo 61 caracteres)");
  const lado = 17 + 4 * (indice + 1); // 21, 25 o 29 cuadros

  const datos = bytesDeDatos(texto, version.datos);
  const bytes = [...datos, ...bytesDeCorreccion(datos, version.ec)];

  // Se prueban las 8 máscaras y se queda la de menor penalización.
  let mejor = 0;
  let minimo = Infinity;
  for (let mascara = 0; mascara < 8; mascara++) {
    const puntos = penalizacion(armar(lado, version.alineacion, bytes, mascara, false), lado);
    if (puntos < minimo) {
      minimo = puntos;
      mejor = mascara;
    }
  }

  const final = armar(lado, version.alineacion, bytes, mejor, true);
  const filas: boolean[][] = [];
  for (let f = 0; f < lado; f++) {
    const fila: boolean[] = [];
    for (let c = 0; c < lado; c++) fila.push(final[f * lado + c] === 1);
    filas.push(fila);
  }
  return filas;
}

// ───────────────────────── 4. Dibujo en SVG ─────────────────────────

/** Cuadros blancos de margen alrededor del QR (el estándar pide 4). */
const MARGEN = 4;

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
