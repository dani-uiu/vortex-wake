-- Pendientes entre sesiones (lo de "¿Qué sigue?" del cierre y los agregados a
-- mano). Solo agrega una tabla: no cambia las que ya existen.
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  updated_at TEXT NOT NULL,
  json TEXT NOT NULL,
  version INTEGER NOT NULL
);
