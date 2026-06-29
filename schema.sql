-- Execute este arquivo no SQL Editor do seu projeto Supabase

-- Perfil da imobiliária (uma única linha)
CREATE TABLE IF NOT EXISTS perfil (
  id      INTEGER PRIMARY KEY DEFAULT 1,
  nome    TEXT DEFAULT '',
  slogan  TEXT DEFAULT '',
  creci   TEXT DEFAULT '',
  telefone TEXT DEFAULT '',
  whatsapp TEXT DEFAULT '',
  email   TEXT DEFAULT '',
  site    TEXT DEFAULT '',
  logo    TEXT DEFAULT ''
);
INSERT INTO perfil (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Imóveis
CREATE TABLE IF NOT EXISTS imoveis (
  id            TEXT PRIMARY KEY,
  criado_em     TIMESTAMPTZ DEFAULT NOW(),
  titulo        TEXT DEFAULT '',
  tipo          TEXT DEFAULT '',
  status        TEXT DEFAULT 'disponivel',
  preco         TEXT DEFAULT '',
  entrada       TEXT DEFAULT '',
  parcela       TEXT DEFAULT '',
  financiamento TEXT DEFAULT '',
  area          TEXT DEFAULT '',
  quartos       TEXT DEFAULT '',
  suites        TEXT DEFAULT '',
  banheiros     TEXT DEFAULT '',
  vagas         TEXT DEFAULT '',
  andar         TEXT DEFAULT '',
  total_andares TEXT DEFAULT '',
  endereco      TEXT DEFAULT '',
  bairro        TEXT DEFAULT '',
  cidade        TEXT DEFAULT '',
  estado        TEXT DEFAULT '',
  destaque      TEXT DEFAULT '',
  diferenciais  TEXT DEFAULT '',
  descricao     TEXT DEFAULT '',
  fotos         TEXT[] DEFAULT '{}'
);

-- Templates (gerenciados pelo admin)
CREATE TABLE IF NOT EXISTS templates (
  id        BIGINT PRIMARY KEY,
  nome      TEXT DEFAULT '',
  image_url TEXT DEFAULT '',
  fields    TEXT[] DEFAULT '{}',
  criado_em TIMESTAMPTZ DEFAULT NOW()
);
