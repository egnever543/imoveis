const MEDIA_FIELDS = ['foto_imovel', 'logo'];
const ALL_FIELDS   = [
  'titulo','preco','entrada','parcela','financiamento',
  'area','quartos','suites','banheiros','vagas','andar',
  'localizacao','endereco','destaque','diferenciais','foto_imovel','logo',
];

// Cor por campo para o mapeamento
const FIELD_COLORS = {
  foto_imovel: '#10b981',
  logo:        '#8b5cf6',
  titulo:      '#3b82f6',
  preco:       '#f59e0b',
  entrada:     '#f59e0b',
  parcela:     '#f59e0b',
  financiamento:'#f59e0b',
  destaque:    '#ec4899',
  _default:    '#64748b',
};

function fieldColor(f) { return FIELD_COLORS[f] || FIELD_COLORS._default; }

let adminPassword = sessionStorage.getItem('adminPassword') || '';
let selectedFile  = null;
let fieldLabels   = {};
let angleLabels   = {};
let photoSlots    = [];
let allTemplates  = [];
let editingId     = null;

// ── Mapeamento ────────────────────────────────────────────────────────────────
let mappingId     = null;
let zonas         = {};       // { campo: { xPct, yPct, wPct, hPct } }
let drawing       = false;
let drawStart     = null;
let activeField   = '';

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  if (adminPassword) {
    const ok = await verificarSenha(adminPassword);
    if (ok) { mostrarAdmin(); return; }
    sessionStorage.removeItem('adminPassword');
    adminPassword = '';
  }
}

async function verificarSenha(pwd) {
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pwd }),
  });
  return res.ok;
}

async function fazerLogin() {
  const pwd = document.getElementById('loginInput').value;
  if (!pwd) return;
  const ok = await verificarSenha(pwd);
  if (!ok) { document.getElementById('loginError').textContent = 'Senha incorreta'; return; }
  adminPassword = pwd;
  sessionStorage.setItem('adminPassword', pwd);
  mostrarAdmin();
}

function sair() { sessionStorage.removeItem('adminPassword'); location.reload(); }

async function mostrarAdmin() {
  document.getElementById('loginWrap').style.display = 'none';
  document.getElementById('adminArea').style.display  = 'block';
  const [fl, al, ps] = await Promise.all([
    fetch('/api/field-labels').then(r => r.json()),
    fetch('/api/angle-labels').then(r => r.json()),
    fetch('/api/photo-slots').then(r => r.json()),
  ]);
  fieldLabels = fl;
  angleLabels = al;
  photoSlots  = ps;
  await carregarTemplates();
}

async function carregarTemplates() {
  const res = await fetch('/api/admin/templates', {
    headers: { 'x-admin-password': adminPassword },
  });
  allTemplates = await res.json();
  renderTemplates(allTemplates);
}

function renderTemplates(templates) {
  const el = document.getElementById('templatesList');
  if (!templates.length) {
    el.innerHTML = '<div class="no-templates">Nenhum template cadastrado ainda.</div>';
    return;
  }
  el.innerHTML = templates.map(t => {
    const nZonas   = Object.keys(t.zonas || {}).length;
    const mapBadge = nZonas
      ? `<span class="field-badge mapped">🗺 ${nZonas} zona${nZonas > 1 ? 's' : ''} mapeada${nZonas > 1 ? 's' : ''}</span>`
      : `<span class="field-badge" style="opacity:.5">🗺 sem mapeamento</span>`;

    return `
    <div class="template-row" id="trow-${t.id}">
      <img src="${t.imageUrl}" alt="${t.nome}" />
      <div class="template-row-info">
        <h3>${t.nome}</h3>
        <div class="fields-wrap" style="margin-bottom:6px">
          ${(t.fields || []).map(f => `
            <span class="field-badge ${MEDIA_FIELDS.includes(f) ? 'media' : ''}">
              ${fieldLabels[f] || f}
            </span>`).join('')}
        </div>
        <div class="fields-wrap" style="margin-bottom:4px">
          ${(t.angulos || []).map(a => `<span class="field-badge angle">${angleLabels[a] || a}</span>`).join('')}
        </div>
        <div class="fields-wrap">${mapBadge}</div>
      </div>
      <div class="template-row-actions">
        <button class="btn-ghost btn-sm"    onclick="abrirEdicao(${t.id})">✏️ Editar</button>
        <button class="btn-primary btn-sm"  onclick="abrirMapeamento(${t.id})">🗺 Mapear</button>
        <button class="btn-danger btn-sm"   onclick="deletarTemplate(${t.id}, '${t.nome.replace(/'/g,"\\'")}')">🗑 Excluir</button>
      </div>
    </div>`;
  }).join('');
}

