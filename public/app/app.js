// ── Estado global ────────────────────────────────────────────────
let templates = [];
let imoveis = [];
let fieldLabels = {};
let angleLabels = {};
let photoSlots = [];
let galeria = [];
let selectedTemplateId = null;
let selectedImovelId = null;
let authToken = localStorage.getItem('authToken') || null;
let currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');

// ── Auth helpers ─────────────────────────────────────────────────
async function authFetch(url, opts = {}) {
 const headers = { ...(opts.headers || {}), 'Authorization': `Bearer ${authToken}` };
 const res = await fetch(url, { ...opts, headers });
 if (res.status === 401) {
  sair();
  throw new Error('Sessão expirada. Entre novamente.');
 }
 return res;
}

// ── Init ─────────────────────────────────────────────────────────
async function init() {
 if (!authToken) { mostrarLogin(); return; }
 document.getElementById('loginWrap').style.display = 'none';
 document.getElementById('appWrap').style.display = 'block';
 if (currentUser?.nome || currentUser?.email) {
  document.getElementById('userLabel').textContent = currentUser.nome || currentUser.email;
 }
 setupNav();
 await Promise.all([loadTemplates(), loadImoveis(), loadPerfil(), loadLabels()]);
 renderGerar();
 renderImoveisGrid();
 loadGaleria();
 loadBilling();
 tratarRetornoPagamento();

 if (localStorage.getItem('mostrarBoasVindas') === '1') {
  localStorage.removeItem('mostrarBoasVindas');
  document.getElementById('boasVindasModal').style.display = 'flex';
 }
}

function fecharBoasVindas(ev) {
 if (ev && ev.target !== ev.currentTarget) return;
 const modal = document.getElementById('boasVindasModal');
 modal.style.display = 'none';
 // Para o vídeo ao fechar (reseta o src do iframe)
 const iframe = modal.querySelector('iframe');
 if (iframe) iframe.src = iframe.src;
}

function mostrarLogin(tab = 'login') {
 document.getElementById('loginWrap').style.display = 'flex';
 document.getElementById('appWrap').style.display = 'none';
 mudarTabAuth(tab);
}

function mudarTabAuth(tab) {
 document.getElementById('formLogin').style.display    = tab === 'login'    ? 'block' : 'none';
 document.getElementById('formCadastro').style.display = tab === 'cadastro' ? 'block' : 'none';
 document.getElementById('tabLogin').classList.toggle('active', tab === 'login');
 document.getElementById('tabCadastro').classList.toggle('active', tab === 'cadastro');
 document.getElementById('authError').textContent = '';
}

async function fazerLogin() {
 const email    = document.getElementById('loginEmail').value.trim();
 const password = document.getElementById('loginSenha').value;
 const errEl    = document.getElementById('authError');
 errEl.textContent = '';
 if (!email || !password) { errEl.textContent = 'Preencha email e senha.'; return; }
 const res  = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
 const data = await res.json();
 if (!res.ok) { errEl.textContent = data.error; return; }
 authToken   = data.token;
 currentUser = data.user;
 localStorage.setItem('authToken', authToken);
 localStorage.setItem('currentUser', JSON.stringify(currentUser));
 init();
}

async function fazerCadastro() {
 const nome     = document.getElementById('cadNome').value.trim();
 const email    = document.getElementById('cadEmail').value.trim();
 const password = document.getElementById('cadSenha').value;
 const errEl    = document.getElementById('authError');
 errEl.textContent = '';
 if (!email || !password) { errEl.textContent = 'Preencha email e senha.'; return; }
 const res  = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, nome }) });
 const data = await res.json();
 if (!res.ok) { errEl.textContent = data.error; return; }
 authToken   = data.token;
 currentUser = data.user;
 localStorage.setItem('authToken', authToken);
 localStorage.setItem('currentUser', JSON.stringify(currentUser));
 localStorage.setItem('mostrarBoasVindas', '1');
 init();
}

function sair() {
 authToken   = null;
 currentUser = null;
 localStorage.removeItem('authToken');
 localStorage.removeItem('currentUser');
 mostrarLogin();
}

async function loadLabels() {
 const [fl, al, ps] = await Promise.all([
 fetch('/api/field-labels').then(r => r.json()),
 fetch('/api/angle-labels').then(r => r.json()),
 fetch('/api/photo-slots').then(r => r.json()),
 ]);
 fieldLabels = fl;
 angleLabels = al;
 photoSlots = ps;
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
 const res = await fetch('/api/templates'); // público
 templates = await res.json();
}

