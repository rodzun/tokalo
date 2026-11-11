-- Datos de PRUEBA para desarrollo. No son una migración: nunca se aplican
-- a producción. Cargar con:  npm run datos:dev
-- Los códigos son aleatorios reales, generados con el alfabeto de Tokalo.

-- Usuario ficticio e inactivo: solo existe para cumplir las claves foráneas.
-- Su hash no es válido, así que nadie puede entrar con él.
INSERT INTO usuarios (id, nombre, usuario, hash_clave, activo, creado_en) VALUES
  (1, 'Usuario de prueba', 'prueba', '!', 0, '2026-11-11T00:00:00Z');

INSERT INTO lotes (id, modelo, cantidad, creado_por, creado_en) VALUES
  (1, 'D', 6, 1, '2026-11-11T00:00:00Z');

-- Dos placas sin activar.
INSERT INTO placas (codigo, modelo, lote, estado, creada_en) VALUES
  ('SFXPXP', 'D', 1, 'sin_activar', '2026-11-11T00:00:00Z'),
  ('7TTGV8', 'D', 1, 'sin_activar', '2026-11-11T00:00:00Z');

-- Tres placas activas, las tres del MISMO negocio pero con un tipo de link
-- distinto, para comparar en el celular cuál abre mejor la reseña.
INSERT INTO placas (codigo, modelo, lote, estado, destino, negocio, responsable, telefono, activada_por, activada_en, creada_en) VALUES
  ('9M8CQ2', 'D', 1, 'activa', 'https://search.google.com/local/writereview?placeid=ChIJxYp2YMnVbZERVR0Z22bHb4s', 'Prueba A: link de reseña directo', 'Responsable 1', '900000001', 1, '2026-11-11T01:00:00Z', '2026-11-11T00:00:00Z'),
  ('PQJFT7', 'D', 1, 'activa', 'https://g.page/r/CVUdGdtmx2-LEAI/review', 'Prueba B: link oficial g.page', 'Responsable 2', '900000002', 1, '2026-11-11T01:00:00Z', '2026-11-11T00:00:00Z'),
  ('3SDBNK', 'D', 1, 'activa', 'https://maps.app.goo.gl/RJbtcYKLeMyt1ZmC7', 'Prueba C: ficha del negocio en Maps', 'Responsable 3', '900000003', 1, '2026-11-11T01:00:00Z', '2026-11-11T00:00:00Z');

-- Una placa desactivada: conserva sus datos.
INSERT INTO placas (codigo, modelo, lote, estado, destino, negocio, responsable, telefono, activada_por, activada_en, creada_en) VALUES
  ('5FD9CX', 'D', 1, 'desactivada', 'https://search.google.com/local/writereview?placeid=ChIJy3uWwHPWbZERICgazBw9xPo', 'Negocio de prueba 4', 'Responsable 4', '900000004', 1, '2026-11-11T01:00:00Z', '2026-11-11T00:00:00Z');
