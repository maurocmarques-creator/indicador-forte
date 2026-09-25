// cadastro-tabela.js — Cadastro > Tabela (tabelas de frete) + trechos.
//
// Script classico carregado depois do script principal do index.html e do
// frete-calculo.js: usa getDb(), cadPodeEditar(), cadEsc(), lerServicos()
// e as constantes/funcoes TAB_* / frete* de la.
//
// As tabelas ficam no Supabase da PortoEx (tabela app_config, chave
// CAD_TABELAS_KEY) com uma chave generica de proposito: a ideia e outros
// projetos lerem as mesmas tabelas. Formato:
//   [{ id, nome, referencia, servicoId, servicoNome,
//      tipo: 'VENDA'|'COMPRA', vigencia: 'AAAA-MM-DD', precisao (2..5),
//      somaIcms, descontoIcmsFretePeso, permiteDesconto, permiteAcrescimo,
//      negociaTarifa (booleans),
//      composicao: ['GRIS', ...],            // itens marcados (TAB_COMPOSICAO)
//      regras: { GRIS: {pct, minimo, franquia}, FRETE_COLETA: {faixas:[{de,ate,valor}], minimo, franquia}, ... },
//      trechos: [{ id, origemUf, origemCidade, destinoUf, destinoCidade }], // cidade '' = estado todo
//      criadoEm, atualizadoEm (ISO) }, ...]
// As regras sao da tabela (valem para todos os trechos dela); os trechos
// dizem para quais origens/destinos a tabela vale.

const CAD_TABELAS_KEY = 'cadastro_tabelas';

// Opcoes SIM/NAO do cabecalho: [campo, rotulo, padrao]
const TAB_SIMNAO = [
  ['somaIcms', 'Soma imposto (ICMS) ao frete', false],
  ['descontoIcmsFretePeso', 'Aplica desconto de ICMS sobre Frete Peso', false],
  ['permiteDesconto', 'Permite desconto', true],
  ['permiteAcrescimo', 'Permite acréscimo', true],
  ['negociaTarifa', 'Negocia tarifa', false],
];

let _tabelas = [];
let _tabEditando = null;   // id da tabela aberta (null = nova)
let _tabRegras = {};       // regras em edicao (copia de trabalho)
let _tabServicos = [];

async function lerTabelas() {
  const db = getDb();
  if (!db) throw new Error('Supabase indisponível');
  const { data, error } = await db.from('app_config').select('value').eq('key', CAD_TABELAS_KEY).maybeSingle();
  if (error) throw error;
  return Array.isArray(data && data.value) ? data.value : [];
}

async function gravarTabelas(lista) {
  const { error } = await getDb().from('app_config')
    .upsert({ key: CAD_TABELAS_KEY, value: lista, updated_at: new Date().toISOString() });
  if (error) throw error;
}

function tabMsg(txt, erro) {
  const el = document.getElementById('cad-tabela-msg');
  el.textContent = txt;
  el.style.color = erro ? '#b91c1c' : '#64748b';
}

