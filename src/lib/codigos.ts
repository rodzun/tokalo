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
