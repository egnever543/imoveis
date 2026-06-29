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
let allTemplates  = [];
let editingId     = null;

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
        <button class="btn-ghost btn-sm"  onclick="abrirEdicao(${t.id})">✏️ Editar</button>
        <button class="btn-ia btn-sm"     onclick="abrirEditarIA(${t.id})">✨ Editar com IA</button>
        <button class="btn-danger btn-sm" onclick="deletarTemplate(${t.id}, '${t.nome.replace(/'/g,"\\'")}')">🗑 Excluir</button>
      </div>
    </div>`).join('');
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

// ── Editar com IA (templates existentes) ─────────────────────────────────────
const IA_COLORS = { logo: '#8b5cf6', localizacao: '#3b82f6' };
const IA_LABELS = { logo: '{ LOGO AQUI }', localizacao: '{ LOCALIZAÇÃO }' };
let iaId        = null;
let iaMarcador  = 'logo';
let iaMarcacoes = {};
let iaDrawing   = false;
let iaStart     = null;

function abrirEditarIA(id) {
  const t = allTemplates.find(t => t.id == id);
  if (!t) return;
  iaId        = id;
  iaMarcacoes = {};
  iaMarcador  = 'logo';

  document.getElementById('btnIAMarkLogo').classList.add('active');
  document.getElementById('btnIAMarkLoc').classList.remove('active');
  document.getElementById('editIAStatus').textContent = '';

  const img = document.getElementById('editIAImage');
  img.onload = () => {
    const canvas = document.getElementById('editIACanvas');
    canvas.width  = img.offsetWidth;
    canvas.height = img.offsetHeight;
    canvas.style.width  = img.offsetWidth  + 'px';
    canvas.style.height = img.offsetHeight + 'px';
    redrawIAMarcacoes();
  };
  img.src = t.imageUrl;
  document.getElementById('editIAModal').style.display = 'flex';
}

function fecharEditIA() {
  document.getElementById('editIAModal').style.display = 'none';
}

function setIAMarcador(campo) {
  iaMarcador = campo;
  document.getElementById('btnIAMarkLogo').classList.toggle('active', campo === 'logo');
  document.getElementById('btnIAMarkLoc').classList.toggle('active', campo === 'localizacao');
}

function limparIAMarcacao() {
  iaMarcacoes = {};
  redrawIAMarcacoes();
}

function iaMarkPos(e) {
  const canvas = document.getElementById('editIACanvas');
  const rect   = canvas.getBoundingClientRect();
  const touch  = e.touches?.[0] || e;
  return {
    x: (touch.clientX - rect.left) * (canvas.width  / rect.width),
    y: (touch.clientY - rect.top)  * (canvas.height / rect.height),
  };
}

function iaMarkStart(e) {
  e.preventDefault();
  iaDrawing = true;
  iaStart   = iaMarkPos(e);
}

function iaMarkMove(e) {
  e.preventDefault();
  if (!iaDrawing) return;
  const cur    = iaMarkPos(e);
  const canvas = document.getElementById('editIACanvas');
  const ctx    = canvas.getContext('2d');
  redrawIAMarcacoes();
  const color = IA_COLORS[iaMarcador];
  const x = Math.min(iaStart.x, cur.x), y = Math.min(iaStart.y, cur.y);
  const w = Math.abs(cur.x - iaStart.x), h = Math.abs(cur.y - iaStart.y);
  ctx.fillStyle = hexToRgba(color, 0.25);
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = color; ctx.lineWidth = 2;
  ctx.setLineDash([6, 3]); ctx.strokeRect(x, y, w, h); ctx.setLineDash([]);
}

function iaMarkEnd(e) {
  e.preventDefault();
  if (!iaDrawing || !iaStart) return;
  iaDrawing = false;
  const cur = iaMarkPos(e.changedTouches?.[0] || e);
  const x = Math.min(iaStart.x, cur.x), y = Math.min(iaStart.y, cur.y);
  const w = Math.abs(cur.x - iaStart.x), h = Math.abs(cur.y - iaStart.y);
  if (w > 10 && h > 10) {
    iaMarcacoes[iaMarcador] = { x, y, w, h };
    if (iaMarcador === 'logo' && !iaMarcacoes.localizacao) setIAMarcador('localizacao');
  }
  iaStart = null;
  redrawIAMarcacoes();
}

function redrawIAMarcacoes() {
  const canvas = document.getElementById('editIACanvas');
  const ctx    = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const [campo, z] of Object.entries(iaMarcacoes)) {
    const color = IA_COLORS[campo];
    const label = IA_LABELS[campo];
    ctx.fillStyle = hexToRgba(color, 0.35);
    ctx.fillRect(z.x, z.y, z.w, z.h);
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.setLineDash([]); ctx.strokeRect(z.x, z.y, z.w, z.h);
    const fs = Math.max(11, Math.min(22, Math.round(z.h * 0.35)));
    ctx.font = `700 ${fs}px Arial, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 3;
    ctx.strokeText(label, z.x + z.w / 2, z.y + z.h / 2);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, z.x + z.w / 2, z.y + z.h / 2);
  }
}

