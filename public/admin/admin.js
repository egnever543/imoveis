// Categorias padrão dos templates — edite aqui para adicionar/remover opções
const CATEGORIAS_TEMPLATE = [
  'Casa',
  'Apartamento',
  'Terreno',
  'Comercial',
  'Lançamento',
  'Aluguel',
];

const MEDIA_FIELDS = ['foto_imovel', 'logo'];
const ALL_FIELDS   = [
  'titulo','preco','entrada','parcela','financiamento',
  'area','quartos','suites','banheiros','vagas','andar',
  'cidade','localizacao','endereco','destaque','diferenciais','foto_imovel','logo',
  'telefone','whatsapp','creci','site','slogan',
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

// ── Tabs ──────────────────────────────────────────────────────────────────────
let logsOffset = 0;
let logsTotal  = 0;

function mudarTab(tab) {
  ['templates','prompts','logs','cobranca','usuarios'].forEach(t => {
    document.getElementById('secao' + t.charAt(0).toUpperCase() + t.slice(1)).style.display = t === tab ? '' : 'none';
    document.getElementById('tab' + t.charAt(0).toUpperCase() + t.slice(1)).classList.toggle('active', t === tab);
  });
  if (tab === 'prompts')  carregarPrompts();
  if (tab === 'logs')     carregarLogs(true);
  if (tab === 'cobranca') { carregarConfig(); carregarCobrancas(); }
  if (tab === 'usuarios') carregarUsuarios();
}

// ── Usuários ─────────────────────────────────────────────────────────
const USUARIO_STATUS_PT = { ativa: 'ativa', trial: 'trial', inativa: 'inativa' };

async function carregarUsuarios() {
  const el = document.getElementById('usuariosLista');
  el.innerHTML = '<div class="no-templates">Carregando…</div>';
  try {
    const res  = await fetch('/api/admin/usuarios', { headers: { 'x-admin-password': adminPassword } });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    if (!data.length) { el.innerHTML = '<div class="no-templates">Nenhum usuário cadastrado.</div>'; return; }

    el.innerHTML = data.map(u => {
      const expira = u.assinaturaExpira ? new Date(u.assinaturaExpira).toLocaleDateString('pt-BR') : null;
      const expiraIso = u.assinaturaExpira ? new Date(u.assinaturaExpira).toISOString().slice(0, 10) : '';
      return `
      <div class="usuario-row" id="usr-${u.id}">
        <div class="usuario-row-top">
          <div>
            <div class="usuario-nome">${escHtml(u.nome || '(sem nome)')} <span style="color:var(--text-muted);font-weight:400">#${u.id}</span></div>
            <div class="usuario-email">${escHtml(u.email)}</div>
          </div>
          <span class="usuario-status ${u.assinaturaStatus}" id="status-badge-${u.id}">${USUARIO_STATUS_PT[u.assinaturaStatus] || u.assinaturaStatus}</span>
          ${expira ? `<span style="font-size:0.72rem;color:var(--text-muted)">até ${expira}</span>` : ''}
          <span class="usuario-saldo" id="saldo-${u.id}">US$ ${u.saldo.toFixed(2)}</span>
        </div>
        <div class="usuario-assinatura">
          <label>Assinatura:</label>
          <select id="status-${u.id}">
            <option value="ativa"   ${u.assinaturaStatus === 'ativa'   ? 'selected' : ''}>Ativa</option>
            <option value="trial"   ${u.assinaturaStatus === 'trial'   ? 'selected' : ''}>Trial</option>
            <option value="inativa" ${u.assinaturaStatus === 'inativa' ? 'selected' : ''}>Inativa</option>
          </select>
          <label>Válida até:</label>
          <input type="date" id="expira-${u.id}" value="${expiraIso}" />
          <button class="btn-ghost" style="font-size:0.8rem" onclick="salvarAssinaturaUsuario(${u.id})">Salvar</button>
        </div>
        <div class="usuario-creditos">
          <input type="number" step="1" id="valor-${u.id}" placeholder="R$" />
          <input type="text" id="desc-${u.id}" placeholder="Descrição (aparece no extrato do cliente)" />
          <button class="btn-primary" style="font-size:0.8rem" onclick="aplicarCreditos(${u.id})">Aplicar</button>
          <span class="hint-neg">Valor em reais, convertido pela cotação configurada. Positivo adiciona, negativo remove (ex: -10).</span>
        </div>
      </div>`;
    }).join('');
  } catch (err) {
    el.innerHTML = `<div class="no-templates">Erro ao carregar: ${escHtml(err.message)}</div>`;
  }
}

async function salvarAssinaturaUsuario(userId) {
  const status = document.getElementById(`status-${userId}`).value;
  const expira = document.getElementById(`expira-${userId}`).value; // yyyy-mm-dd ou ''
  try {
    const res = await fetch(`/api/admin/usuarios/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPassword },
      body: JSON.stringify({ assinaturaStatus: status, assinaturaExpira: expira || null }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    const badge = document.getElementById(`status-badge-${userId}`);
    badge.textContent = USUARIO_STATUS_PT[data.assinaturaStatus] || data.assinaturaStatus;
    badge.className = `usuario-status ${data.assinaturaStatus}`;
    toast('Assinatura atualizada', 'success');
  } catch (err) {
    toast('Erro: ' + err.message, 'error');
  }
}

async function aplicarCreditos(userId) {
  const valor = Number(document.getElementById(`valor-${userId}`).value);
  const descricao = document.getElementById(`desc-${userId}`).value.trim();
  if (!valor) { toast('Informe um valor em R$ diferente de zero', 'error'); return; }
  try {
    const res = await fetch(`/api/admin/usuarios/${userId}/creditos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPassword },
      body: JSON.stringify({ valorBrl: valor, descricao }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    document.getElementById(`saldo-${userId}`).textContent = `US$ ${data.saldo.toFixed(2)}`;
    document.getElementById(`valor-${userId}`).value = '';
    document.getElementById(`desc-${userId}`).value = '';
    toast(`Saldo atualizado: US$ ${data.saldo.toFixed(2)}`, 'success');
  } catch (err) {
    toast('Erro: ' + err.message, 'error');
  }
}

const COBRANCA_STATUS_PT = { succeeded: 'paga', pending: 'pendente', failed: 'falhou', reembolsada: 'reembolsada' };

async function carregarCobrancas() {
  const el = document.getElementById('cobrancasLista');
  el.innerHTML = '<div class="no-templates">Carregando…</div>';
  try {
    const res  = await fetch('/api/admin/cobrancas', { headers: { 'x-admin-password': adminPassword } });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    if (!data.cobrancas.length) {
      el.innerHTML = '<div class="no-templates">Nenhuma cobrança ainda.</div>';
      return;
    }
    el.innerHTML = data.cobrancas.map(c => {
      const d = new Date(c.criadoEm);
      return `
      <div class="cobranca-row">
        <span class="cobranca-status ${c.status}">${COBRANCA_STATUS_PT[c.status] || c.status}</span>
        <span class="cobranca-desc">${escHtml(c.descricao)}</span>
        <span class="cobranca-email">${escHtml(c.email)}</span>
        <span class="cobranca-valor">${c.moeda === 'BRL' ? 'R$' : c.moeda} ${c.valor.toFixed(2)}</span>
        <span class="cobranca-data">${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
        ${c.recibo ? `<a href="${c.recibo}" target="_blank">recibo ↗</a>` : ''}
      </div>`;
    }).join('');
  } catch (err) {
    el.innerHTML = `<div class="no-templates">Erro ao carregar: ${escHtml(err.message)}</div>`;
  }
}

// ── Cobrança ─────────────────────────────────────────────────────────
async function carregarConfig() {
  const res = await fetch('/api/admin/config', { headers: { 'x-admin-password': adminPassword } });
  const cfg = await res.json();
  document.getElementById('cfgMarkup').value       = cfg.markup_pct;
  document.getElementById('cfgCotacao').value      = cfg.cotacao_brl;
  document.getElementById('cfgAssinatura').value   = cfg.preco_assinatura_brl;
  document.getElementById('cfgRecargaMin').value   = cfg.recarga_min_brl;
  document.getElementById('cfgTrialDias').value    = cfg.trial_dias;
  document.getElementById('cfgTrialCredito').value = cfg.trial_credito_usd;
}

async function salvarConfig() {
  const body = {
    markup_pct:           Number(document.getElementById('cfgMarkup').value),
    cotacao_brl:          Number(document.getElementById('cfgCotacao').value),
    preco_assinatura_brl: Number(document.getElementById('cfgAssinatura').value),
    recarga_min_brl:      Number(document.getElementById('cfgRecargaMin').value),
    trial_dias:           Number(document.getElementById('cfgTrialDias').value),
    trial_credito_usd:    Number(document.getElementById('cfgTrialCredito').value),
  };
  const res = await fetch('/api/admin/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPassword },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.error) { toast('Erro: ' + data.error, 'error'); return; }
  toast('Configuração salva!', 'success');
}

async function carregarPrompts() {
  const el = document.getElementById('promptsLista');
  el.innerHTML = '<div class="no-templates">Carregando…</div>';
  const res  = await fetch('/api/admin/prompts', { headers: { 'x-admin-password': adminPassword } });
  const data = await res.json();
  el.innerHTML = Object.entries(data).map(([, p]) => `
    <div class="prompt-card">
      <div class="prompt-card-header">
        <div>
          <div class="prompt-card-title">${p.titulo}</div>
          <div class="prompt-card-meta">Modelo: ${p.modelo} — ${p.descricao}</div>
        </div>
      </div>
      <div class="prompt-card-body">
        <div class="prompt-text">${escHtml(p.prompt)}</div>
      </div>
    </div>
  `).join('');
}

async function carregarLogs(reset) {
  if (reset) { logsOffset = 0; document.getElementById('logsLista').innerHTML = ''; }
  const tipo   = document.getElementById('logFiltroTipo').value;
  const params = new URLSearchParams({ limit: 30, offset: logsOffset });
  if (tipo) params.set('tipo', tipo);
  const res  = await fetch(`/api/admin/logs?${params}`, { headers: { 'x-admin-password': adminPassword } });
  const data = await res.json();
  logsTotal = data.total || 0;
  if (reset && data.resumo) renderLogsResumo(data.resumo);
  const el = document.getElementById('logsLista');
  if (!data.logs.length && logsOffset === 0) { el.innerHTML = '<div class="no-templates">Nenhum log encontrado.</div>'; }
  data.logs.forEach(log => {
    const d    = new Date(log.criado_em);
    const time = d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
    const title = log.input?.imovel ? `${log.input.imovel} — ${log.input.template || ''}` : (log.input?.template || log.tipo);
    const custo = log.custo != null ? `$${Number(log.custo).toFixed(4)}` : '—';
    const div  = document.createElement('div');
    div.className = 'log-row';
    div.innerHTML = `
      <div class="log-row-header" onclick="this.nextElementSibling.classList.toggle('open')">
        <span class="log-badge ${log.tipo}">${log.tipo}</span>
        <span class="log-row-title">${escHtml(title)}</span>
        <span class="log-row-custo">${custo}</span>
        <span class="log-row-time">${time}</span>
      </div>
      <div class="log-row-body">
        <div class="log-json">${escHtml(JSON.stringify(log.input, null, 2))}</div>
      </div>
    `;
    el.appendChild(div);
  });
  logsOffset += data.logs.length;
  const btnMore = document.getElementById('btnLogsMore');
  btnMore.style.display = logsOffset < logsTotal ? '' : 'none';
}

const TIPO_LABELS = { gerar: 'Geração de arte', previa: 'Prévia de texto', edicao: 'Edição mágica', oneclick: '1-Click Art', analise: 'Análise de template', transcricao: 'Transcrição' };

function renderLogsResumo(resumo) {
  const el = document.getElementById('logsResumo');
  const cards = [`
    <div class="resumo-card">
      <div class="rc-label">Custo total</div>
      <div class="rc-valor">$${(resumo.totalUsd || 0).toFixed(2)}</div>
      <div class="rc-sub">estimado (USD)</div>
    </div>`];
  Object.entries(resumo.porTipo || {}).forEach(([tipo, t]) => {
    cards.push(`
    <div class="resumo-card">
      <div class="rc-label">${TIPO_LABELS[tipo] || tipo}</div>
      <div class="rc-valor">$${t.usd.toFixed(2)}</div>
      <div class="rc-sub">${t.qtd}x — média $${t.media.toFixed(4)}</div>
    </div>`);
  });
  el.innerHTML = cards.join('');
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
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

  // Select de categoria — inclui a atual do template mesmo se sair da lista padrão
  const cats = [...new Set([...CATEGORIAS_TEMPLATE, t.categoria].filter(Boolean))];
  document.getElementById('editCategoria').innerHTML =
    `<option value="">Sem categoria</option>` +
    cats.map(c => `<option value="${escHtml(c)}" ${t.categoria === c ? 'selected' : ''}>${escHtml(c)}</option>`).join('');

  // Preview da imagem atual + limpar seleÃ§Ã£o anterior
  document.getElementById('editImgPreview').src = t.imageUrl;
  document.getElementById('editImgInput').value  = '';
  document.getElementById('editImgNome').textContent = '';

  document.getElementById('editFieldsWrap').innerHTML = ALL_FIELDS.map(f => {
    const checked = (t.fields || []).includes(f);
    const isMedia = MEDIA_FIELDS.includes(f);
    const cls = ['field-toggle', checked ? 'checked' : '', checked && isMedia ? 'media' : ''].filter(Boolean).join(' ');
    return `<div class="${cls}" data-value="${f}" data-media="${isMedia}" onclick="toggleToggle(this)">${fieldLabels[f] || f}</div>`;
  }).join('');

  renderAngulosEdit((t.fields || []).includes('foto_imovel'), t.angulos || []);
  renderMapaForm(t.fields || [], t.mapa || {}, t.angulos || []);
  document.getElementById('editTranscricao').value = t.transcricao || '';
  document.getElementById('editModal').style.display = 'flex';
}

function renderMapaForm(fields, mapa, angulos = []) {
  const wrap = document.getElementById('editMapaForm');
  const textos  = fields.filter(f => f !== 'foto_imovel');
  const entries = [
    ...textos.map(f => ({ key: f, label: fieldLabels[f] || f })),
    ...angulos.map(a => ({ key: `ang:${a}`, label: `Foto — ${angleLabels[a] || a}` })),
  ];
  if (!entries.length) {
    wrap.innerHTML = '<p style="font-size:0.8rem;color:var(--text-muted)">Nenhum campo detectado.</p>';
    return;
  }
  wrap.innerHTML = entries.map(({ key, label }) => `
    <div class="field">
      <label style="font-size:0.75rem">${label}</label>
      <input type="text" data-mapa-field="${key}"
             value="${(mapa[key] || '').replace(/"/g, '&quot;')}"
             placeholder="Ex: onde este elemento aparece na imagem do template..." />
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
    const cls = ['field-toggle', checked ? 'checked' : '', checked ? 'angle' : ''].filter(Boolean).join(' ');
    return `<div class="${cls}" data-value="${s.key}" data-media="false" onclick="toggleToggle(this)">${s.label}</div>`;
  }).join('');
}

function toggleToggle(el) {
  const isChecked = !el.classList.contains('checked');
  const isMedia   = el.dataset.media === 'true';
  const inAngulos = !!el.closest('#editAngulosWrap');

  el.classList.toggle('checked', isChecked);
  if (isMedia)   el.classList.toggle('media', isChecked);
  if (inAngulos) el.classList.toggle('angle', isChecked);

  function refreshMapa() {
    const activeFields  = [...document.querySelectorAll('#editFieldsWrap .checked')].map(d => d.dataset.value);
    const activeAngulos = [...document.querySelectorAll('#editAngulosWrap .checked')].map(d => d.dataset.value);
    const currentMapa   = {};
    document.querySelectorAll('#editMapaForm input[data-mapa-field]').forEach(inp => {
      if (inp.value.trim()) currentMapa[inp.dataset.mapaField] = inp.value.trim();
    });
    renderMapaForm(activeFields, currentMapa, activeAngulos);
  }

  if (el.closest('#editFieldsWrap')) {
    const fotoChecked    = !!document.querySelector('#editFieldsWrap [data-value="foto_imovel"].checked');
    const currentAngulos = [...document.querySelectorAll('#editAngulosWrap .checked')].map(d => d.dataset.value);
    renderAngulosEdit(fotoChecked, currentAngulos);
    refreshMapa();
  }

  if (inAngulos) refreshMapa();
}

function fecharModal(e) {
  if (e.target === document.getElementById('editModal'))
    document.getElementById('editModal').style.display = 'none';
}

async function salvarEdicao() {
  const nome      = document.getElementById('editNome').value.trim();
  const categoria = document.getElementById('editCategoria').value.trim();
  const fields      = [...document.querySelectorAll('#editFieldsWrap .checked')].map(d => d.dataset.value);
  const angulos     = [...document.querySelectorAll('#editAngulosWrap .checked')].map(d => d.dataset.value);
  const transcricao = document.getElementById('editTranscricao').value.trim();
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
      body: JSON.stringify({ nome, categoria, fields, angulos, mapa, transcricao }),
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

// ── Analisar transcrição de um template específico ──────────────────
async function analisarEsteTemplate() {
  const btn = document.getElementById('btnAnalisarEste');
  btn.disabled = true;
  btn.textContent = 'Analisando...';
  try {
    const res = await fetch(`/api/admin/templates/${editingId}/gerar-transcricao`, {
      method: 'POST',
      headers: { 'x-admin-password': adminPassword },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    document.getElementById('editTranscricao').value = data.transcricao;
    toast('Transcricao gerada!', 'success');
  } catch (err) {
    toast('Erro: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Analisar com IA';
  }
}

// ── Gerar transcrições em lote ──────────────────────────────────────
async function gerarTranscricoes() {
  const btn = document.getElementById('btnGerarTranscricoes');
  btn.disabled = true;
  btn.textContent = 'Analisando...';
  try {
    const res = await fetch('/api/admin/templates/gerar-transcricoes', {
      method: 'POST',
      headers: { 'x-admin-password': adminPassword },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    const erros = (data.resultados || []).filter(r => r.erro);
    if (data.atualizados === 0 && !erros.length) {
      toast(data.msg || 'Nenhum template para analisar.', 'success');
    } else if (erros.length) {
      const msgs = erros.map(r => r.nome + ': ' + r.erro).join(' | ');
      toast('Erros: ' + msgs, 'error');
    } else {
      toast(data.atualizados + ' de ' + data.total + ' template(s) analisado(s).', 'success');
    }
    await carregarTemplates();
  } catch (err) {
    toast('Erro: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Analisar textos dos templates';
  }
}

function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type} show`;
  setTimeout(() => el.classList.remove('show'), 4000);
}


init();

