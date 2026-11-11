-- Los lotes ahora se pueden eliminar. Con AUTOINCREMENT, el número de un
-- lote eliminado no se vuelve a usar nunca: así "lote 5" significa siempre
-- lo mismo en los CSV que ya se mandaron a imprenta.
--
-- SQLite no permite añadir AUTOINCREMENT a una tabla existente: hay que
-- crear una tabla nueva, copiar los datos y reemplazar la anterior.

-- Las placas apuntan a lotes; esto pospone la comprobación de esas
-- referencias hasta el final de la migración.
PRAGMA defer_foreign_keys = true;

CREATE TABLE lotes_nueva (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  modelo      TEXT NOT NULL REFERENCES modelos(id),
  cantidad    INTEGER NOT NULL,
  creado_por  INTEGER NOT NULL REFERENCES usuarios(id),
  creado_en   TEXT NOT NULL
);

INSERT INTO lotes_nueva (id, modelo, cantidad, creado_por, creado_en)
  SELECT id, modelo, cantidad, creado_por, creado_en FROM lotes;

DROP TABLE lotes;
ALTER TABLE lotes_nueva RENAME TO lotes;
