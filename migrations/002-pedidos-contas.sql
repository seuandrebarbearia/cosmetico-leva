CREATE TABLE clientes (email TEXT PRIMARY KEY);
CREATE TABLE codigos_cliente (
  email TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  issued_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  attempts INTEGER NOT NULL
);
CREATE TABLE sessoes_cliente (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL REFERENCES clientes(email),
  expires_at BIGINT NOT NULL
);
CREATE INDEX sessoes_cliente_expira ON sessoes_cliente (expires_at);

ALTER TABLE pedidos ADD COLUMN account_email TEXT REFERENCES clientes(email);
ALTER TABLE pedidos ADD COLUMN delivery_address TEXT;
ALTER TABLE pedidos ADD COLUMN read_at TEXT;
ALTER TABLE pedidos ADD COLUMN status TEXT NOT NULL DEFAULT 'recebido'
  CHECK (status IN ('recebido', 'em_preparo', 'preparado', 'enviado'));
ALTER TABLE pedidos ADD COLUMN status_history TEXT NOT NULL DEFAULT '[]';
ALTER TABLE pedidos ADD COLUMN carrier TEXT;
ALTER TABLE pedidos ADD COLUMN tracking TEXT;
ALTER TABLE pedidos ADD COLUMN mail_status TEXT;
ALTER TABLE pedidos ADD COLUMN mail_attempt_at TEXT;
UPDATE pedidos SET read_at = created_at;
CREATE INDEX pedidos_por_cliente ON pedidos (account_email, id DESC);
