// Códigos de placa: 6 caracteres de un alfabeto de 28.
// Consonantes sin la L y dígitos del 2 al 9. Sin vocales, para que nunca
// se formen palabras; sin 0, 1 ni L, para que no se confundan al leerlos.

export const ALFABETO = "BCDFGHJKMNPQRSTVWXYZ23456789";
export const LARGO_CODIGO = 6;

const FORMATO = new RegExp(`^[${ALFABETO}]{${LARGO_CODIGO}}$`);

/**
 * Pasa un código a mayúsculas y comprueba su formato.
 * Devuelve el código normalizado, o null si no puede ser un código de Tokalo.
 */
export function normalizarCodigo(texto: string): string | null {
  const codigo = texto.toUpperCase();
  return FORMATO.test(codigo) ? codigo : null;
}

// ───────────────────────── Generación ─────────────────────────

// Un byte aleatorio vale de 0 a 255. Como 256 no es múltiplo de 28, usar
// `byte % 28` directamente haría algunas letras un poco más probables.
// Solución: descartar los bytes de 252 a 255 (252 = 28 x 9) y pedir otro.
const LIMITE_SIN_SESGO = 256 - (256 % ALFABETO.length);

/**
 * Genera un código al azar con el generador criptográfico del sistema
 * (el equivalente a `secrets` en Python). No depende de fecha, lote ni
 * contador: conocer un código no ayuda a adivinar otro.
 */
export function generarCodigo(): string {
  let codigo = "";
  while (codigo.length < LARGO_CODIGO) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      if (byte < LIMITE_SIN_SESGO && codigo.length < LARGO_CODIGO) {
        codigo += ALFABETO[byte % ALFABETO.length];
      }
    }
  }
  return codigo;
}

/** Función que devuelve un código. Los tests pasan una propia para forzar choques. */
export type Generador = () => string;

/**
 * Genera `cantidad` códigos distintos entre sí y distintos de `evitar`.
 * (Que no existan ya en la base lo garantiza la clave primaria al insertar.)
 */
export function generarCodigosUnicos(
  cantidad: number,
  generador: Generador = generarCodigo,
  evitar: ReadonlySet<string> = new Set(),
): string[] {
  const codigos = new Set<string>();
  // Tope de intentos, para no quedar en un bucle si el generador está roto.
  for (let intentos = 0; codigos.size < cantidad; intentos++) {
    if (intentos > cantidad * 20 + 100) throw new Error("No se pudieron generar códigos únicos");
    const codigo = generador();
    if (!evitar.has(codigo)) codigos.add(codigo);
  }
  return [...codigos];
}
