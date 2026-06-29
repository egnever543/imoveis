require('dotenv').config();
const express    = require('express');
const multer     = require('multer');
const https      = require('https');
const http       = require('http');
const OpenAI     = require('openai');
const { createClient } = require('@supabase/supabase-js');
const cloudinary = require('cloudinary').v2;

const app    = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Multer em memória — não salva nada em disco
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());
app.use(express.static('public'));

// ── Helpers ───────────────────────────────────────────────────────────────────

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

async function imageB64FromUrl(url) {
  if (!url) return null;
  try {
    const buf  = await fetchBuffer(url);
    const ext  = url.split('?')[0].split('.').pop().toLowerCase();
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    return { b64: buf.toString('base64'), mime };
  } catch {
    return null;
  }
}

function cloudinaryUpload(buffer, folder) {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image' },
      (err, result) => err ? reject(err) : resolve(result)
    ).end(buffer);
  });
}

function cloudinaryPublicId(url) {
  const m = url.match(/\/upload\/(?:v\d+\/)?(.+)\.[a-z]+$/i);
  return m ? m[1] : null;
}

// Mapeia colunas snake_case do DB para camelCase da API
function fromDb(row) {
  if (!row) return null;
  const r = { ...row };
  if ('criado_em'     in r) { r.criadoEm     = r.criado_em;     delete r.criado_em; }
  if ('total_andares' in r) { r.totalAndares  = r.total_andares; delete r.total_andares; }
  if ('image_url'     in r) { r.imageUrl      = r.image_url;     delete r.image_url; }
  return r;
}