const PREVIEW_COUNT = 5;
let templatesTrocando = false; // true = usuário clicou em "Mudar template", mostra o grid

function mudarTemplateGrid() {
 templatesTrocando = true;
 renderTemplatesGrid();
}

function renderTemplatesGrid() {
 const grid = document.getElementById('templatesGrid');
 if (!templates.length) {
 grid.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem">Nenhum template cadastrado. <a href="/admin/" style="color:var(--primary)">Acesse o admin →</a></p>';
 return;
 }

 const escolhido = templates.find(t => t.id === selectedTemplateId);

 // Template escolhido: mostra só ele, com aviso e botão de troca
 if (escolhido && !templatesTrocando) {
  grid.innerHTML = `
  <div class="template-escolhido">
   <div class="template-card selected" style="cursor:default" ondblclick="abrirGaleria()">
    <img src="${escolhido.imageUrl}" alt="${escolhido.nome}" loading="lazy" />
    <div class="template-card-name">${escolhido.nome}</div>
    <span class="check-badge"></span>
   </div>
   <div class="template-escolhido-info">
    <div class="template-escolhido-badge">✓ Template escolhido</div>
    <p>Agora selecione o imóvel abaixo e avance para a prévia.</p>
    <button class="btn-ghost" onclick="mudarTemplateGrid()">Mudar template</button>
   </div>
  </div>`;
  return;
 }

 const preview = templates.slice(0, PREVIEW_COUNT);
 let html = preview.map(t => templateCardHtml(t)).join('');
 html += `
 <div class="template-card more-card" onclick="abrirGaleria()">
 <span class="more-card-icon"></span>
 <span>Ver mais</span>
 </div>`;
 grid.innerHTML = html;
}

function templateCardHtml(t) {
 return `
 <div class="template-card ${selectedTemplateId === t.id ? 'selected' : ''}" onclick="selecionarTemplate(${t.id})" ondblclick="abrirGaleria()">
 <img src="${t.imageUrl}" alt="${t.nome}" loading="lazy" />
 <div class="template-card-name">${t.nome}</div>
 <span class="check-badge"></span>
 </div>`;
}

function selecionarTemplate(id) {
 selectedTemplateId = id;
 galeriaEscolhendo = false;
 templatesTrocando = false;
 renderTemplatesGrid();
 if (document.getElementById('templateGallery').style.display !== 'none') renderGaleria();
 atualizarResumo();
}

// ── Galeria de templates ("ver mais") ───────────────────────────────
let galeriaEscolhendo = false; // true = mostrando o carrossel para trocar

function abrirGaleria() {
 galeriaEscolhendo = !selectedTemplateId;
 renderGaleria();
 document.getElementById('templateGallery').style.display = 'flex';
}

function fecharGaleria() {
 document.getElementById('templateGallery').style.display = 'none';
}

function mudarTemplate() {
 galeriaEscolhendo = true;
 renderGaleria();
}

