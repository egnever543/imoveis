require('dotenv').config();
const OpenAI = require('openai');
const { toFile } = require('openai');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const TEMPLATE_URL = 'https://criativosimobiliarios.com/assets/showcase-4-CIqEnBlL.webp';
const IMOVEL_URL   = 'https://storage.googleapis.com/rogga-cliente/imagens_empreendimento/1694009043bangalo.jpg';

const DADOS = {
  preco: 'R$ 1.000.000,00', entrada: 'R$ 300.000,00', parcela: 'R$ 50.000,00/mês',
  area: '75 m²', quartos: '2', banheiros: '2', vagas: '1',
  localizacao: 'Itapoá - SC', destaque: 'Frente Mar, Academia, Vista permanente',
};

function log(msg) {
  const ts = new Date().toISOString().split('T')[1].replace('Z','');
  console.log(`[${ts}] ${msg}`);
}

function fetchImageAsBase64(url) {
  return new Promise((resolve, reject) => {
    log(`Baixando: ${url.slice(0, 80)}...`);
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
        return fetchImageAsBase64(res.headers.location).then(resolve).catch(reject);
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const mime = res.headers['content-type'] || 'image/jpeg';
        log(`  OK: ${buf.length} bytes (${mime})`);
        resolve({ base64: buf.toString('base64'), mime, buf });
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

function bufToFile(buf, mime, filename) {
  const tmpPath = path.join(__dirname, filename);
  fs.writeFileSync(tmpPath, buf);
  return tmpPath;
}

async function main() {
  log('=== TESTE: GPT-4o Vision → gpt-image-1 Edit ===\n');

  // 1. Baixa as duas imagens
  log('--- PASSO 1: Download das imagens ---');
  const [template, imovel] = await Promise.all([
    fetchImageAsBase64(TEMPLATE_URL),
    fetchImageAsBase64(IMOVEL_URL),
  ]);

  // 2. GPT-4o analisa o template e extrai o estilo visual
  log('\n--- PASSO 2: GPT-4o analisa o estilo do template ---');
  const visionRes = await openai.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: { url: `data:${template.mime};base64,${template.base64}`, detail: 'high' },
        },
        {
          type: 'text',
          text: 'Descreva em detalhes o estilo visual deste banner imobiliário: cores dominantes, tipografia, layout, elementos gráficos, estilo de fundo, hierarquia visual. Seja específico e técnico para que um designer possa recriar o estilo.',
        },
      ],
    }],
  });

  const estiloTemplate = visionRes.choices[0].message.content;
  log(`Estilo extraído:\n${estiloTemplate}\n`);

  // 3. GPT-4o descreve a foto do novo imóvel
  log('\n--- PASSO 3: GPT-4o descreve o novo imóvel ---');
  const imovelVisionRes = await openai.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 300,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: { url: `data:${imovel.mime};base64,${imovel.base64}`, detail: 'high' },
        },
        {
          type: 'text',
          text: 'Descreva visualmente este imóvel em detalhes: tipo, fachada, cores, arquitetura, paisagismo, entorno. Seja específico o suficiente para que um designer possa recriar a imagem.',
        },
      ],
    }],
  });
  const descricaoImovel = imovelVisionRes.choices[0].message.content;
  log(`Descrição:\n${descricaoImovel}\n`);

  // 4. Prompt: "é como mandar no chat" — template como base visual, trocar imóvel e dados
  const prompt = `Você está olhando para um banner imobiliário profissional (o template). Quero que você recrie esse banner EXATAMENTE com o mesmo layout, estrutura, paleta de cores, tipografia e estilo gráfico — mas substituindo:

1. O imóvel da foto pelo descrito abaixo
2. Todos os textos pelos novos dados do imóvel

NOVO IMÓVEL (substitua a foto do template por este):
${descricaoImovel}

NOVOS DADOS (substitua todos os textos do template):
• Chamada principal: ${DADOS.destaque}
• Preço: ${DADOS.preco}
• Entrada: ${DADOS.entrada}
• Parcela: ${DADOS.parcela}
• ${DADOS.area}  •  ${DADOS.quartos} quartos  •  ${DADOS.banheiros} banheiros  •  ${DADOS.vagas} vaga de garagem
• Localização: ${DADOS.localizacao}

REGRAS:
- Mantenha FIELMENTE o layout, hierarquia visual e estilo do template original
- Todo texto em português, sem erros, legível e nítido
- Tipografia bold sem serifa, alto contraste
- Integre a foto do novo imóvel no mesmo espaço visual que o original ocupa`;

  log(`--- PASSO 4: Prompt montado (${prompt.length} chars) ---`);
  log(`\n--- PASSO 5: gpt-image-1 images.edit — template como base visual ---`);
  log('Aguardando geração...\n');

  const t0 = Date.now();
  try {
    // Template é a base visual — o modelo vê o layout e recria com novos dados
    const templateFile = await toFile(template.buf, 'template.webp', { type: template.mime });

    const editRes = await openai.images.edit({
      model: 'gpt-image-1',
      image: templateFile,
      prompt,
      n: 1,
      size: '1024x1024',
      quality: 'high',
    });

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    log(`✅ Gerado em ${elapsed}s`);
    log(`Usage: ${JSON.stringify(editRes.usage || {})}`);

    const result = editRes.data[0];
    const outPath = path.join(__dirname, 'output-test.png');

    if (result.b64_json) {
      fs.writeFileSync(outPath, Buffer.from(result.b64_json, 'base64'));
      log(`\n🎨 IMAGEM SALVA EM: ${outPath}`);
    } else if (result.url) {
      log(`\n🎨 URL: ${result.url}`);
    }

  } catch (err) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    log(`\n❌ ERRO após ${elapsed}s`);
    log(`Status: ${err.status}`);
    log(`Mensagem: ${err.message}`);
    if (err.error) log(`Detalhe:\n${JSON.stringify(err.error, null, 2)}`);
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
