CREATE TABLE IF NOT EXISTS rift_documents (
  namespace text NOT NULL,
  key text NOT NULL,
  contents text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (namespace, key)
);
