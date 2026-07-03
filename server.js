require('dotenv').config();
const express    = require('express');
const multer     = require('multer');
const path       = require('path');
const https      = require('https');
const http       = require('http');
const OpenAI     = require('openai');
const { createClient } = require('@supabase/supabase-js');
const cloudinary = require('cloudinary').v2;
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'imoveis-secret-key-change-in-prod';

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

const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;

const upload = multer({ storage: multer.memoryStorage() });

// ── Stripe webhook (precisa do body cru, antes do express.json) ──────────────
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) return res.status(500).json({ error: 'Stripe não configurado' });
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).json({ error: `Webhook inválido: ${err.message}` });
  }

  try {
    const obj = event.data.object;

    if (event.type === 'checkout.session.completed') {
      const userId = Number(obj.metadata?.user_id);

      if (obj.mode === 'payment' && obj.metadata?.tipo === 'recarga' && userId) {
        const cfg = await getBillingConfig();
        const brl = obj.amount_total / 100;
        const usd = +(brl / cfg.cotacao_brl).toFixed(4);
        await creditar(userId, usd, `Recarga de créditos (R$ ${brl.toFixed(2)})`, obj.id);
        if (obj.customer) await supabase.from('usuarios').update({ stripe_customer_id: obj.customer }).eq('id', userId);
      }

      if (obj.mode === 'subscription' && userId) {
        const expira = new Date(); expira.setFullYear(expira.getFullYear() + 1);
        await supabase.from('usuarios').update({
          assinatura_status: 'ativa',
          assinatura_expira: expira.toISOString(),
          stripe_customer_id: obj.customer,
        }).eq('id', userId);
      }
    }

    if (event.type === 'invoice.paid' && obj.customer && obj.billing_reason === 'subscription_cycle') {
      const expira = new Date(); expira.setFullYear(expira.getFullYear() + 1);
      await supabase.from('usuarios')
        .update({ assinatura_status: 'ativa', assinatura_expira: expira.toISOString() })
        .eq('stripe_customer_id', obj.customer);
    }

    if ((event.type === 'customer.subscription.deleted' || event.type === 'invoice.payment_failed') && obj.customer) {
      await supabase.from('usuarios')
        .update({ assinatura_status: 'inativa' })
        .eq('stripe_customer_id', obj.customer);
    }

    if (event.type === 'payment_intent.succeeded' && obj.metadata?.tipo === 'auto_recarga') {
      const userId = Number(obj.metadata.user_id);
      const cfg = await getBillingConfig();
      const brl = obj.amount / 100;
      const usd = +(brl / cfg.cotacao_brl).toFixed(4);
      await creditar(userId, usd, `Auto-recarga (R$ ${brl.toFixed(2)})`, obj.id);
      await supabase.from('usuarios').update({ auto_recarga_falhou: false }).eq('id', userId);
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Erro webhook:', err);
    res.status(500).json({ error: err.message });
  }
});

app.use(express.json({ limit: '10mb' }));
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
  if ('fotos' in r) r.fotos = r.fotos || {};
  if ('mapa'  in r) {
    if (typeof r.mapa === 'string') {
      try { r.mapa = JSON.parse(r.mapa); } catch { r.mapa = {}; }
    }
    r.mapa = r.mapa || {};
  }
  if ('template_nome' in r) { r.templateNome = r.template_nome; delete r.template_nome; }
  if ('imovel_titulo' in r) { r.imovelTitulo = r.imovel_titulo; delete r.imovel_titulo; }
  if ('template_id'   in r) { r.templateId   = r.template_id;   delete r.template_id; }
  if ('imovel_id'     in r) { r.imovelId     = r.imovel_id;     delete r.imovel_id; }
  return r;
}

// ── Billing: config, saldo e transações ───────────────────────────────────────
const BILLING_DEFAULTS = {
  markup_pct: 30,           // % sobre o custo de tokens
  cotacao_brl: 5.50,        // R$ por US$ na conversão de recargas
  preco_assinatura_brl: 289.90,
  recarga_min_brl: 25,
  trial_dias: 7,
  trial_credito_usd: 1.0,
};

async function getBillingConfig() {
  const { data } = await supabase.from('config').select('valor').eq('chave', 'billing').single();
  return { ...BILLING_DEFAULTS, ...(data?.valor || {}) };
}

async function getSaldo(userId) {
  const { data } = await supabase.from('transacoes').select('valor_usd').eq('user_id', userId);
  return +((data || []).reduce((s, t) => s + Number(t.valor_usd), 0)).toFixed(4);
}

async function creditar(userId, usd, descricao, ref) {
  if (!usd || usd <= 0) return;
  await supabase.from('transacoes').insert({ user_id: userId, tipo: 'credito', valor_usd: usd, descricao, ref: ref || null });
}

async function debitar(userId, usd, descricao, ref) {
  if (!usd || usd <= 0) return;
  await supabase.from('transacoes').insert({ user_id: userId, tipo: 'debito', valor_usd: -usd, descricao, ref: ref || null });
}

// Custo final cobrado do cliente = custo real × (1 + markup)
async function custoComMarkup(custoUsd) {
  const cfg = await getBillingConfig();
  return +(custoUsd * (1 + (cfg.markup_pct || 0) / 100)).toFixed(4);
}

