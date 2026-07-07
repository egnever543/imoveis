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
 renderInicio();
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
 if (page === 'inicio') renderInicio();
 if (page === 'oneclick') renderOneClick();
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
 document.body.style.overflow = 'hidden'; // trava a rolagem da tela de trás
}

function fecharGaleria() {
 document.getElementById('templateGallery').style.display = 'none';
 document.body.style.overflow = '';
}

function mudarTemplate() {
 galeriaEscolhendo = true;
 renderGaleria();
}

let templateBusca = '';
let templateCategoria = null; // null = todas

function filtrarTemplates(valor) {
 templateBusca = (valor || '').trim().toLowerCase();
 renderGaleria();
}

function filtrarCategoria(cat) {
 templateCategoria = cat;
 renderGaleria();
}

function renderGaleria() {
 const track = document.getElementById('galleryTrack');
 const navs = document.querySelectorAll('#templateGallery .gallery-nav');
 const filtros = document.getElementById('galleryFiltros');
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
  if (filtros) filtros.style.display = 'none';
  track.classList.remove('grid-mode');
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

 // Modo navegação: grid vertical com busca e filtro por categoria
 navs.forEach(n => n.style.display = 'none');
 if (footer) footer.style.display = '';
 if (filtros) filtros.style.display = 'flex';
 track.classList.add('grid-mode');

 // Chips de categoria (a partir das categorias cadastradas no admin)
 const chipsEl = document.getElementById('galleryChips');
 const categorias = [...new Set(templates.map(t => t.categoria).filter(Boolean))].sort();
 if (chipsEl) {
  chipsEl.innerHTML = categorias.length ? [
   `<button class="gallery-chip ${templateCategoria === null ? 'active' : ''}" onclick="filtrarCategoria(null)">Todos</button>`,
   ...categorias.map(c =>
    `<button class="gallery-chip ${templateCategoria === c ? 'active' : ''}" onclick="filtrarCategoria('${c.replace(/'/g, "\\'")}')">${c}</button>`),
  ].join('') : '';
 }

 let lista = templates;
 if (templateCategoria) lista = lista.filter(t => t.categoria === templateCategoria);
 if (templateBusca) lista = lista.filter(t =>
  [t.nome, t.categoria].filter(Boolean).join(' ').toLowerCase().includes(templateBusca));

 if (!lista.length) {
  track.innerHTML = `<p style="color:var(--text-muted);grid-column:1/-1;padding:20px">Nenhum template encontrado.</p>`;
  return;
 }

 track.innerHTML = lista.map(t => `
 <div class="gallery-card ${selectedTemplateId === t.id ? 'selected' : ''}" onclick="selecionarTemplate(${t.id})">
 <img src="${t.imageUrl}" alt="${t.nome}" loading="lazy" />
 <div class="gallery-card-name">${t.nome}</div>
 <span class="check-badge"></span>
 </div>
 `).join('');
}

function scrollGaleria(dir) {
 const track = document.getElementById('galleryTrack');
 track.scrollBy({ left: dir * 260, behavior: 'smooth' });
}