function renderGaleria() {
 const track = document.getElementById('galleryTrack');
 const navs = document.querySelectorAll('#templateGallery .gallery-nav');
 if (!templates.length) {
  track.innerHTML = '<p style="color:var(--text-muted)">Nenhum template cadastrado.</p>';
  return;
 }

 const escolhido = templates.find(t => t.id === selectedTemplateId);
 const footer = document.querySelector('#templateGallery .gallery-footer');

 // Modo "template escolhido": só o design selecionado, com ações
 if (escolhido && !galeriaEscolhendo) {
  navs.forEach(n => n.style.display = 'none');
  if (footer) footer.style.display = 'none';
  track.innerHTML = `
  <div class="gallery-chosen">
   <div class="gallery-chosen-badge">✓ Template escolhido</div>
   <div class="gallery-card selected" style="cursor:default">
    <img src="${escolhido.imageUrl}" alt="${escolhido.nome}" loading="lazy" />
    <div class="gallery-card-name">${escolhido.nome}</div>
   </div>
   <div class="gallery-chosen-actions">
    <button class="btn-ghost" onclick="mudarTemplate()">Mudar template</button>
    <button class="btn-primary" onclick="fecharGaleria()">Continuar</button>
   </div>
  </div>`;
  return;
 }

 // Modo carrossel: todos os templates
 navs.forEach(n => n.style.display = '');
 if (footer) footer.style.display = '';
 track.innerHTML = templates.map(t => `
 <div class="gallery-card ${selectedTemplateId === t.id ? 'selected' : ''}" onclick="selecionarTemplate(${t.id})">
 <img src="${t.imageUrl}" alt="${t.nome}" loading="lazy" />
 <div class="gallery-card-name">${t.nome}</div>
 <span class="check-badge"></span>
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
 const res = await authFetch('/api/imoveis');
 imoveis = await res.json();
}

function renderImoveisGrid() {
 const grid = document.getElementById('imoveisGrid');
 const empty = document.getElementById('imoveisEmpty');
 if (!imoveis.length) {
 grid.innerHTML = '';
 empty.style.display = 'block';
 return;
 }
 empty.style.display = 'none';
 grid.innerHTML = imoveis.map(im => {
 const foto = Object.values(im.fotos || {})[0];
 const local = [im.bairro, im.cidade, im.estado].filter(Boolean).join(', ');
 const tags = [];
 if (im.area) tags.push(`${im.area} m²`);
 if (im.quartos) tags.push(`${im.quartos} qtos`);
 if (im.vagas) tags.push(`${im.vagas} vaga${im.vagas > 1 ? 's' : ''}`);
 return `
 <div class="imovel-card">
 <div class="imovel-card-thumb">
 ${foto ? `<img src="${foto}" alt="${im.titulo}" />` : ''}
 </div>
 <div class="imovel-card-body">
 <span class="status-badge status-${im.status}">${im.status}</span>
 <h3>${im.titulo}</h3>
 ${im.preco ? `<div class="preco">R$ ${im.preco}</div>` : ''}
 ${local ? `<div class="local"> ${local}</div>` : ''}
 <div class="imovel-card-tags">
 ${tags.map(t => `<span class="tag">${t}</span>`).join('')}
 </div>
 <div class="imovel-card-actions">
 <button class="btn-ghost btn-sm" onclick="editarImovel('${im.id}')"> Editar</button>
 <button class="btn-danger btn-sm" onclick="deletarImovel('${im.id}')"> Excluir</button>
 </div>
 </div>
 </div>`;
 }).join('');
}

const IMOVEL_PREVIEW_COUNT = 6;
let imovelBusca = '';
let imovelPickerExpandido = false;

function filtrarImoveis(valor) {
 imovelBusca = (valor || '').trim().toLowerCase();
 renderImovelPicker();
}

function expandirImoveis() {
 imovelPickerExpandido = true;
 renderImovelPicker();
}

function renderImovelPicker() {
 const picker = document.getElementById('imovelPicker');
 const empty = document.getElementById('imovelPickerEmpty');
 const buscaWrap = document.getElementById('imovelBuscaWrap');
 if (!imoveis.length) {
  picker.innerHTML = '';
  empty.style.display = 'block';
  if (buscaWrap) buscaWrap.style.display = 'none';
  return;
 }
 empty.style.display = 'none';
 if (buscaWrap) buscaWrap.style.display = imoveis.length > IMOVEL_PREVIEW_COUNT ? 'flex' : 'none';

 let lista = imoveis;
 if (imovelBusca) {
  lista = imoveis.filter(im =>
   [im.titulo, im.cidade, im.bairro, im.tipo, im.endereco]
    .filter(Boolean).join(' ').toLowerCase().includes(imovelBusca)
  );
 }

 if (!lista.length) {
  picker.innerHTML = `<p style="color:var(--text-muted);font-size:0.85rem;grid-column:1/-1">Nenhum imóvel encontrado para "${imovelBusca}".</p>`;
  return;
 }

 // Sem busca e sem expandir: mostra só os primeiros + card "Ver mais"
 const mostrarTudo = imovelBusca || imovelPickerExpandido || lista.length <= IMOVEL_PREVIEW_COUNT;
 const visiveis = mostrarTudo ? lista : lista.slice(0, IMOVEL_PREVIEW_COUNT);
 // Imóvel selecionado sempre visível, mesmo fora do preview
 if (selectedImovelId && !visiveis.some(i => i.id === selectedImovelId)) {
  const sel = lista.find(i => i.id === selectedImovelId);
  if (sel) visiveis[visiveis.length - 1] = sel;
 }
 const ocultos = lista.length - visiveis.length;

 let html = visiveis.map(im => {
  const foto = Object.values(im.fotos || {})[0];
  const local = [im.cidade, im.estado].filter(Boolean).join(' - ');
  return `
  <div class="picker-card ${selectedImovelId === im.id ? 'selected' : ''}" onclick="selecionarImovel('${im.id}')">
   <div class="picker-thumb">
    ${foto ? `<img src="${foto}" alt="" />` : ''}
   </div>
   <div class="picker-info">
    <h4>${im.titulo}</h4>
    <p>${[im.tipo, local].filter(Boolean).join(' • ') || '—'}</p>
   </div>
   <span class="picker-check"></span>
  </div>`;
 }).join('');

 if (ocultos > 0) {
  html += `
  <div class="picker-card picker-more" onclick="expandirImoveis()">
   <span class="picker-more-num">+${ocultos}</span>
   <span>Ver mais</span>
  </div>`;
 }

 picker.innerHTML = html;
}

function selecionarImovel(id) {
 selectedImovelId = id;
 renderImovelPicker();
 atualizarResumo();
}

function atualizarResumo() {
 const hint = document.getElementById('previaHint');
 const btnP = document.getElementById('btnPrevia');
 const t = templates.find(t => t.id === selectedTemplateId);
 const im = imoveis.find(i => i.id === selectedImovelId);

 if (!t || !im) {
  if (hint) hint.style.display = 'none';
  if (btnP) btnP.disabled = true;
  return;
 }

 // Verifica ângulos faltando
 const angulos = t.angulos || [];
 const fotos = im.fotos || {};
 const faltando = angulos.filter(a => !fotos[a]);

 if (hint) {
  hint.style.display = 'block';
  if (faltando.length > 0) {
   const labels = faltando.map(a => angleLabels[a] || a).join(', ');
   hint.innerHTML = `Este template exige fotos que o imóvel ainda não tem: <strong>${labels}</strong>. <a href="#" onclick="editarImovel('${im.id}');return false" style="color:#fff">Adicionar fotos →</a>`;
  } else {
   hint.textContent = 'Iremos gerar os textos que irão aparecer na arte, confira-os antes de enviar para criação.';
  }
 }
 if (btnP) btnP.disabled = faltando.length > 0;
}

function renderGerar() {
 renderTemplatesGrid();
 renderImovelPicker();
 atualizarResumo();
}

// ── Previa de texto ───────────────────────────────────────────────
async function gerarPrevia() {
 if (!selectedTemplateId || !selectedImovelId) return;
 const btn = document.getElementById('btnPrevia');
 btn.disabled = true;
 btn.textContent = 'Gerando...';
 document.getElementById('previaWrap').style.display = 'none';
 try {
  const res  = await authFetch('/api/previa', {
   method: 'POST',
   headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify({ templateId: selectedTemplateId, imovelId: selectedImovelId }),
  });
  const data = await res.json();
  if (res.status === 402) {
   toast(data.error, 'error');
   navegarPara('plano');
   loadBilling();
   return;
  }
  if (!res.ok || data.error) throw new Error(data.error);
  renderPreviaForm(data.campos, data.textos);
  document.getElementById('previaWrap').style.display = 'block';
  document.getElementById('previaWrap').scrollIntoView({ behavior: 'smooth' });
 } catch (err) {
  toast('Erro na previa: ' + err.message, 'error');
 } finally {
  btn.disabled = false;
  btn.textContent = 'Ver previa de texto';
 }
}

function renderPreviaForm(campos, textos) {
 document.getElementById('previaForm').innerHTML = campos.map(({ key, label }) => `
  <div class="field">
   <label>${label}</label>
   <input type="text" data-previa-key="${key}" value="${(textos[key] || '').replace(/"/g, '&quot;')}" />
  </div>`).join('');
}

function fecharPrevia() {
 document.getElementById('previaWrap').style.display = 'none';
}

async function gerarArteComPrevia() {
 const textos = {};
 document.querySelectorAll('#previaForm input[data-previa-key]').forEach(inp => {
  if (inp.value.trim()) textos[inp.dataset.previaKey] = inp.value.trim();
 });
 await gerarArte(textos);
}

// ── Gerar Arte (assíncrono) ───────────────────────────────────────
let pollTimer = null;

function gerarArte(textosPrevia = null, formato = '1x1') {
 if (!selectedTemplateId || !selectedImovelId) return;
 document.getElementById('previaWrap').style.display = 'none';
 iniciarGeracao({ templateId: selectedTemplateId, imovelId: selectedImovelId, textosPrevia, formato });
}

function iniciarGeracao(body) {
 // Dispara a geração sem bloquear — o servidor salva na galeria sozinho
 authFetch('/api/gerar', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
 })
  .then(async r => ({ status: r.status, d: await r.json() }))
  .then(({ status, d }) => {
   if (status === 402) { toast(d.error, 'error'); navegarPara('plano'); loadBilling(); return; }
   if (d.error) toast('Erro na geração: ' + d.error, 'error');
   loadGaleria();
   loadBilling();
  })
  .catch(err => { toast('Erro: ' + err.message, 'error'); loadGaleria(); });

 toast('Geração iniciada!', 'success');
 navegarPara('galeria');
 setTimeout(loadGaleria, 800);
 iniciarPolling();
}

function iniciarPolling() {
 const banner = document.getElementById('gerandoBanner');
 banner.style.display = 'flex';
 if (pollTimer) return;
 pollTimer = setInterval(async () => {
  await loadGaleria();
  if (!galeria.some(g => g.status === 'gerando')) {
   clearInterval(pollTimer);
   pollTimer = null;
   banner.style.display = 'none';
  }
 }, 10000);
}

function gerarVariacaoReels(id) {
 const item = galeria.find(g => g.id === id);
 if (!item) return;
 if (!item.templateId || !item.imovelId) {
  toast('Esta arte é antiga e não tem os dados para gerar variação.', 'error');
  return;
 }
 iniciarGeracao({
  templateId: item.templateId,
  imovelId: item.imovelId,
  textosPrevia: item.textos || null,
  formato: 'reels',
 });
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
 <button type="button" class="foto-slot-remove" onclick="removerFotoSlot('${imovelId}', '${slot.key}')"></button>`
 : `<span class="foto-slot-empty"></span>`}
 </div>
 <label class="foto-slot-btn">
 ${url ? ' Trocar' : '+ Adicionar'}
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
 let id = (!imovelId || imovelId === 'null') ? null : imovelId;
 if (!id) {
 const form = document.getElementById('imovelForm');
 const titulo = form.elements['titulo']?.value?.trim();
 if (!titulo) { toast('Salve o imóvel primeiro (preencha ao menos o título)', 'error'); return; }
 const campos = ['titulo','tipo','status','preco','entrada','parcela','financiamento',
 'area','quartos','suites','banheiros','vagas','andar',
 'endereco','bairro','cidade','estado','destaque','diferenciais','descricao'];
 const body = {};
 campos.forEach(c => { body[c] = form.elements[c]?.value || ''; });
 const res = await authFetch('/api/imoveis', {
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
 const res = await authFetch(`/api/imoveis/${id}/foto/${slot}`, { method: 'POST', body: fd });
 if (!res.ok) { toast('Erro ao enviar foto', 'error'); return; }
 const updated = await res.json();

 await loadImoveis();
 renderFotoSlots(updated.fotos || {}, id);
 toast('Foto salva!', 'success');
}

async function removerFotoSlot(imovelId, slot) {
 if (!imovelId) return;
 await authFetch(`/api/imoveis/${imovelId}/foto/${slot}`, { method: 'DELETE' });
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
 const id = document.getElementById('imovelEditId').value;

 const campos = ['titulo','tipo','status','preco','entrada','parcela','financiamento',
 'area','quartos','suites','banheiros','vagas','andar',
 'endereco','bairro','cidade','estado','destaque','diferenciais','descricao'];
 const body = {};
 campos.forEach(c => { body[c] = form.elements[c]?.value || ''; });

 const url = id ? `/api/imoveis/${id}` : '/api/imoveis';
 const method = id ? 'PUT' : 'POST';
 const res = await authFetch(url, {
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
 await authFetch(`/api/imoveis/${id}`, { method: 'DELETE' });
 await loadImoveis();
 renderImoveisGrid();
 if (selectedImovelId === id) { selectedImovelId = null; atualizarResumo(); }
 toast('Imóvel excluído', 'success');
}

// ── Perfil ────────────────────────────────────────────────────────
async function loadPerfil() {
 const res = await authFetch('/api/perfil');
 const perfil = await res.json();
 const form = document.getElementById('perfilForm');
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
 const fd = new FormData(e.target);
 const res = await authFetch('/api/perfil', { method: 'PUT', body: fd });
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

// ── Galeria ───────────────────────────────────────────────────────
let pastaAberta = null;

async function loadGaleria() {
 try {
  const res = await authFetch('/api/galeria');
  galeria = await res.json();
  renderGaleriaGrid();
  if (galeria.some(g => g.status === 'gerando') && !pollTimer) iniciarPolling();
 } catch { /* silencioso */ }
}

function agruparPastas() {
 // Artes antigas não têm imovelId — mapeia título → id para caírem na mesma pasta
 const idPorTitulo = {};
 galeria.forEach(i => {
  if (i.imovelId && i.imovelTitulo) idPorTitulo[i.imovelTitulo] = String(i.imovelId);
 });
 const pastas = {};
 galeria.forEach(item => {
  const key = String(item.imovelId || idPorTitulo[item.imovelTitulo] || item.imovelTitulo || 'outros');
  if (!pastas[key]) pastas[key] = { titulo: item.imovelTitulo || 'Sem imóvel', itens: [] };
  pastas[key].itens.push(item);
 });
 return pastas;
}

function abrirPasta(key) { pastaAberta = key; renderGaleriaGrid(); }
function fecharPasta()   { pastaAberta = null; renderGaleriaGrid(); }

function renderGaleriaGrid() {
 const grid = document.getElementById('galeriaGrid');
 const empty = document.getElementById('galeriaEmpty');
 if (!galeria.length) {
  empty.style.display = 'block';
  grid.innerHTML = '';
  return;
 }
 empty.style.display = 'none';

 const pastas = agruparPastas();
 if (pastaAberta && !pastas[pastaAberta]) pastaAberta = null;

 // Vista de pastas
 if (!pastaAberta) {
  grid.innerHTML = Object.entries(pastas).map(([key, p]) => {
   const capa = p.itens.find(i => i.imageUrl);
   const gerando = p.itens.some(i => i.status === 'gerando');
   return `
   <div class="pasta-card" onclick="abrirPasta('${key}')">
    <div class="pasta-card-img-wrap">
     ${capa ? `<img src="${capa.imageUrl}" alt="" loading="lazy" />` : `<div class="pasta-card-vazia"><svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></div>`}
     ${gerando ? `<div class="pasta-gerando-badge"><span class="spinner" style="width:12px;height:12px;border-width:2px"></span> gerando</div>` : ''}
    </div>
    <div class="galeria-card-info">
     <div class="galeria-card-title">${p.titulo}</div>
     <div class="galeria-card-sub">${p.itens.length} arte${p.itens.length > 1 ? 's' : ''}</div>
    </div>
   </div>`;
  }).join('');
  return;
 }

 // Vista de artes dentro da pasta
 const p = pastas[pastaAberta];
 grid.innerHTML = `
  <div style="grid-column:1/-1;display:flex;align-items:center;gap:12px">
   <button class="btn-ghost btn-sm" onclick="fecharPasta()">← Pastas</button>
   <strong style="font-size:0.95rem">${p.titulo}</strong>
  </div>` +
  p.itens.map(item => {
   if (item.status === 'gerando') {
    return `
    <div class="galeria-card">
     <div class="galeria-card-gerando">
      <span class="spinner" style="width:22px;height:22px;border-width:2px"></span>
      <span>Gerando${item.formato === 'reels' ? ' (Reels)' : ''}…</span>
     </div>
     <div class="galeria-card-info">
      <div class="galeria-card-title">${item.imovelTitulo || '—'}</div>
      <div class="galeria-card-sub">${item.templateNome || ''}</div>
     </div>
    </div>`;
   }
   if (item.status === 'erro') {
    return `
    <div class="galeria-card">
     <div class="galeria-card-gerando" style="color:var(--danger)">Falha na geração</div>
     <div class="galeria-card-info">
      <div class="galeria-card-title">${item.imovelTitulo || '—'}</div>
      <div class="galeria-card-sub">${item.templateNome || ''}</div>
     </div>
     <div class="galeria-card-actions">
      <button class="btn-danger btn-sm" onclick="deletarDaGaleria(${item.id})">Excluir</button>
     </div>
    </div>`;
   }
   return `
   <div class="galeria-card" id="gcrd-${item.id}">
    <div class="galeria-card-img-wrap">
     <img src="${item.imageUrl}" alt="${item.imovelTitulo || 'Arte'}" loading="lazy" />
    </div>
    <div class="galeria-card-info">
     <div class="galeria-card-title">${item.imovelTitulo || '—'}</div>
     <div class="galeria-card-sub">${item.templateNome || ''}${item.formato === 'reels' ? ' • Reels' : ''}</div>
    </div>
    <div class="galeria-card-actions">
     <a href="${item.imageUrl}" download class="btn-ghost btn-sm"><svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Baixar</a>
     <button class="btn-ghost btn-sm" onclick="abrirEdicao(${item.id})" title="Edição mágica"><svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg></button>
     ${item.formato !== 'reels' && item.templateId ? `<button class="btn-ghost btn-sm" onclick="gerarVariacaoReels(${item.id})">Reels</button>` : ''}
     <button class="btn-danger btn-sm" onclick="deletarDaGaleria(${item.id})">Excluir</button>
    </div>
   </div>`;
  }).join('');
}

async function deletarDaGaleria(id) {
 if (!confirm('Remover esta arte da galeria?')) return;
 try {
 await authFetch(`/api/galeria/${id}`, { method: 'DELETE' });
 galeria = galeria.filter(i => i.id !== id);
 renderGaleriaGrid();
 toast('Arte removida', 'success');
 } catch (err) {
 toast('Erro ao remover', 'error');
 }
}

// ── Plano / Billing ───────────────────────────────────────────────
let billing = null;

async function loadBilling() {
 try {
  const res = await authFetch('/api/billing');
  billing = await res.json();
  renderBilling();
 } catch { /* silencioso */ }
}

function renderBilling() {
 if (!billing) return;
 const st = billing.assinatura.status;
 const expira = billing.assinatura.expira ? new Date(billing.assinatura.expira) : null;
 const expirada = expira && expira < new Date();

 const statusEl = document.getElementById('assinaturaStatus');
 const detEl = document.getElementById('assinaturaDetalhe');
 const btnAssinar = document.getElementById('btnAssinar');
 document.getElementById('precoAssinatura').textContent = `R$ ${Number(billing.precos.assinaturaBrl).toFixed(2).replace('.', ',')}`;

 if (st === 'ativa' && !expirada) {
  statusEl.textContent = '● Ativa';
  statusEl.className = 'plano-status ok';
  detEl.textContent = `Renova em ${expira.toLocaleDateString('pt-BR')}`;
  btnAssinar.style.display = 'none';
 } else if (st === 'trial' && !expirada) {
  statusEl.textContent = '● Período de teste';
  statusEl.className = 'plano-status trial';
  detEl.textContent = `Teste grátis até ${expira.toLocaleDateString('pt-BR')} — assine para continuar depois.`;
  btnAssinar.style.display = 'block';
 } else {
  statusEl.textContent = '● Inativa';
  statusEl.className = 'plano-status off';
  detEl.textContent = 'Assine para gerar artes com IA.';
  btnAssinar.style.display = 'block';
 }

 // Saldo
 const saldo = Number(billing.saldo || 0);
 document.getElementById('saldoValor').textContent = `US$ ${saldo.toFixed(2)}`;
 const custoArte = 0.26; // estimativa média por arte (com markup)
 document.getElementById('saldoEstimativa').textContent =
  saldo > 0 ? `≈ ${Math.floor(saldo / custoArte)} artes` : 'Sem créditos — recarregue para gerar.';
 document.getElementById('recargaMinInfo').textContent =
  `Recarga mínima: R$ ${Number(billing.precos.recargaMinBrl).toFixed(2)} — cotação: R$ ${Number(billing.precos.cotacaoBrl).toFixed(2)}/US$`;

 // Auto-recarga
 document.getElementById('autoRecargaToggle').checked = billing.autoRecarga.ativa;
 document.getElementById('autoRecargaValor').value = billing.autoRecarga.valorBrl;
 document.getElementById('autoRecargaAviso').style.display = billing.autoRecarga.falhou ? 'block' : 'none';

 // Extrato
 const ext = document.getElementById('extratoLista');
 if (!billing.extrato.length) {
  ext.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem">Nenhuma movimentação ainda.</p>';
 } else {
  ext.innerHTML = billing.extrato.map(t => {
   const v = Number(t.valor_usd);
   const d = new Date(t.criado_em);
   return `
   <div class="extrato-row">
    <span class="extrato-desc">${t.descricao || t.tipo}</span>
    <span class="extrato-data">${d.toLocaleDateString('pt-BR')}</span>
    <span class="extrato-valor ${v >= 0 ? 'pos' : 'neg'}">${v >= 0 ? '+' : ''}US$ ${v.toFixed(3)}</span>
   </div>`;
  }).join('');
 }
}

async function assinar() {
 try {
  const res = await authFetch('/api/billing/assinar', { method: 'POST' });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  window.location.href = data.url;
 } catch (err) { toast('Erro: ' + err.message, 'error'); }
}

async function recarregar(valorBrl) {
 try {
  const res = await authFetch('/api/billing/recarga', {
   method: 'POST',
   headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify({ valorBrl }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  window.location.href = data.url;
 } catch (err) { toast('Erro: ' + err.message, 'error'); }
}

function recarregarCustom() {
 const v = Number(document.getElementById('recargaValor').value);
 if (!v) { toast('Informe o valor da recarga', 'error'); return; }
 recarregar(v);
}

async function salvarAutoRecarga() {
 const ativa = document.getElementById('autoRecargaToggle').checked;
 const valorBrl = Number(document.getElementById('autoRecargaValor').value) || undefined;
 try {
  const res = await authFetch('/api/billing/auto-recarga', {
   method: 'PUT',
   headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify({ ativa, valorBrl }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  toast('Auto-recarga atualizada', 'success');
  loadBilling();
 } catch (err) { toast('Erro: ' + err.message, 'error'); }
}

function tratarRetornoPagamento() {
 const params = new URLSearchParams(window.location.search);
 const pg = params.get('pagamento');
 if (!pg) return;
 window.history.replaceState({}, '', '/app/');
 if (pg === 'assinatura') toast('Assinatura confirmada! Bem-vindo.', 'success');
 if (pg === 'recarga')    toast('Recarga confirmada! Os créditos entram em instantes.', 'success');
 if (pg === 'cancelado')  toast('Pagamento cancelado.', 'error');
 navegarPara('plano');
 // o crédito entra via webhook — recarrega o saldo algumas vezes
 setTimeout(loadBilling, 2000);
 setTimeout(loadBilling, 6000);
}

// ── Edição mágica ─────────────────────────────────────────────────
let editandoArteId = null;

function abrirEdicao(id) {
 const item = galeria.find(g => g.id === id);
 if (!item?.imageUrl) return;
 editandoArteId = id;
 document.getElementById('editarArteImg').src = item.imageUrl;
 document.getElementById('editarArteMsg').value = '';
 document.getElementById('editarArteModal').style.display = 'flex';
 document.getElementById('editarArteMsg').focus();
}

function fecharEdicao(ev) {
 if (ev && ev.target !== ev.currentTarget) return; // só fecha no backdrop ou botões
 document.getElementById('editarArteModal').style.display = 'none';
 editandoArteId = null;
}

function enviarEdicao() {
 const instrucao = document.getElementById('editarArteMsg').value.trim();
 if (!instrucao) { toast('Descreva a alteração desejada', 'error'); return; }
 if (!editandoArteId) return;

 authFetch(`/api/galeria/${editandoArteId}/editar`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ instrucao }),
 })
  .then(async r => ({ status: r.status, d: await r.json() }))
  .then(({ status, d }) => {
   if (status === 402) { toast(d.error, 'error'); navegarPara('plano'); loadBilling(); return; }
   if (d.error) toast('Erro na edição: ' + d.error, 'error');
   loadGaleria();
   loadBilling();
  })
  .catch(err => { toast('Erro: ' + err.message, 'error'); loadGaleria(); });

 document.getElementById('editarArteModal').style.display = 'none';
 editandoArteId = null;
 toast('Edição iniciada! A nova versão aparecerá na galeria.', 'success');
 setTimeout(loadGaleria, 800);
 iniciarPolling();
}

// ── Toast ─────────────────────────────────────────────────────────
function toast(msg, type = 'success') {
 const el = document.getElementById('toast');
 el.textContent = msg;
 el.className = `toast ${type} show`;
 setTimeout(() => el.classList.remove('show'), 3000);
}

init();
