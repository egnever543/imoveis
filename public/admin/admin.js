const MEDIA_FIELDS = ['foto_imovel', 'logo'];
const ALL_FIELDS   = [
  'titulo','preco','entrada','parcela','financiamento',
  'area','quartos','suites','banheiros','vagas','andar',
  'localizacao','endereco','destaque','diferenciais','foto_imovel','logo',
];

let adminPassword = sessionStorage.getItem('adminPassword') || '';
let selectedFile  = null;
let fieldLabels   = {};
let angleLabels   = {};
let photoSlots    = [];
let editingId     = null;

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

function sair() {
  sessionStorage.removeItem('adminPassword');
  location.reload();
}

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
  const templates = await res.json();
  renderTemplates(templates);
}

function renderTemplates(templates) {
  allTemplates = templates;
  const el = document.getElementById('templatesList');
  if (!templates.length) {
    el.innerHTML = '<div class="no-templates">Nenhum template cadastrado ainda.</div>';
    return;
  }
  el.innerHTML = templates.map(t => {
    const angulos = (t.angulos || []).map(a =>
      `<span class="field-badge angle">${angleLabels[a] || a}</span>`
    ).join('');
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
        ${angulos ? `<div class="fields-wrap"><span style="font-size:0.65rem;color:var(--text-muted);margin-right:4px">📐</span>${angulos}</div>` : ''}
      </div>
      <div class="template-row-actions">
        <button class="btn-ghost btn-sm" onclick="abrirEdicao(${t.id})">✏️ Editar</button>
        <button class="btn-danger btn-sm" onclick="deletarTemplate(${t.id}, '${t.nome.replace(/'/g,"\\'")}')">🗑 Excluir</button>
      </div>
    </div>`;
  }).join('');
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

// ── Editar ────────────────────────────────────────────────────────────────────
let allTemplates = [];

function abrirEdicao(id) {
  const t = allTemplates.find(t => t.id == id);
  if (!t) return;
  const { nome, fields = [], angulos = [] } = t;
  editingId = id;
  document.getElementById('editNome').value = nome;

  // Campos
  const fieldsWrap = document.getElementById('editFieldsWrap');
  fieldsWrap.innerHTML = ALL_FIELDS.map(f => {
    const checked = fields.includes(f);
    const isMedia = MEDIA_FIELDS.includes(f);
    return `
      <label class="field-toggle ${checked ? 'checked' : ''} ${checked && isMedia ? 'media' : ''}"
             onclick="toggleToggle(this, ${isMedia})">
        <input type="checkbox" value="${f}" ${checked ? 'checked' : ''} />
        ${fieldLabels[f] || f}
      </label>`;
  }).join('');

  // Ângulos — só aparece se foto_imovel estiver nos fields
  renderAngulosEdit(fields.includes('foto_imovel'), angulos);

  document.getElementById('editModal').style.display = 'flex';
}

function renderAngulosEdit(show, selectedAngulos) {
  const wrap = document.getElementById('editAngulosSection');
  if (!show) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  const angulosWrap = document.getElementById('editAngulosWrap');
  angulosWrap.innerHTML = photoSlots.map(s => {
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

  // Se desmarcar foto_imovel, esconde seção de ângulos
  if (label.closest('#editFieldsWrap')) {
    const allFieldCbs = document.querySelectorAll('#editFieldsWrap input');
    const fotoChecked = [...allFieldCbs].find(c => c.value === 'foto_imovel')?.checked;
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

// ── Upload ────────────────────────────────────────────────────────────────────
function handleFile(file) {
  if (!file) return;
  selectedFile = file;
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('dropContent').innerHTML = `
      <img src="${e.target.result}" style="max-height:120px;object-fit:contain;border-radius:8px;margin-bottom:6px" />
      <div style="font-size:0.8rem">${file.name}</div>
    `;
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
    const res = await fetch('/api/admin/templates', {
      method: 'POST',
      headers: { 'x-admin-password': adminPassword },
      body: fd,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    toast(`Template "${data.nome}" salvo! Edite para definir os ângulos de foto.`, 'success');
    selectedFile = null;
    document.getElementById('fileInput').value = '';
    document.getElementById('nomeInput').value = '';
    document.getElementById('dropContent').innerHTML = `
      <div class="dz-icon">🖼</div>
      <div>Clique ou arraste a imagem do template aqui</div>
      <div style="font-size:0.75rem;margin-top:4px">PNG, JPG ou WEBP</div>
    `;
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

init();
