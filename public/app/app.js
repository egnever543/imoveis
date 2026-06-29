// ── Estado global ────────────────────────────────────────────────
let templates    = [];
let imoveis      = [];
let fieldLabels  = {};
let angleLabels  = {};
let photoSlots   = [];
let selectedTemplateId = null;
let selectedImovelId   = null;
let lastArteData       = null;

// ── Init ─────────────────────────────────────────────────────────
async function init() {
  setupNav();
  await Promise.all([loadTemplates(), loadImoveis(), loadPerfil(), loadLabels()]);
  renderGerar();
  renderImoveisGrid();
}

async function loadLabels() {
  const [fl, al, ps] = await Promise.all([
    fetch('/api/field-labels').then(r => r.json()),
    fetch('/api/angle-labels').then(r => r.json()),
    fetch('/api/photo-slots').then(r => r.json()),
  ]);
  fieldLabels = fl;
  angleLabels = al;
  photoSlots  = ps;
}

// ── Navegação ─────────────────────────────────────────────────────
function setupNav() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => navegarPara(btn.dataset.page));
  });
}

function navegarPara(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.getElementById(`page-${page}`)?.classList.add('active');
  document.querySelector(`.nav-item[data-page="${page}"]`)?.classList.add('active');
}

// ── Templates ─────────────────────────────────────────────────────
async function loadTemplates() {
  const res = await fetch('/api/templates');
  templates = await res.json();
}

const PREVIEW_COUNT = 5;

function renderTemplatesGrid() {
  const grid = document.getElementById('templatesGrid');
  if (!templates.length) {
    grid.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem">Nenhum template cadastrado. <a href="/admin/" style="color:var(--primary)">Acesse o admin →</a></p>';
    return;
  }
  const preview = templates.slice(0, PREVIEW_COUNT);
  let html = preview.map(t => templateCardHtml(t)).join('');
  html += `
    <div class="template-card more-card" onclick="abrirGaleria()">
      <span class="more-card-icon">🖼️</span>
      <span>Ver mais</span>
    </div>`;
  grid.innerHTML = html;
}

function templateCardHtml(t) {
  return `
    <div class="template-card ${selectedTemplateId === t.id ? 'selected' : ''}" onclick="selecionarTemplate(${t.id})">
      <img src="${t.imageUrl}" alt="${t.nome}" loading="lazy" />
      <div class="template-card-name">${t.nome}</div>
      <span class="check-badge">✓</span>
    </div>`;
}

function selecionarTemplate(id) {
  selectedTemplateId = id;
  renderTemplatesGrid();
  if (document.getElementById('templateGallery').style.display !== 'none') renderGaleria();
  atualizarResumo();
}

// ── Galeria de templates ("ver mais") ───────────────────────────────
function abrirGaleria() {
  renderGaleria();
  document.getElementById('templateGallery').style.display = 'flex';
}

function fecharGaleria() {
  document.getElementById('templateGallery').style.display = 'none';
}

function renderGaleria() {
  const track = document.getElementById('galleryTrack');
  if (!templates.length) {
    track.innerHTML = '<p style="color:var(--text-muted)">Nenhum template cadastrado.</p>';
    return;
  }
  track.innerHTML = templates.map(t => `
    <div class="gallery-card ${selectedTemplateId === t.id ? 'selected' : ''}" onclick="selecionarTemplate(${t.id})">
      <img src="${t.imageUrl}" alt="${t.nome}" loading="lazy" />
      <div class="gallery-card-name">${t.nome}</div>
      <span class="check-badge">✓</span>
    </div>
  `).join('');
  const selectedEl = track.querySelector('.gallery-card.selected');
  if (selectedEl) selectedEl.scrollIntoView({ behavior: 'instant', inline: 'center', block: 'nearest' });
}

function scrollGaleria(dir) {
  const track = document.getElementById('galleryTrack');
  track.scrollBy({ left: dir * 260, behavior: 'smooth' });
}

// ── Imóveis ───────────────────────────────────────────────────────
async function loadImoveis() {
  const res = await fetch('/api/imoveis');
  imoveis = await res.json();
}