// ── Labels dos campos ─────────────────────────────────────────────────────────
const FIELD_LABELS_PT = {
  titulo: 'Título', preco: 'Preço', entrada: 'Entrada', parcela: 'Parcela',
  financiamento: 'Financiamento', area: 'Área (m²)', quartos: 'Quartos',
  suites: 'Suítes', banheiros: 'Banheiros', vagas: 'Vagas', andar: 'Andar',
  localizacao: 'Localização', endereco: 'Endereço', destaque: 'Chamada principal',
  diferenciais: 'Diferenciais', foto_imovel: 'Foto do imóvel', logo: 'Logo',
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
app.get('/api/admin/templates', adminAuth, async (_, res) => {
  const { data, error } = await supabase
    .from('templates').select('*').order('criado_em', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data.map(fromDb));
});

app.post('/api/admin/templates', adminAuth, upload.single('imagem'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Imagem obrigatória' });

    // Upload para Cloudinary
    const result = await cloudinaryUpload(req.file.buffer, 'templates');

    // Busca buffer para análise da IA
    const img = await imageB64FromUrl(result.secure_url);

    // Analisa campos presentes com IA
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

    const { data, error } = await supabase.from('templates').insert({
      id: Date.now(),
      nome: req.body.nome || req.file.originalname,
      image_url: result.secure_url,
      fields,
    }).select().single();

    if (error) throw new Error(error.message);
    res.status(201).json(fromDb(data));
  } catch (err) {
    console.error('Erro análise template:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/templates/:id', adminAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('templates').delete().eq('id', req.params.id).select().single();
  if (error) return res.status(404).json({ error: 'Não encontrado' });
  const pid = cloudinaryPublicId(data.image_url);
  if (pid) await cloudinary.uploader.destroy(pid).catch(() => {});
  res.json({ ok: true });
});

// ── PUBLIC: Templates & Labels ────────────────────────────────────────────────
app.get('/api/templates', async (_, res) => {
  const { data, error } = await supabase
    .from('templates').select('*').order('criado_em', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data.map(fromDb));
});

app.get('/api/field-labels', (_, res) => res.json(FIELD_LABELS_PT));

// ── PERFIL ────────────────────────────────────────────────────────────────────
app.get('/api/perfil', async (_, res) => {
  const { data, error } = await supabase.from('perfil').select('*').eq('id', 1).single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.put('/api/perfil', upload.single('logo'), async (req, res) => {
  const campos = ['nome','slogan','creci','telefone','whatsapp','email','site'];
  const updates = {};
  campos.forEach(c => { if (req.body[c] !== undefined) updates[c] = req.body[c]; });

  if (req.file) {
    const { data: old } = await supabase.from('perfil').select('logo').eq('id', 1).single();
    if (old?.logo) {
      const pid = cloudinaryPublicId(old.logo);
      if (pid) await cloudinary.uploader.destroy(pid).catch(() => {});
    }
    const result = await cloudinaryUpload(req.file.buffer, 'logos');
    updates.logo = result.secure_url;
  }

  const { data, error } = await supabase
    .from('perfil').update(updates).eq('id', 1).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── IMÓVEIS ───────────────────────────────────────────────────────────────────
app.get('/api/imoveis', async (_, res) => {
  const { data, error } = await supabase
    .from('imoveis').select('*').order('criado_em', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data.map(fromDb));
});

app.get('/api/imoveis/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('imoveis').select('*').eq('id', req.params.id).single();
  if (error) return res.status(404).json({ error: 'Não encontrado' });
  res.json(fromDb(data));
});

app.post('/api/imoveis', upload.array('fotos', 10), async (req, res) => {
  try {
    const fotos = [];
    for (const file of (req.files || [])) {
      const r = await cloudinaryUpload(file.buffer, 'imoveis');
      fotos.push(r.secure_url);
    }

    const { data, error } = await supabase.from('imoveis').insert({
      id:            Date.now().toString(),
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
      total_andares: req.body.totalAndares || '',
      endereco:      req.body.endereco || '',
      bairro:        req.body.bairro || '',
      cidade:        req.body.cidade || '',
      estado:        req.body.estado || '',
      destaque:      req.body.destaque || '',
      diferenciais:  req.body.diferenciais || '',
      descricao:     req.body.descricao || '',
      fotos,
    }).select().single();

    if (error) throw new Error(error.message);
    res.status(201).json(fromDb(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/imoveis/:id', upload.array('fotos', 10), async (req, res) => {
  try {
    const campos = ['titulo','tipo','status','preco','entrada','parcela','financiamento',
      'area','quartos','suites','banheiros','vagas','andar',
      'endereco','bairro','cidade','estado','destaque','diferenciais','descricao'];
    const updates = {};
    campos.forEach(c => { if (req.body[c] !== undefined) updates[c] = req.body[c]; });
    if (req.body.totalAndares !== undefined) updates.total_andares = req.body.totalAndares;

    if (req.files?.length > 0) {
      const { data: existing } = await supabase
        .from('imoveis').select('fotos').eq('id', req.params.id).single();
      const novas = [];
      for (const file of req.files) {
        const r = await cloudinaryUpload(file.buffer, 'imoveis');
        novas.push(r.secure_url);
      }
      updates.fotos = [...(existing?.fotos || []), ...novas];
    }

    const { data, error } = await supabase
      .from('imoveis').update(updates).eq('id', req.params.id).select().single();
    if (error) return res.status(404).json({ error: 'Não encontrado' });
    res.json(fromDb(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/imoveis/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('imoveis').delete().eq('id', req.params.id).select().single();
  if (error) return res.status(404).json({ error: 'Não encontrado' });
  for (const url of (data.fotos || [])) {
    const pid = cloudinaryPublicId(url);
    if (pid) await cloudinary.uploader.destroy(pid).catch(() => {});
  }
  res.json({ ok: true });
});

app.delete('/api/imoveis/:id/foto', async (req, res) => {
  const fotoUrl = req.body.url;
  const { data, error } = await supabase
    .from('imoveis').select('fotos').eq('id', req.params.id).single();
  if (error) return res.status(404).json({ error: 'Não encontrado' });

  const novas = (data.fotos || []).filter(f => f !== fotoUrl);
  const { data: updated } = await supabase
    .from('imoveis').update({ fotos: novas }).eq('id', req.params.id).select().single();

  const pid = cloudinaryPublicId(fotoUrl);
  if (pid) await cloudinary.uploader.destroy(pid).catch(() => {});

  res.json(fromDb(updated));
});

// ── GERAÇÃO DE ARTE ───────────────────────────────────────────────────────────
const FIELD_DATA = (imovel, localizacao) => ({
  titulo:        `Title: ${imovel.titulo}`,
  preco:         imovel.preco         ? `Price: R$ ${imovel.preco}` : null,
  entrada:       imovel.entrada       ? `Down payment: R$ ${imovel.entrada}` : null,
  parcela:       imovel.parcela       ? `Monthly installment: R$ ${imovel.parcela}` : null,
  financiamento: imovel.financiamento ? `Financing: ${imovel.financiamento}` : null,
  area:          imovel.area          ? `Area: ${imovel.area} m²` : null,
  quartos:       imovel.quartos       ? `Bedrooms: ${imovel.quartos}` : null,
  suites:        imovel.suites        ? `Suites: ${imovel.suites}` : null,
  banheiros:     imovel.banheiros     ? `Bathrooms: ${imovel.banheiros}` : null,
  vagas:         imovel.vagas         ? `Parking spots: ${imovel.vagas}` : null,
  andar:         imovel.andar         ? `Floor: ${imovel.andar}º` : null,
  localizacao:   localizacao          ? `Location: ${localizacao}` : null,
  endereco:      imovel.endereco      ? `Address: ${imovel.endereco}` : null,
  destaque:      imovel.destaque      ? `Headline: ${imovel.destaque}` : null,
  diferenciais:  imovel.diferenciais  ? `Differentials: ${imovel.diferenciais}` : null,
});

app.post('/api/gerar', async (req, res) => {
  try {
    const { templateId, imovelId } = req.body;

    const { data: tRow } = await supabase.from('templates').select('*').eq('id', templateId).single();
    if (!tRow) return res.status(400).json({ error: 'Template inválido' });
    const template = fromDb(tRow);

    const { data: imRow } = await supabase.from('imoveis').select('*').eq('id', imovelId).single();
    if (!imRow) return res.status(400).json({ error: 'Imóvel não encontrado' });
    const imovel = fromDb(imRow);

    const { data: perfil } = await supabase.from('perfil').select('*').eq('id', 1).single();

    // Carrega imagens via URL (Cloudinary)
    const templateImg = await imageB64FromUrl(template.imageUrl);
    if (!templateImg) return res.status(500).json({ error: 'Não foi possível carregar o template' });

    let imovelImg = null;
    if (template.fields.includes('foto_imovel') && imovel.fotos?.length > 0) {
      imovelImg = await imageB64FromUrl(imovel.fotos[0]);
    }

    let logoImg = null;
    if (template.fields.includes('logo') && perfil?.logo) {
      logoImg = await imageB64FromUrl(perfil.logo);
    }

    const localizacao = [imovel.bairro, imovel.cidade, imovel.estado].filter(Boolean).join(', ');
    const fieldData   = FIELD_DATA(imovel, localizacao);
    const dados = template.fields
      .filter(f => !['foto_imovel', 'logo'].includes(f))
      .map(f => fieldData[f])
      .filter(Boolean)
      .join('\n');

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

    const content = [];
    content.push({ type: 'input_image', image_url: `data:${templateImg.mime};base64,${templateImg.b64}` });
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
