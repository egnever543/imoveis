require('dotenv').config();
const express    = require('express');
const multer     = require('multer');
const path       = require('path');
const https      = require('https');
const http       = require('http');
const OpenAI     = require('openai');
const { createClient } = require('@supabase/supabase-js');
const cloudinary = require('cloudinary').v2;

const app    = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const sharp  = require('sharp');
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Slots de foto do imóvel ───────────────────────────────────────────────────
const PHOTO_SLOTS = [
  { key: 'frontal',         label: 'Fachada / Frontal'       },
  { key: 'aereo',           label: 'Vista Aérea'             },
  { key: 'baixo_para_cima', label: 'Vista de Baixo (Prédio)' },
  { key: 'sala',            label: 'Sala de Estar'           },
  { key: 'cozinha',         label: 'Cozinha'                 },
  { key: 'quarto',          label: 'Quarto Principal'        },
  { key: 'suite',           label: 'Suíte'                   },
  { key: 'banheiro',        label: 'Banheiro'                },
  { key: 'sacada',          label: 'Sacada / Varanda'        },
  { key: 'area_lazer',      label: 'Área de Lazer'           },
  { key: 'garagem',         label: 'Garagem / Vaga'          },
];

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
  if (!url) return null;
  const m = url.match(/\/upload\/(?:v\d+\/)?(.+)\.[a-z]+$/i);
  return m ? m[1] : null;
}

function fromDb(row) {
  if (!row) return null;
  const r = { ...row };
  if ('criado_em'     in r) { r.criadoEm     = r.criado_em;     delete r.criado_em; }
  if ('total_andares' in r) { r.totalAndares  = r.total_andares; delete r.total_andares; }
  if ('image_url'     in r) { r.imageUrl      = r.image_url;     delete r.image_url; }
  // fotos é JSONB — vem como objeto, garante {}
  if ('fotos' in r) r.fotos = r.fotos || {};
  return r;
}

// ── Geração do guia anotado ───────────────────────────────────────────────────
const ZONE_COLORS = {
  foto_imovel:  '#10b981',
  logo:         '#8b5cf6',
  titulo:       '#3b82f6',
  preco:        '#f59e0b',
  entrada:      '#f59e0b',
  parcela:      '#f59e0b',
  financiamento:'#f59e0b',
  destaque:     '#ec4899',
  _default:     '#64748b',
};

function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1,3),16),
    parseInt(hex.slice(3,5),16),
    parseInt(hex.slice(5,7),16),
  ];
}