// Gate: exige assinatura ativa/trial válida e saldo positivo
async function billingGate(req, res, next) {
  try {
    const { data: u } = await supabase.from('usuarios')
      .select('assinatura_status, assinatura_expira').eq('id', req.user.id).single();
    const valida = u && ['ativa', 'trial'].includes(u.assinatura_status)
      && (!u.assinatura_expira || new Date(u.assinatura_expira) > new Date());
    if (!valida) return res.status(402).json({ error: 'Assinatura inativa. Assine o plano para gerar artes.', code: 'assinatura' });

    const saldo = await getSaldo(req.user.id);
    if (saldo < 0.05) return res.status(402).json({ error: 'Saldo de créditos insuficiente. Faça uma recarga.', code: 'saldo' });
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Auto-recarga: dispara cobrança off-session quando o saldo cai abaixo de US$ 1
async function verificarAutoRecarga(userId) {
  if (!stripe) return;
  try {
    const { data: u } = await supabase.from('usuarios')
      .select('auto_recarga_ativa, auto_recarga_falhou, auto_recarga_valor_brl, stripe_customer_id')
      .eq('id', userId).single();
    if (!u?.auto_recarga_ativa || u.auto_recarga_falhou || !u.stripe_customer_id) return;

    const saldo = await getSaldo(userId);
    if (saldo >= 1) return;

    const pms = await stripe.paymentMethods.list({ customer: u.stripe_customer_id, type: 'card', limit: 1 });
    if (!pms.data.length) throw new Error('sem cartão salvo');

    await stripe.paymentIntents.create({
      amount: Math.round(Number(u.auto_recarga_valor_brl || 50) * 100),
      currency: 'brl',
      customer: u.stripe_customer_id,
      payment_method: pms.data[0].id,
      off_session: true,
      confirm: true,
      metadata: { user_id: String(userId), tipo: 'auto_recarga' },
    });
    // O crédito entra via webhook payment_intent.succeeded
  } catch (err) {
    console.error('Auto-recarga falhou:', err.message);
    await supabase.from('usuarios').update({ auto_recarga_falhou: true }).eq('id', userId);
  }
}

// ── Custo estimado (USD) ──────────────────────────────────────────────────────
// gpt-4o: $2.50/1M tokens de entrada, $10/1M de saída.
// image_generation high: ~$0.167 (1024x1024) / ~$0.25 (1024x1536) por imagem.
const PRECO = { in: 2.5 / 1e6, out: 10 / 1e6, img1024: 0.167, img1536: 0.25 };

function custoChat(usage) {
  if (!usage) return null;
  return +((usage.prompt_tokens || 0) * PRECO.in + (usage.completion_tokens || 0) * PRECO.out).toFixed(6);
}

function registrarLog(entry) {
  supabase.from('logs').insert(entry).then(() => {}, () => {});
}

// ── Labels ────────────────────────────────────────────────────────────────────
const FIELD_LABELS_PT = {
  titulo: 'Título', preco: 'Preço', entrada: 'Entrada', parcela: 'Parcela',
  financiamento: 'Financiamento', area: 'Área (m²)', quartos: 'Quartos',
  suites: 'Suítes', banheiros: 'Banheiros', vagas: 'Vagas', andar: 'Andar',
  cidade: 'Cidade', localizacao: 'Localização (bairro/região)', endereco: 'Endereço', destaque: 'Chamada principal',
  diferenciais: 'Diferenciais', foto_imovel: 'Foto do imóvel', logo: 'Logo',
  telefone: 'Telefone (do perfil)', whatsapp: 'WhatsApp (do perfil)', creci: 'CRECI (do perfil)',
  site: 'Site (do perfil)', slogan: 'Slogan (do perfil)',
};

const ANGLE_LABELS_PT = Object.fromEntries(PHOTO_SLOTS.map(s => [s.key, s.label]));

// ── Prompt análise template ───────────────────────────────────────────────────
const ANALYZE_PROMPT = `Analyze this real estate marketing banner template image carefully.

Return ONLY a valid JSON object with two keys: "fields" and "mapa".

1. "fields": array of field names present in the template. Use exclusively these names:
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
- "cidade"        — city name only (when the template shows just the city, e.g. "PATOS DE MINAS" or "APARTAMENTOS EM PATOS DE MINAS")
- "localizacao"   — neighborhood, region or broader location (when separate from city)
- "endereco"      — full street address
- "destaque"      — main headline or highlight phrase
- "diferenciais"  — amenities or differentials list (pool, gym, etc.)
- "foto_imovel"   — area displaying a property photo
- "logo"          — agency/brand logo area
- "telefone"      — contact phone number
- "whatsapp"      — WhatsApp contact number
- "creci"         — CRECI license number of the agent/agency
- "site"          — website URL
- "slogan"        — agency slogan or tagline

2. "mapa": a JSON object where each key is a field name from "fields" and the value is a short description (in Portuguese) of exactly how that element appears in this specific image — the literal text or context visible. This will be used to build precise find-and-replace instructions.

Example:
{
  "cidade": "nome da cidade 'PATOS DE MINAS' dentro da frase 'APARTAMENTOS EM PATOS DE MINAS' no topo",
  "localizacao": "bairro 'Setor Bueno' abaixo do título no centro",
  "entrada": "valor após o label 'Entrada:' em destaque no centro",
  "parcela": "valor após o label 'Mensais:' abaixo da entrada",
  "logo": "logotipo da imobiliária no canto superior direito",
  "foto_imovel": "foto da fachada do empreendimento na metade inferior"
}

Full example output: {"fields": ["entrada", "parcela", "cidade", "foto_imovel", "logo"], "mapa": {"cidade": "...", "entrada": "..."}}`;

// ── Admin auth ────────────────────────────────────────────────────────────────
function adminAuth(req, res, next) {
  if (req.headers['x-admin-password'] !== process.env.ADMIN_PASSWORD)
    return res.status(401).json({ error: 'Não autorizado' });
  next();
}

// ── User auth middleware ──────────────────────────────────────────────────────
function userAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Não autenticado' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}

// ── ADMIN: Login ──────────────────────────────────────────────────────────────
app.post('/api/admin/login', (req, res) => {
  if (req.body.password !== process.env.ADMIN_PASSWORD)
    return res.status(401).json({ error: 'Senha incorreta' });
  res.json({ ok: true });
});

// ── AUTH: Cadastro e Login ────────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, nome } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email e senha obrigatórios' });
    if (password.length < 6)  return res.status(400).json({ error: 'Senha deve ter ao menos 6 caracteres' });

    const { data: existing } = await supabase.from('usuarios').select('id').eq('email', email.toLowerCase()).single();
    if (existing) return res.status(400).json({ error: 'Email já cadastrado' });

    const senha_hash = await bcrypt.hash(password, 10);
    const { data, error } = await supabase.from('usuarios').insert({
      email: email.toLowerCase(),
      senha_hash,
      nome: nome || '',
    }).select('id, email, nome').single();

    if (error) throw new Error(error.message);

    // Cria perfil vazio para o novo usuário (o PUT /api/perfil cria depois se isto falhar)
    const { error: perfilErr } = await supabase.from('perfil').insert({ user_id: data.id });
    if (perfilErr) console.error('Falha ao criar perfil no cadastro:', perfilErr.message);

    // Trial: X dias de acesso + crédito de boas-vindas
    const cfg = await getBillingConfig();
    const expira = new Date(); expira.setDate(expira.getDate() + (cfg.trial_dias || 7));
    await supabase.from('usuarios').update({
      assinatura_status: 'trial',
      assinatura_expira: expira.toISOString(),
    }).eq('id', data.id);
    await creditar(data.id, cfg.trial_credito_usd || 1, 'Crédito de boas-vindas (trial)');

    const token = jwt.sign({ id: data.id, email: data.email }, JWT_SECRET, { expiresIn: '30d' });
    res.status(201).json({ token, user: { id: data.id, email: data.email, nome: data.nome } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email e senha obrigatórios' });

    const { data: user } = await supabase.from('usuarios').select('*').eq('email', email.toLowerCase()).single();
    if (!user) return res.status(401).json({ error: 'Email ou senha incorretos' });

    const ok = await bcrypt.compare(password, user.senha_hash);
    if (!ok) return res.status(401).json({ error: 'Email ou senha incorretos' });

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, email: user.email, nome: user.nome } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

    const buf  = req.file.buffer;
    const mime = req.file.mimetype;
    const b64  = buf.toString('base64');

    // Analisa campos na imagem já editada pelo cliente
    const analysis = await openai.chat.completions.create({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } },
          { type: 'text', text: ANALYZE_PROMPT },
        ],
      }],
    });
    const parsed = JSON.parse(analysis.choices[0].message.content);
    registrarLog({
      tipo: 'analise', input: { template: req.body.nome || req.file.originalname }, status: 'ok',
      usage: analysis.usage || null, custo: custoChat(analysis.usage),
    });
    const fields = Array.isArray(parsed.fields) ? parsed.fields : [];
    const mapa   = (parsed.mapa && typeof parsed.mapa === 'object') ? parsed.mapa : {};

    const result = await cloudinaryUpload(buf, 'templates');
    const { data, error } = await supabase.from('templates').insert({
      id:        Date.now(),
      nome:      req.body.nome || req.file.originalname,
      image_url: result.secure_url,
      fields,
      angulos:   [],
      mapa: JSON.stringify(mapa),
    }).select().single();

    if (error) throw new Error(error.message);
    res.status(201).json(fromDb(data));
  } catch (err) {
    console.error('Erro análise template:', err);
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/admin/templates/:id', adminAuth, async (req, res) => {
  const { nome, fields, angulos, mapa, transcricao } = req.body;
  const update = {};
  if (nome        !== undefined) update.nome        = nome;
  if (fields      !== undefined) update.fields      = fields;
  if (angulos     !== undefined) update.angulos     = angulos;
  if (mapa        !== undefined) update.mapa        = typeof mapa === 'object' ? JSON.stringify(mapa) : mapa;
  if (transcricao !== undefined) update.transcricao = transcricao;
  const { data, error } = await supabase
    .from('templates').update(update).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(fromDb(data));
});

