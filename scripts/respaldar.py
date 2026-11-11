#!/usr/bin/env python3
"""Descarga un respaldo completo de la base de Tokalo a un archivo .sql.

El archivo trae la estructura y todos los datos. Queda en la carpeta
respaldos/, que git ignora: contiene nombres y teléfonos de clientes y no
debe subirse a ningún repositorio.

Uso (desde la carpeta del proyecto):

    python3 scripts/respaldar.py              # producción
    python3 scripts/respaldar.py dev          # desarrollo
"""

import sqlite3
import subprocess
import sys
from datetime import datetime
from pathlib import Path

# Base de datos de cada entorno y argumentos extra de wrangler.
ENTORNOS = {
    "dev": ("tokalo-dev", []),
    "produccion": ("tokalo", ["--env", "produccion"]),
}


def ordenar(sql: str) -> str:
    """Reordena el respaldo para que se pueda restaurar tal cual.

    El archivo de Cloudflare crea la tabla "placas" y le inserta filas antes
    de crear "lotes", aunque placas apunta a lotes; al restaurarlo, la base
    falla con "no such table: lotes". Solución: primero todos los CREATE
    TABLE y después el resto, sin cambiar nada más.
    """
    # Se parte el texto en sentencias completas. sqlite3.complete_statement
    # sabe si un trozo ya termina en ";" de verdad (y no dentro de un texto).
    sentencias: list[str] = []
    actual = ""
    for linea in sql.splitlines(keepends=True):
        actual += linea
        if sqlite3.complete_statement(actual):
            sentencias.append(actual)
            actual = ""
    if actual.strip():
        sentencias.append(actual)

    def grupo(sentencia: str) -> int:
        inicio = sentencia.lstrip().upper()
        if inicio.startswith("PRAGMA"):
            return 0
        if inicio.startswith("CREATE TABLE"):
            return 1
        return 2

    # sorted() es estable: dentro de cada grupo se conserva el orden original.
    return "".join(sorted(sentencias, key=grupo))


def main() -> int:
    entorno = sys.argv[1] if len(sys.argv) > 1 else "produccion"
    if entorno not in ENTORNOS:
        print(f"Entorno desconocido: {entorno}. Usa 'dev' o 'produccion'.", file=sys.stderr)
        return 2

    base, extra = ENTORNOS[entorno]
    carpeta = Path("respaldos")
    carpeta.mkdir(exist_ok=True)
    archivo = carpeta / f"{base}-{datetime.now().strftime('%Y-%m-%d-%H%M%S')}.sql"

    orden = ["npx", "wrangler", "d1", "export", base, *extra, "--remote", "--output", str(archivo)]
    resultado = subprocess.run(orden, capture_output=True, text=True)
    if resultado.returncode != 0 or not archivo.exists():
        print("No se pudo hacer el respaldo:", file=sys.stderr)
        print(resultado.stdout[-2000:], resultado.stderr[-2000:], file=sys.stderr)
        return 1

    archivo.write_text(ordenar(archivo.read_text(encoding="utf-8")), encoding="utf-8")

    lineas = sum(1 for _ in archivo.open(encoding="utf-8"))
    print(f"Respaldo guardado en {archivo} ({archivo.stat().st_size} bytes, {lineas} líneas).")
    print("Guárdalo fuera de esta computadora: contiene datos de clientes.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
