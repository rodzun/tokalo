-- Estado de impresión de cada lote: "generado" (recién creado) o "impreso"
-- (ya se mandó a fabricar). Solo se puede eliminar un lote "generado".
-- Se guarda también cuándo y quién cambió el estado por última vez.
ALTER TABLE lotes ADD COLUMN estado TEXT NOT NULL DEFAULT 'generado'
  CHECK (estado IN ('generado', 'impreso'));
ALTER TABLE lotes ADD COLUMN estado_cambiado_en TEXT;
ALTER TABLE lotes ADD COLUMN estado_cambiado_por INTEGER REFERENCES usuarios(id);

-- Los lotes que ya existen quedan en "generado", salvo los que tengan alguna
-- placa activada (activa o desactivada) o con escaneos: esos ya se fabricaron.
-- En ellos la fecha y el usuario quedan vacíos, porque no se sabe.
UPDATE lotes SET estado = 'impreso'
WHERE id IN (
  SELECT lote FROM placas
  WHERE estado != 'sin_activar' OR codigo IN (SELECT codigo FROM escaneos)
);