async function gerarGuia(imageUrl, zonas, labels) {
  const buf  = await fetchBuffer(imageUrl);
  const meta = await sharp(buf).metadata();
  const W = meta.width, H = meta.height;

  const rects = Object.entries(zonas).map(([field, z]) => {
    const x = Math.round(z.xPct / 100 * W);
    const y = Math.round(z.yPct / 100 * H);
    const w = Math.round(z.wPct / 100 * W);
    const h = Math.round(z.hPct / 100 * H);
    const color = ZONE_COLORS[field] || ZONE_COLORS._default;
    const [r,g,b] = hexToRgb(color);
    const label   = `[ ${(labels[field] || field).toUpperCase()} ]`;
    const fs      = Math.max(14, Math.min(36, Math.round(h * 0.32)));
    return `
      <rect x="${x}" y="${y}" width="${w}" height="${h}"
            fill="rgb(${r},${g},${b})" fill-opacity="0.42"
            stroke="rgb(${r},${g},${b})" stroke-width="3" rx="4"/>
      <text x="${x + w/2}" y="${y + h/2}"
            font-family="Arial Black, Arial, sans-serif"
            font-size="${fs}" font-weight="900"
            fill="white" text-anchor="middle" dominant-baseline="middle"
            stroke="black" stroke-width="2" paint-order="stroke">
        ${label}
      </text>`;
  }).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${rects}</svg>`;

  return sharp(buf)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();
}

// ── Labels ────────────────────────────────────────────────────────────────────
const FIELD_LABELS_PT = {
  titulo: 'Título', preco: 'Preço', entrada: 'Entrada', parcela: 'Parcela',
  financiamento: 'Financiamento', area: 'Área (m²)', quartos: 'Quartos',
  suites: 'Suítes', banheiros: 'Banheiros', vagas: 'Vagas', andar: 'Andar',
  localizacao: 'Localização', endereco: 'Endereço', destaque: 'Chamada principal',
  diferenciais: 'Diferenciais', foto_imovel: 'Foto do imóvel', logo: 'Logo',
};

const ANGLE_LABELS_PT = Object.fromEntries(PHOTO_SLOTS.map(s => [s.key, s.label]));

// ── Prompt análise template ───────────────────────────────────────────────────
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
  if (req.headers['x-admin-password'] !== process.env.ADMIN_PASSWORD)
    return res.status(401).json({ error: 'Não autorizado' });
  next();
}

// ── ADMIN: Login ──────────────────────────────────────────────────────────────
app.post('/api/admin/login', (req, res) => {
  if (req.body.password !== process.env.ADMIN_PASSWORD)
    return res.status(401).json({ error: 'Senha incorreta' });
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

    const result = await cloudinaryUpload(req.file.buffer, 'templates');
    const img    = await imageB64FromUrl(result.secure_url);

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
      id:        Date.now(),
      nome:      req.body.nome || req.file.originalname,
      image_url: result.secure_url,
      fields,
      angulos:   [],
    }).select().single();

    if (error) throw new Error(error.message);
    res.status(201).json(fromDb(data));
  } catch (err) {
    console.error('Erro análise template:', err);
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/admin/templates/:id', adminAuth, async (req, res) => {
  const { nome, fields, angulos, zonas } = req.body;
  const update = {};
  if (nome    !== undefined) update.nome    = nome;
  if (fields  !== undefined) update.fields  = fields;
  if (angulos !== undefined) update.angulos = angulos;
  if (zonas   !== undefined) update.zonas   = zonas;
  const { data, error } = await supabase
    .from('templates').update(update).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(fromDb(data));
});

app.delete('/api/admin/templates/:id', adminAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('templates').delete().eq('id', req.params.id).select().single();
  if (error) return res.status(404).json({ error: 'Não encontrado' });
  const pid = cloudinaryPublicId(data.image_url);
  if (pid) await cloudinary.uploader.destroy(pid).catch(() => {});
  res.json({ ok: true });
});

// ── PUBLIC: Templates, Labels, Slots ─────────────────────────────────────────
app.get('/api/templates', async (_, res) => {
  const { data, error } = await supabase
    .from('templates').select('*').order('criado_em', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data.map(fromDb));
});

app.get('/api/field-labels',  (_, res) => res.json(FIELD_LABELS_PT));
app.get('/api/angle-labels',  (_, res) => res.json(ANGLE_LABELS_PT));
app.get('/api/photo-slots',   (_, res) => res.json(PHOTO_SLOTS));

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

// Upload de foto por slot: POST /api/imoveis/:id/foto/:slot
app.post('/api/imoveis/:id/foto/:slot', upload.single('foto'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Foto obrigatória' });
    const slot = req.params.slot;
    if (!PHOTO_SLOTS.find(s => s.key === slot))
      return res.status(400).json({ error: 'Slot inválido' });

    const { data: existing } = await supabase
      .from('imoveis').select('fotos').eq('id', req.params.id).single();
    if (!existing) return res.status(404).json({ error: 'Imóvel não encontrado' });

    // Remove foto antiga do slot no Cloudinary
    const oldUrl = (existing.fotos || {})[slot];
    if (oldUrl) {
      const pid = cloudinaryPublicId(oldUrl);
      if (pid) await cloudinary.uploader.destroy(pid).catch(() => {});
    }

    const result  = await cloudinaryUpload(req.file.buffer, 'imoveis');
    const novasFotos = { ...(existing.fotos || {}), [slot]: result.secure_url };

    const { data, error } = await supabase
      .from('imoveis').update({ fotos: novasFotos }).eq('id', req.params.id).select().single();
    if (error) throw new Error(error.message);
    res.json(fromDb(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Remove foto de um slot: DELETE /api/imoveis/:id/foto/:slot
app.delete('/api/imoveis/:id/foto/:slot', async (req, res) => {
  const { data: existing } = await supabase
    .from('imoveis').select('fotos').eq('id', req.params.id).single();
  if (!existing) return res.status(404).json({ error: 'Não encontrado' });

  const slot   = req.params.slot;
  const oldUrl = (existing.fotos || {})[slot];
  if (oldUrl) {
    const pid = cloudinaryPublicId(oldUrl);
    if (pid) await cloudinary.uploader.destroy(pid).catch(() => {});
  }

  const novasFotos = { ...(existing.fotos || {}) };
  delete novasFotos[slot];

  const { data, error } = await supabase
    .from('imoveis').update({ fotos: novasFotos }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(fromDb(data));
});

const IMOVEL_CAMPOS = [
  'titulo','tipo','status','preco','entrada','parcela','financiamento',
  'area','quartos','suites','banheiros','vagas','andar',
  'endereco','bairro','cidade','estado','destaque','diferenciais','descricao',
];

app.post('/api/imoveis', async (req, res) => {
  try {
    const fields = {};
    IMOVEL_CAMPOS.forEach(c => { fields[c] = req.body[c] || ''; });
    if (req.body.totalAndares !== undefined) fields.total_andares = req.body.totalAndares;

    const { data, error } = await supabase.from('imoveis').insert({
      id: Date.now().toString(),
      ...fields,
      fotos: {},
    }).select().single();

    if (error) throw new Error(error.message);
    res.status(201).json(fromDb(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/imoveis/:id', async (req, res) => {
  try {
    const updates = {};
    IMOVEL_CAMPOS.forEach(c => { if (req.body[c] !== undefined) updates[c] = req.body[c]; });
    if (req.body.totalAndares !== undefined) updates.total_andares = req.body.totalAndares;

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
  for (const url of Object.values(data.fotos || {})) {
    const pid = cloudinaryPublicId(url);
    if (pid) await cloudinary.uploader.destroy(pid).catch(() => {});
  }
  res.json({ ok: true });
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

    // Gera guia anotado se houver zonas mapeadas, senão usa o original
    const zonas = template.zonas || {};
    let templateImg;
    if (Object.keys(zonas).length > 0) {
      const guiaBuf = await gerarGuia(template.imageUrl, zonas, FIELD_LABELS_PT);
      const b64     = guiaBuf.toString('base64');
      templateImg   = { b64, mime: 'image/png' };
    } else {
      templateImg = await imageB64FromUrl(template.imageUrl);
    }
    if (!templateImg) return res.status(500).json({ error: 'Não foi possível carregar o template' });

    // Seleciona fotos pelos ângulos exigidos pelo template
    const angulos = template.angulos || [];
    const fotoSlots = [];
    if (template.fields.includes('foto_imovel') && angulos.length > 0) {
      for (const ang of angulos) {
        const url = (imovel.fotos || {})[ang];
        if (url) {
          const img = await imageB64FromUrl(url);
          if (img) fotoSlots.push({ ang, img });
        }
      }
    } else if (template.fields.includes('foto_imovel')) {
      // Sem ângulo definido — usa qualquer foto disponível
      const primeiraUrl = Object.values(imovel.fotos || {})[0];
      if (primeiraUrl) {
        const img = await imageB64FromUrl(primeiraUrl);
        if (img) fotoSlots.push({ ang: 'foto', img });
      }
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
    fotoSlots.forEach((_, i) => { imgOrder[`foto_${i}`] = imgIdx++; });
    if (logoImg) imgOrder.logo = imgIdx++;

    const fotoLines = fotoSlots.map((s, i) =>
      `Image ${imgOrder[`foto_${i}`]}: property photo (${ANGLE_LABELS_PT[s.ang] || s.ang}) — place in the photo area of the template.`
    ).join('\n');

    const mensagem = `Image ${imgOrder.template}: design template — source of truth for layout, zones, colors and typography.
${fotoLines}
${logoImg ? `Image ${imgOrder.logo}: agency logo — replace the logo zone of the template with this exact logo image. Do not redraw or recreate it.` : ''}

STRICT RULES:
1. Reproduce the template layout pixel-perfectly — do not add, remove or reposition any zone or graphic element.
2. Replace ONLY the fields listed below. Every field corresponds to something already visible in the template. Do not insert any data that is not listed.
3. All replacement text must be in Brazilian Portuguese. Maintain original font style, weight and contrast.

Fields to replace:
${dados || '(no text fields — only replace photo and/or logo)'}`;

    const content = [];
    content.push({ type: 'input_image', image_url: `data:${templateImg.mime};base64,${templateImg.b64}` });
    fotoSlots.forEach(s => content.push({ type: 'input_image', image_url: `data:${s.img.mime};base64,${s.img.b64}` }));
    if (logoImg) content.push({ type: 'input_image', image_url: `data:${logoImg.mime};base64,${logoImg.b64}` });
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

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));
}

module.exports = app;
