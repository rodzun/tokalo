"""Tests del candado de despliegue. Se ejecutan con `npm test`."""
import os
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))
from candado_despliegue import cambios_que_bloquean  # noqa: E402

CANDADO = os.path.join(os.path.dirname(os.path.abspath(__file__)), "candado_despliegue.py")


class ReglasDelCandado(unittest.TestCase):
    def test_carpeta_limpia_no_bloquea(self):
        self.assertEqual(cambios_que_bloquean(""), [])

    def test_cambio_sin_commit_bloquea_en_cualquier_carpeta(self):
        for linea in [" M src/lib/placas.ts", "M  package.json", " M wrangler.toml", " D migrations/0001_esquema.sql", "A  README.md"]:
            self.assertEqual(cambios_que_bloquean(linea + "\n"), [linea])

    def test_archivo_nuevo_en_src_o_migrations_bloquea(self):
        for linea in ["?? src/lib/nuevo.ts", "?? migrations/0009_algo.sql"]:
            self.assertEqual(cambios_que_bloquean(linea + "\n"), [linea])

    def test_archivo_nuevo_fuera_de_esas_carpetas_no_bloquea(self):
        for linea in ["?? notas.txt", "?? respaldos/tokalo.sql", "?? scripts/prueba.py", "?? test/zz.test.ts"]:
            self.assertEqual(cambios_que_bloquean(linea + "\n"), [])

    def test_devuelve_solo_las_lineas_que_bloquean(self):
        salida = "?? notas.txt\n M src/index.ts\n?? migrations/0009_algo.sql\n"
        self.assertEqual(cambios_que_bloquean(salida), [" M src/index.ts", "?? migrations/0009_algo.sql"])


class CandadoDeVerdad(unittest.TestCase):
    """Ejecuta el script en un repositorio git de prueba y mira su código de salida."""

    def setUp(self):
        self.carpeta = tempfile.TemporaryDirectory()
        self.git("init", "-q")
        os.makedirs(os.path.join(self.carpeta.name, "src"))
        os.makedirs(os.path.join(self.carpeta.name, "migrations"))
        self.escribir("src/index.ts", "// v1\n")
        self.escribir("migrations/0001.sql", "SELECT 1;\n")
        self.git("add", "-A")
        self.git("-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-q", "-m", "inicial")

    def tearDown(self):
        self.carpeta.cleanup()

    def git(self, *args):
        subprocess.run(["git", *args], cwd=self.carpeta.name, check=True, capture_output=True)

    def escribir(self, ruta, texto):
        with open(os.path.join(self.carpeta.name, ruta), "w") as f:
            f.write(texto)

    def salida_del_candado(self):
        return subprocess.run([sys.executable, CANDADO], cwd=self.carpeta.name, capture_output=True, text=True).returncode

    def test_limpio_deja_pasar(self):
        self.assertEqual(self.salida_del_candado(), 0)

    def test_archivo_modificado_aborta(self):
        self.escribir("src/index.ts", "// a medio escribir\n")
        self.assertEqual(self.salida_del_candado(), 1)

    def test_migracion_nueva_sin_commit_aborta(self):
        self.escribir("migrations/0002.sql", "CREATE TABLE x (y);\n")
        self.assertEqual(self.salida_del_candado(), 1)

    def test_archivo_nuevo_dentro_de_subcarpeta_de_src_aborta(self):
        os.makedirs(os.path.join(self.carpeta.name, "src", "lib"))
        self.escribir("src/lib/nuevo.ts", "// nuevo\n")
        self.assertEqual(self.salida_del_candado(), 1)

    def test_archivo_nuevo_fuera_no_aborta(self):
        self.escribir("notas.txt", "apuntes\n")
        self.assertEqual(self.salida_del_candado(), 0)

    def test_fuera_de_un_repositorio_git_aborta(self):
        with tempfile.TemporaryDirectory() as sin_git:
            r = subprocess.run([sys.executable, CANDADO], cwd=sin_git, capture_output=True, text=True,
                               env={**os.environ, "GIT_CEILING_DIRECTORIES": os.path.dirname(sin_git)})
            self.assertEqual(r.returncode, 1)


if __name__ == "__main__":
    unittest.main()