// ── Imóveis ───────────────────────────────────────────────────────
async function loadImoveis() {
 const res = await authFetch('/api/imoveis');
 imoveis = await res.json();
 renderInicio();
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
 const finLabel = { venda: 'Venda', aluguel: 'Aluguel', venda_aluguel: 'Venda • Aluguel' }[im.finalidade] || 'Venda';
 tags.push(finLabel);
 if (im.area) tags.push(`${im.area} m²`);
 if (im.quartos) tags.push(`${im.quartos} qtos`);
 if (im.vagas) tags.push(`${im.vagas} vaga${im.vagas > 1 ? 's' : ''}`);
 const valorLinha = im.finalidade === 'aluguel'
  ? (im.aluguel ? `<div class="preco">R$ ${im.aluguel}/mês</div>` : '')
  : (im.preco ? `<div class="preco">R$ ${im.preco}</div>` : '');
 return `
 <div class="imovel-card">
 <div class="imovel-card-thumb">
 ${foto ? `<img src="${foto}" alt="${im.titulo}" />` : ''}
 </div>
 <div class="imovel-card-body">
 <span class="status-badge status-${im.status}">${im.status}</span>
 <h3>${im.titulo}</h3>
 ${valorLinha}
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
  const aviso = document.getElementById('camposAviso');
  if (aviso) { aviso.style.display = 'none'; aviso.innerHTML = ''; }
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

 renderCamposAviso(t, im);
}

// ── Aviso de campos do template sem dado no cadastro ──────────────
const CAMPOS_DO_PERFIL = ['telefone', 'whatsapp', 'creci', 'site', 'slogan', 'logo'];

function renderCamposAviso(t, im) {
 const aviso = document.getElementById('camposAviso');
 if (!aviso) return;

 const faltaImovel = [];
 const faltaPerfil = [];

 (t.fields || []).forEach(f => {
  if (f === 'foto_imovel') return; // fotos já têm aviso próprio
  if (CAMPOS_DO_PERFIL.includes(f)) {
   if (!perfilData?.[f]) faltaPerfil.push(f === 'logo' ? 'Logo' : (fieldLabels[f] || f).replace(' (do perfil)', ''));
   return;
  }
  const valor = f === 'localizacao' ? (im.bairro || im.estado) : im[f];
  if (!valor) faltaImovel.push(fieldLabels[f] || f);
 });

 const msgs = [];
 if (faltaImovel.length) {
  msgs.push(`<strong>${faltaImovel.join(', ')}</strong> não ${faltaImovel.length > 1 ? 'estão preenchidos' : 'está preenchido'} no imóvel. <a href="#" onclick="editarImovel('${im.id}');return false">Completar cadastro →</a>`);
 }
 if (faltaPerfil.length) {
  msgs.push(`<strong>${faltaPerfil.join(', ')}</strong> ${faltaPerfil.length > 1 ? 'faltam' : 'falta'} no seu perfil. <a href="#" onclick="navegarPara('perfil');return false">Completar perfil →</a>`);
 }

 if (!msgs.length) { aviso.style.display = 'none'; aviso.innerHTML = ''; return; }
 aviso.style.display = 'block';
 aviso.innerHTML = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
  <div>Este template usa informações que estão em branco — para um resultado melhor, complete-as:<br>${msgs.join('<br>')}</div>`;
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
  renderPreviaFotos(true);
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

// ── Prévia de fotos: quais imagens entram na arte ─────────────────
let fotosPrevia = {};

function renderPreviaFotos(init = false) {
 const wrap = document.getElementById('previaFotos');
 const t = templates.find(x => x.id === selectedTemplateId);
 const im = imoveis.find(x => x.id === selectedImovelId);

 if (!t || !im || !(t.fields || []).includes('foto_imovel')) {
  fotosPrevia = {};
  wrap.style.display = 'none'; wrap.innerHTML = '';
  return;
 }
 const fotos = Object.entries(im.fotos || {}); // [slotKey, url]
 if (!fotos.length) {
  fotosPrevia = {};
  wrap.style.display = 'none'; wrap.innerHTML = '';
  return;
 }

 const slots = (t.angulos && t.angulos.length) ? t.angulos : ['foto'];
 if (init) {
  fotosPrevia = {};
  slots.forEach(s => { fotosPrevia[s] = (im.fotos || {})[s] || fotos[0][1]; });
 }

 wrap.style.display = 'block';
 wrap.innerHTML = `
 <div class="previa-fotos-header">Imagens que serão usadas na arte <span>— clique para trocar</span></div>` +
 slots.map(s => `
 <div class="previa-foto-slot">
  <div class="previa-foto-label">${s === 'foto' ? 'Foto do imóvel' : (angleLabels[s] || s)}</div>
  <div class="previa-foto-thumbs">
   ${fotos.map(([key, url]) => `
   <div class="previa-foto-thumb ${fotosPrevia[s] === url ? 'selected' : ''}" onclick="escolherFotoPrevia('${s}', '${url}')">
    <img src="${url}" loading="lazy" alt="" />
    <span>${angleLabels[key] || key}</span>
   </div>`).join('')}
  </div>
 </div>`).join('');
}

function escolherFotoPrevia(slot, url) {
 fotosPrevia[slot] = url;
 renderPreviaFotos(false);
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
 iniciarGeracao({
  templateId: selectedTemplateId,
  imovelId: selectedImovelId,
  textosPrevia,
  formato,
  fotosEscolhidas: Object.keys(fotosPrevia).length ? { ...fotosPrevia } : undefined,
 });
}

function iniciarGeracao(body, url = '/api/gerar') {
 // Dispara a geração sem bloquear — o servidor salva na galeria sozinho
 authFetch(url, {
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

// ── Variação de formato (Feed / Reels / Stories) ──────────────────
const FORMATOS_LABEL = { '1x1': 'Feed', feed: 'Feed', reels: 'Reels', stories: 'Stories' };

function toggleFormatoMenu(id, ev) {
 if (ev) ev.stopPropagation();
 document.querySelectorAll('.formato-menu.open').forEach(m => {
  if (m.id !== `fm-${id}`) m.classList.remove('open');
 });
 document.getElementById(`fm-${id}`)?.classList.toggle('open');
}

document.addEventListener('click', () => {
 document.querySelectorAll('.formato-menu.open').forEach(m => m.classList.remove('open'));
});

function gerarFormato(id, formato) {
 const label = FORMATOS_LABEL[formato] || formato;
 if (!confirm(`Gerar a versão ${label} desta arte?\nA nova imagem será criada em segundo plano e descontada dos seus créditos.`)) return;
 authFetch(`/api/galeria/${id}/formato`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ formato }),
 })
  .then(async r => ({ status: r.status, d: await r.json() }))
  .then(({ status, d }) => {
   if (status === 402) { toast(d.error, 'error'); navegarPara('plano'); loadBilling(); return; }
   if (d.error) toast('Erro: ' + d.error, 'error');
   loadGaleria();
   loadBilling();
  })
  .catch(err => { toast('Erro: ' + err.message, 'error'); loadGaleria(); });

 toast(`Gerando versão ${FORMATOS_LABEL[formato] || formato}…`, 'success');
 setTimeout(loadGaleria, 800);
 iniciarPolling();
}

// ── CRUD Imóveis ──────────────────────────────────────────────────
function atualizarFinalidade(v) {
 document.getElementById('finVenda').style.display   = v === 'aluguel' ? 'none' : '';
 document.getElementById('finAluguel').style.display = v === 'venda'   ? 'none' : '';
}

function abrirFormImovel(id = null) {
 document.getElementById('imovelForm').reset();
 document.getElementById('imovelEditId').value = '';
 document.getElementById('formImovelTitulo').textContent = 'Cadastrar Imóvel';
 renderFotoSlots({});
 atualizarFinalidade('venda');

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
 if (!im.finalidade) form.elements['finalidade'].value = 'venda';
 atualizarFinalidade(form.elements['finalidade'].value);
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
 const campos = ['titulo','tipo','status','finalidade','preco','entrada','parcela','financiamento',
 'aluguel','condominio','iptu','garantia',
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

 const campos = ['titulo','tipo','status','finalidade','preco','entrada','parcela','financiamento',
 'aluguel','condominio','iptu','garantia',
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
let perfilData = {};

async function loadPerfil() {
 const res = await authFetch('/api/perfil');
 const perfil = await res.json();
 perfilData = perfil || {};
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
 renderInicio();
}

// Redimensiona a imagem no navegador (máx. 1024px, mantém transparência)
function redimensionarImagem(file, maxDim = 1024) {
 return new Promise((resolve) => {
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
   URL.revokeObjectURL(url);
   const escala = Math.min(1, maxDim / Math.max(img.width, img.height));
   if (escala === 1 && file.size < 2 * 1024 * 1024) { resolve(file); return; }
   const canvas = document.createElement('canvas');
   canvas.width  = Math.round(img.width * escala);
   canvas.height = Math.round(img.height * escala);
   canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
   canvas.toBlob(blob => resolve(blob || file), 'image/png');
  };
  img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
  img.src = url;
 });
}

async function salvarPerfil(e) {
 e.preventDefault();
 const fd = new FormData(e.target);

 // Logo grande estoura o limite de upload — reduz antes de enviar
 const logoFile = e.target.elements.logo?.files?.[0];
 if (logoFile) {
  const menor = await redimensionarImagem(logoFile);
  fd.set('logo', menor, 'logo.png');
 }

 try {
  const res = await authFetch('/api/perfil', { method: 'PUT', body: fd });
  if (!res.ok) {
   let msg = `erro ${res.status}`;
   try { msg = (await res.json()).error || msg; } catch { /* resposta não-JSON (ex: 413) */ }
   if (res.status === 413) msg = 'Imagem muito grande. Tente um arquivo menor.';
   throw new Error(msg);
  }
  toast('Perfil salvo!', 'success');
  loadPerfil();
 } catch (err) {
  toast('Erro ao salvar perfil: ' + err.message, 'error');
 }
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
  renderInicio();
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
     <div class="galeria-card-sub">${item.templateNome || ''}${item.formato && item.formato !== '1x1' && item.formato !== 'feed' ? ` • ${FORMATOS_LABEL[item.formato] || item.formato}` : ''}</div>
    </div>
    <div class="galeria-card-actions">
     <a href="${item.imageUrl}" download class="btn-ghost btn-sm"><svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Baixar</a>
     <button class="btn-ghost btn-sm" onclick="abrirEdicao(${item.id})" title="Edição mágica"><svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg></button>
     <div class="formato-wrap">
      <button class="btn-ghost btn-sm" style="width:100%" onclick="toggleFormatoMenu(${item.id}, event)">Formato ▾</button>
      <div class="formato-menu" id="fm-${item.id}">
       ${['feed', 'reels', 'stories']
         .filter(f => f !== (item.formato === '1x1' ? 'feed' : item.formato))
         .map(f => `<button onclick="gerarFormato(${item.id}, '${f}')">${FORMATOS_LABEL[f]}</button>`).join('')}
      </div>
     </div>
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

 renderInicio();

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
let referenciaDataUrl = null;

function abrirEdicao(id) {
 const item = galeria.find(g => g.id === id);
 if (!item?.imageUrl) return;
 editandoArteId = id;
 document.getElementById('editarArteImg').src = item.imageUrl;
 document.getElementById('editarArteMsg').value = '';
 removerReferencia();
 document.getElementById('editarArteModal').style.display = 'flex';
 document.getElementById('editarArteMsg').focus();
}

async function anexarReferencia(input) {
 const file = input.files[0];
 if (!file) return;
 const menor = await redimensionarImagem(file); // reduz p/ caber no limite de upload
 const reader = new FileReader();
 reader.onload = e => {
  referenciaDataUrl = e.target.result;
  document.getElementById('editarRefImg').src = referenciaDataUrl;
  document.getElementById('editarRefPreview').style.display = 'flex';
 };
 reader.readAsDataURL(menor);
 input.value = '';
}

function removerReferencia() {
 referenciaDataUrl = null;
 document.getElementById('editarRefPreview').style.display = 'none';
 document.getElementById('editarRefImg').src = '';
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
  body: JSON.stringify({ instrucao, referencia: referenciaDataUrl || undefined }),
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

// ── 1-Click Art ───────────────────────────────────────────────────
const OC_OBJETIVOS = [
 { key: 'venda',      label: 'Venda' },
 { key: 'locacao',    label: 'Locação' },
 { key: 'lancamento', label: 'Lançamento' },
 { key: 'visitas',    label: 'Visitas' },
];
const OC_ESTILOS = [
 { key: 'clean',    nome: 'Clean Claro',           desc: 'Minimalista, fundo claro, elegante',        grad: 'linear-gradient(135deg,#f5f5f4,#d6e4e8)', txt: '#1a1a1a' },
 { key: 'escuro',   nome: 'Moderno Escuro',        desc: 'Premium, grafite com dourado',              grad: 'linear-gradient(135deg,#1c1c1c,#3a3123)', txt: '#e8c872' },
 { key: 'vibrante', nome: 'Vibrante Promocional',  desc: 'Cores fortes, energia de oferta',           grad: 'linear-gradient(135deg,#facc15,#1a1a1a)', txt: '#fff' },
];
const OC_CAMPOS = ['preco', 'entrada', 'parcela', 'aluguel', 'condominio', 'iptu', 'area', 'quartos', 'banheiros', 'vagas', 'cidade', 'destaque', 'diferenciais'];

const oc = { imovelId: null, objetivo: 'venda', estilo: 'clean', campos: ['preco', 'quartos', 'area'] };

function renderOneClick() {
 // Imóveis (só os que têm foto)
 const comFoto = imoveis.filter(im => Object.keys(im.fotos || {}).length > 0);
 document.getElementById('ocImovelEmpty').style.display = comFoto.length ? 'none' : 'block';
 if (oc.imovelId && !comFoto.find(i => i.id === oc.imovelId)) oc.imovelId = null;
 document.getElementById('ocImovelPicker').innerHTML = comFoto.map(im => {
  const foto = Object.values(im.fotos || {})[0];
  const local = [im.cidade, im.estado].filter(Boolean).join(' - ');
  return `
  <div class="picker-card ${oc.imovelId === im.id ? 'selected' : ''}" onclick="ocSelecionarImovel('${im.id}')">
   <div class="picker-thumb">${foto ? `<img src="${foto}" alt="" />` : ''}</div>
   <div class="picker-info">
    <h4>${im.titulo}</h4>
    <p>${[im.tipo, local].filter(Boolean).join(' • ') || '—'}</p>
   </div>
   <span class="picker-check"></span>
  </div>`;
 }).join('');

 // Objetivos
 document.getElementById('ocObjetivos').innerHTML = OC_OBJETIVOS.map(o => `
  <button class="oc-chip ${oc.objetivo === o.key ? 'active' : ''}" onclick="oc.objetivo='${o.key}';renderOneClick()">${o.label}</button>`).join('');

 // Estilos
 document.getElementById('ocEstilos').innerHTML = OC_ESTILOS.map(e => `
  <div class="oc-estilo ${oc.estilo === e.key ? 'selected' : ''}" onclick="oc.estilo='${e.key}';renderOneClick()">
   <div class="oc-estilo-swatch" style="background:${e.grad}"><span style="color:${e.txt}">Aa</span></div>
   <div class="oc-estilo-nome">${e.nome}</div>
   <div class="oc-estilo-desc">${e.desc}</div>
  </div>`).join('');

 // Campos (máx. 4) — só os preenchidos no imóvel selecionado quando houver
 const im = comFoto.find(i => i.id === oc.imovelId);
 document.getElementById('ocCampos').innerHTML = OC_CAMPOS.map(c => {
  const temValor = !im || !!im[c];
  const ativo = oc.campos.includes(c);
  return `<button class="oc-chip ${ativo ? 'active' : ''} ${temValor ? '' : 'disabled'}"
   ${temValor ? `onclick="ocToggleCampo('${c}')"` : 'disabled title="Campo vazio no imóvel"'}>${(fieldLabels[c] || c).replace(' (do perfil)', '')}</button>`;
 }).join('');

 // Botão + dica
 const btn = document.getElementById('btnOneClick');
 const hint = document.getElementById('ocHint');
 btn.disabled = !oc.imovelId;
 hint.textContent = !oc.imovelId
  ? 'Selecione um imóvel com foto para gerar.'
  : 'A arte será criada em segundo plano e salva na galeria.';
}

function ocSelecionarImovel(id) {
 oc.imovelId = id;
 const im = imoveis.find(i => i.id === id);
 if (im) {
  // Imóvel de aluguel: objetivo e campos padrão voltados à locação
  if (im.finalidade === 'aluguel') {
   oc.objetivo = 'locacao';
   oc.campos = ['aluguel', 'quartos', 'area'];
  } else if (!oc.campos.length) {
   oc.campos = ['preco', 'quartos', 'area'];
  }
  oc.campos = oc.campos.filter(c => !!im[c]); // remove escolhas sem valor neste imóvel
 }
 renderOneClick();
}

function ocToggleCampo(c) {
 if (oc.campos.includes(c)) {
  oc.campos = oc.campos.filter(x => x !== c);
 } else {
  if (oc.campos.length >= 4) { toast('Máximo de 4 informações — desmarque uma primeiro.', 'error'); return; }
  oc.campos.push(c);
 }
 renderOneClick();
}

function gerar1Click() {
 if (!oc.imovelId) return;
 iniciarGeracao({
  imovelId: oc.imovelId,
  objetivo: oc.objetivo,
  estilo: oc.estilo,
  campos: [...oc.campos],
 }, '/api/gerar-1click');
}

// ── Início: checklist de onboarding + dashboard ───────────────────
function verTutorialInicio() {
 localStorage.setItem('tutorialVisto', '1');
 navegarPara('tutoriais');
}

function renderInicio() {
 const el = document.getElementById('inicioContent');
 if (!el) return;

 const perfilOk   = !!(perfilData?.nome && perfilData?.logo);
 const imovelOk   = imoveis.length > 0;
 const arteOk     = galeria.length > 0;
 const tutorialOk = localStorage.getItem('tutorialVisto') === '1';
 const feitos = [perfilOk, imovelOk, arteOk, tutorialOk].filter(Boolean).length;

 const titulo = document.getElementById('inicioTitulo');
 const sub    = document.getElementById('inicioSub');
 if (titulo) titulo.textContent = currentUser?.nome ? `Olá, ${currentUser.nome.split(' ')[0]}!` : 'Bem-vindo!';

 // ── Onboarding: checklist ──
 if (feitos < 4) {
  if (sub) sub.textContent = 'Vamos preparar tudo para sua primeira arte';
  const item = (ok, titulo, desc, btnLabel, onclick) => `
   <div class="check-item ${ok ? 'done' : ''}">
    <span class="check-item-mark">${ok
     ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
     : ''}</span>
    <div class="check-item-info">
     <div class="check-item-titulo">${titulo}</div>
     <div class="check-item-desc">${desc}</div>
    </div>
    ${ok ? '' : `<button class="btn-primary check-item-btn" onclick="${onclick}">${btnLabel}</button>`}
   </div>`;

  el.innerHTML = `
  <div class="checklist-card">
   <div class="checklist-progress-label">${feitos} de 4 concluídos</div>
   <div class="checklist-progress"><div class="checklist-progress-bar" style="width:${(feitos / 4) * 100}%"></div></div>
   ${item(perfilOk, 'Complete o perfil da imobiliária',
     'Nome e logo — a logo aparece nas suas artes.',
     'Completar perfil', "navegarPara('perfil')")}
   ${item(imovelOk, 'Cadastre seu primeiro imóvel',
     'Com fotos — elas entram na arte gerada.',
     'Cadastrar imóvel', 'abrirFormImovel()')}
   ${item(arteOk, 'Gere sua primeira arte',
     'Escolha um template, um imóvel e deixe a IA criar.',
     'Gerar arte', "navegarPara('gerar')")}
   ${item(tutorialOk, 'Assista o tutorial de 1 minuto',
     'Veja o passo a passo completo em vídeo.',
     'Assistir', 'verTutorialInicio()')}
  </div>`;
  return;
 }

 // ── Dashboard ──
 if (sub) sub.textContent = 'Resumo da sua conta';

 let planoCard = '';
 let avisos = '';
 if (billing) {
  const st = billing.assinatura.status;
  const expira = billing.assinatura.expira ? new Date(billing.assinatura.expira) : null;
  const saldo = Number(billing.saldo || 0);
  const artes = Math.floor(saldo / 0.26);

  if (st === 'trial' && expira) {
   const dias = Math.max(0, Math.ceil((expira - Date.now()) / 86400000));
   planoCard = `
   <div class="inicio-card">
    <div class="inicio-card-label">Período de teste</div>
    <div class="inicio-card-valor">${dias} dia${dias === 1 ? '' : 's'} restante${dias === 1 ? '' : 's'}</div>
    <button class="btn-primary" style="margin-top:10px" onclick="navegarPara('plano')">Assinar agora</button>
   </div>`;
  } else if (st !== 'ativa' || (expira && expira < new Date())) {
   planoCard = `
   <div class="inicio-card">
    <div class="inicio-card-label">Assinatura</div>
    <div class="inicio-card-valor" style="color:var(--danger)">Inativa</div>
    <button class="btn-primary" style="margin-top:10px" onclick="navegarPara('plano')">Assinar</button>
   </div>`;
  }

  avisos = [
   billing.autoRecarga?.falhou ? `<div class="inicio-aviso">A última auto-recarga falhou — verifique seu cartão na tela <a href="#" onclick="navegarPara('plano');return false">Plano</a>.</div>` : '',
   saldo < 1 && st === 'ativa' ? `<div class="inicio-aviso">Saldo baixo (US$ ${saldo.toFixed(2)}) — <a href="#" onclick="navegarPara('plano');return false">recarregue</a> para continuar gerando.</div>` : '',
  ].join('');

  planoCard += `
  <div class="inicio-card">
   <div class="inicio-card-label">Créditos</div>
   <div class="inicio-card-valor">US$ ${saldo.toFixed(2)}</div>
   <div class="inicio-card-sub">≈ ${artes} arte${artes === 1 ? '' : 's'}</div>
  </div>`;
 }

 const ultimas = galeria.filter(g => g.imageUrl).slice(0, 4);
 el.innerHTML = `
 ${avisos}
 <div class="inicio-grid">
  ${planoCard}
  <div class="inicio-card">
   <div class="inicio-card-label">Artes geradas</div>
   <div class="inicio-card-valor">${galeria.length}</div>
   <div class="inicio-card-sub">${imoveis.length} imóve${imoveis.length === 1 ? 'l' : 'is'} cadastrado${imoveis.length === 1 ? '' : 's'}</div>
  </div>
 </div>
 <button class="btn-generate inicio-cta" onclick="navegarPara('gerar')">+ Criar nova arte</button>
 ${ultimas.length ? `
 <div class="inicio-ultimas">
  <div class="inicio-ultimas-label">Últimas artes</div>
  <div class="inicio-ultimas-grid">
   ${ultimas.map(g => `<img src="${g.imageUrl}" alt="" loading="lazy" onclick="navegarPara('galeria')" />`).join('')}
  </div>
 </div>` : ''}`;
}

// ── Toast ─────────────────────────────────────────────────────────
function toast(msg, type = 'success') {
 const el = document.getElementById('toast');
 el.textContent = msg;
 el.className = `toast ${type} show`;
 setTimeout(() => el.classList.remove('show'), 3000);
}

init();
