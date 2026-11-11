-- Cada modelo es para una plataforma: Google, Instagram, Tripadvisor...
-- Puede haber un "Tótem pavonado" de Google y otro de Instagram: son modelos
-- distintos, porque el diseño impreso es distinto.
--
-- Los modelos que ya existen (D a H) son todos de Google.
-- Los valores válidos se controlan en el código (src/lib/plataformas.ts),
-- para poder añadir plataformas sin tener que recrear la tabla.
ALTER TABLE modelos ADD COLUMN plataforma TEXT NOT NULL DEFAULT 'google';