function tabFmtData(iso) {
  if (!iso) return '';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

// Numero -> texto para campo (virgula decimal); null -> vazio.
function tabInp(n) {
  return n === null || n === undefined ? '' : String(n).replace('.', ',');
}

function tabVista(qual) {
  document.getElementById('cad-tabela-lista').style.display = qual === 'lista' ? '' : 'none';
  document.getElementById('cad-tabela-form').style.display = qual === 'form' ? '' : 'none';
  document.getElementById('cad-tabela-trechos').style.display = qual === 'trechos' ? '' : 'none';
}

// ---------- LISTA ----------

async function carregarTabelas() {
  tabVista('lista');
  tabMsg('Carregando...');
  try {
    const podeEditar = await cadPodeEditar();
    document.getElementById('cad-tabela-nova').style.display = podeEditar ? '' : 'none';
    _tabelas = await lerTabelas();
    renderTabelas();
    tabMsg(_tabelas.length ? '' : 'Nenhuma tabela cadastrada ainda.');
  } catch (e) {
    console.error(e);
    tabMsg('Não foi possível carregar as tabelas (verifique a conexão).', true);
  }
}

function renderTabelas() {
  const lista = [..._tabelas].sort((a, b) => (b.vigencia || '').localeCompare(a.vigencia || '') || a.nome.localeCompare(b.nome));
  document.getElementById('tb-cad-tabela').innerHTML = lista.map(t => `
    <tr style="cursor:pointer" onclick="abrirTabela('${t.id}')" title="Abrir tabela">
      <td><b>${cadEsc(t.nome)}</b>${t.referencia ? ` <span style="color:#64748b;font-size:.75rem">(${cadEsc(t.referencia)})</span>` : ''}</td>
      <td>${cadEsc(t.servicoNome || '—')}</td>
      <td>${tabFmtData(t.vigencia)}</td>
      <td>${t.tipo === 'COMPRA' ? 'Compra' : 'Venda'}</td>
      <td style="color:#64748b;font-size:.78rem">${(t.trechos || []).length} trecho(s)</td>
    </tr>`).join('');
}

// ---------- FORMULARIO DA TABELA ----------

function novaTabela() {
  abrirTabela(null);
}

async function abrirTabela(id) {
  const podeEditar = await cadPodeEditar();
  const t = id ? _tabelas.find(x => x.id === id) : null;
  if (!t && !podeEditar) return;
  _tabEditando = t ? t.id : null;
  _tabRegras = JSON.parse(JSON.stringify((t && t.regras) || {}));
  try { _tabServicos = await lerServicos(); } catch (e) { _tabServicos = []; }

  const f = document.getElementById('cad-tabela-form');
  tabVista('form');

  const v = t || {
    nome: '', referencia: '', servicoId: '', tipo: 'VENDA', vigencia: '', precisao: 2, composicao: [],
    ...Object.fromEntries(TAB_SIMNAO.map(([k, , pad]) => [k, pad])),
  };
  const simNao = (campo, valor) => `
    <select id="tf-${campo}">
      <option value="1"${valor ? ' selected' : ''}>SIM</option>
      <option value="0"${valor ? '' : ' selected'}>NÃO</option>
    </select>`;
  const servicoSumiu = v.servicoId && !_tabServicos.some(s => s.id === v.servicoId);

  f.innerHTML = `
    <h3 style="margin-bottom:14px">${t ? 'Tabela — ' + cadEsc(t.nome) : 'Cadastrar nova tabela'}</h3>
    <div class="tf-grid">
      <div class="tf-col">
        <label class="tf-lbl">Nome *</label>
        <input id="tf-nome" type="text" maxlength="120" value="${cadEsc(v.nome)}">
        <label class="tf-lbl">Referência</label>
        <input id="tf-referencia" type="text" maxlength="120" value="${cadEsc(v.referencia || '')}">
        <label class="tf-lbl">Serviço *</label>
        <select id="tf-servico" style="width:100%;margin-bottom:10px">
          <option value="">— selecione —</option>
          ${_tabServicos.map(s => `<option value="${s.id}"${s.id === v.servicoId ? ' selected' : ''}>${cadEsc(s.nome)}</option>`).join('')}
          ${servicoSumiu ? `<option value="${v.servicoId}" selected>${cadEsc(v.servicoNome || '?')} (excluído)</option>` : ''}
        </select>
        ${_tabServicos.length ? '' : '<div style="font-size:.74rem;color:#b91c1c;margin:-6px 0 10px">Nenhum serviço cadastrado — cadastre em Cadastro ▾ > Serviço.</div>'}
        <div class="tf-linha">
          <div><label class="tf-lbl">Tipo de tabela</label>
            <select id="tf-tipo">
              <option value="VENDA"${v.tipo !== 'COMPRA' ? ' selected' : ''}>Venda</option>
              <option value="COMPRA"${v.tipo === 'COMPRA' ? ' selected' : ''}>Compra</option>
            </select></div>
          <div><label class="tf-lbl">Vigência *</label>
            <input id="tf-vigencia" type="date" value="${v.vigencia || ''}"></div>
          <div><label class="tf-lbl">Precisão</label>
            <select id="tf-precisao">
              ${[2, 3, 4, 5].map(n => `<option value="${n}"${+v.precisao === n ? ' selected' : ''}>${n} decimais</option>`).join('')}
            </select></div>
        </div>
        ${TAB_SIMNAO.map(([k, rot]) => `
          <div class="tf-simnao"><span>${rot}</span>${simNao(k, v[k])}</div>`).join('')}
      </div>
      <div class="tf-col">
        <label class="tf-lbl">Composição da tabela <span style="font-weight:400;color:#64748b">(marque os itens que a tabela usa)</span></label>
        <div class="tf-comp">
          ${TAB_COMPOSICAO.map(([k, rot]) => `
            <label><input type="checkbox" value="${k}"${(v.composicao || []).includes(k) ? ' checked' : ''} onchange="tabRenderRegras()"> ${rot}</label>`).join('')}
        </div>
      </div>
    </div>
    <div class="tf-lbl" style="margin-top:18px">Regras da tabela <span style="font-weight:400;color:#64748b">(valem para todos os trechos desta tabela)</span></div>
    <div id="tf-regras" class="tf-regras"></div>
    <div id="tf-msg" style="font-size:.78rem;margin:10px 0 0;min-height:1em"></div>
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
      <button id="tf-salvar" class="cad-btn" type="button" onclick="salvarTabela()">💾 Salvar e ir para os trechos</button>
      ${t ? `<button class="cad-btn" type="button" style="background:var(--primary-light)" onclick="abrirTrechos('${t.id}')">Trechos (${(t.trechos || []).length})</button>` : ''}
      <button class="cad-btn" type="button" style="background:#64748b" onclick="carregarTabelas()">Voltar</button>
      ${t ? '<button class="cad-del" type="button" style="margin-left:auto" onclick="excluirTabela()">Excluir tabela</button>' : ''}
    </div>`;

  tabRenderRegras(true);

  // Somente leitura para quem nao e editor
  if (!podeEditar) {
    f.querySelectorAll('input,select').forEach(el => { el.disabled = true; });
    f.querySelectorAll('#tf-salvar,.cad-del,.tf-add-faixa,.tf-del-faixa').forEach(el => el.remove());
  }
}

function tabComposicaoMarcada() {
  return [...document.querySelectorAll('#cad-tabela-form .tf-comp input:checked')].map(i => i.value);
}

// Le os valores digitados nos blocos de regra de volta para _tabRegras.
function tabColetarRegras() {
  document.querySelectorAll('#tf-regras .tf-regra').forEach(bl => {
    const k = bl.dataset.item;
    const r = {};
    bl.querySelectorAll('[data-campo]').forEach(inp => {
      if (!inp.closest('.tf-faixa')) r[inp.dataset.campo] = freteNum(inp.value);
    });
    if (bl.querySelector('.tf-faixas')) {
      r.faixas = [...bl.querySelectorAll('.tf-faixa')].map(row => ({
        de: freteNum(row.querySelector('[data-campo=de]').value),
        ate: freteNum(row.querySelector('[data-campo=ate]').value),
        valor: freteNum(row.querySelector('[data-campo=valor]').value),
      }));
    }
    _tabRegras[k] = r;
  });
}

function tabCampo(campo, rotulo, valor, dica) {
  return `<label>${rotulo}<input type="text" inputmode="decimal" data-campo="${campo}" value="${tabInp(valor)}"${dica ? ` placeholder="${dica}"` : ''}></label>`;
}

function tabBlocoRegra(k) {
  const tipo = TAB_TIPO[k];
  const r = _tabRegras[k] || {};
  let corpo = '';
  switch (tipo) {
    case 'PCT_NF':
      corpo = `<div class="tf-campos">${tabCampo('pct', '% sobre o valor da mercadoria', r.pct, 'ex.: 0,3')}</div>`;
      break;
    case 'PCT_CTE':
      corpo = `<div class="tf-campos">${tabCampo('pct', '% sobre o valor do CT-e', r.pct, 'ex.: 1,5')}</div>`;
      break;
    case 'FIXO':
      corpo = `<div class="tf-campos">${tabCampo('valor', 'Valor fixo (R$)', r.valor, 'em branco = não cobra')}</div>`;
      break;
    case 'FRACAO':
      corpo = `<div class="tf-campos">${tabCampo('fracaoKg', 'Fração (kg)', r.fracaoKg, 'ex.: 100')}${tabCampo('valor', 'Valor por fração (R$)', r.valor)}</div>
        <div class="tf-dica">peso ÷ fração, arredonda para cima, × valor</div>`;
      break;
    case 'FAIXA_PESO':
    case 'FAIXA_M3': {
      const un = tipo === 'FAIXA_PESO' ? 'kg' : 'm³';
      const faixas = r.faixas && r.faixas.length ? r.faixas : [{ de: null, ate: null, valor: null }];
      corpo = `<div class="tf-faixas">
          <div class="tf-faixa-cab"><span>De (${un})</span><span>Até (${un})</span><span>R$ por ${un}</span><span></span></div>
          ${faixas.map((f, i) => `
            <div class="tf-faixa">
              <input type="text" inputmode="decimal" data-campo="de" value="${tabInp(f.de)}" placeholder="0">
              <input type="text" inputmode="decimal" data-campo="ate" value="${tabInp(f.ate)}" placeholder="vazio = acima">
              <input type="text" inputmode="decimal" data-campo="valor" value="${tabInp(f.valor)}">
              <button type="button" class="tf-del-faixa" title="Remover faixa" onclick="tabDelFaixa('${k}',${i})">✕</button>
            </div>`).join('')}
          <button type="button" class="tf-add-faixa" onclick="tabAddFaixa('${k}')">+ faixa</button>
        </div>
        <div class="tf-dica">${un === 'kg' ? 'peso' : 'm³'} × valor da faixa em que ele cair</div>`;
      break;
    }
    default:
      return `<div class="tf-regra" data-item="${k}">
          <div class="tf-regra-tit">${TAB_ROTULO[k]}</div>
          <div class="tf-regra-vazia">Regra deste item a definir</div>
        </div>`;
  }
  return `<div class="tf-regra" data-item="${k}">
      <div class="tf-regra-tit">${TAB_ROTULO[k]}</div>
      ${corpo}
      <div class="tf-campos" style="margin-top:6px">
        ${tabCampo('minimo', 'Preço mínimo (R$)', r.minimo)}
        ${tabCampo('franquia', 'Franquia de peso (kg)', r.franquia)}
      </div>
    </div>`;
}

// Mostra um bloco de regra so para os itens marcados na composicao,
// preservando o que ja foi digitado.
function tabRenderRegras(inicial) {
  if (!inicial) tabColetarRegras();
  const marcados = tabComposicaoMarcada();
  document.getElementById('tf-regras').innerHTML = marcados.length
    ? marcados.map(tabBlocoRegra).join('')
    : '<div style="color:#64748b;font-size:.8rem">Marque ao lado os itens da composição — só eles aparecem aqui.</div>';
}

function tabAddFaixa(k) {
  tabColetarRegras();
  const r = _tabRegras[k] || (_tabRegras[k] = {});
  r.faixas = r.faixas || [];
  // Sugere o "de" logo depois do "ate" da ultima faixa (ex.: ate 1 -> de 1,01).
  const ult = r.faixas[r.faixas.length - 1];
  const de = ult && ult.ate !== null && ult.ate !== undefined ? Math.round((ult.ate + 0.01) * 100) / 100 : null;
  r.faixas.push({ de, ate: null, valor: null });
  tabRenderRegras(true);
}

function tabDelFaixa(k, i) {
  tabColetarRegras();
  const r = _tabRegras[k];
  if (r && r.faixas) r.faixas.splice(i, 1);
  tabRenderRegras(true);
}

function tfMsg(txt, erro) {
  const el = document.getElementById('tf-msg');
  el.textContent = txt;
  el.style.color = erro ? '#b91c1c' : '#16a34a';
}

// Regras so dos itens marcados, sem faixas totalmente vazias.
function tabRegrasParaGravar(composicao) {
  const out = {};
  for (const k of composicao) {
    const r = { ...(_tabRegras[k] || {}) };
    if (r.faixas) {
      r.faixas = r.faixas.filter(f => f.de !== null || f.ate !== null || f.valor !== null)
        .map(f => ({ de: f.de ?? 0, ate: f.ate, valor: f.valor ?? 0 }))
        .sort((a, b) => a.de - b.de);
    }
    out[k] = r;
  }
  return out;
}

function tabValidarRegras(regras) {
  for (const [k, r] of Object.entries(regras)) {
    for (const f of r.faixas || []) {
      if (f.ate !== null && f.ate !== undefined && f.ate < f.de) return `${TAB_ROTULO[k]}: faixa com "até" menor que "de".`;
    }
    if (TAB_TIPO[k] === 'FRACAO' && r.valor && !r.fracaoKg) return `${TAB_ROTULO[k]}: informe a fração em kg.`;
  }
  return null;
}

async function salvarTabela() {
  if (!(await cadPodeEditar())) return;
  tabColetarRegras();
  const nomeEl = document.getElementById('tf-nome');
  const vigEl = document.getElementById('tf-vigencia');
  const srvEl = document.getElementById('tf-servico');
  const nome = nomeEl.value.trim();
  const vigencia = vigEl.value;
  const servicoId = srvEl.value;
  nomeEl.style.borderColor = nome ? '' : '#ef4444';
  vigEl.style.borderColor = vigencia ? '' : '#ef4444';
  srvEl.style.borderColor = servicoId ? '' : '#ef4444';
  if (!nome || !vigencia || !servicoId) { tfMsg('Preencha o nome, o serviço e a vigência.', true); return; }

  const composicao = tabComposicaoMarcada();
  const regras = tabRegrasParaGravar(composicao);
  const erroRegra = tabValidarRegras(regras);
  if (erroRegra) { tfMsg(erroRegra, true); return; }

  const btn = document.getElementById('tf-salvar');
  btn.disabled = true;
  tfMsg('Salvando...', false);
  try {
    // Rele antes de gravar para nao apagar o que outra pessoa salvou.
    const lista = await lerTabelas();
    const dup = lista.find(x => x.id !== _tabEditando && x.nome.toUpperCase() === nome.toUpperCase() && x.vigencia === vigencia);
    if (dup) { tfMsg('Já existe uma tabela com esse nome e essa vigência.', true); return; }

    const antiga = _tabEditando ? lista.find(x => x.id === _tabEditando) : null;
    const agora = new Date().toISOString();
    const srv = _tabServicos.find(s => s.id === servicoId);
    const tab = {
      ...(antiga || {}),
      id: antiga ? antiga.id : Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      nome,
      referencia: document.getElementById('tf-referencia').value.trim(),
      servicoId,
      servicoNome: srv ? srv.nome : ((antiga && antiga.servicoNome) || ''),
      tipo: document.getElementById('tf-tipo').value,
      vigencia,
      precisao: +document.getElementById('tf-precisao').value,
      ...Object.fromEntries(TAB_SIMNAO.map(([k]) => [k, document.getElementById('tf-' + k).value === '1'])),
      composicao,
      regras,
      trechos: (antiga && antiga.trechos) || [],
      criadoEm: antiga ? antiga.criadoEm : agora,
      atualizadoEm: agora,
    };
    const nova = antiga ? lista.map(x => (x.id === tab.id ? tab : x)) : [...lista, tab];
    await gravarTabelas(nova);
    _tabelas = nova;
    _tabEditando = tab.id;
    abrirTrechos(tab.id, `Tabela "${nome}" salva. Agora inclua os trechos em que ela vale.`);
  } catch (e) {
    console.error(e);
    tfMsg('Não foi possível salvar (verifique a conexão).', true);
  } finally {
    btn.disabled = false;
  }
}

async function excluirTabela() {
  if (!(await cadPodeEditar()) || !_tabEditando) return;
  const t = _tabelas.find(x => x.id === _tabEditando);
  if (!t || !confirm(`Excluir a tabela "${t.nome}"? Essa ação não pode ser desfeita.`)) return;
  try {
    const lista = (await lerTabelas()).filter(x => x.id !== t.id);
    await gravarTabelas(lista);
    _tabelas = lista;
    _tabEditando = null;
    await carregarTabelas();
    tabMsg(`Tabela "${t.nome}" excluída.`);
  } catch (e) {
    console.error(e);
    tfMsg('Não foi possível excluir (verifique a conexão).', true);
  }
}

// ---------- TRECHOS ----------

// Cidades conhecidas (destinos que aparecem nos dados do dashboard) para
// sugerir na digitacao; qualquer cidade pode ser digitada.
function tabCidadesConhecidas() {
  const rows = (typeof RAW !== 'undefined' && RAW.rows) || [];
  return [...new Set(rows.map(r => r.EFF_CIDADE).filter(Boolean))].sort();
}

async function abrirTrechos(id, aviso) {
  const podeEditar = await cadPodeEditar();
  const t = _tabelas.find(x => x.id === id);
  if (!t) return;
  _tabEditando = id;
  tabVista('trechos');
  const ufOpts = '<option value="">UF</option>' + FRETE_UFS.map(u => `<option>${u}</option>`).join('');
  const el = document.getElementById('cad-tabela-trechos');
  el.innerHTML = `
    <h3 style="margin-bottom:4px">Trechos — ${cadEsc(t.nome)}</h3>
    <div style="font-size:.78rem;color:#64748b;margin-bottom:12px">
      Serviço ${cadEsc(t.servicoNome || '—')} · vigência ${tabFmtData(t.vigencia)} ·
      no cálculo, o frete usa esta tabela quando a origem e o destino casam com um dos trechos abaixo.
      Deixe a cidade em branco para valer para o estado inteiro.
    </div>
    ${podeEditar ? `
    <div class="tr-form">
      <div><label class="tf-lbl">Origem</label>
        <div class="tr-par"><select id="tr-ouf">${ufOpts}</select>
          <input id="tr-ocid" type="text" list="tr-cidades" placeholder="Cidade (em branco = estado todo)"></div></div>
      <div><label class="tf-lbl">Destino</label>
        <div class="tr-par"><select id="tr-duf">${ufOpts}</select>
          <input id="tr-dcid" type="text" list="tr-cidades" placeholder="Cidade (em branco = estado todo)"></div></div>
      <button class="cad-btn" type="button" onclick="adicionarTrecho()" style="align-self:flex-end">+ Adicionar trecho</button>
    </div>
    <datalist id="tr-cidades">${tabCidadesConhecidas().map(c => `<option value="${cadEsc(c)}">`).join('')}</datalist>` : ''}
    <div id="tr-msg" style="font-size:.78rem;margin:8px 0;min-height:1em"></div>
    <table>
      <thead><tr><th>Origem</th><th>Destino</th><th style="width:90px"></th></tr></thead>
      <tbody id="tb-trechos"></tbody>
    </table>
    <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
      <button class="cad-btn" type="button" style="background:var(--primary-light)" onclick="abrirTabela('${t.id}')">← Voltar para a tabela</button>
      <button class="cad-btn" type="button" style="background:#64748b" onclick="carregarTabelas()">Lista de tabelas</button>
    </div>`;
  renderTrechos(podeEditar);
  if (aviso) trMsg(aviso, false);
}

function trMsg(txt, erro) {
  const el = document.getElementById('tr-msg');
  el.textContent = txt;
  el.style.color = erro ? '#b91c1c' : '#16a34a';
}

function renderTrechos(podeEditar) {
  const t = _tabelas.find(x => x.id === _tabEditando);
  const trechos = (t && t.trechos) || [];
  const lugar = (uf, cid) => cid ? `${cadEsc(cid)}/${uf}` : `<i>${uf} — estado todo</i>`;
  document.getElementById('tb-trechos').innerHTML = trechos.length
    ? trechos.map(tr => `<tr>
        <td>${lugar(tr.origemUf, tr.origemCidade)}</td>
        <td>${lugar(tr.destinoUf, tr.destinoCidade)}</td>
        <td style="text-align:right">${podeEditar ? `<button class="cad-del" type="button" onclick="excluirTrecho('${tr.id}')">Excluir</button>` : ''}</td>
      </tr>`).join('')
    : '<tr><td colspan="3" style="color:#64748b">Nenhum trecho cadastrado — sem trecho a tabela não é usada no cálculo automático.</td></tr>';
}

async function adicionarTrecho() {
  if (!(await cadPodeEditar())) return;
  const tr = {
    origemUf: document.getElementById('tr-ouf').value,
    origemCidade: freteNorm(document.getElementById('tr-ocid').value),
    destinoUf: document.getElementById('tr-duf').value,
    destinoCidade: freteNorm(document.getElementById('tr-dcid').value),
  };
  if (!tr.origemUf || !tr.destinoUf) { trMsg('Escolha a UF de origem e a de destino.', true); return; }
  try {
    const lista = await lerTabelas();
    const t = lista.find(x => x.id === _tabEditando);
    if (!t) { trMsg('Tabela não encontrada (foi excluída?).', true); return; }
    t.trechos = t.trechos || [];
    const igual = t.trechos.some(x => x.origemUf === tr.origemUf && x.destinoUf === tr.destinoUf &&
      freteNorm(x.origemCidade) === tr.origemCidade && freteNorm(x.destinoCidade) === tr.destinoCidade);
    if (igual) { trMsg('Esse trecho já está cadastrado.', true); return; }
    t.trechos.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ...tr });
    t.atualizadoEm = new Date().toISOString();
    await gravarTabelas(lista);
    _tabelas = lista;
    renderTrechos(true);
    document.getElementById('tr-ocid').value = '';
    document.getElementById('tr-dcid').value = '';
    trMsg('Trecho incluído.', false);
  } catch (e) {
    console.error(e);
    trMsg('Não foi possível salvar o trecho (verifique a conexão).', true);
  }
}

async function excluirTrecho(trId) {
  if (!(await cadPodeEditar())) return;
  try {
    const lista = await lerTabelas();
    const t = lista.find(x => x.id === _tabEditando);
    if (!t) return;
    t.trechos = (t.trechos || []).filter(x => x.id !== trId);
    t.atualizadoEm = new Date().toISOString();
    await gravarTabelas(lista);
    _tabelas = lista;
    renderTrechos(true);
    trMsg('Trecho excluído.', false);
  } catch (e) {
    console.error(e);
    trMsg('Não foi possível excluir o trecho (verifique a conexão).', true);
  }
}
