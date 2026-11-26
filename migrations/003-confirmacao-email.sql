ALTER TABLE clientes ADD COLUMN pin_hash TEXT;
ALTER TABLE clientes ADD COLUMN cpf TEXT;

CREATE TABLE confirmacoes_cliente (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('pedido', 'senha')),
  payload TEXT,
  expires_at BIGINT NOT NULL,
  UNIQUE (email, kind)
);
CREATE INDEX confirmacoes_cliente_expira ON confirmacoes_cliente (expires_at);

CREATE TABLE tentativas_cliente (
  email TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at BIGINT NOT NULL
);
