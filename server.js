require('dotenv').config();
const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const https    = require('https');
const http     = require('http');
const OpenAI   = require('openai');

const app    = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const DATA_DIR    = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// ── Storage configs ───────────────────────────────────────────────────────────
const storageImovel = multer.diskStorage({
  destination: (_, __, cb) => cb(null, path.join(UPLOADS_DIR, 'imoveis')),
  filename:    (_, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const storageLogo = multer.diskStorage({
  destination: (_, __, cb) => cb(null, path.join(UPLOADS_DIR, 'logos')),
  filename:    (_, file, cb) => cb(null, `logo-${Date.now()}${path.extname(file.originalname)}`),
});
const storageTemplate = multer.diskStorage({
  destination: (_, __, cb) => cb(null, path.join(UPLOADS_DIR, 'templates')),
  filename:    (_, file, cb) => cb(null, `template-${Date.now()}${path.extname(file.originalname)}`),
});

const uploadImovel   = multer({ storage: storageImovel });
const uploadLogo     = multer({ storage: storageLogo });
const uploadTemplate = multer({ storage: storageTemplate });

app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static(UPLOADS_DIR));

// ── Helpers ───────────────────────────────────────────────────────────────────
const readJSON  = (file) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
const writeJSON = (file, data) => fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));

const TEMPLATES_FILE = path.join(DATA_DIR, 'templates.json');
const readTemplates  = () => fs.existsSync(TEMPLATES_FILE) ? JSON.parse(fs.readFileSync(TEMPLATES_FILE, 'utf8')) : [];
const writeTemplates = (data) => fs.writeFileSync(TEMPLATES_FILE, JSON.stringify(data, null, 2));

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
        return fetchBuffer(res.headers.location).then(resolve).catch(reject);
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function imageB64FromPath(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const ext  = path.extname(filePath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  return { b64: fs.readFileSync(filePath).toString('base64'), mime };
}

// ── Nomes de campo para exibição ──────────────────────────────────────────────
const FIELD_LABELS_PT = {
  titulo:        'Título',
  preco:         'Preço',
  entrada:       'Entrada',
  parcela:       'Parcela',
  financiamento: 'Financiamento',
  area:          'Área (m²)',
  quartos:       'Quartos',
  suites:        'Suítes',
  banheiros:     'Banheiros',
  vagas:         'Vagas',
  andar:         'Andar',
  localizacao:   'Localização',
  endereco:      'Endereço',
  destaque:      'Chamada principal',
  diferenciais:  'Diferenciais',
  foto_imovel:   'Foto do imóvel',
  logo:          'Logo',
};

// ── Prompt de análise de template ─────────────────────────────────────────────
const ANALYZE_PROMPT = `Analyze this real estate marketing banner template image carefully.
Identify which data fields are visually present as content areas, text blocks, icons or placeholders.

Return ONLY a valid JSON object with a "fields" array. Use exclusively these field names:
- "titulo"        — property title or name
- "preco"         — total sale price
- "entrada"       — down payment amount
- "parcela"       — monthly installment value
- "financiamento" — financing type (MCMV, FGTS, bank name, etc.)
- "area"          — property area in m²
- "quartos"       — number of bedrooms
- "suites"        — number of suites
- "banheiros"     — number of bathrooms
- "vagas"         — parking spots
- "andar"         — floor number
- "localizacao"   — city, neighborhood or region
- "endereco"      — full street address
- "destaque"      — main headline or highlight phrase
- "diferenciais"  — amenities or differentials list (pool, gym, etc.)
- "foto_imovel"   — area displaying a property photo
- "logo"          — agency/brand logo area

Example: {"fields": ["titulo", "preco", "parcela", "quartos", "localizacao", "foto_imovel", "logo"]}`;

// ── Admin auth ────────────────────────────────────────────────────────────────
function adminAuth(req, res, next) {
  if (req.headers['x-admin-password'] !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Não autorizado' });
  }
  next();
}

// ── ADMIN: Login ──────────────────────────────────────────────────────────────
app.post('/api/admin/login', (req, res) => {
  if (req.body.password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Senha incorreta' });
  }
  res.json({ ok: true });
});

// ── ADMIN: Templates ──────────────────────────────────────────────────────────
app.get('/api/admin/templates', adminAuth, (_, res) => res.json(readTemplates()));

app.post('/api/admin/templates', adminAuth, uploadTemplate.single('imagem'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Imagem obrigatória' });

    const imagePath = path.join(UPLOADS_DIR, 'templates', req.file.filename);
    const img = imageB64FromPath(imagePath);

    const analysis = await openai.chat.completions.create({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.b64}` } },
          { type: 'text', text: ANALYZE_PROMPT },
        ],
      }],
    });

    const parsed = JSON.parse(analysis.choices[0].message.content);
    const fields = Array.isArray(parsed.fields) ? parsed.fields : [];

    const templates = readTemplates();
    const novo = {
      id: Date.now(),
      nome: req.body.nome || req.file.originalname,
      imageUrl: `/uploads/templates/${req.file.filename}`,
      fields,
      criadoEm: new Date().toISOString(),
    };
    templates.push(novo);
    writeTemplates(templates);
    res.status(201).json(novo);
  } catch (err) {
    console.error('Erro análise template:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/templates/:id', adminAuth, (req, res) => {
  const templates = readTemplates();
  const idx = templates.findIndex(t => String(t.id) === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Não encontrado' });
  const [removed] = templates.splice(idx, 1);
  const fp = path.join(__dirname, removed.imageUrl.replace(/^\//, ''));
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  writeTemplates(templates);
  res.json({ ok: true });
});

// ── PUBLIC: Templates ─────────────────────────────────────────────────────────
app.get('/api/templates', (_, res) => res.json(readTemplates()));
app.get('/api/field-labels', (_, res) => res.json(FIELD_LABELS_PT));

// ── PERFIL DA IMOBILIÁRIA ─────────────────────────────────────────────────────
app.get('/api/perfil', (_, res) => res.json(readJSON('perfil.json')));

app.put('/api/perfil', uploadLogo.single('logo'), (req, res) => {
  const perfil = readJSON('perfil.json');
  const campos = ['nome','slogan','creci','telefone','whatsapp','email','site'];
  campos.forEach(c => { if (req.body[c] !== undefined) perfil[c] = req.body[c]; });
  if (req.file) {
    if (perfil.logo) {
      const old = path.join(__dirname, perfil.logo.replace(/^\//, ''));
      if (fs.existsSync(old)) fs.unlinkSync(old);
    }
    perfil.logo = `/uploads/logos/${req.file.filename}`;
  }
  writeJSON('perfil.json', perfil);
  res.json(perfil);
});

// ── IMÓVEIS ───────────────────────────────────────────────────────────────────
app.get('/api/imoveis', (_, res) => res.json(readJSON('imoveis.json')));

app.get('/api/imoveis/:id', (req, res) => {
  const imovel = readJSON('imoveis.json').find(i => i.id === req.params.id);
  if (!imovel) return res.status(404).json({ error: 'Não encontrado' });
  res.json(imovel);
});

app.post('/api/imoveis', uploadImovel.array('fotos', 10), (req, res) => {
  const imoveis = readJSON('imoveis.json');
  const novo = {
    id: Date.now().toString(),
    criadoEm: new Date().toISOString(),
    titulo:        req.body.titulo || '',
    tipo:          req.body.tipo || '',
    status:        req.body.status || 'disponivel',
    preco:         req.body.preco || '',
    entrada:       req.body.entrada || '',
    parcela:       req.body.parcela || '',
    financiamento: req.body.financiamento || '',
    area:          req.body.area || '',
    quartos:       req.body.quartos || '',
    suites:        req.body.suites || '',
    banheiros:     req.body.banheiros || '',
    vagas:         req.body.vagas || '',
    andar:         req.body.andar || '',
    totalAndares:  req.body.totalAndares || '',
    endereco:      req.body.endereco || '',
    bairro:        req.body.bairro || '',
    cidade:        req.body.cidade || '',
    estado:        req.body.estado || '',
    destaque:      req.body.destaque || '',
    diferenciais:  req.body.diferenciais || '',
    descricao:     req.body.descricao || '',
    fotos: (req.files || []).map(f => `/uploads/imoveis/${f.filename}`),
  };
  imoveis.push(novo);
  writeJSON('imoveis.json', imoveis);
  res.status(201).json(novo);
});

app.put('/api/imoveis/:id', uploadImovel.array('fotos', 10), (req, res) => {
  const imoveis = readJSON('imoveis.json');
  const idx = imoveis.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Não encontrado' });
  const campos = ['titulo','tipo','status','preco','entrada','parcela','financiamento',
    'area','quartos','suites','banheiros','vagas','andar','totalAndares',
    'endereco','bairro','cidade','estado','destaque','diferenciais','descricao'];
  campos.forEach(c => { if (req.body[c] !== undefined) imoveis[idx][c] = req.body[c]; });
  if (req.files && req.files.length > 0) {
    const novas = req.files.map(f => `/uploads/imoveis/${f.filename}`);
    imoveis[idx].fotos = [...(imoveis[idx].fotos || []), ...novas];
  }
  writeJSON('imoveis.json', imoveis);
  res.json(imoveis[idx]);
});

app.delete('/api/imoveis/:id', (req, res) => {
  const imoveis = readJSON('imoveis.json');
  const idx = imoveis.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Não encontrado' });
  const [removed] = imoveis.splice(idx, 1);
  (removed.fotos || []).forEach(f => {
    const p = path.join(__dirname, f.replace(/^\//, ''));
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });
  writeJSON('imoveis.json', imoveis);
  res.json({ ok: true });
});

app.delete('/api/imoveis/:id/foto', (req, res) => {
  const imoveis = readJSON('imoveis.json');
  const imovel = imoveis.find(i => i.id === req.params.id);
  if (!imovel) return res.status(404).json({ error: 'Não encontrado' });
  imovel.fotos = (imovel.fotos || []).filter(f => f !== req.body.url);
  const p = path.join(__dirname, req.body.url.replace(/^\//, ''));
  if (fs.existsSync(p)) fs.unlinkSync(p);
  writeJSON('imoveis.json', imoveis);
  res.json(imovel);
});

// ── GERAÇÃO DE ARTE ───────────────────────────────────────────────────────────
const FIELD_DATA = (imovel, localizacao) => ({
  titulo:        `Title: ${imovel.titulo}`,
  preco:         imovel.preco        ? `Price: R$ ${imovel.preco}` : null,
  entrada:       imovel.entrada      ? `Down payment: R$ ${imovel.entrada}` : null,
  parcela:       imovel.parcela      ? `Monthly installment: R$ ${imovel.parcela}` : null,
  financiamento: imovel.financiamento? `Financing: ${imovel.financiamento}` : null,
  area:          imovel.area         ? `Area: ${imovel.area} m²` : null,
  quartos:       imovel.quartos      ? `Bedrooms: ${imovel.quartos}` : null,
  suites:        imovel.suites       ? `Suites: ${imovel.suites}` : null,
  banheiros:     imovel.banheiros    ? `Bathrooms: ${imovel.banheiros}` : null,
  vagas:         imovel.vagas        ? `Parking spots: ${imovel.vagas}` : null,
  andar:         imovel.andar        ? `Floor: ${imovel.andar}º` : null,
  localizacao:   localizacao         ? `Location: ${localizacao}` : null,
  endereco:      imovel.endereco     ? `Address: ${imovel.endereco}` : null,
  destaque:      imovel.destaque     ? `Headline: ${imovel.destaque}` : null,
  diferenciais:  imovel.diferenciais ? `Differentials: ${imovel.diferenciais}` : null,
});

app.post('/api/gerar', async (req, res) => {
  try {
    const { templateId, imovelId } = req.body;

    const template = readTemplates().find(t => String(t.id) === String(templateId));
    if (!template) return res.status(400).json({ error: 'Template inválido' });

    const imovel = readJSON('imoveis.json').find(i => i.id === imovelId);
    if (!imovel) return res.status(400).json({ error: 'Imóvel não encontrado' });

    const perfil = readJSON('perfil.json');

    // Baixa imagem do template
    const templateBuf = await fetchBuffer(`http://localhost:${process.env.PORT || 3000}${template.imageUrl}`);
    const templateB64 = templateBuf.toString('base64');
    const templateExt = path.extname(template.imageUrl).toLowerCase();
    const templateMime = templateExt === '.png' ? 'image/png' : templateExt === '.webp' ? 'image/webp' : 'image/jpeg';

    // Foto do imóvel (se o template pede)
    let imovelImg = null;
    if (template.fields.includes('foto_imovel') && imovel.fotos?.length > 0) {
      imovelImg = imageB64FromPath(path.join(__dirname, imovel.fotos[0].replace(/^\//, '')));
    }

    // Logo da imobiliária (se o template pede)
    let logoImg = null;
    if (template.fields.includes('logo') && perfil.logo) {
      logoImg = imageB64FromPath(path.join(__dirname, perfil.logo.replace(/^\//, '')));
    }

    // Localização
    const localizacao = [imovel.bairro, imovel.cidade, imovel.estado].filter(Boolean).join(', ');

    // Monta dados — apenas os campos que o template declarou ter
    const fieldData = FIELD_DATA(imovel, localizacao);
    const dados = template.fields
      .filter(f => !['foto_imovel', 'logo'].includes(f))
      .map(f => fieldData[f])
      .filter(Boolean)
      .join('\n');

    // Índice das imagens
    let imgIdx = 1;
    const imgOrder = { template: imgIdx++ };
    if (imovelImg) imgOrder.imovel = imgIdx++;
    if (logoImg)   imgOrder.logo   = imgIdx++;

    const mensagem = `Image ${imgOrder.template}: design template — source of truth for layout, zones, colors and typography.
${imovelImg ? `Image ${imgOrder.imovel}: property photo — place in the photo area of the template.` : ''}
${logoImg   ? `Image ${imgOrder.logo}: agency logo — replace the logo zone of the template with this exact logo image. Do not redraw or recreate it.` : ''}

STRICT RULES:
1. Reproduce the template layout pixel-perfectly — do not add, remove or reposition any zone or graphic element.
2. Replace ONLY the fields listed below. Every field corresponds to something already visible in the template. Do not insert any data that is not listed.
3. All replacement text must be in Brazilian Portuguese. Maintain original font style, weight and contrast.

Fields to replace:
${dados || '(no text fields — only replace photo and/or logo)'}`;

    // Monta content
    const content = [];
    content.push({ type: 'input_image', image_url: `data:${templateMime};base64,${templateB64}` });
    if (imovelImg) content.push({ type: 'input_image', image_url: `data:${imovelImg.mime};base64,${imovelImg.b64}` });
    if (logoImg)   content.push({ type: 'input_image', image_url: `data:${logoImg.mime};base64,${logoImg.b64}` });
    content.push({ type: 'input_text', text: mensagem });

    const response = await openai.responses.create({
      model: 'gpt-4o',
      input: [{ role: 'user', content }],
      tools: [{ type: 'image_generation', quality: 'high', size: '1024x1024' }],
    });

    for (const item of response.output || []) {
      if (item.type === 'image_generation_call' && item.result) {
        return res.json({ success: true, imageData: `data:image/png;base64,${item.result}` });
      }
    }

    res.status(500).json({ error: 'Nenhuma imagem gerada' });
  } catch (err) {
    console.error('Erro geração:', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));