async function confirmarEditIA() {
  if (!Object.keys(iaMarcacoes).length) {
    toast('Marque pelo menos uma área antes de salvar.', 'error');
    return;
  }

  const img    = document.getElementById('editIAImage');
  const canvas = document.getElementById('editIACanvas');
  const final  = document.createElement('canvas');
  final.width  = img.naturalWidth;
  final.height = img.naturalHeight;
  const ctx    = final.getContext('2d');

  // Desenha imagem original
  ctx.drawImage(img, 0, 0, final.width, final.height);

  // Desenha placeholders em resolução natural (retângulo branco + texto)
  const scaleX = final.width / canvas.width;
  const scaleY = final.height / canvas.height;
  for (const [campo, z] of Object.entries(iaMarcacoes)) {
    const label = IA_LABELS[campo];
    const rx = z.x * scaleX, ry = z.y * scaleY;
    const rw = z.w * scaleX, rh = z.h * scaleY;

    // Fundo branco/cinza limpo para cobrir o conteúdo original
    ctx.fillStyle = '#e8e8e8';
    ctx.fillRect(rx, ry, rw, rh);
    // Borda sutil
    ctx.strokeStyle = '#aaaaaa';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 3]);
    ctx.strokeRect(rx, ry, rw, rh);
    ctx.setLineDash([]);
    // Texto do placeholder
    const fs = Math.max(14, Math.min(40, Math.round(rh * 0.32)));
    ctx.font = `700 ${fs}px Arial, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#555555';
    ctx.fillText(label, rx + rw / 2, ry + rh / 2);
  }

  const status = document.getElementById('editIAStatus');
  status.textContent = '⏳ Salvando…';
  document.querySelector('#editIAModal .btn-ia').disabled = true;

  try {
    const blob = await new Promise(resolve => final.toBlob(resolve, 'image/png'));
    const fd   = new FormData();
    fd.append('imagem', blob, 'template.png');

    const res  = await fetch(`/api/admin/templates/${iaId}/editar-ia`, {
      method: 'POST',
      headers: { 'x-admin-password': adminPassword },
      body: fd,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    fecharEditIA();
    toast('Template salvo com placeholders!', 'success');
    await carregarTemplates();
  } catch (err) {
    toast('Erro: ' + err.message, 'error');
    status.textContent = '';
  } finally {
    document.querySelector('#editIAModal .btn-ia').disabled = false;
  }
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── Upload & editor de marcação ───────────────────────────────────────────────
const MARK_COLORS = { logo: '#8b5cf6', localizacao: '#3b82f6' };
const MARK_LABELS = { logo: '{ LOGO AQUI }', localizacao: '{ LOCALIZAÇÃO }' };
let marcador   = 'logo';   // campo ativo
let marcacoes  = {};       // { logo: {x,y,w,h}, localizacao: {x,y,w,h} }
let markDrawing = false;
let markStart_  = null;

function handleFile(file) {
  if (!file) return;
  selectedFile = file;
  if (!document.getElementById('nomeInput').value)
    document.getElementById('nomeInput').value = file.name.replace(/\.[^.]+$/, '');

  const reader = new FileReader();
  reader.onload = e => {
    // Vai para o passo 2 com o editor de marcação
    document.getElementById('uploadStep1').style.display = 'none';
    document.getElementById('uploadStep2').style.display = 'block';

    const img = document.getElementById('uploadPreviewImg');
    img.onload = () => {
      const canvas = document.getElementById('uploadMarkCanvas');
      canvas.width  = img.offsetWidth;
      canvas.height = img.offsetHeight;
      canvas.style.width  = img.offsetWidth  + 'px';
      canvas.style.height = img.offsetHeight + 'px';
      redrawMarcacoes();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function handleDrop(e) {
  e.preventDefault();
  document.getElementById('dropZone').classList.remove('over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) handleFile(file);
}

function voltarStep1() {
  selectedFile = null;
  marcacoes    = {};
  document.getElementById('uploadStep2').style.display = 'none';
  document.getElementById('uploadStep1').style.display = 'block';
  document.getElementById('fileInput').value = '';
}

function setMarcador(campo) {
  marcador = campo;
  document.getElementById('btnMarkLogo').classList.toggle('active', campo === 'logo');
  document.getElementById('btnMarkLoc').classList.toggle('active', campo === 'localizacao');
}

function limparMarcacao() {
  marcacoes = {};
  redrawMarcacoes();
}

function markPos(e) {
  const canvas = document.getElementById('uploadMarkCanvas');
  const rect   = canvas.getBoundingClientRect();
  const touch  = e.touches?.[0] || e;
  return {
    x: (touch.clientX - rect.left) * (canvas.width  / rect.width),
    y: (touch.clientY - rect.top)  * (canvas.height / rect.height),
  };
}

function markStart(e) {
  e.preventDefault();
  markDrawing = true;
  markStart_  = markPos(e);
}

function markMove(e) {
  e.preventDefault();
  if (!markDrawing) return;
  const cur = markPos(e);
  redrawMarcacoes();
  // Desenha retângulo em progresso
  const canvas = document.getElementById('uploadMarkCanvas');
  const ctx    = canvas.getContext('2d');
  const color  = MARK_COLORS[marcador];
  const x = Math.min(markStart_.x, cur.x);
  const y = Math.min(markStart_.y, cur.y);
  const w = Math.abs(cur.x - markStart_.x);
  const h = Math.abs(cur.y - markStart_.y);
  ctx.fillStyle   = hexToRgba(color, 0.25);
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = color;
  ctx.lineWidth   = 2;
  ctx.setLineDash([6, 3]);
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);
}

function markEnd(e) {
  e.preventDefault();
  if (!markDrawing || !markStart_) return;
  markDrawing = false;
  const cur = markPos(e.changedTouches?.[0] || e);
  const x = Math.min(markStart_.x, cur.x);
  const y = Math.min(markStart_.y, cur.y);
  const w = Math.abs(cur.x - markStart_.x);
  const h = Math.abs(cur.y - markStart_.y);
  if (w > 10 && h > 10) {
    marcacoes[marcador] = { x, y, w, h };
    // Avança automaticamente para o próximo campo se só marcou um
    if (marcador === 'logo' && !marcacoes.localizacao) setMarcador('localizacao');
  }
  markStart_ = null;
  redrawMarcacoes();
}

function redrawMarcacoes() {
  const canvas = document.getElementById('uploadMarkCanvas');
  const ctx    = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const [campo, z] of Object.entries(marcacoes)) {
    const color = MARK_COLORS[campo];
    const label = MARK_LABELS[campo];
    // Fundo
    ctx.fillStyle = hexToRgba(color, 0.35);
    ctx.fillRect(z.x, z.y, z.w, z.h);
    // Borda
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2;
    ctx.setLineDash([]);
    ctx.strokeRect(z.x, z.y, z.w, z.h);
    // Label
    const fs = Math.max(11, Math.min(22, Math.round(z.h * 0.35)));
    ctx.font         = `700 ${fs}px Arial, sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle  = 'rgba(0,0,0,0.8)';
    ctx.lineWidth    = 3;
    ctx.strokeText(label, z.x + z.w / 2, z.y + z.h / 2);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, z.x + z.w / 2, z.y + z.h / 2);
  }
}