app.post('/api/admin/templates/:id/editar-ia', adminAuth, upload.single('imagem'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Imagem obrigatória' });
    const result = await cloudinaryUpload(req.file.buffer, 'templates');
    const { data, error } = await supabase
      .from('templates').update({ image_url: result.secure_url })
      .eq('id', req.params.id).select().single();
    if (error) throw new Error(error.message);
    res.json(fromDb(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/templates/:id/gerar-transcricao', adminAuth, async (req, res) => {
  try {
    const { data: t } = await supabase.from('templates').select('id, nome, image_url').eq('id', req.params.id).single();
    if (!t) return res.status(404).json({ error: 'Template não encontrado' });

    const img = await imageB64FromUrl(t.image_url);
    if (!img) return res.status(400).json({ error: 'Não foi possível carregar a imagem' });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.b64}` } },
          { type: 'text', text: `Transcreva TODO o texto visível nesta imagem de marketing imobiliário, exatamente como aparece — incluindo headlines, labels, valores placeholder, slogans e qualquer outro texto. Preserve a capitalização original. Separe blocos de texto por linha. Não inclua descrições, apenas o texto em si.` },
        ],
      }],
    });

    const transcricao = completion.choices[0].message.content.trim();
    const { error: upErr } = await supabase.from('templates').update({ transcricao }).eq('id', t.id);
    if (upErr) throw new Error('Supabase update: ' + upErr.message);

    registrarLog({
      tipo: 'transcricao', input: { template: t.nome }, status: 'ok',
      usage: completion.usage || null, custo: custoChat(completion.usage),
    });

    res.json({ ok: true, transcricao });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/templates/gerar-transcricoes', adminAuth, async (req, res) => {
  try {
    const { data: rows } = await supabase
      .from('templates')
      .select('id, nome, image_url, transcricao')
      .order('criado_em', { ascending: true });

    const semTranscricao = rows.filter(r => !r.transcricao || !r.transcricao.trim());
    if (!semTranscricao.length) return res.json({ ok: true, atualizados: 0, msg: 'Todos os templates já têm transcrição.' });

    const resultados = [];
    for (const t of semTranscricao) {
      try {
        const img = await imageB64FromUrl(t.image_url);
        if (!img) { resultados.push({ id: t.id, nome: t.nome, erro: 'Não foi possível carregar a imagem' }); continue; }

        const completion = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [{
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.b64}` } },
              { type: 'text', text: `Transcreva TODO o texto visível nesta imagem de marketing imobiliário, exatamente como aparece — incluindo headlines, labels, valores placeholder, slogans e qualquer outro texto. Preserve a capitalização original. Separe blocos de texto por linha. Não inclua descrições, apenas o texto em si.` },
            ],
          }],
        });

        const transcricao = completion.choices[0].message.content.trim();
        const { error: upErr } = await supabase.from('templates').update({ transcricao }).eq('id', t.id);
        if (upErr) throw new Error('Supabase update: ' + upErr.message);
        registrarLog({
          tipo: 'transcricao', input: { template: t.nome }, status: 'ok',
          usage: completion.usage || null, custo: custoChat(completion.usage),
        });
        resultados.push({ id: t.id, nome: t.nome, ok: true, transcricao });
      } catch (err) {
        resultados.push({ id: t.id, nome: t.nome, erro: err.message });
      }
    }

    res.json({ ok: true, atualizados: resultados.filter(r => r.ok).length, total: semTranscricao.length, resultados });
  } catch (err) {
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
app.get('/api/perfil', userAuth, async (req, res) => {
  const { data } = await supabase.from('perfil').select('*').eq('user_id', req.user.id).single();
  res.json(data || {});
});

app.put('/api/perfil', userAuth, upload.single('logo'), async (req, res) => {
  try {
    const campos = ['nome','slogan','creci','telefone','whatsapp','email','site'];
    const updates = {};
    campos.forEach(c => { if (req.body[c] !== undefined) updates[c] = req.body[c]; });

    if (req.file) {
      const { data: old } = await supabase.from('perfil').select('logo').eq('user_id', req.user.id).single();
      if (old?.logo) {
        const pid = cloudinaryPublicId(old.logo);
        if (pid) await cloudinary.uploader.destroy(pid).catch(() => {});
      }
      const result = await cloudinaryUpload(req.file.buffer, 'logos');
      updates.logo = result.secure_url;
    }

    const { data: existing } = await supabase.from('perfil').select('id').eq('user_id', req.user.id).single();
    let result;
    if (existing) {
      result = await supabase.from('perfil').update(updates).eq('user_id', req.user.id).select().single();
    } else {
      result = await supabase.from('perfil').insert({ ...updates, user_id: req.user.id }).select().single();
    }
    if (result.error) throw new Error(result.error.message);
    res.json(result.data);
  } catch (err) {
    console.error('Erro perfil:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── IMÓVEIS ───────────────────────────────────────────────────────────────────
app.get('/api/imoveis', userAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('imoveis').select('*').eq('user_id', req.user.id).order('criado_em', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data.map(fromDb));
});

app.get('/api/imoveis/:id', userAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('imoveis').select('*').eq('id', req.params.id).eq('user_id', req.user.id).single();
  if (error) return res.status(404).json({ error: 'Não encontrado' });
  res.json(fromDb(data));
});

// Upload de foto por slot: POST /api/imoveis/:id/foto/:slot
app.post('/api/imoveis/:id/foto/:slot', userAuth, upload.single('foto'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Foto obrigatória' });
    const slot = req.params.slot;
    if (!PHOTO_SLOTS.find(s => s.key === slot))
      return res.status(400).json({ error: 'Slot inválido' });

    const { data: existing } = await supabase
      .from('imoveis').select('fotos').eq('id', req.params.id).eq('user_id', req.user.id).single();
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
app.delete('/api/imoveis/:id/foto/:slot', userAuth, async (req, res) => {
  const { data: existing } = await supabase
    .from('imoveis').select('fotos').eq('id', req.params.id).eq('user_id', req.user.id).single();
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

app.post('/api/imoveis', userAuth, async (req, res) => {
  try {
    const fields = {};
    IMOVEL_CAMPOS.forEach(c => { fields[c] = req.body[c] || ''; });
    if (req.body.totalAndares !== undefined) fields.total_andares = req.body.totalAndares;

    const { data, error } = await supabase.from('imoveis').insert({
      id: Date.now().toString(),
      ...fields,
      fotos: {},
      user_id: req.user.id,
    }).select().single();

    if (error) throw new Error(error.message);
    res.status(201).json(fromDb(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/imoveis/:id', userAuth, async (req, res) => {
  try {
    const updates = {};
    IMOVEL_CAMPOS.forEach(c => { if (req.body[c] !== undefined) updates[c] = req.body[c]; });
    if (req.body.totalAndares !== undefined) updates.total_andares = req.body.totalAndares;

    const { data, error } = await supabase
      .from('imoveis').update(updates).eq('id', req.params.id).eq('user_id', req.user.id).select().single();
    if (error) return res.status(404).json({ error: 'Não encontrado' });
    res.json(fromDb(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/imoveis/:id', userAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('imoveis').delete().eq('id', req.params.id).eq('user_id', req.user.id).select().single();
  if (error) return res.status(404).json({ error: 'Não encontrado' });
  for (const url of Object.values(data.fotos || {})) {
    const pid = cloudinaryPublicId(url);
    if (pid) await cloudinary.uploader.destroy(pid).catch(() => {});
  }
  res.json({ ok: true });
});

// ── PRÉVIA DE TEXTO ───────────────────────────────────────────────────────────
app.post('/api/previa', userAuth, billingGate, async (req, res) => {
  try {
    const { templateId, imovelId } = req.body;

    const { data: tRow } = await supabase.from('templates').select('*').eq('id', templateId).single();
    if (!tRow) return res.status(400).json({ error: 'Template inválido' });
    const template = fromDb(tRow);

    const { data: imRow } = await supabase.from('imoveis').select('*').eq('id', imovelId).eq('user_id', req.user.id).single();
    if (!imRow) return res.status(400).json({ error: 'Imóvel não encontrado' });
    const imovel = fromDb(imRow);

    const { data: perfil } = await supabase.from('perfil').select('*').eq('user_id', req.user.id).single();

    const fieldData = FIELD_DATA(imovel, perfil);
    const mapa = template.mapa || {};
    const camposTexto = (template.fields || []).filter(f => !['foto_imovel', 'logo'].includes(f));

    const dadosImovel = camposTexto
      .map(f => { const v = fieldData[f]; return v ? `- ${f} (${FIELD_LABELS_PT[f] || f}): ${v.split(' → ')[1]?.replace(/"/g,'') || v}` : null; })
      .filter(Boolean).join('\n');

    const mapaDesc = camposTexto
      .filter(f => mapa[f])
      .map(f => `- ${FIELD_LABELS_PT[f] || f}: ${mapa[f]}`)
      .join('\n');

    const PREVIA_PROMPT = `Você é um especialista em marketing imobiliário. Sua tarefa é gerar os textos finais exatos para um banner/arte imobiliária.

Você receberá:
1. A transcrição do template (como os textos aparecem no original)
2. Os dados do novo imóvel
3. Onde cada elemento aparece no template

Gere um JSON onde cada chave é o nome do campo e o valor é o texto final EXATO e completo como deve aparecer na imagem — já com capitalização correta, preposições ajustadas, formatação e contexto da frase completa.

REGRA MAIS IMPORTANTE — imite o formato do template, não o formato do cadastro:
Cada template escreve os valores de um jeito próprio (abreviações, unidades, maiúsculas, sufixos). Observe na transcrição EXATAMENTE como cada valor aparece no original e reescreva o dado do novo imóvel NESSE MESMO formato.
Exemplos:
- Template mostra "R$ 3.18M" e o dado é "R$ 1.000.000,00" → gere "R$ 1M"
- Template mostra "ENTRADA: R$ 64 mil" e o dado é "R$ 300.000,00" → gere "ENTRADA: R$ 300 mil"
- Template mostra "LOTES DE 390 m²" e o dado é "450" → gere "LOTES DE 450 m²"
- Template mostra "2 DORM." e o dado é "3 quartos" → gere "3 DORM."
Isso vale para TODOS os campos: preço, entrada, parcela, área, quartos, cidade etc. Nunca copie o valor bruto do cadastro se o template usa outro estilo — converta o número/texto para o padrão visual do template (mesma abreviação, mesma pontuação, mesmo uso de maiúsculas).
Mantenha apenas o comprimento parecido com o original para o texto caber no mesmo espaço da imagem.

ATENÇÃO — os valores da transcrição são PLACEHOLDERS, nunca o conteúdo final:
Todo valor que aparece na transcrição do template (telefone, CRECI, preços, cidade, nomes) pertence ao anúncio ANTIGO e deve ser 100% substituído pelo dado correspondente fornecido em "Dados do novo imóvel". Use a transcrição SOMENTE para copiar o estilo/formato — jamais retorne um número de telefone, CRECI, valor ou nome que veio da transcrição.
Exemplo: template mostra "(47) 3346-8354" e os dados informam telefone "(48) 99123-4567" → gere "(48) 99123-4567" (no mesmo estilo de formatação do template).

Em "Dados do novo imóvel", cada linha começa com o NOME EXATO do campo JSON seguido do valor a usar — ex: "- telefone (Telefone (do perfil)): (48) 99123-4567" significa que o campo "telefone" do JSON deve conter esse número formatado no estilo do template. TODO campo que tem linha em "Dados do novo imóvel" DEVE vir preenchido no JSON com esse valor.
Apenas quando um campo pedido NÃO tiver nenhuma linha correspondente em "Dados do novo imóvel", retorne string vazia "" — nunca invente e nunca reaproveite o valor do template.

Transcrição do template:
${template.transcricao || '(não informada)'}

Dados do novo imóvel:
${dadosImovel || '(nenhum)'}

Localização de cada campo no template:
${mapaDesc || '(não informado)'}

Imobiliária: ${perfil?.nome || ''}

Retorne SOMENTE um JSON válido com os campos: ${camposTexto.join(', ')}
Exemplo: {"cidade": "TERRENOS EM ITAPOÁ, SC", "entrada": "ENTRADA: R$ 80 mil", "parcela": "MENSAIS: R$ 4.200"}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: PREVIA_PROMPT }],
    });

    const textos = JSON.parse(completion.choices[0].message.content);

    registrarLog({
      tipo: 'previa',
      input: { template: template.nome, imovel: imovel.titulo, campos: camposTexto, promptEnviado: PREVIA_PROMPT },
      status: 'ok',
      usage: completion.usage || null,
      custo: custoChat(completion.usage),
      user_id: req.user.id,
    });

    const cobranca = await custoComMarkup(custoChat(completion.usage) || 0);
    await debitar(req.user.id, cobranca, `Prévia de texto — ${imovel.titulo}`);

    res.json({ textos, campos: camposTexto.map(f => ({ key: f, label: FIELD_LABELS_PT[f] || f })) });
  } catch (err) {
    console.error('Erro prévia:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GERAÇÃO DE ARTE ───────────────────────────────────────────────────────────
const FIELD_DATA = (imovel, perfil = {}) => {
  const localizacao = [imovel.bairro, imovel.estado].filter(Boolean).join(', ');
  return {
    telefone:      perfil?.telefone      ? `contact phone → "${perfil.telefone}"` : null,
    whatsapp:      perfil?.whatsapp      ? `WhatsApp number → "${perfil.whatsapp}"` : null,
    creci:         perfil?.creci         ? `CRECI license → "${perfil.creci}"` : null,
    site:          perfil?.site          ? `website → "${perfil.site}"` : null,
    slogan:        perfil?.slogan        ? `agency slogan → "${perfil.slogan}"` : null,
    titulo:        `property name/title → "${imovel.titulo}"`,
    preco:         imovel.preco         ? `total price → "R$ ${imovel.preco}"` : null,
    entrada:       imovel.entrada       ? `down payment (entrada) → "R$ ${imovel.entrada}"` : null,
    parcela:       imovel.parcela       ? `monthly installment (mensais/parcela) → "R$ ${imovel.parcela}"` : null,
    financiamento: imovel.financiamento ? `financing (financiamento) → "${imovel.financiamento}"` : null,
    area:          imovel.area          ? `area (área) → "${imovel.area} m²"` : null,
    quartos:       imovel.quartos       ? `bedrooms (quartos) → "${imovel.quartos}"` : null,
    suites:        imovel.suites        ? `suites → "${imovel.suites}"` : null,
    banheiros:     imovel.banheiros     ? `bathrooms (banheiros) → "${imovel.banheiros}"` : null,
    vagas:         imovel.vagas         ? `parking spots (vagas) → "${imovel.vagas}"` : null,
    andar:         imovel.andar         ? `floor (andar) → "${imovel.andar}º"` : null,
    cidade:        imovel.cidade        ? `city name (cidade) → "${imovel.cidade}"` : null,
    localizacao:   localizacao          ? `neighborhood/region (localização) → "${localizacao}"` : null,
    endereco:      imovel.endereco      ? `street address (endereço) → "${imovel.endereco}"` : null,
    destaque:      imovel.destaque      ? `headline/tagline → "${imovel.destaque}"` : null,
    diferenciais:  imovel.diferenciais  ? `highlights/differentials → "${imovel.diferenciais}"` : null,
  };
};

app.post('/api/gerar', userAuth, billingGate, async (req, res) => {
  let galeriaId = null;
  try {
    const { templateId, imovelId, textosPrevia, formato, fotosEscolhidas } = req.body;
    const isReels = formato === 'reels';

    const { data: tRow } = await supabase.from('templates').select('*').eq('id', templateId).single();
    if (!tRow) return res.status(400).json({ error: 'Template inválido' });
    const template = fromDb(tRow);

    const { data: imRow } = await supabase.from('imoveis').select('*').eq('id', imovelId).eq('user_id', req.user.id).single();
    if (!imRow) return res.status(400).json({ error: 'Imóvel não encontrado' });
    const imovel = fromDb(imRow);

    const { data: perfil } = await supabase.from('perfil').select('*').eq('user_id', req.user.id).single();

    // Registro pendente na galeria — o card "gerando" aparece imediatamente
    const { data: pendente, error: pendErr } = await supabase.from('galeria').insert({
      status:        'gerando',
      formato:       isReels ? 'reels' : '1x1',
      template_id:   templateId,
      imovel_id:     imovelId,
      template_nome: template.nome,
      imovel_titulo: imovel.titulo,
      textos:        textosPrevia || null,
      user_id:       req.user.id,
    }).select('id').single();
    if (pendErr) throw new Error(pendErr.message);
    galeriaId = pendente.id;

    const templateImg = await imageB64FromUrl(template.imageUrl);
    if (!templateImg) throw new Error('Não foi possível carregar o template');

    // Seleciona fotos pelos ângulos exigidos pelo template
    const angulos = template.angulos || [];
    const fotoSlots = [];
    const urlsDoImovel = Object.values(imovel.fotos || {});
    if (template.fields.includes('foto_imovel') && fotosEscolhidas && typeof fotosEscolhidas === 'object' && Object.keys(fotosEscolhidas).length) {
      // Usuário escolheu as fotos na prévia — só aceita URLs que pertencem ao imóvel
      for (const [ang, url] of Object.entries(fotosEscolhidas)) {
        if (!urlsDoImovel.includes(url)) continue;
        const img = await imageB64FromUrl(url);
        if (img) fotoSlots.push({ ang, img });
      }
    } else if (template.fields.includes('foto_imovel') && angulos.length > 0) {
      for (const ang of angulos) {
        const url = (imovel.fotos || {})[ang];
        if (url) {
          const img = await imageB64FromUrl(url);
          if (img) fotoSlots.push({ ang, img });
        }
      }
    } else if (template.fields.includes('foto_imovel')) {
      // Sem ângulo definido — usa qualquer foto disponível
      const primeiraUrl = urlsDoImovel[0];
      if (primeiraUrl) {
        const img = await imageB64FromUrl(primeiraUrl);
        if (img) fotoSlots.push({ ang: 'foto', img });
      }
    }

    let logoImg = null;
    if (template.fields.includes('logo') && perfil?.logo) {
      logoImg = await imageB64FromUrl(perfil.logo);
    }

    const fieldData   = FIELD_DATA(imovel, perfil);
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

    // Monta substituições — usa textosPrevia (pré-aprovados) se fornecidos
    const mapa = template.mapa || {};
    const substituicoes = template.fields
      .filter(f => !['foto_imovel', 'logo'].includes(f))
      .map(f => {
        const textoFinal = textosPrevia?.[f];
        const valorBruto = fieldData[f];
        if (!textoFinal && !valorBruto) return null;
        const onde = mapa[f] ? `Localização no template: ${mapa[f]}` : `Campo: ${FIELD_LABELS_PT[f] || f}`;
        if (textoFinal) {
          return `• ${onde}\n  Substitua pelo texto exato: "${textoFinal}"`;
        }
        const novoValor = valorBruto.split(' → ')[1]?.replace(/"/g, '') || valorBruto;
        return `• ${onde}\n  Reescreva a frase/título inteiro integrando "${novoValor}" de forma natural — ajuste preposições, capitalização e concordância.`;
      })
      .filter(Boolean)
      .join('\n\n');

    const mensagem = `Você recebeu um template de marketing imobiliário (Imagem ${imgOrder.template}). Quero recriar a exata mesma imagem substituindo apenas os valores abaixo.

Substituições a fazer:
${substituicoes || '(nenhuma)'}

${fotoSlots.length === 0
      ? '• Foto do imóvel: nenhuma foto fornecida.'
      : fotoSlots.map((s, i) => {
          const onde = mapa[`ang:${s.ang}`] ? `Localização no template: ${mapa[`ang:${s.ang}`]}.` : '';
          return `• Foto (${ANGLE_LABELS_PT[s.ang] || s.ang}): substitua pela Imagem ${imgOrder[`foto_${i}`]} exatamente como fornecida — não gere nem recrie. ${onde}`;
        }).join('\n')}

${logoImg
      ? `• Logo: substitua o logo atual pela Imagem ${imgOrder.logo} exatamente como fornecida, integrando ao fundo sem caixa branca.${mapa['logo'] ? ` Localização no template: ${mapa['logo']}.` : ''}`
      : `• Logo: não foi fornecida nenhuma logo — mantenha o logo original do template sem alterações.`}

Regras:
- Mantenha fonte, cor e tamanho de cada texto — só o conteúdo troca.
- Quando o valor faz parte de uma frase ou título maior (ex: "TERRENOS NO CONTINENTAL, SC"), reescreva a frase inteira de forma gramaticalmente correta e natural com o novo valor — ajuste preposições, capitalização e concordância conforme necessário, mas preserve o estilo visual (fonte, cor, tamanho, posição).
- Não adicione linhas novas. Substitua sempre no lugar exato onde o valor original está na imagem.
- Todo o resto — layout, cores, formas decorativas, espaçamentos — pixel a pixel igual ao original.${isReels ? `
- IMPORTANTE: gere no formato vertical 9:16 (Reels/Stories). Adapte a composição do template para ocupar bem o quadro vertical — pode reorganizar os blocos verticalmente, mas mantenha identidade visual, cores, fontes e hierarquia do original.` : ''}`;


    const content = [];
    content.push({ type: 'input_image', image_url: `data:${templateImg.mime};base64,${templateImg.b64}` });
    fotoSlots.forEach(s => content.push({ type: 'input_image', image_url: `data:${s.img.mime};base64,${s.img.b64}` }));
    if (logoImg) content.push({ type: 'input_image', image_url: `data:${logoImg.mime};base64,${logoImg.b64}` });
    content.push({ type: 'input_text', text: mensagem });

    const logInput = {
      template: template.nome,
      imovel: imovel.titulo,
      campos: template.fields,
      textosPrevia: textosPrevia || null,
      formato: isReels ? 'reels' : '1x1',
      imagens: [`template: ${template.imageUrl}`, ...fotoSlots.map((s,i) => `foto_${i} (${s.ang})`), logoImg ? 'logo' : null].filter(Boolean),
      promptEnviado: mensagem,
    };

    const response = await openai.responses.create({
      model: 'gpt-4o',
      input: [{ role: 'user', content }],
      tools: [{ type: 'image_generation', quality: 'high', size: isReels ? '1024x1536' : '1024x1024' }],
    });

    const usage = response.usage || null;
    const custoTokens = usage
      ? (usage.input_tokens || 0) * PRECO.in + (usage.output_tokens || 0) * PRECO.out
      : 0;
    const custoImg = isReels ? PRECO.img1536 : PRECO.img1024;

    for (const item of response.output || []) {
      if (item.type === 'image_generation_call' && item.result) {
        const up = await cloudinaryUpload(Buffer.from(item.result, 'base64'), 'galeria');
        await supabase.from('galeria')
          .update({ image_url: up.secure_url, status: 'pronta' })
          .eq('id', galeriaId);
        registrarLog({
          tipo: 'gerar', input: logInput, status: 'ok',
          usage, custo: +(custoTokens + custoImg).toFixed(6),
          user_id: req.user.id,
        });
        const cobranca = await custoComMarkup(custoTokens + custoImg);
        await debitar(req.user.id, cobranca, `Geração de arte — ${imovel.titulo}${isReels ? ' (Reels)' : ''}`, String(galeriaId));
        verificarAutoRecarga(req.user.id);
        return res.json({ success: true, galeriaId });
      }
    }

    await supabase.from('galeria').update({ status: 'erro' }).eq('id', galeriaId);
    registrarLog({
      tipo: 'gerar', input: logInput, status: 'sem_imagem',
      usage, custo: +custoTokens.toFixed(6),
      user_id: req.user.id,
    });
    res.status(500).json({ error: 'Nenhuma imagem gerada' });
  } catch (err) {
    console.error('Erro geração:', err);
    if (galeriaId) supabase.from('galeria').update({ status: 'erro' }).eq('id', galeriaId).then(() => {}, () => {});
    registrarLog({ tipo: 'gerar', input: { erro: err.message }, status: 'erro', user_id: req.user?.id });
    res.status(500).json({ error: err.message });
  }
});

// ── EDIÇÃO MÁGICA: altera uma arte existente via instrução de texto ──────────
app.post('/api/galeria/:id/editar', userAuth, billingGate, async (req, res) => {
  let galeriaId = null;
  try {
    const instrucao = (req.body.instrucao || '').trim();
    if (!instrucao) return res.status(400).json({ error: 'Descreva a alteração desejada' });

    // Imagem de referência opcional (data URL enviada pelo cliente)
    const referencia = typeof req.body.referencia === 'string' && req.body.referencia.startsWith('data:image/')
      ? req.body.referencia
      : null;

    const { data: orig } = await supabase.from('galeria')
      .select('*').eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (!orig?.image_url) return res.status(404).json({ error: 'Arte não encontrada' });

    // Registro pendente — o card "gerando" aparece na galeria imediatamente
    const { data: pendente, error: pendErr } = await supabase.from('galeria').insert({
      status:        'gerando',
      formato:       orig.formato || '1x1',
      template_id:   orig.template_id,
      imovel_id:     orig.imovel_id,
      template_nome: orig.template_nome,
      imovel_titulo: orig.imovel_titulo,
      textos:        orig.textos,
      user_id:       req.user.id,
    }).select('id').single();
    if (pendErr) throw new Error(pendErr.message);
    galeriaId = pendente.id;

    const img = await imageB64FromUrl(orig.image_url);
    if (!img) throw new Error('Não foi possível carregar a imagem original');

    const mensagem = `Você recebeu uma arte de marketing imobiliário pronta (Imagem 1). Faça APENAS a alteração solicitada abaixo, mantendo todo o resto da imagem exatamente igual.
${referencia ? '\nA Imagem 2 é uma REFERÊNCIA fornecida pelo usuário — use-a conforme indicado na instrução (ex: aplicar o elemento, copiar o estilo, substituir por ela).\n' : ''}
Alteração solicitada:
"${instrucao}"

Regras:
- Altere somente o que foi pedido — nada além disso.
- Preserve fontes, cores, textos, posições e todos os elementos não mencionados, pixel a pixel.
- Mantenha o mesmo formato e proporção da imagem original (Imagem 1).`;

    const isReels = orig.formato === 'reels';
    const content = [
      { type: 'input_image', image_url: `data:${img.mime};base64,${img.b64}` },
    ];
    if (referencia) content.push({ type: 'input_image', image_url: referencia });
    content.push({ type: 'input_text', text: mensagem });

    const response = await openai.responses.create({
      model: 'gpt-4o',
      input: [{ role: 'user', content }],
      tools: [{ type: 'image_generation', quality: 'high', size: isReels ? '1024x1536' : '1024x1024' }],
    });

    const usage = response.usage || null;
    const custoTokens = usage
      ? (usage.input_tokens || 0) * PRECO.in + (usage.output_tokens || 0) * PRECO.out
      : 0;
    const custoImg = isReels ? PRECO.img1536 : PRECO.img1024;

    for (const item of response.output || []) {
      if (item.type === 'image_generation_call' && item.result) {
        const up = await cloudinaryUpload(Buffer.from(item.result, 'base64'), 'galeria');
        await supabase.from('galeria')
          .update({ image_url: up.secure_url, status: 'pronta' })
          .eq('id', galeriaId);
        registrarLog({
          tipo: 'edicao',
          input: { origem: orig.id, imovel: orig.imovel_titulo, template: orig.template_nome, instrucao, comReferencia: !!referencia, promptEnviado: mensagem },
          status: 'ok', usage, custo: +(custoTokens + custoImg).toFixed(6),
          user_id: req.user.id,
        });
        const cobranca = await custoComMarkup(custoTokens + custoImg);
        await debitar(req.user.id, cobranca, `Edição de arte — ${orig.imovel_titulo || 'sem título'}`, String(galeriaId));
        verificarAutoRecarga(req.user.id);
        return res.json({ success: true, galeriaId });
      }
    }

    await supabase.from('galeria').update({ status: 'erro' }).eq('id', galeriaId);
    registrarLog({
      tipo: 'edicao', input: { origem: orig.id, instrucao }, status: 'sem_imagem',
      usage, custo: +custoTokens.toFixed(6), user_id: req.user.id,
    });
    res.status(500).json({ error: 'Nenhuma imagem gerada' });
  } catch (err) {
    console.error('Erro edição:', err);
    if (galeriaId) supabase.from('galeria').update({ status: 'erro' }).eq('id', galeriaId).then(() => {}, () => {});
    registrarLog({ tipo: 'edicao', input: { erro: err.message }, status: 'erro', user_id: req.user?.id });
    res.status(500).json({ error: err.message });
  }
});

// ── Galeria ───────────────────────────────────────────────────────────────────
app.get('/api/galeria', userAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('galeria').select('*').eq('user_id', req.user.id).order('criado_em', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data.map(fromDb));
});

app.delete('/api/galeria/:id', userAuth, async (req, res) => {
  const { data } = await supabase.from('galeria').select('image_url').eq('id', req.params.id).eq('user_id', req.user.id).single();
  if (data?.image_url) {
    const pid = cloudinaryPublicId(data.image_url);
    if (pid) await cloudinary.uploader.destroy(pid).catch(() => {});
  }
  await supabase.from('galeria').delete().eq('id', req.params.id).eq('user_id', req.user.id);
  res.json({ ok: true });
});

// ── BILLING: usuário ──────────────────────────────────────────────────────────
function appUrl(req) {
  return process.env.APP_URL || `https://${req.headers.host}`;
}

async function ensureStripeCustomer(userId, email) {
  const { data: u } = await supabase.from('usuarios').select('stripe_customer_id').eq('id', userId).single();
  if (u?.stripe_customer_id) return u.stripe_customer_id;
  const customer = await stripe.customers.create({ email, metadata: { user_id: String(userId) } });
  await supabase.from('usuarios').update({ stripe_customer_id: customer.id }).eq('id', userId);
  return customer.id;
}

app.get('/api/billing', userAuth, async (req, res) => {
  try {
    const [cfg, saldo] = await Promise.all([getBillingConfig(), getSaldo(req.user.id)]);
    const { data: u } = await supabase.from('usuarios')
      .select('assinatura_status, assinatura_expira, auto_recarga_ativa, auto_recarga_valor_brl, auto_recarga_falhou')
      .eq('id', req.user.id).single();
    const { data: extrato } = await supabase.from('transacoes')
      .select('tipo, valor_usd, descricao, criado_em')
      .eq('user_id', req.user.id).order('criado_em', { ascending: false }).limit(20);

    res.json({
      saldo,
      assinatura: { status: u?.assinatura_status || 'inativa', expira: u?.assinatura_expira || null },
      autoRecarga: {
        ativa:  !!u?.auto_recarga_ativa,
        valorBrl: Number(u?.auto_recarga_valor_brl || 50),
        falhou: !!u?.auto_recarga_falhou,
      },
      precos: {
        assinaturaBrl: cfg.preco_assinatura_brl,
        recargaMinBrl: cfg.recarga_min_brl,
        cotacaoBrl:    cfg.cotacao_brl,
      },
      extrato: extrato || [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/billing/assinar', userAuth, async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: 'Stripe não configurado' });
    const cfg = await getBillingConfig();
    const customer = await ensureStripeCustomer(req.user.id, req.user.email);
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer,
      line_items: [{
        price_data: {
          currency: 'brl',
          unit_amount: Math.round(cfg.preco_assinatura_brl * 100),
          recurring: { interval: 'year' },
          product_data: { name: 'Estúdio do Corretor — Assinatura anual' },
        },
        quantity: 1,
      }],
      metadata: { user_id: String(req.user.id) },
      success_url: `${appUrl(req)}/app/?pagamento=assinatura`,
      cancel_url:  `${appUrl(req)}/app/?pagamento=cancelado`,
    });
    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/billing/recarga', userAuth, async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: 'Stripe não configurado' });
    const cfg = await getBillingConfig();
    const valorBrl = Number(req.body.valorBrl);
    if (!valorBrl || valorBrl < cfg.recarga_min_brl)
      return res.status(400).json({ error: `Recarga mínima: R$ ${cfg.recarga_min_brl.toFixed(2)}` });

    const customer = await ensureStripeCustomer(req.user.id, req.user.email);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer,
      payment_intent_data: { setup_future_usage: 'off_session' }, // salva o cartão p/ auto-recarga
      line_items: [{
        price_data: {
          currency: 'brl',
          unit_amount: Math.round(valorBrl * 100),
          product_data: { name: `Recarga de créditos — R$ ${valorBrl.toFixed(2)}` },
        },
        quantity: 1,
      }],
      metadata: { user_id: String(req.user.id), tipo: 'recarga' },
      success_url: `${appUrl(req)}/app/?pagamento=recarga`,
      cancel_url:  `${appUrl(req)}/app/?pagamento=cancelado`,
    });
    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/billing/auto-recarga', userAuth, async (req, res) => {
  try {
    const { ativa, valorBrl } = req.body;
    const cfg = await getBillingConfig();
    const updates = {};
    if (ativa !== undefined) {
      updates.auto_recarga_ativa = !!ativa;
      if (ativa) updates.auto_recarga_falhou = false; // reativar limpa a falha
    }
    if (valorBrl !== undefined) {
      const v = Number(valorBrl);
      if (!v || v < cfg.recarga_min_brl)
        return res.status(400).json({ error: `Valor mínimo: R$ ${cfg.recarga_min_brl.toFixed(2)}` });
      updates.auto_recarga_valor_brl = v;
    }
    const { error } = await supabase.from('usuarios').update(updates).eq('id', req.user.id);
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── ADMIN: Config de cobrança ─────────────────────────────────────────────────
app.get('/api/admin/config', adminAuth, async (_, res) => {
  res.json(await getBillingConfig());
});

app.put('/api/admin/config', adminAuth, async (req, res) => {
  try {
    const atual = await getBillingConfig();
    const permitidos = ['markup_pct', 'cotacao_brl', 'preco_assinatura_brl', 'recarga_min_brl', 'trial_dias', 'trial_credito_usd'];
    const novo = { ...atual };
    permitidos.forEach(k => {
      if (req.body[k] !== undefined) {
        const v = Number(req.body[k]);
        if (Number.isFinite(v) && v >= 0) novo[k] = v;
      }
    });
    const { error } = await supabase.from('config').upsert({ chave: 'billing', valor: novo });
    if (error) throw new Error(error.message);
    res.json(novo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── ADMIN: Cobranças (direto do Stripe) ───────────────────────────────────────
app.get('/api/admin/cobrancas', adminAuth, async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: 'Stripe não configurado' });
    const charges = await stripe.charges.list({ limit: 50 });
    const lista = charges.data.map(c => ({
      id:        c.id,
      valor:     c.amount / 100,
      moeda:     c.currency.toUpperCase(),
      status:    c.refunded ? 'reembolsada' : c.status, // succeeded | pending | failed | reembolsada
      descricao: c.description || c.calculated_statement_descriptor || '—',
      email:     c.billing_details?.email || c.receipt_email || '—',
      criadoEm:  new Date(c.created * 1000).toISOString(),
      recibo:    c.receipt_url || null,
    }));
    res.json({ cobrancas: lista });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── ADMIN: Prompts ────────────────────────────────────────────────────────────
app.get('/api/admin/prompts', adminAuth, (req, res) => {
  res.json({
    analise_template: {
      titulo: 'Análise de Template (ao cadastrar)',
      modelo: 'gpt-4o',
      descricao: 'Detecta automaticamente os campos e posições ao subir um novo template.',
      prompt: ANALYZE_PROMPT,
    },
    previa_texto: {
      titulo: 'Prévia de Texto (antes de gerar arte)',
      modelo: 'gpt-4o',
      descricao: 'Pré-computa os textos finais com gramática e formatação corretas antes de enviar para geração da imagem.',
      prompt: `[Gerado dinamicamente por request — veja nos Logs o promptEnviado de cada chamada "previa"]`,
    },
    geracao_arte: {
      titulo: 'Geração de Arte (imagem final)',
      modelo: 'gpt-4o (image_generation tool)',
      descricao: 'Instrui a IA a recriar o template substituindo exatamente os valores fornecidos.',
      prompt: `[Gerado dinamicamente por request — veja nos Logs o promptEnviado de cada chamada "gerar"]`,
    },
    transcricao_template: {
      titulo: 'Transcrição de Template (ao analisar)',
      modelo: 'gpt-4o',
      descricao: 'Lê o texto visível do template para usar como referência na prévia.',
      prompt: `Transcreva TODO o texto visível nesta imagem de marketing imobiliário, exatamente como aparece — incluindo headlines, labels, valores placeholder, slogans e qualquer outro texto. Preserve a capitalização original. Separe blocos de texto por linha. Não inclua descrições, apenas o texto em si.`,
    },
  });
});

// ── ADMIN: Logs ───────────────────────────────────────────────────────────────
app.get('/api/admin/logs', adminAuth, async (req, res) => {
  const limit  = parseInt(req.query.limit  || '50');
  const offset = parseInt(req.query.offset || '0');
  const tipo   = req.query.tipo || null;

  let query = supabase.from('logs').select('*', { count: 'exact' })
    .order('criado_em', { ascending: false })
    .range(offset, offset + limit - 1);

  if (tipo) query = query.eq('tipo', tipo);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });

  // Resumo de custos (todos os logs, sem paginação)
  const { data: todos } = await supabase.from('logs').select('tipo, custo, status');
  const resumo = { totalUsd: 0, porTipo: {} };
  (todos || []).forEach(l => {
    const c = Number(l.custo) || 0;
    resumo.totalUsd += c;
    if (!resumo.porTipo[l.tipo]) resumo.porTipo[l.tipo] = { qtd: 0, usd: 0 };
    resumo.porTipo[l.tipo].qtd += 1;
    resumo.porTipo[l.tipo].usd += c;
  });
  resumo.totalUsd = +resumo.totalUsd.toFixed(4);
  Object.values(resumo.porTipo).forEach(t => {
    t.usd   = +t.usd.toFixed(4);
    t.media = t.qtd ? +(t.usd / t.qtd).toFixed(4) : 0;
  });

  res.json({ logs: data, total: count, resumo });
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));
}

module.exports = app;
