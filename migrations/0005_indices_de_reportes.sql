-- Índices para los reportes: permiten buscar por rango de fechas sin
-- recorrer toda la tabla (como un índice de libro, ordenado por fecha).
CREATE INDEX escaneos_fecha ON escaneos (fecha);
CREATE INDEX placas_activada_en ON placas (activada_en);
