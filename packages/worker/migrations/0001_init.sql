-- Esquema inicial de Vortex Wake en D1.
--
-- Cada fila guarda el objeto completo como JSON (el mismo formato que los
-- archivos de data/ en el servidor local) más las columnas para buscar.
-- `version` sirve para escribir solo si nadie cambió la fila mientras se
-- mezclaba (dos teléfonos al mismo tiempo): ver src/store.ts.

-- Equipo: una sola fila (id = 1).
CREATE TABLE team (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  json TEXT NOT NULL,
  version INTEGER NOT NULL
);

-- Sesiones: una por día, con asistencia y cierre.
CREATE TABLE sessions (
  date TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  version INTEGER NOT NULL
);

-- Micro-entradas.
CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  session_date TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  json TEXT NOT NULL,
  version INTEGER NOT NULL
);

CREATE INDEX entries_by_session_date ON entries (session_date);
