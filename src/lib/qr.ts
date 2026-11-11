// Códigos QR en SVG.
//
// Codificador propio, limitado a lo que Tokalo necesita:
//   - texto en "modo alfanumérico" (mayúsculas, dígitos y pocos símbolos),
//   - corrección de errores M (se lee aunque se dañe hasta un 15 %),
//   - QR de tamaño 1 a 3 (hasta 61 caracteres; nuestras URL tienen 31 a 51).
//
// ¿Por qué no una librería? La que se probó (qrcode-generator) gastaba de
// 3 a 33 ms de CPU por QR, y el plan gratuito de Cloudflare da 10 ms. Esta
// versión hace mucho menos trabajo (medición en CLAUDE.md). Esa librería se conserva solo para los
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
// La cuadrícula es una lista plana de lado x lado valores (0 = blanco,
// 1 = negro); el cuadro de la fila f y columna c está en la posición
// f * lado + c.
//
// Este bloque está escrito pensando en la velocidad: Cloudflare ejecuta el
// código "en frío" (sin optimizar) casi siempre que se pide un QR, así que
// cada operación ahorrada cuenta. Por eso se usan listas de números
// (Uint8Array) y bucles simples en vez de funciones pequeñas.

/** Los 15 bits de "formato": dicen al lector qué corrección y qué máscara se usó. */
function bitsDeFormato(mascara: number): number {
  // Nivel M se codifica como 00, así que el dato es solo el número de máscara.
  let resto = mascara << 10;
  for (let i = 14; i >= 10; i--) {
    if ((resto >>> i) & 1) resto ^= 0x537 << (i - 10);
  }
  return ((mascara << 10) | resto) ^ 0x5412;
}

/** Lo que no depende del texto: se calcula una vez por tamaño de QR. */
interface Plantilla {
  lado: number;
  /** Cuadrícula con las partes fijas dibujadas y el resto en blanco. */
  base: Uint8Array;
  /** Posiciones de los cuadros de datos, en el orden en que se llenan. */
  celdas: Uint16Array;
  /** Fila y columna de cada cuadro de datos (para aplicar la máscara). */
  filas: Uint8Array;
  columnas: Uint8Array;
}

const plantillas: Array<Plantilla | undefined> = [];

