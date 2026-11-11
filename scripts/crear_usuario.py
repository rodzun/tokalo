#!/usr/bin/env python3
"""Crea un usuario de Tokalo o le cambia la contraseña.

Solo usa la librería estándar. La contraseña se genera aquí, se muestra UNA
vez en pantalla y en la base solo se guarda su hash.

Ejemplos (desde la carpeta del proyecto):

    python3 scripts/crear_usuario.py dev --usuario rod --nombre "Rodrigo"
    python3 scripts/crear_usuario.py produccion --usuario rod --nombre "Rodrigo"
    python3 scripts/crear_usuario.py produccion --usuario rod --cambiar-clave
    python3 scripts/crear_usuario.py dev --usuario rod --nombre "Rodrigo" --solo-sql
"""

import argparse
import base64
import hashlib
import re
import secrets
import subprocess
import sys
from datetime import datetime, timezone

# Debe coincidir con ITERACIONES en src/lib/auth.ts.
ITERACIONES = 25_000

# Caracteres de la contraseña: sin 0/O, 1/l/I, para poder copiarla a mano.
CARACTERES = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
LARGO_CLAVE = 16

# Base de datos de cada entorno y argumentos extra de wrangler.
ENTORNOS = {
    "dev": ("tokalo-dev", []),
    "produccion": ("tokalo", ["--env", "produccion"]),
}


def generar_clave() -> str:
    """Contraseña aleatoria de 16 caracteres (unos 93 bits de azar)."""
    return "".join(secrets.choice(CARACTERES) for _ in range(LARGO_CLAVE))


def hash_clave(clave: str, sal: bytes | None = None, iteraciones: int = ITERACIONES) -> str:
    """Devuelve 'pbkdf2$iteraciones$sal$hash', el formato que verifica el Worker."""
    if sal is None:
        sal = secrets.token_bytes(16)
    derivado = hashlib.pbkdf2_hmac("sha256", clave.encode("utf-8"), sal, iteraciones, dklen=32)
    return "pbkdf2${}${}${}".format(
        iteraciones,
        base64.b64encode(sal).decode("ascii"),
        base64.b64encode(derivado).decode("ascii"),
    )


def texto_sql(valor: str) -> str:
    """Encierra un texto entre comillas para SQL, duplicando las comillas internas."""
    return "'" + valor.replace("'", "''") + "'"


def main() -> int:
    parser = argparse.ArgumentParser(description="Crea un usuario de Tokalo o le cambia la contraseña.")
    parser.add_argument("entorno", choices=ENTORNOS, help="base de datos de destino")
    parser.add_argument("--usuario", required=True, help="nombre para entrar (minúsculas, sin espacios)")
    parser.add_argument("--nombre", help="nombre de la persona (obligatorio al crear)")
    parser.add_argument("--cambiar-clave", action="store_true", help="el usuario ya existe: solo nueva contraseña")
    parser.add_argument("--solo-sql", action="store_true", help="mostrar el SQL sin ejecutarlo")
    args = parser.parse_args()

    usuario = args.usuario.strip().lower()
    if not re.fullmatch(r"[a-z0-9._-]{3,32}", usuario):
        print("El usuario debe tener de 3 a 32 caracteres: letras, números, punto, guion.", file=sys.stderr)
        return 2
    if not args.cambiar_clave and not (args.nombre and args.nombre.strip()):
        print("Falta --nombre (obligatorio al crear un usuario).", file=sys.stderr)
        return 2

    clave = generar_clave()
    guardado = hash_clave(clave)

    if args.cambiar_clave:
        # También se borra la cuenta de intentos fallidos, por si estaba bloqueado.
        sql = (
            f"UPDATE usuarios SET hash_clave = {texto_sql(guardado)} WHERE usuario = {texto_sql(usuario)}; "
            f"DELETE FROM intentos_login WHERE usuario = {texto_sql(usuario)};"
        )
    else:
        ahora = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        sql = (
            "INSERT INTO usuarios (nombre, usuario, hash_clave, activo, creado_en) VALUES ("
            f"{texto_sql(args.nombre.strip())}, {texto_sql(usuario)}, {texto_sql(guardado)}, 1, {texto_sql(ahora)});"
        )

    base, extra = ENTORNOS[args.entorno]
    if args.solo_sql:
        print(sql)
    else:
        # Lista de argumentos (sin shell): nada de lo escrito se interpreta como comando.
        orden = ["npx", "wrangler", "d1", "execute", base, *extra, "--remote", "--command", sql]
        resultado = subprocess.run(orden, capture_output=True, text=True)
        if resultado.returncode != 0:
            print("No se pudo guardar en la base:", file=sys.stderr)
            print(resultado.stdout[-2000:], resultado.stderr[-2000:], file=sys.stderr)
            return 1

    accion = "Contraseña cambiada" if args.cambiar_clave else "Usuario creado"
    print(f"\n{accion} en '{args.entorno}'.")
    print(f"  Usuario:    {usuario}")
    print(f"  Contraseña: {clave}")
    print("\nGuárdala ahora: no se puede volver a ver, solo reemplazar.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
