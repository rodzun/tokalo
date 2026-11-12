#!/usr/bin/env python3
"""Candado antes de desplegar a producción.

Aborta (código de salida 1) si la carpeta no coincide con lo guardado en git:
  - cualquier archivo con seguimiento que tenga cambios sin commit, o
  - cualquier archivo nuevo sin seguimiento dentro de src/ o migrations/.

Motivo: `wrangler deploy` sube lo que haya en la carpeta en ese instante, y
las migraciones se leen de migrations/. El 2026-11-12 un despliegue se llevó
a producción una migración y código a medio escribir.

Lo llama `npm run desplegar:produccion` antes de migrar y de subir el código.
"""
import subprocess
import sys

# Carpetas donde un archivo nuevo (sin seguimiento) también bloquea.
CARPETAS_VIGILADAS = ("src/", "migrations/")


def cambios_que_bloquean(salida_de_git: str) -> list[str]:
    """Recibe la salida de `git status --porcelain` y devuelve las líneas que
    impiden desplegar. Lista vacía = se puede desplegar.

    Cada línea es "XY ruta": dos letras de estado, un espacio y la ruta.
    "??" significa archivo sin seguimiento; cualquier otra cosa es un cambio
    sin commit en un archivo que git ya sigue.
    """
    bloquean = []
    for linea in salida_de_git.splitlines():
        if len(linea) < 4:
            continue
        estado, ruta = linea[:2], linea[3:].strip('"')
        if estado == "??":
            if ruta.startswith(CARPETAS_VIGILADAS):
                bloquean.append(linea)
        else:
            bloquean.append(linea)
    return bloquean


def main() -> int:
    # --untracked-files=all lista cada archivo nuevo, no solo su carpeta.
    git = subprocess.run(
        ["git", "status", "--porcelain", "--untracked-files=all"],
        capture_output=True, text=True,
    )
    if git.returncode != 0:
        print("CANDADO: no se pudo consultar git; no se despliega.\n" + git.stderr, file=sys.stderr)
        return 1
    bloquean = cambios_que_bloquean(git.stdout)
    if bloquean:
        print("CANDADO: no se despliega a producción. Hay cambios sin commit:", file=sys.stderr)
        for linea in bloquean:
            print("  " + linea, file=sys.stderr)
        print("Haz commit (o descarta los cambios) y vuelve a intentarlo.", file=sys.stderr)
        return 1
    print("Candado: la carpeta coincide con git. Se puede desplegar.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