function plantillaDe(indice: number, alineacion: number): Plantilla {
  const guardada = plantillas[indice];
  if (guardada !== undefined) return guardada;

  const lado = 17 + 4 * (indice + 1); // 21, 25 o 29 cuadros
  const base = new Uint8Array(lado * lado);
  const ocupado = new Uint8Array(lado * lado); // 1 = parte fija, no lleva datos
  const poner = (f: number, c: number, negro: boolean): void => {
    base[f * lado + c] = negro ? 1 : 0;
    ocupado[f * lado + c] = 1;
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

  // Sitio de los bits de formato (dos copias) y del cuadro siempre negro.
  // Aquí quedan en blanco; se pintan al final, cuando ya se eligió máscara.
  for (let i = 0; i < 15; i++) {
    poner(i < 6 ? i : i < 8 ? i + 1 : lado - 15 + i, 8, false);
    poner(8, i < 8 ? lado - i - 1 : i < 9 ? 7 : 14 - i, false);
  }
  poner(lado - 8, 8, false);

  // Orden de los datos: columnas de dos en dos, de derecha a izquierda,
  // subiendo y bajando en zigzag, saltando los cuadros ocupados.
  const orden: number[] = [];
  let direccion = -1;
  let fila = lado - 1;
  for (let col = lado - 1; col > 0; col -= 2) {
    if (col === 6) col--; // la columna 6 es la línea de sincronía
    for (;;) {
      for (let k = 0; k < 2; k++) {
        if (ocupado[fila * lado + col - k] === 0) orden.push(fila * lado + col - k);
      }
      fila += direccion;
      if (fila < 0 || fila >= lado) {
        fila -= direccion;
        direccion = -direccion;
        break;
      }
    }
  }

  const nueva: Plantilla = {
    lado,
    base,
    celdas: Uint16Array.from(orden),
    filas: Uint8Array.from(orden, (posicion) => Math.floor(posicion / lado)),
    columnas: Uint8Array.from(orden, (posicion) => posicion % lado),
  };
  plantillas[indice] = nueva;
  return nueva;
}

/**
 * Escribe los datos en la cuadrícula `g` aplicando una de las 8 máscaras
 * del estándar: patrones que invierten ciertos cuadros para que no queden
 * zonas uniformes. `bits` trae un 0 o un 1 por cada cuadro de datos.
 */
function ponerDatos(g: Uint8Array, p: Plantilla, bits: Uint8Array, mascara: number): void {
  const { celdas, filas, columnas } = p;
  for (let i = 0; i < celdas.length; i++) {
    const f = filas[i] as number;
    const c = columnas[i] as number;
    let invertir: boolean;
    switch (mascara) {
      case 0: invertir = (f + c) % 2 === 0; break;
      case 1: invertir = f % 2 === 0; break;
      case 2: invertir = c % 3 === 0; break;
      case 3: invertir = (f + c) % 3 === 0; break;
      case 4: invertir = ((f >> 1) + Math.floor(c / 3)) % 2 === 0; break;
      case 5: invertir = ((f * c) % 2) + ((f * c) % 3) === 0; break;
      case 6: invertir = (((f * c) % 2) + ((f * c) % 3)) % 2 === 0; break;
      default: invertir = (((f * c) % 3) + ((f + c) % 2)) % 2 === 0;
    }
    g[celdas[i] as number] = invertir ? (bits[i] as number) ^ 1 : (bits[i] as number);
  }
}

/**
 * Puntos de penalización de una cuadrícula: cuanto más bajo, más fácil de
 * leer. Son las cuatro reglas de qrcode-generator, para elegir siempre la
 * misma máscara que esa librería. `sumas` es espacio de trabajo reutilizable.
 */
function penalizacion(g: Uint8Array, lado: number, sumas: Uint8Array): number {
  let puntos = 0;
  let negros = 0;
  const ultimo = lado - 1;

  // Paso previo: para cada cuadro, cuántos negros hay entre él y sus dos
  // vecinos de la misma fila. Con eso, la regla 1 necesita 3 lecturas por
  // cuadro en vez de 8.
  for (let f = 0; f < lado; f++) {
    const inicio = f * lado;
    for (let c = 0; c < lado; c++) {
      const i = inicio + c;
      const valor = g[i] as number;
      negros += valor;
      sumas[i] = valor + (c > 0 ? (g[i - 1] as number) : 0) + (c < ultimo ? (g[i + 1] as number) : 0);
    }
  }

  // Regla 1: cuadros con más de 5 vecinos (de los 8 que lo rodean) de su mismo color.
  for (let f = 0; f < lado; f++) {
    const alto = f > 0 && f < ultimo ? 3 : 2; // filas que abarca la vecindad
    for (let c = 0; c < lado; c++) {
      const i = f * lado + c;
      // Negros en el bloque de 3x3 centrado en el cuadro (recortado en los bordes).
      const negrosCerca =
        (sumas[i] as number) + (f > 0 ? (sumas[i - lado] as number) : 0) + (f < ultimo ? (sumas[i + lado] as number) : 0);
      const vecinos = alto * (c > 0 && c < ultimo ? 3 : 2) - 1;
      const iguales = g[i] === 1 ? negrosCerca - 1 : vecinos - negrosCerca;
      if (iguales > 5) puntos += iguales - 2;
    }
  }

  // Regla 2: bloques de 2x2 de un solo color.
  for (let f = 0; f < ultimo; f++) {
    for (let c = 0; c < ultimo; c++) {
      const i = f * lado + c;
      const suma = (g[i] as number) + (g[i + 1] as number) + (g[i + lado] as number) + (g[i + lado + 1] as number);
      if (suma === 0 || suma === 4) puntos += 3;
    }
  }

  // Regla 3: secuencias negro-blanco-negro-negro-negro-blanco-negro, que
  // se parecen a un "ojo" y confunden al lector. En filas y en columnas.
  for (let a = 0; a < lado; a++) {
    for (let b = 0; b < lado - 6; b++) {
      let i = a * lado + b; // en la fila a, empezando en la columna b
      if (g[i] === 1 && g[i + 1] === 0 && g[i + 2] === 1 && g[i + 3] === 1 && g[i + 4] === 1 && g[i + 5] === 0 && g[i + 6] === 1) {
        puntos += 40;
      }
      i = b * lado + a; // en la columna a, empezando en la fila b
      if (
        g[i] === 1 && g[i + lado] === 0 && g[i + 2 * lado] === 1 && g[i + 3 * lado] === 1 &&
        g[i + 4 * lado] === 1 && g[i + 5 * lado] === 0 && g[i + 6 * lado] === 1
      ) {
        puntos += 40;
      }
    }
  }

  // Regla 4: que la proporción de negros se aleje del 50 %.
  puntos += (Math.abs((100 * negros) / lado / lado - 50) / 5) * 10;

  return puntos;
}

/** Calcula la cuadrícula final de un texto. Devuelve la lista plana y su lado. */
function cuadricula(texto: string): { g: Uint8Array; lado: number } {
  for (const caracter of texto) {
    if (!ALFANUMERICO.includes(caracter)) {
      throw new Error(`El QR solo admite mayúsculas, dígitos y $%*+-./: (sobra "${caracter}")`);
    }
  }
  // El tamaño más pequeño en el que quepa el texto.
  const indice = VERSIONES.findIndex((v) => bitsNecesarios(texto.length) <= v.datos * 8);
  const version = VERSIONES[indice];
  if (version === undefined) throw new Error("Texto demasiado largo para el QR (máximo 61 caracteres)");

  const p = plantillaDe(indice, version.alineacion);
  const { lado } = p;

  // Bytes finales (datos + corrección) convertidos a un bit por cuadro.
  // Los cuadros que sobran al final quedan en 0, como pide el estándar.
  const datos = bytesDeDatos(texto, version.datos);
  const bytes = [...datos, ...bytesDeCorreccion(datos, version.ec)];
  const bits = new Uint8Array(p.celdas.length);
  for (let i = 0; i < bytes.length * 8; i++) {
    bits[i] = ((bytes[i >>> 3] as number) >>> (7 - (i & 7))) & 1;
  }

  // Se prueban las 8 máscaras y se queda la de menor penalización.
  const g = new Uint8Array(p.base); // copia de las partes fijas
  const sumas = new Uint8Array(lado * lado);
  let mejor = 0;
  let minimo = Infinity;
  for (let mascara = 0; mascara < 8; mascara++) {
    ponerDatos(g, p, bits, mascara);
    const puntos = penalizacion(g, lado, sumas);
    if (puntos < minimo) {
      minimo = puntos;
      mejor = mascara;
    }
  }

  // Cuadrícula definitiva: datos con la máscara elegida, bits de formato
  // (repetidos en dos sitios) y el cuadro que siempre es negro.
  ponerDatos(g, p, bits, mejor);
  const formato = bitsDeFormato(mejor);
  for (let i = 0; i < 15; i++) {
    const bit = (formato >>> i) & 1;
    g[(i < 6 ? i : i < 8 ? i + 1 : lado - 15 + i) * lado + 8] = bit; // vertical
    g[8 * lado + (i < 8 ? lado - i - 1 : i < 9 ? 7 : 14 - i)] = bit; // horizontal
  }
  g[(lado - 8) * lado + 8] = 1;

  return { g, lado };
}

/**
 * Calcula el QR de un texto como lista de filas; true = cuadro negro.
 * Lanza un error si el texto no cabe o tiene caracteres fuera del modo
 * alfanumérico. (La usan los tests; el SVG trabaja con la lista plana.)
 */
export function matrizQr(texto: string): boolean[][] {
  const { g, lado } = cuadricula(texto);
  const filas: boolean[][] = [];
  for (let f = 0; f < lado; f++) {
    const fila: boolean[] = [];
    for (let c = 0; c < lado; c++) fila.push(g[f * lado + c] === 1);
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
  const { g, lado } = cuadricula(texto);
  const total = lado + 2 * MARGEN;

  // Un rectángulo por cada tramo horizontal de cuadros negros seguidos.
  // "M x y" mueve el lápiz; "h" y "v" trazan líneas; "z" cierra la figura.
  let trazo = "";
  for (let f = 0; f < lado; f++) {
    let c = 0;
    while (c < lado) {
      if (g[f * lado + c] !== 1) {
        c++;
        continue;
      }
      const inicio = c;
      while (c < lado && g[f * lado + c] === 1) c++;
      trazo += `M${inicio + MARGEN} ${f + MARGEN}h${c - inicio}v1h-${c - inicio}z`;
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="#fff"/>` +
    `<path d="${trazo}" fill="#000"/></svg>`
  );
}
