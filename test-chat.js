require('dotenv').config();
const OpenAI = require('openai');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const TEMPLATE_URL = 'https://criativosimobiliarios.com/assets/showcase-4-CIqEnBlL.webp';
const IMOVEL_URL   = 'https://storage.googleapis.com/rogga-cliente/imagens_empreendimento/1694009043bangalo.jpg';

const DADOS = {
  destaque:   'Frente Mar, Academia, Vista permanente',
  preco:      'R$ 1.000.000,00',
  entrada:    'R$ 300.000,00',
  parcela:    'R$ 50.000,00/mês',
  area:       '75 m²',
  quartos:    '2', banheiros: '2', vagas: '1',
  localizacao:'Itapoá - SC',
};

function log(msg) {
  const ts = new Date().toISOString().split('T')[1].replace('Z', '');
  console.log(`[${ts}] ${msg}`);
}

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    log(`Baixando: ${url.slice(0, 70)}...`);
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
        return fetchBuffer(res.headers.location).then(resolve).catch(reject);
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        log(`  ✓ ${buf.length} bytes`);
        resolve(buf);
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  log('=== Responses API — gpt-4o + image_generation tool ===\n');

  // 1. Baixa as imagens
  const [templateBuf, imovelBuf] = await Promise.all([
    fetchBuffer(TEMPLATE_URL),
    fetchBuffer(IMOVEL_URL),
  ]);

  const templateB64 = templateBuf.toString('base64');
  const imovelB64   = imovelBuf.toString('base64');

  // 2. Monta a conversa — igual mandar no chat
  const mensagem = `Primeira imagem: template do banner (referência de layout, cores e estilo).
Segunda imagem: apartamento a vender.

Recrie o banner no estilo do template mas com o apartamento da segunda imagem e estes dados:

Chamada: ${DADOS.destaque}
Preço: ${DADOS.preco}
Entrada: ${DADOS.entrada}
Parcela: ${DADOS.parcela}
Área: ${DADOS.area} | ${DADOS.quartos} quartos | ${DADOS.banheiros} banheiros | ${DADOS.vagas} vaga
Localização: ${DADOS.localizacao}

Textos em português, legíveis e nítidos.`;

  log(`Mensagem:\n${mensagem}\n`);
  log('Enviando para Responses API (gpt-4o + image_generation)...\n');

  const t0 = Date.now();
  try {
    const response = await openai.responses.create({
      model: 'gpt-4o',
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_image', image_url: `data:image/webp;base64,${templateB64}` },
            { type: 'input_image', image_url: `data:image/jpeg;base64,${imovelB64}` },
            { type: 'input_text', text: mensagem },
          ],
        },
      ],
      tools: [{ type: 'image_generation', quality: 'high', size: '1024x1024' }],
    });

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    log(`✅ Resposta em ${elapsed}s`);
    log(`Usage: ${JSON.stringify(response.usage || {})}`);

    let salvo = false;
    for (const item of response.output || []) {
      if (item.type === 'image_generation_call' && item.result) {
        const outPath = path.join(__dirname, 'output-chat.png');
        fs.writeFileSync(outPath, Buffer.from(item.result, 'base64'));
        log(`\n🎨 SALVO: ${outPath}`);
        salvo = true;
      }
      if (item.type === 'message') {
        const txt = item.content?.map(c => c.text || '').join('').trim();
        if (txt) log(`\n💬 Modelo: "${txt.slice(0, 300)}"`);
      }
    }

    if (!salvo) {
      log('\nOutput (sem imagem):');
      console.log(JSON.stringify(response.output, null, 2));
    }

  } catch (err) {
    log(`\n❌ ERRO após ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    log(`Status: ${err.status} — ${err.message}`);
    if (err.error) log(`Detalhe: ${JSON.stringify(err.error, null, 2)}`);
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
