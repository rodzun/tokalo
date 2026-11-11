CREATE TABLE placas (
  codigo  TEXT PRIMARY KEY,
  destino TEXT NOT NULL
);
INSERT INTO placas (codigo, destino) VALUES
  ('ABC234', 'https://search.google.com/local/writereview?placeid=ChIJd47f2fnXbZERrQZbyDhq2y0'),
  ('XYZ789', 'https://example.com/uno'),
  ('QWE456', 'https://example.com/dos'),
  ('RTY567', 'https://example.com/tres'),
  ('HJK892', 'https://example.com/cuatro');
