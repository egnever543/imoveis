require('dotenv').config();
const OpenAI = require('openai');
const { toFile } = require('openai');
const sharp = require('sharp');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const TEMPLATE_URL = 'https://criativosimobiliarios.com/assets/showcase-4-CIqEnBlL.webp';

// Dois apartamentos diferentes
const APE_A = 'https://storage.googleapis.com/rogga-cliente/imagens_empreendimento/1694009043bangalo.jpg';
const APE_B = 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTardXlK_VBbhBgJLHbT40Lbt49of3OeTNILY5IOno-CufOIveiA4Uj2Qb2&s=10';

// Dois conjuntos de dados diferentes
const DADOS_A = {
  destaque:   'Frente Mar, Academia, Vista permanente',
  preco:      'R$ 1.000.000,00',
  entrada:    'R$ 300.000,00',
  parcela:    'R$ 50.000,00/mês',
  area:       '75 m²',
  quartos:    '2', banheiros: '2', vagas: '1',
  localizacao:'Itapoá - SC',
};

const DADOS_B = {
  destaque:   'Últimas unidades! Entrega Dezembro/2025',
  preco:      'R$ 450.000,00',
  entrada:    'R$ 45.000,00',
  parcela:    'R$ 2.800,00/mês',
  area:       '62 m²',
  quartos:    '3', banheiros: '1', vagas: '2',
  localizacao:'Patos de Minas - MG',
};

function log(label, msg) {
  const ts = new Date().toISOString().split('T')[1].replace('Z','');
  console.log(`[${ts}] [${label}] ${msg}`);
}

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
        return fetchBuffer(res.headers.location).then(resolve).catch(reject);
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function buildPrompt(dados) {
  return `Left image is the design template (keep its exact layout, colors, typography and style).
Right image is the apartment to sell.

Recreate the banner using the template design but with:
- The apartment from the right image as the main photo
- These property details replacing all existing text:

Chamada: ${dados.destaque}
Preço: ${dados.preco}
Entrada: ${dados.entrada}
Parcela: ${dados.parcela}
Área: ${dados.area} | ${dados.quartos} quartos | ${dados.banheiros} banheiros | ${dados.vagas} vaga
Localização: ${dados.localizacao}

All text in Portuguese. Sharp, legible typography.`;
}

async function combinar(templateBuf, imovelBuf) {
  const SIZE = 512;
  const t = await sharp(templateBuf).resize(SIZE, SIZE, { fit: 'cover' }).png().toBuffer();
  const i = await sharp(imovelBuf).resize(SIZE, SIZE, { fit: 'cover' }).png().toBuffer();
  return sharp({ create: { width: SIZE * 2, height: SIZE, channels: 4, background: { r:0,g:0,b:0,alpha:1 } } })
    .composite([{ input: t, left: 0, top: 0 }, { input: i, left: SIZE, top: 0 }])
    .png().toBuffer();
}

async function gerar(label, combinada, prompt, outFile) {
  log(label, 'Enviando para gpt-image-1...');
  const t0 = Date.now();
  const imageFile = await toFile(combinada, 'ref.png', { type: 'image/png' });
  const res = await openai.images.edit({
    model: 'gpt-image-1',
    image: imageFile,
    prompt,
    n: 1,
    size: '1024x1024',
    quality: 'high',
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  log(label, `✅ Gerado em ${elapsed}s`);
  const result = res.data[0];
  if (result.b64_json) {
    fs.writeFileSync(outFile, Buffer.from(result.b64_json, 'base64'));
    log(label, `🎨 Salvo: ${outFile}`);
  }
}

async function main() {
  console.log('=== TESTE A/B ===');
  console.log('QUERY 1 — mesmo template + dados A  →  troca só o APÊ (B→A)');
  console.log('QUERY 2 — mesmo template + mesmo apê →  troca só os dados (A→B)\n');

  // Baixa tudo em paralelo
  console.log('Baixando imagens...');
  const [templateBuf, apeBuf, apeBBuf] = await Promise.all([
    fetchBuffer(TEMPLATE_URL),
    fetchBuffer(APE_A),
    fetchBuffer(APE_B),
  ]);
  console.log('✓ Downloads concluídos\n');

  // Monta as duas imagens combinadas
  const combinada1 = await combinar(templateBuf, apeBBuf);   // Query 1: template + apê B (diferente)
  const combinada2 = await combinar(templateBuf, apeBuf);    // Query 2: template + apê A (mesmo) mas dados B

  // Roda as duas queries em paralelo
  console.log('Rodando as 2 queries em paralelo...\n');
  await Promise.all([
    gerar('QUERY-1 (novo apê, dados A)',   combinada1, buildPrompt(DADOS_A), path.join(__dirname, 'output-query1.png')),
    gerar('QUERY-2 (mesmo apê, dados B)', combinada2, buildPrompt(DADOS_B), path.join(__dirname, 'output-query2.png')),
  ]);

  console.log('\n=== CONCLUÍDO ===');
  console.log('output-query1.png → apê diferente, mesmos dados (Itapoá)');
  console.log('output-query2.png → mesmo apê, dados diferentes (Patos de Minas)');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
