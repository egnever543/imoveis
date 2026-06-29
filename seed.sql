-- Seed com dados locais migrados
-- Execute no SQL Editor do Supabase APÓS rodar schema.sql
--
-- ATENÇÃO: logo e fotos eram arquivos locais.
-- Suba essas imagens manualmente no Cloudinary e substitua as URLs abaixo antes de rodar.

-- Perfil
UPDATE perfil SET
  nome     = 'L Imoveis',
  slogan   = '',
  creci    = '',
  telefone = '',
  whatsapp = '',
  email    = '',
  site     = '',
  -- Substitua pela URL do Cloudinary após subir o arquivo:
  -- uploads/logos/logo-1782743856949.jpg
  logo     = ''
WHERE id = 1;

-- Imóveis
INSERT INTO imoveis (
  id, criado_em, titulo, tipo, status,
  preco, entrada, parcela, financiamento,
  area, quartos, suites, banheiros, vagas, andar, total_andares,
  endereco, bairro, cidade, estado,
  destaque, diferenciais, descricao,
  fotos
) VALUES (
  '1782743524707',
  '2026-06-29T14:32:04.707Z',
  'Bangalô Beach Club',
  'Apartamento',
  'disponivel',
  '1.000.000,00',
  '300.000,00',
  '50.000,00',
  'MINHA CASA MINHA VIDA',
  '75', '2', '1', '1', '1', '6', '',
  'Av Beira Mar V', 'Itapoá', 'Palmeiras', 'SC',
  'Frente Mar, Vista Permanente',
  'Piscina, Academia, Hidromassagem, +17 areas de laser.',
  '',
  -- Substitua pela URL do Cloudinary após subir o arquivo:
  -- uploads/imoveis/1782743524679-imagem_2026-06-29_113203054.png
  ARRAY[]::TEXT[]
) ON CONFLICT (id) DO NOTHING;