async function uploadTemplate() {
  if (!selectedFile) return;

  const nome = document.getElementById('nomeInput').value.trim();
  document.getElementById('btnUpload').disabled = true;
  document.getElementById('analyzingHint').style.display = 'block';

  // Gera imagem anotada com as marcações desenhadas
  const img    = document.getElementById('uploadPreviewImg');
  const canvas = document.getElementById('uploadMarkCanvas');
  const final  = document.createElement('canvas');
  final.width  = img.naturalWidth;
  final.height = img.naturalHeight;
  const ctx    = final.getContext('2d');
  ctx.drawImage(img, 0, 0, final.width, final.height);

  // Re-escala e desenha placeholders em resolução natural
  const scaleX = final.width  / canvas.width;
  const scaleY = final.height / canvas.height;
  for (const [campo, z] of Object.entries(marcacoes)) {
    const label = MARK_LABELS[campo];
    const rx = z.x * scaleX, ry = z.y * scaleY;
    const rw = z.w * scaleX, rh = z.h * scaleY;
    ctx.fillStyle = '#e8e8e8';
    ctx.fillRect(rx, ry, rw, rh);
    ctx.strokeStyle = '#aaaaaa'; ctx.lineWidth = 2;
    ctx.setLineDash([6, 3]); ctx.strokeRect(rx, ry, rw, rh); ctx.setLineDash([]);
    const fs = Math.max(14, Math.min(40, Math.round(rh * 0.32)));
    ctx.font = `700 ${fs}px Arial, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#555555';
    ctx.fillText(label, rx + rw / 2, ry + rh / 2);
  }

  try {
    const blob = await new Promise(resolve => final.toBlob(resolve, 'image/png'));
    const fd = new FormData();
    fd.append('imagem', blob, 'template.png');
    fd.append('nome',   nome);

    const res  = await fetch('/api/admin/templates', {
      method: 'POST',
      headers: { 'x-admin-password': adminPassword },
      body: fd,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    toast(`"${data.nome}" salvo com placeholders aplicados!`, 'success');
    selectedFile = null;
    marcacoes    = {};
    document.getElementById('fileInput').value  = '';
    document.getElementById('nomeInput').value  = '';
    document.getElementById('uploadStep2').style.display = 'none';
    document.getElementById('uploadStep1').style.display = 'block';
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
