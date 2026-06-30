const MEDIA_FIELDS = ['foto_imovel', 'logo'];
const ALL_FIELDS   = [
  'titulo','preco','entrada','parcela','financiamento',
  'area','quartos','suites','banheiros','vagas','andar',
  'cidade','localizacao','endereco','destaque','diferenciais','foto_imovel','logo',
];

let adminPassword = sessionStorage.getItem('adminPassword') || '';
let selectedFile  = null;
let fieldLabels   = {};
let angleLabels   = {};
let photoSlots    = [];
let allTemplates  = [];
let editingId     = null;

// â”€â”€ Init â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  el.innerHTML = templates.map(t => `
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
        <div class="fields-wrap">
          ${(t.angulos || []).map(a => `<span class="field-badge angle">${angleLabels[a] || a}</span>`).join('')}
        </div>
      </div>
      <div class="template-row-actions">
        <button class="btn-ghost btn-sm"  onclick="abrirEdicao(${t.id})">Editar</button>
        <button class="btn-danger btn-sm" onclick="deletarTemplate(${t.id}, '${t.nome.replace(/'/g,"\\'")}')">Excluir</button>
      </div>
    </div>`).join('');
}

// â”€â”€ Editar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function abrirEdicao(id) {
  const t = allTemplates.find(t => t.id == id);
  if (!t) return;
  editingId = id;
  document.getElementById('editNome').value = t.nome;

  // Preview da imagem atual + limpar seleÃ§Ã£o anterior
  document.getElementById('editImgPreview').src = t.imageUrl;
  document.getElementById('editImgInput').value  = '';
  document.getElementById('editImgNome').textContent = '';

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
  renderMapaForm(t.fields || [], t.mapa || {});
  document.getElementById('editModal').style.display = 'flex';
}

function renderMapaForm(fields, mapa) {
  const wrap = document.getElementById('editMapaForm');
  const editaveis = fields.filter(f => f !== 'foto_imovel');
  if (!editaveis.length) { wrap.innerHTML = '<p style="font-size:0.8rem;color:var(--text-muted)">Nenhum campo de texto detectado.</p>'; return; }
  wrap.innerHTML = editaveis.map(f => `
    <div class="field">
      <label style="font-size:0.75rem">${fieldLabels[f] || f}</label>
      <input type="text" data-mapa-field="${f}"
             value="${(mapa[f] || '').replace(/"/g, '&quot;')}"
             placeholder="Ex: como este campo aparece na imagem do template..." />
    </div>`).join('');
}

function previewEditImg(input) {
  const file = input.files[0];
  if (!file) return;
  document.getElementById('editImgPreview').src = URL.createObjectURL(file);
  document.getElementById('editImgNome').textContent = file.name;
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
  const mapa = {};
  document.querySelectorAll('#editMapaForm input[data-mapa-field]').forEach(inp => {
    if (inp.value.trim()) mapa[inp.dataset.mapaField] = inp.value.trim();
  });
  const imgFile = document.getElementById('editImgInput').files[0];

  const btn = document.querySelector('#editModal .btn-primary');
  btn.disabled = true;
  btn.textContent = 'Salvandoâ€¦';

  try {
    // 1. Se tiver nova imagem, envia primeiro
    if (imgFile) {
      const fd = new FormData();
      fd.append('imagem', imgFile);
      const imgRes = await fetch(`/api/admin/templates/${editingId}/editar-ia`, {
        method: 'POST',
        headers: { 'x-admin-password': adminPassword },
        body: fd,
      });
      if (!imgRes.ok) { toast('Erro ao enviar imagem', 'error'); return; }
    }

    // 2. Salva nome/fields/angulos
    const res = await fetch(`/api/admin/templates/${editingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPassword },
      body: JSON.stringify({ nome, fields, angulos, mapa }),
    });
    if (!res.ok) { toast('Erro ao salvar', 'error'); return; }

    document.getElementById('editModal').style.display = 'none';
    toast('Template atualizado!', 'success');
    await carregarTemplates();
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar';
  }
}

async function deletarTemplate(id, nome) {
  if (!confirm(`Excluir o template "${nome}"?`)) return;
  await fetch(`/api/admin/templates/${id}`, {
    method: 'DELETE',
    headers: { 'x-admin-password': adminPassword },
  });
  toast('Template excluÃ­do', 'success');
  await carregarTemplates();
}

// â”€â”€ Upload â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function handleFile(file) {
  if (!file) return;
  selectedFile = file;
  const nomeInput = document.getElementById('nomeInput');
  if (!nomeInput.value)
    nomeInput.value = file.name.replace(/\.[^.]+$/, '');
  const img = document.getElementById('uploadPreviewImg');
  img.src = URL.createObjectURL(file);
  document.getElementById('uploadPreview').style.display = 'block';
}

function handleDrop(e) {
  e.preventDefault();
  document.getElementById('dropZone').classList.remove('over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) handleFile(file);
}

function cancelarUpload() {
  selectedFile = null;
  document.getElementById('fileInput').value = '';
  document.getElementById('nomeInput').value = '';
  document.getElementById('uploadPreview').style.display = 'none';
}

async function uploadTemplate() {
  if (!selectedFile) return;
  const nome = document.getElementById('nomeInput').value.trim();
  const btn  = document.getElementById('btnUpload');
  btn.disabled = true;
  document.getElementById('analyzingHint').style.display = 'block';

  try {
    const fd = new FormData();
    fd.append('imagem', selectedFile);
    fd.append('nome', nome);

    const res  = await fetch('/api/admin/templates', {
      method: 'POST',
      headers: { 'x-admin-password': adminPassword },
      body: fd,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    toast(`"${data.nome}" salvo!`, 'success');
    cancelarUpload();
    await carregarTemplates();
  } catch (err) {
    toast('Erro: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    document.getElementById('analyzingHint').style.display = 'none';
  }
}

// â”€â”€ Toast â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type} show`;
  setTimeout(() => el.classList.remove('show'), 4000);
}


init();

