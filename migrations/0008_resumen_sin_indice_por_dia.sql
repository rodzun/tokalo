-- Ajuste de las tablas resumen (0007), tras medir en local:
--
-- 1. Se quita el índice por día de `escaneos_diarios`. El reporte ya no lo
--    usa: recorre placa por placa con la clave primaria (codigo, dia, canal)
--    y lee la mitad de filas, porque no tiene que ordenar aparte. Sin el
--    índice, cada escaneo cuesta una fila escrita menos.
--
-- 2. Se rehacen los dos resúmenes desde la tabla `escaneos`. Es por si entre
--    la migración 0007 y el despliegue del código que suma en los resúmenes
--    se registró algún escaneo con el código anterior (que no los conoce).
--    Rehacerlos da siempre el mismo resultado: se puede repetir sin riesgo.
DROP INDEX IF EXISTS escaneos_diarios_dia;

DELETE FROM escaneos_diarios;
DELETE FROM escaneos_totales;

INSERT INTO escaneos_diarios (codigo, dia, canal, cantidad)
SELECT codigo, date(fecha, '-5 hours'), canal, COUNT(*) FROM escaneos GROUP BY 1, 2, 3;

INSERT INTO escaneos_totales (codigo, canal, cantidad)
SELECT codigo, canal, COUNT(*) FROM escaneos GROUP BY 1, 2;
