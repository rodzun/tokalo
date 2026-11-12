-- Tablas resumen de escaneos: los reportes y la lista de placas leen de
-- aquí y ya no recorren la tabla `escaneos` (que se conserva como detalle).
-- Motivo: D1 cobra cada fila leída y el cupo diario es por cuenta; con el
-- resumen, una placa con 30 lecturas en un día ocupa 2 filas en vez de 30.
--
-- Cada escaneo suma 1 en ambas tablas en la misma transacción en que se
-- guarda (ver src/lib/escaneos.ts), así que no pueden desfasarse.
--
-- WITHOUT ROWID: la tabla se guarda ordenada por su clave primaria, sin un
-- índice aparte. Cada fila cuesta una sola escritura.

-- Lecturas por placa, día (de Perú, "AAAA-MM-DD") y canal.
CREATE TABLE escaneos_diarios (
  codigo    TEXT NOT NULL REFERENCES placas(codigo),
  dia       TEXT NOT NULL,
  canal     TEXT NOT NULL CHECK (canal IN ('n','q')),
  cantidad  INTEGER NOT NULL,
  PRIMARY KEY (codigo, dia, canal)
) WITHOUT ROWID;

-- Para el reporte por rango de fechas. Lleva dentro la cantidad: el reporte
-- se responde solo con el índice, sin ir a buscar cada fila a la tabla.
CREATE INDEX escaneos_diarios_dia ON escaneos_diarios (dia, codigo, canal, cantidad);

-- Lecturas de siempre por placa y canal: como mucho dos filas por placa.
CREATE TABLE escaneos_totales (
  codigo    TEXT NOT NULL REFERENCES placas(codigo),
  canal     TEXT NOT NULL CHECK (canal IN ('n','q')),
  cantidad  INTEGER NOT NULL,
  PRIMARY KEY (codigo, canal)
) WITHOUT ROWID;

-- Relleno con los escaneos que ya existen. '-5 hours' pasa de UTC a hora de Perú.
INSERT INTO escaneos_diarios (codigo, dia, canal, cantidad)
SELECT codigo, date(fecha, '-5 hours'), canal, COUNT(*) FROM escaneos GROUP BY 1, 2, 3;

INSERT INTO escaneos_totales (codigo, canal, cantidad)
SELECT codigo, canal, COUNT(*) FROM escaneos GROUP BY 1, 2;