// ── Editar ────────────────────────────────────────────────────────────────────
function abrirEdicao(id) {
  const t = allTemplates.find(t => t.id == id);
  if (!t) return;
  editingId = id;
  document.getElementById('editNome').value = t.nome;

  document.getElementById('editFieldsWrap').innerHTML = ALL_FIELDS.map(f => {
    const checked = (t.fields || []).includes(f);
    const isMedia = MEDIA_FIELDS.includes(f);
    return `
      <label class="field-toggle ${checked ? 'checked' : ''} ${checked && isMedia ? 'media' : ''}"
             onclick="toggleToggle(this, ${isMedia})">
        <input type="checkbox" value="${f}" ${checked ? 'checked' : ''} />
        ${fieldLabels[f] || f}
      </label>`;
  }).join('');

  renderAngulosEdit((t.fields || []).includes('foto_imovel'), t.angulos || []);
  document.getElementById('editModal').style.display = 'flex';
}

function renderAngulosEdit(show, selectedAngulos) {
  const wrap = document.getElementById('editAngulosSection');
  if (!show) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  document.getElementById('editAngulosWrap').innerHTML = photoSlots.map(s => {
    const checked = selectedAngulos.includes(s.key);
    return `
      <label class="field-toggle ${checked ? 'checked angle' : ''}"
             onclick="toggleToggle(this, false)">
        <input type="checkbox" value="${s.key}" ${checked ? 'checked' : ''} />
        ${s.label}
      </label>`;
  }).join('');
}

function toggleToggle(label, isMedia) {
  const cb = label.querySelector('input');
  cb.checked = !cb.checked;
  label.classList.toggle('checked', cb.checked);
  if (isMedia) label.classList.toggle('media', cb.checked);
  else if (label.closest('#editAngulosWrap')) label.classList.toggle('angle', cb.checked);

  if (label.closest('#editFieldsWrap')) {
    const fotoChecked = [...document.querySelectorAll('#editFieldsWrap input')]
      .find(c => c.value === 'foto_imovel')?.checked;
    const currentAngulos = [...document.querySelectorAll('#editAngulosWrap input:checked')].map(c => c.value);
    renderAngulosEdit(fotoChecked, currentAngulos);
  }
}

function fecharModal(e) {
  if (e.target === document.getElementById('editModal'))
    document.getElementById('editModal').style.display = 'none';
}