function renderImoveisGrid() {
  const grid  = document.getElementById('imoveisGrid');
  const empty = document.getElementById('imoveisEmpty');
  if (!imoveis.length) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  grid.innerHTML = imoveis.map(im => {
    const foto  = Object.values(im.fotos || {})[0];
    const local = [im.bairro, im.cidade, im.estado].filter(Boolean).join(', ');
    const tags  = [];
    if (im.area)    tags.push(`${im.area} m²`);
    if (im.quartos) tags.push(`${im.quartos} qtos`);
    if (im.vagas)   tags.push(`${im.vagas} vaga${im.vagas > 1 ? 's' : ''}`);
    return `
      <div class="imovel-card">
        <div class="imovel-card-thumb">
          ${foto ? `<img src="${foto}" alt="${im.titulo}" />` : '🏢'}
        </div>
        <div class="imovel-card-body">
          <span class="status-badge status-${im.status}">${im.status}</span>
          <h3>${im.titulo}</h3>
          ${im.preco ? `<div class="preco">R$ ${im.preco}</div>` : ''}
          ${local ? `<div class="local">📍 ${local}</div>` : ''}
          <div class="imovel-card-tags">
            ${tags.map(t => `<span class="tag">${t}</span>`).join('')}
          </div>
          <div class="imovel-card-actions">
            <button class="btn-ghost btn-sm" onclick="editarImovel('${im.id}')">✏️ Editar</button>
            <button class="btn-danger btn-sm" onclick="deletarImovel('${im.id}')">🗑 Excluir</button>
          </div>
        </div>
      </div>`;
  }).join('');
}

