const MEDIA_FIELDS = ['foto_imovel', 'logo'];

let adminPassword = sessionStorage.getItem('adminPassword') || '';
let selectedFile  = null;
let fieldLabels   = {};

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
  if (!ok) {
    document.getElementById('loginError').textContent = 'Senha incorreta';
    return;
  }
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
  const res = await fetch('/api/field-labels');
  fieldLabels = await res.json();
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
        <div class="fields-wrap">
          ${(t.fields || []).map(f => `
            <span class="field-badge ${MEDIA_FIELDS.includes(f) ? 'media' : ''}">
              ${fieldLabels[f] || f}
            </span>
          `).join('')}
        </div>
      </div>
      <button class="btn-danger btn-sm" onclick="deletarTemplate(${t.id}, '${t.nome}')">🗑</button>
    </div>
  `).join('');
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
  if (!document.getElementById('nomeInput').value) {
    document.getElementById('nomeInput').value = file.name.replace(/\.[^.]+$/, '');
  }
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

    toast(`Template "${data.nome}" salvo com ${data.fields.length} campo(s) detectado(s)!`, 'success');
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