async function salvarEdicao() {
  const nome    = document.getElementById('editNome').value.trim();
  const fields  = [...document.querySelectorAll('#editFieldsWrap input:checked')].map(cb => cb.value);
  const angulos = [...document.querySelectorAll('#editAngulosWrap input:checked')].map(cb => cb.value);

  const res = await fetch(`/api/admin/templates/${editingId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPassword },
    body: JSON.stringify({ nome, fields, angulos }),
  });
  if (!res.ok) { toast('Erro ao salvar', 'error'); return; }
  document.getElementById('editModal').style.display = 'none';
  toast('Template atualizado!', 'success');
  await carregarTemplates();
}

async function deletarTemplate(id, nome) {
  if (!confirm(`Excluir o template "${nome}"?`)) return;
  await fetch(`/api/admin/templates/${id}`, {
    method: 'DELETE',
    headers: { 'x-admin-password': adminPassword },
  });
  toast('Template excluído', 'success');
  await carregarTemplates();
}

// ── Mapeamento de zonas ───────────────────────────────────────────────────────
function abrirMapeamento(id) {
  const t = allTemplates.find(t => t.id == id);
  if (!t) return;
  mappingId   = id;
  zonas       = JSON.parse(JSON.stringify(t.zonas || {}));
  activeField = '';
  drawing     = false;

  // Popula select com campos do template
  const sel = document.getElementById('mapFieldSelect');
  sel.innerHTML = '<option value="">— Selecione um campo —</option>' +
    (t.fields || []).map(f =>
      `<option value="${f}" style="color:${fieldColor(f)}">${fieldLabels[f] || f}${zonas[f] ? ' ✓' : ''}</option>`
    ).join('');
  sel.onchange = () => {
    activeField = sel.value;
    document.getElementById('btnLimparZona').disabled = !activeField || !zonas[activeField];
    redrawCanvas();
  };

  document.getElementById('mapImage').src = t.imageUrl;
  document.getElementById('mapModal').style.display = 'flex';
  atualizarLegenda();
  atualizarContagem();
}

function fecharMapModal(e) {
  if (e.target === document.getElementById('mapModal'))
    document.getElementById('mapModal').style.display = 'none';
}

function sincronizarCanvas() {
  const img    = document.getElementById('mapImage');
  const canvas = document.getElementById('mapCanvas');
  canvas.width  = img.offsetWidth;
  canvas.height = img.offsetHeight;
  canvas.style.width  = img.offsetWidth  + 'px';
  canvas.style.height = img.offsetHeight + 'px';
  redrawCanvas();
}

function posRelativa(e) {
  const canvas = document.getElementById('mapCanvas');
  const rect   = canvas.getBoundingClientRect();
  const src    = e.touches ? e.touches[0] : e;
  return {
    x: src.clientX - rect.left,
    y: src.clientY - rect.top,
  };
}

function iniciarDesenho(e) {
  if (!activeField) return;
  e.preventDefault();
  drawing   = true;
  drawStart = posRelativa(e);
}

function atualizarDesenho(e) {
  if (!drawing) return;
  e.preventDefault();
  const cur = posRelativa(e);
  redrawCanvas(drawStart, cur);
}

function finalizarDesenho(e) {
  if (!drawing) return;
  e.preventDefault();
  drawing = false;
  const cur    = posRelativa(e.changedTouches ? e.changedTouches[0] : e);
  const canvas = document.getElementById('mapCanvas');
  const W = canvas.width, H = canvas.height;

  const x = Math.min(drawStart.x, cur.x);
  const y = Math.min(drawStart.y, cur.y);
  const w = Math.abs(cur.x - drawStart.x);
  const h = Math.abs(cur.y - drawStart.y);

  if (w < 10 || h < 10) return; // clique sem intenção

  zonas[activeField] = {
    xPct: (x / W) * 100,
    yPct: (y / H) * 100,
    wPct: (w / W) * 100,
    hPct: (h / H) * 100,
  };

  // Atualiza select
  const opt = document.querySelector(`#mapFieldSelect option[value="${activeField}"]`);
  if (opt) opt.textContent = (fieldLabels[activeField] || activeField) + ' ✓';

  document.getElementById('btnLimparZona').disabled = false;
  atualizarLegenda();
  atualizarContagem();
  redrawCanvas();
}

function redrawCanvas(start, cur) {
  const canvas = document.getElementById('mapCanvas');
  const ctx    = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // Desenha zonas salvas
  Object.entries(zonas).forEach(([field, z]) => {
    const x = z.xPct / 100 * W;
    const y = z.yPct / 100 * H;
    const w = z.wPct / 100 * W;
    const h = z.hPct / 100 * H;
    const color = fieldColor(field);
    const isActive = field === activeField;

    ctx.fillStyle = hexToRgba(color, isActive ? 0.35 : 0.25);
    ctx.fillRect(x, y, w, h);

    ctx.strokeStyle = color;
    ctx.lineWidth   = isActive ? 3 : 2;
    ctx.setLineDash(isActive ? [] : [6, 3]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);

    // Label
    const label = `[ ${(fieldLabels[field] || field).toUpperCase()} ]`;
    const fs    = Math.max(11, Math.min(22, Math.round(h * 0.3)));
    ctx.font      = `900 ${fs}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle  = 'rgba(0,0,0,0.8)';
    ctx.lineWidth    = 3;
    ctx.strokeText(label, x + w / 2, y + h / 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, x + w / 2, y + h / 2);
  });

  // Desenha retângulo em andamento
  if (start && cur && activeField) {
    const x = Math.min(start.x, cur.x);
    const y = Math.min(start.y, cur.y);
    const w = Math.abs(cur.x - start.x);
    const h = Math.abs(cur.y - start.y);
    const color = fieldColor(activeField);
    ctx.fillStyle   = hexToRgba(color, 0.2);
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
  }
}

function limparZonaSelecionada() {
  if (!activeField || !zonas[activeField]) return;
  delete zonas[activeField];
  const opt = document.querySelector(`#mapFieldSelect option[value="${activeField}"]`);
  if (opt) opt.textContent = fieldLabels[activeField] || activeField;
  document.getElementById('btnLimparZona').disabled = true;
  atualizarLegenda();
  atualizarContagem();
  redrawCanvas();
}

function atualizarLegenda() {
  const leg = document.getElementById('mapLegend');
  leg.innerHTML = Object.keys(zonas).map(f => {
    const color = fieldColor(f);
    return `<span class="map-legend-item" style="background:${hexToRgba(color,0.25)};color:${color};border:1px solid ${hexToRgba(color,0.5)}">
      ${fieldLabels[f] || f}
    </span>`;
  }).join('');
}

function atualizarContagem() {
  const n = Object.keys(zonas).length;
  document.getElementById('mapZonesCount').textContent =
    n === 0 ? 'Nenhuma zona mapeada ainda'
    : `${n} zona${n > 1 ? 's' : ''} mapeada${n > 1 ? 's' : ''}`;
}

async function salvarZonas() {
  const res = await fetch(`/api/admin/templates/${mappingId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPassword },
    body: JSON.stringify({ zonas }),
  });
  if (!res.ok) { toast('Erro ao salvar', 'error'); return; }
  document.getElementById('mapModal').style.display = 'none';
  toast('Mapeamento salvo!', 'success');
  await carregarTemplates();
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── Upload ────────────────────────────────────────────────────────────────────
function handleFile(file) {
  if (!file) return;
  selectedFile = file;
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('dropContent').innerHTML = `
      <img src="${e.target.result}" style="max-height:120px;object-fit:contain;border-radius:8px;margin-bottom:6px" />
      <div style="font-size:0.8rem">${file.name}</div>`;
  };
  reader.readAsDataURL(file);
  document.getElementById('btnUpload').disabled = false;
  if (!document.getElementById('nomeInput').value)
    document.getElementById('nomeInput').value = file.name.replace(/\.[^.]+$/, '');
}

function handleDrop(e) {
  e.preventDefault();
  document.getElementById('dropZone').classList.remove('over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) handleFile(file);
}

async function uploadTemplate() {
  if (!selectedFile) return;
  const nome = document.getElementById('nomeInput').value.trim();
  document.getElementById('btnUpload').disabled = true;
  document.getElementById('analyzingHint').style.display = 'block';

  const fd = new FormData();
  fd.append('imagem', selectedFile);
  fd.append('nome', nome);

  try {
    const res  = await fetch('/api/admin/templates', {
      method: 'POST',
      headers: { 'x-admin-password': adminPassword },
      body: fd,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    toast(`"${data.nome}" salvo! Agora clique em 🗺 Mapear para definir as zonas.`, 'success');
    selectedFile = null;
    document.getElementById('fileInput').value = '';
    document.getElementById('nomeInput').value = '';
    document.getElementById('dropContent').innerHTML = `
      <div class="dz-icon">🖼</div>
      <div>Clique ou arraste a imagem do template aqui</div>
      <div style="font-size:0.75rem;margin-top:4px">PNG, JPG ou WEBP</div>`;
    await carregarTemplates();
  } catch (err) {
    toast('Erro: ' + err.message, 'error');
  } finally {
    document.getElementById('btnUpload').disabled = false;
    document.getElementById('analyzingHint').style.display = 'none';
  }
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type} show`;
  setTimeout(() => el.classList.remove('show'), 4000);
}

// Resincroniza canvas ao redimensionar janela
window.addEventListener('resize', () => {
  if (document.getElementById('mapModal').style.display !== 'none') sincronizarCanvas();
});

init();
