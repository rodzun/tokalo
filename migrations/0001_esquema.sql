-- Esquema inicial de Tokalo.
-- Fechas: texto en UTC, formato ISO 8601 (2026-11-11T07:30:00Z).
-- Booleanos: 0 o 1 (SQLite no tiene tipo booleano).

-- Catálogo de modelos de placa.
CREATE TABLE modelos (
  id        TEXT PRIMARY KEY,            -- 'D', 'E', 'F', 'G', 'H'
  nombre    TEXT NOT NULL,
  tipo      TEXT NOT NULL CHECK (tipo IN ('totem','mesa','tarjeta')),
  ancho_mm  INTEGER NOT NULL,
  alto_mm   INTEGER NOT NULL,
  version   INTEGER NOT NULL DEFAULT 1
);

-- Personas que pueden entrar a /admin. Hoy una sola; luego vendedores.
CREATE TABLE usuarios (
  id          INTEGER PRIMARY KEY,
  nombre      TEXT NOT NULL,
  usuario     TEXT NOT NULL UNIQUE,      -- en minúsculas
  hash_clave  TEXT NOT NULL,             -- pbkdf2$iteraciones$sal$hash
  activo      INTEGER NOT NULL DEFAULT 1,
  creado_en   TEXT NOT NULL
);

-- Cada tanda de códigos generada desde /admin.
CREATE TABLE lotes (
  id          INTEGER PRIMARY KEY,
  modelo      TEXT NOT NULL REFERENCES modelos(id),
  cantidad    INTEGER NOT NULL,
  creado_por  INTEGER NOT NULL REFERENCES usuarios(id),
  creado_en   TEXT NOT NULL
);

-- Una fila por placa física. La clave primaria garantiza códigos únicos.
CREATE TABLE placas (
  codigo        TEXT PRIMARY KEY,        -- 6 caracteres, en mayúsculas
  modelo        TEXT NOT NULL REFERENCES modelos(id),
  lote          INTEGER NOT NULL REFERENCES lotes(id),
  estado        TEXT NOT NULL DEFAULT 'sin_activar'
                CHECK (estado IN ('sin_activar','activa','desactivada')),
  destino       TEXT,                    -- link de reseña (siempre https)
  negocio       TEXT,
  responsable   TEXT,
  telefono      TEXT,
  activada_por  INTEGER REFERENCES usuarios(id),
  activada_en   TEXT,
  creada_en     TEXT NOT NULL
);

-- Historial: cada vez que cambia el destino de una placa.
CREATE TABLE cambios_destino (
  id                INTEGER PRIMARY KEY,
  codigo            TEXT NOT NULL REFERENCES placas(codigo),
  destino_anterior  TEXT,
  destino_nuevo     TEXT NOT NULL,
  usuario_id        INTEGER NOT NULL REFERENCES usuarios(id),
  cambiado_en       TEXT NOT NULL
);

-- Un registro por escaneo del público. Sin IP ni user-agent completo.
CREATE TABLE escaneos (
  id       INTEGER PRIMARY KEY,
  codigo   TEXT NOT NULL REFERENCES placas(codigo),
  canal    TEXT NOT NULL CHECK (canal IN ('n','q')),   -- n = NFC, q = QR
  fecha    TEXT NOT NULL,
  pais     TEXT,                                       -- de request.cf
  sistema  TEXT NOT NULL CHECK (sistema IN ('ios','android','otro'))
);
CREATE INDEX escaneos_codigo_fecha ON escaneos (codigo, fecha);

-- Límite de intentos de login por nombre de usuario.
CREATE TABLE intentos_login (
  usuario          TEXT PRIMARY KEY,
  fallos           INTEGER NOT NULL,
  bloqueado_hasta  TEXT
);