function renderImovelPicker() {
  const picker = document.getElementById('imovelPicker');
  const empty  = document.getElementById('imovelPickerEmpty');
  if (!imoveis.length) {
    picker.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  picker.innerHTML = imoveis.map(im => {
    const foto  = Object.values(im.fotos || {})[0];
    const local = [im.cidade, im.estado].filter(Boolean).join(' - ');
    return `
      <div class="picker-card ${selectedImovelId === im.id ? 'selected' : ''}" onclick="selecionarImovel('${im.id}')">
        <div class="picker-thumb">
          ${foto ? `<img src="${foto}" alt="" />` : '🏢'}
        </div>
        <div class="picker-info">
          <h4>${im.titulo}</h4>
          <p>${[im.tipo, local].filter(Boolean).join(' • ') || '—'}</p>
        </div>
        <span class="picker-check">✓</span>
      </div>`;
  }).join('');
}

function selecionarImovel(id) {
  selectedImovelId = id;
  renderImovelPicker();
  atualizarResumo();
}

function atualizarResumo() {
  const resumo = document.getElementById('gerarResumo');
  const btn    = document.getElementById('btnGerar');
  const t  = templates.find(t => t.id === selectedTemplateId);
  const im = imoveis.find(i => i.id === selectedImovelId);

  if (!t || !im) {
    resumo.innerHTML = '<p class="resumo-hint">Selecione template e imóvel para continuar</p>';
    btn.disabled = true;
    return;
  }

  // Verifica ângulos faltando
  const angulos  = t.angulos || [];
  const fotos    = im.fotos || {};
  const faltando = angulos.filter(a => !fotos[a]);

  const fieldBadges = (t.fields || []).map(f =>
    `<span class="resumo-badge">${fieldLabels[f] || f}</span>`
  ).join('');

  const angulosBadges = angulos.map(a => {
    const falta = !fotos[a];
    return `<span class="resumo-badge ${falta ? 'missing' : 'ok'}">${angleLabels[a] || a}${falta ? ' ⚠️' : ' ✓'}</span>`;
  }).join('');

  const avisoFalta = faltando.length
    ? `<div class="resumo-alerta">⚠️ Este template precisa de: <strong>${faltando.map(a => angleLabels[a] || a).join(', ')}</strong>. Cadastre essas fotos no imóvel.</div>`
    : '';

  resumo.innerHTML = `
    <div class="resumo-content">
      <strong>Template:</strong> ${t.nome}<br>
      <strong>Imóvel:</strong> ${im.titulo}
      <div style="margin-top:10px">
        <div class="resumo-label">Campos que serão preenchidos</div>
        <div class="resumo-badges">${fieldBadges}</div>
      </div>
      ${angulos.length ? `
      <div style="margin-top:10px">
        <div class="resumo-label">Fotos necessárias</div>
        <div class="resumo-badges">${angulosBadges}</div>
      </div>` : ''}
      ${avisoFalta}
    </div>`;

  btn.disabled = faltando.length > 0;
}

function renderGerar() {
  renderTemplatesGrid();
  renderImovelPicker();
  atualizarResumo();
}

// ── Gerar Arte ────────────────────────────────────────────────────
async function gerarArte() {
  if (!selectedTemplateId || !selectedImovelId) return;
  document.getElementById('loadingOverlay').style.display = 'flex';
  document.getElementById('resultadoWrap').style.display  = 'none';

  try {
    const res  = await fetch('/api/gerar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: selectedTemplateId, imovelId: selectedImovelId }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error);

    lastArteData = data.imageData;
    document.getElementById('resultadoImg').src = data.imageData;
    document.getElementById('resultadoWrap').style.display = 'block';
    document.getElementById('resultadoWrap').scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    toast('Erro: ' + err.message, 'error');
  } finally {
    document.getElementById('loadingOverlay').style.display = 'none';
  }
}

function downloadArte() {
  if (!lastArteData) return;
  const a = document.createElement('a');
  a.href = lastArteData;
  a.download = `arte-${Date.now()}.png`;
  a.click();
}

// ── CRUD Imóveis ──────────────────────────────────────────────────
function abrirFormImovel(id = null) {
  document.getElementById('imovelForm').reset();
  document.getElementById('imovelEditId').value = '';
  document.getElementById('formImovelTitulo').textContent = 'Cadastrar Imóvel';
  renderFotoSlots({});

  if (id) {
    const im = imoveis.find(i => i.id === id);
    if (!im) return;
    document.getElementById('formImovelTitulo').textContent = 'Editar Imóvel';
    document.getElementById('imovelEditId').value = id;
    const form = document.getElementById('imovelForm');
    Object.keys(im).forEach(k => {
      const el = form.elements[k];
      if (el && el.type !== 'file') el.value = im[k] || '';
    });
    renderFotoSlots(im.fotos || {}, id);
  }

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-imovel-form').classList.add('active');
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
}

function renderFotoSlots(fotos, imovelId = null) {
  const wrap = document.getElementById('fotoSlotsWrap');
  wrap.innerHTML = photoSlots.map(slot => {
    const url = fotos[slot.key];
    return `
      <div class="foto-slot" id="slot-${slot.key}">
        <div class="foto-slot-label">${slot.label}</div>
        <div class="foto-slot-preview" id="slotpreview-${slot.key}">
          ${url
            ? `<img src="${url}" alt="${slot.label}" />
               <button type="button" class="foto-slot-remove" onclick="removerFotoSlot('${imovelId}', '${slot.key}')">✕</button>`
            : `<span class="foto-slot-empty">📷</span>`}
        </div>
        <label class="foto-slot-btn">
          ${url ? '🔄 Trocar' : '+ Adicionar'}
          <input type="file" accept="image/*" style="display:none"
                 onchange="uploadFotoSlot(this, '${imovelId}', '${slot.key}')" />
        </label>
      </div>`;
  }).join('');
}

async function uploadFotoSlot(input, imovelId, slot) {
  const file = input.files[0];
  if (!file) return;

  // Se imóvel ainda não foi salvo, salva primeiro
  let id = imovelId;
  if (!id) {
    const form = document.getElementById('imovelForm');
    const titulo = form.elements['titulo']?.value?.trim();
    if (!titulo) { toast('Salve o imóvel primeiro (preencha ao menos o título)', 'error'); return; }
    const campos = ['titulo','tipo','status','preco','entrada','parcela','financiamento',
      'area','quartos','suites','banheiros','vagas','andar',
      'endereco','bairro','cidade','estado','destaque','diferenciais','descricao'];
    const body = {};
    campos.forEach(c => { body[c] = form.elements[c]?.value || ''; });
    const res = await fetch('/api/imoveis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) { toast('Erro ao salvar imóvel', 'error'); return; }
    const saved = await res.json();
    id = saved.id;
    document.getElementById('imovelEditId').value = id;
    document.getElementById('formImovelTitulo').textContent = 'Editar Imóvel';
    await loadImoveis();
  }

  const preview = document.getElementById(`slotpreview-${slot}`);
  preview.innerHTML = `<div style="font-size:0.75rem;color:var(--text-muted);padding:8px">Enviando…</div>`;

  const fd = new FormData();
  fd.append('foto', file);
  const res = await fetch(`/api/imoveis/${id}/foto/${slot}`, { method: 'POST', body: fd });
  if (!res.ok) { toast('Erro ao enviar foto', 'error'); return; }
  const updated = await res.json();

  await loadImoveis();
  renderFotoSlots(updated.fotos || {}, id);
  toast('Foto salva!', 'success');
}

async function removerFotoSlot(imovelId, slot) {
  if (!imovelId) return;
  await fetch(`/api/imoveis/${imovelId}/foto/${slot}`, { method: 'DELETE' });
  await loadImoveis();
  const im = imoveis.find(i => i.id === imovelId);
  renderFotoSlots(im?.fotos || {}, imovelId);
  toast('Foto removida', 'success');
}

function editarImovel(id) { abrirFormImovel(id); }

function voltarImoveis() {
  navegarPara('imoveis');
  renderImoveisGrid();
}

async function salvarImovel(e) {
  e.preventDefault();
  const form = e.target;
  const id   = document.getElementById('imovelEditId').value;

  const campos = ['titulo','tipo','status','preco','entrada','parcela','financiamento',
    'area','quartos','suites','banheiros','vagas','andar',
    'endereco','bairro','cidade','estado','destaque','diferenciais','descricao'];
  const body = {};
  campos.forEach(c => { body[c] = form.elements[c]?.value || ''; });

  const url    = id ? `/api/imoveis/${id}` : '/api/imoveis';
  const method = id ? 'PUT' : 'POST';
  const res    = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) { toast('Erro ao salvar', 'error'); return; }
  const saved = await res.json();
  if (!id) document.getElementById('imovelEditId').value = saved.id;
  await loadImoveis();
  toast(id ? 'Imóvel atualizado!' : 'Imóvel salvo! Agora adicione as fotos abaixo.', 'success');
  if (id) voltarImoveis();
  else renderFotoSlots(saved.fotos || {}, saved.id);
}

async function deletarImovel(id) {
  if (!confirm('Excluir este imóvel?')) return;
  await fetch(`/api/imoveis/${id}`, { method: 'DELETE' });
  await loadImoveis();
  renderImoveisGrid();
  if (selectedImovelId === id) { selectedImovelId = null; atualizarResumo(); }
  toast('Imóvel excluído', 'success');
}

// ── Perfil ────────────────────────────────────────────────────────
async function loadPerfil() {
  const res    = await fetch('/api/perfil');
  const perfil = await res.json();
  const form   = document.getElementById('perfilForm');
  Object.keys(perfil).forEach(k => {
    const el = form.elements[k];
    if (el && el.type !== 'file') el.value = perfil[k] || '';
  });
  if (perfil.logo) {
    document.getElementById('logoPreview').src = perfil.logo;
    document.getElementById('logoPreview').style.display = 'block';
    document.getElementById('logoPlaceholder').style.display = 'none';
  }
}

async function salvarPerfil(e) {
  e.preventDefault();
  const fd  = new FormData(e.target);
  const res = await fetch('/api/perfil', { method: 'PUT', body: fd });
  if (!res.ok) { toast('Erro ao salvar perfil', 'error'); return; }
  toast('Perfil salvo!', 'success');
}

function previewLogo(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('logoPreview').src = e.target.result;
    document.getElementById('logoPreview').style.display = 'block';
    document.getElementById('logoPlaceholder').style.display = 'none';
  };
  reader.readAsDataURL(file);
}

// ── Toast ─────────────────────────────────────────────────────────
function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type} show`;
  setTimeout(() => el.classList.remove('show'), 3000);
}

init();
