-- Los lotes ahora se pueden eliminar. Con AUTOINCREMENT, el número de un
-- lote eliminado no se vuelve a usar nunca: así "lote 5" significa siempre
-- lo mismo en los CSV que ya se mandaron a imprenta.
--
-- SQLite no permite añadir AUTOINCREMENT a una tabla existente: hay que
-- guardar los datos aparte, recrear la tabla y devolverlos.

-- Las placas apuntan a lotes. Esto pospone la comprobación de esas
-- referencias hasta el final de la migración: en medio quedan "rotas", y
-- se arreglan al reinsertar los lotes en la tabla nueva con sus mismos ids.
PRAGMA defer_foreign_keys = true;

CREATE TABLE lotes_copia AS SELECT * FROM lotes;

DROP TABLE lotes;

CREATE TABLE lotes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  modelo      TEXT NOT NULL REFERENCES modelos(id),
  cantidad    INTEGER NOT NULL,
  creado_por  INTEGER NOT NULL REFERENCES usuarios(id),
  creado_en   TEXT NOT NULL
);

INSERT INTO lotes (id, modelo, cantidad, creado_por, creado_en)
  SELECT id, modelo, cantidad, creado_por, creado_en FROM lotes_copia;

DROP TABLE lotes_copia;
