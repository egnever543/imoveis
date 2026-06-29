// ── Estado global ────────────────────────────────────────────────
let templates    = [];
let imoveis      = [];
let fieldLabels  = {};
let selectedTemplateId = null;
let selectedImovelId   = null;
let lastArteData       = null;
let fotosNovas         = [];

// ── Init ─────────────────────────────────────────────────────────
async function init() {
  setupNav();
  await Promise.all([loadTemplates(), loadImoveis(), loadPerfil(), loadFieldLabels()]);
  renderGerar();
  renderImoveisGrid();
}

async function loadFieldLabels() {
  const res = await fetch('/api/field-labels');
  fieldLabels = await res.json();
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

function renderTemplatesGrid() {
  const grid = document.getElementById('templatesGrid');
  if (!templates.length) {
    grid.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem">Nenhum template cadastrado. <a href="/admin.html" style="color:var(--primary)">Acesse o admin →</a></p>';
    return;
  }
  grid.innerHTML = templates.map(t => `
    <div class="template-card ${selectedTemplateId === t.id ? 'selected' : ''}" onclick="selecionarTemplate(${t.id})">
      <img src="${t.imageUrl}" alt="${t.nome}" loading="lazy" />
      <div class="template-card-name">${t.nome}</div>
      <span class="check-badge">✓</span>
    </div>
  `).join('');
}

function selecionarTemplate(id) {
  selectedTemplateId = id;
  renderTemplatesGrid();
  atualizarResumo();
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
    const foto  = im.fotos?.[0];
    const local = [im.bairro, im.cidade, im.estado].filter(Boolean).join(', ');
    const tags  = [];
    if (im.area)      tags.push(`${im.area} m²`);
    if (im.quartos)   tags.push(`${im.quartos} qtos`);
    if (im.vagas)     tags.push(`${im.vagas} vaga${im.vagas > 1 ? 's' : ''}`);
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
      </div>
    `;
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
    const foto  = im.fotos?.[0];
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
      </div>
    `;
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

  const fieldBadges = (t.fields || []).map(f =>
    `<span style="font-size:0.7rem;padding:2px 8px;border-radius:20px;background:#1e3a5f;color:#93c5fd;border:1px solid #2563eb44">${fieldLabels[f] || f}</span>`
  ).join(' ');

  resumo.innerHTML = `
    <div class="resumo-content">
      <strong>Template:</strong> ${t.nome}<br>
      <strong>Imóvel:</strong> ${im.titulo}<br>
      <div style="margin-top:10px">
        <div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Campos que serão preenchidos</div>
        <div style="display:flex;flex-wrap:wrap;gap:5px">${fieldBadges}</div>
      </div>
    </div>
  `;
  btn.disabled = false;
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
  document.getElementById('fotosPreview').innerHTML = '';
  fotosNovas = [];
  document.getElementById('formImovelTitulo').textContent = 'Cadastrar Imóvel';

  if (id) {
    const im = imoveis.find(i => i.id === id);
    if (!im) return;
    document.getElementById('formImovelTitulo').textContent = 'Editar Imóvel';
    document.getElementById('imovelEditId').value = id;
    const form = document.getElementById('imovelForm');
    Object.keys(im).forEach(k => {
      const el = form.elements[k];
      if (el) el.value = im[k];
    });
    // Fotos existentes
    if (im.fotos?.length) {
      document.getElementById('fotosPreview').innerHTML = im.fotos.map(url => `
        <div class="foto-thumb-wrap">
          <img class="foto-thumb" src="${url}" />
          <button type="button" class="foto-remove" onclick="removerFotoExistente('${id}', '${url}')">✕</button>
        </div>
      `).join('');
    }
  }

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-imovel-form').classList.add('active');
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
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
  const fd   = new FormData(form);
  // Adiciona arquivos novos selecionados
  if (fotosNovas.length) {
    fd.delete('fotos');
    fotosNovas.forEach(f => fd.append('fotos', f));
  }
  const url    = id ? `/api/imoveis/${id}` : '/api/imoveis';
  const method = id ? 'PUT' : 'POST';
  const res    = await fetch(url, { method, body: fd });
  if (!res.ok) { toast('Erro ao salvar', 'error'); return; }
  await loadImoveis();
  toast(id ? 'Imóvel atualizado!' : 'Imóvel cadastrado!', 'success');
  voltarImoveis();
}

async function deletarImovel(id) {
  if (!confirm('Excluir este imóvel?')) return;
  await fetch(`/api/imoveis/${id}`, { method: 'DELETE' });
  await loadImoveis();
  renderImoveisGrid();
  if (selectedImovelId === id) { selectedImovelId = null; atualizarResumo(); }
  toast('Imóvel excluído', 'success');
}

async function removerFotoExistente(imovelId, url) {
  await fetch(`/api/imoveis/${imovelId}/foto`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  await loadImoveis();
  abrirFormImovel(imovelId);
}

function previewFotos(input) {
  fotosNovas = Array.from(input.files);
  const preview = document.getElementById('fotosPreview');
  // Mantém fotos existentes (as do servidor já estão renderizadas)
  const existentes = preview.querySelectorAll('.foto-thumb-wrap');
  // Remove previews anteriores que foram adicionados por essa função
  preview.querySelectorAll('.foto-preview-new').forEach(el => el.remove());
  fotosNovas.forEach(file => {
    const reader = new FileReader();
    reader.onload = e => {
      const wrap = document.createElement('div');
      wrap.className = 'foto-thumb-wrap foto-preview-new';
      wrap.innerHTML = `<img class="foto-thumb" src="${e.target.result}" />`;
      preview.appendChild(wrap);
    };
    reader.readAsDataURL(file);
  });
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
