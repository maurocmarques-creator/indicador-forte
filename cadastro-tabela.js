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
//      fatorCubagem (kg por m3; peso cubado = m3 x fator; peso considerado = maior entre real e cubado),
//      somaIcms, descontoIcmsFretePeso, negociaTarifa (booleans),
//      composicao: ['GRIS', ...],             // itens que a tabela usa (TAB_COMPOSICAO)
//      trechos: [{ id, origemUf, origemCidade, destinoUf, destinoCidade,  // cidade '' = estado todo
//                  regras: { GRIS: {pct, minimo},
//                            FRETE_COLETA: {faixas:[{de,ate,franquia,valorFranquia,valor}], minimo}, ... } }],
//      criadoEm, atualizadoEm (ISO) }, ...]
// As regras (valores) sao sempre de cada trecho (origem -> destino); a
// tabela so diz quais itens entram. Regra de cada tipo: topo do frete-calculo.js.

const CAD_TABELAS_KEY = 'cadastro_tabelas';

// Opcoes SIM/NAO do cabecalho: [campo, rotulo, padrao]
const TAB_SIMNAO = [
  ['somaIcms', 'Soma imposto (ICMS) ao frete', false],
  ['descontoIcmsFretePeso', 'Aplica desconto de ICMS sobre Frete Peso', false],
  ['negociaTarifa', 'Negocia tarifa', false],
];

let _tabelas = [];
let _tabEditando = null;   // id da tabela aberta (null = nova)
let _trEditando = null;    // id do trecho aberto (null = novo)
let _tabRegras = {};       // regras do trecho em edicao (copia de trabalho)
let _tabComp = [];         // composicao usada para desenhar os blocos de regra
let _tabServicos = [];

function novoId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

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
  window.scrollTo(0, 0);
}

function tabLugar(uf, cid) {
  return cid ? `${cadEsc(cid)}/${uf}` : `<i>${uf} — estado todo</i>`;
}

// ---------- LISTA DE TABELAS ----------

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

// ---------- FORMULARIO DA TABELA (cabecalho + composicao) ----------

function novaTabela() {
  return abrirTabela(null);
}

async function abrirTabela(id) {
  const podeEditar = await cadPodeEditar();
  const t = id ? _tabelas.find(x => x.id === id) : null;
  if (!t && !podeEditar) return;
  _tabEditando = t ? t.id : null;
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
          <div><label class="tf-lbl">Cubagem (kg/m³)</label>
            <input id="tf-cubagem" type="text" inputmode="decimal" style="width:90px" value="${tabInp(v.fatorCubagem)}" placeholder="ex.: 300"></div>
          <div><label class="tf-lbl">Precisão</label>
            <select id="tf-precisao">
              ${[2, 3, 4, 5].map(n => `<option value="${n}"${+v.precisao === n ? ' selected' : ''}>${n} decimais</option>`).join('')}
            </select></div>
        </div>
        <div class="tf-dica" style="margin:-4px 0 8px">Peso cubado = cubagem (m³) × este fator. No cálculo vale o <b>peso considerado</b>: o maior entre o peso real e o peso cubado.</div>
        ${TAB_SIMNAO.map(([k, rot]) => `
          <div class="tf-simnao"><span>${rot}</span>${simNao(k, v[k])}</div>`).join('')}
      </div>
      <div class="tf-col">
        <label class="tf-lbl">Composição da tabela <span style="font-weight:400;color:#64748b">(marque os itens que a tabela usa)</span></label>
        <div class="tf-comp">
          ${TAB_COMPOSICAO.map(([k, rot]) => `
            <label><input type="checkbox" value="${k}"${(v.composicao || []).includes(k) ? ' checked' : ''}> ${rot}</label>`).join('')}
        </div>
        <div class="tf-dica" style="margin-top:10px">Os valores de cada item (%, faixas, franquia, mínimo...) são preenchidos em cada trecho (origem → destino).</div>
      </div>
    </div>
    <div id="tf-msg" style="font-size:.78rem;margin:10px 0 0;min-height:1em"></div>
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
      <button id="tf-salvar" class="cad-btn" type="button" onclick="salvarTabela()">💾 Salvar e ir para os trechos</button>
      ${t ? `<button class="cad-btn" type="button" style="background:var(--primary-light)" onclick="abrirTrechos('${t.id}')">Trechos (${(t.trechos || []).length})</button>` : ''}
      <button class="cad-btn" type="button" style="background:#64748b" onclick="carregarTabelas()">Voltar</button>
      ${t ? '<button class="cad-del" type="button" style="margin-left:auto" onclick="excluirTabela()">Excluir tabela</button>' : ''}
    </div>`;

  if (!podeEditar) {
    f.querySelectorAll('input,select').forEach(el => { el.disabled = true; });
    f.querySelectorAll('#tf-salvar,.cad-del').forEach(el => el.remove());
  }
}

function tfMsg(txt, erro) {
  const el = document.getElementById('tf-msg');
  el.textContent = txt;
  el.style.color = erro ? '#b91c1c' : '#16a34a';
}

async function salvarTabela() {
  if (!(await cadPodeEditar())) return;
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
  const composicao = [...document.querySelectorAll('#cad-tabela-form .tf-comp input:checked')].map(i => i.value);
  if (!composicao.length) { tfMsg('Marque pelo menos um item da composição.', true); return; }

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
      id: antiga ? antiga.id : novoId(),
      nome,
      referencia: document.getElementById('tf-referencia').value.trim(),
      servicoId,
      servicoNome: srv ? srv.nome : ((antiga && antiga.servicoNome) || ''),
      tipo: document.getElementById('tf-tipo').value,
      vigencia,
      precisao: +document.getElementById('tf-precisao').value,
      fatorCubagem: freteNum(document.getElementById('tf-cubagem').value),
      ...Object.fromEntries(TAB_SIMNAO.map(([k]) => [k, document.getElementById('tf-' + k).value === '1'])),
      composicao,
      trechos: (antiga && antiga.trechos) || [],
      criadoEm: antiga ? antiga.criadoEm : agora,
      atualizadoEm: agora,
    };
    // campos que sairam da tabela
    delete tab.regras; delete tab.permiteDesconto; delete tab.permiteAcrescimo;
    const nova = antiga ? lista.map(x => (x.id === tab.id ? tab : x)) : [...lista, tab];
    await gravarTabelas(nova);
    _tabelas = nova;
    _tabEditando = tab.id;
    abrirTrechos(tab.id, antiga ? `Tabela "${nome}" salva.` : `Tabela "${nome}" salva. Agora inclua os trechos com as regras de cada um.`);
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
  if (!t || !confirm(`Excluir a tabela "${t.nome}" e todos os trechos dela? Essa ação não pode ser desfeita.`)) return;
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

// ---------- LISTA DE TRECHOS ----------

function trMsg(txt, erro) {
  const el = document.getElementById('tr-msg');
  if (!el) return;
  el.textContent = txt;
  el.style.color = erro ? '#b91c1c' : '#16a34a';
}

// Quantos itens da composicao o trecho ja tem preenchidos.
function trPreenchidos(t, tr) {
  const temValor = r => r && Object.entries(r).some(([c, v]) =>
    c === 'faixas' ? (v || []).length > 0 : v !== null && v !== undefined);
  return (t.composicao || []).filter(k => temValor((tr.regras || {})[k])).length;
}

async function abrirTrechos(id, aviso) {
  const podeEditar = await cadPodeEditar();
  const t = _tabelas.find(x => x.id === id);
  if (!t) return;
  _tabEditando = id;
  tabVista('trechos');
  const trechos = [...(t.trechos || [])].sort((a, b) =>
    (a.origemUf + a.origemCidade + a.destinoUf + a.destinoCidade).localeCompare(b.origemUf + b.origemCidade + b.destinoUf + b.destinoCidade));
  const nComp = (t.composicao || []).length;
  document.getElementById('cad-tabela-trechos').innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:4px">
      <h3 style="margin:0">Trechos — ${cadEsc(t.nome)}</h3>
      ${podeEditar ? `<button class="cad-btn" type="button" onclick="abrirTrecho(null)">+ Novo trecho</button>` : ''}
    </div>
    <div style="font-size:.78rem;color:#64748b;margin-bottom:10px">
      Serviço ${cadEsc(t.servicoNome || '—')} · vigência ${tabFmtData(t.vigencia)} ·
      cada trecho tem as suas regras. No cálculo, vale o trecho que casar com a origem e o destino
      (cidade em branco = estado todo; com cidade tem prioridade).
    </div>
    <div id="tr-msg" style="font-size:.78rem;margin:4px 0 8px;min-height:1em"></div>
    <table>
      <thead><tr><th>Origem</th><th>Destino</th><th style="width:160px">Itens preenchidos</th></tr></thead>
      <tbody>${trechos.length ? trechos.map(tr => {
        const n = trPreenchidos(t, tr);
        return `<tr style="cursor:pointer" onclick="abrirTrecho('${tr.id}')" title="Abrir trecho">
          <td>${tabLugar(tr.origemUf, tr.origemCidade)}</td>
          <td>${tabLugar(tr.destinoUf, tr.destinoCidade)}</td>
          <td style="color:${n < nComp ? '#b45309' : '#16a34a'};font-weight:600">${n} de ${nComp}</td>
        </tr>`;
      }).join('') : '<tr><td colspan="3" style="color:#64748b">Nenhum trecho cadastrado — sem trecho a tabela não é usada no cálculo.</td></tr>'}</tbody>
    </table>
    <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
      <button class="cad-btn" type="button" style="background:var(--primary-light)" onclick="abrirTabela('${t.id}')">← Voltar para a tabela</button>
      <button class="cad-btn" type="button" style="background:#64748b" onclick="carregarTabelas()">Lista de tabelas</button>
    </div>`;
  if (aviso) trMsg(aviso, false);
}

// ---------- EDITOR DE TRECHO (origem/destino + regras) ----------

// id = trecho existente; null = novo; copiarDe = id de trecho cujas regras
// vem pre-preenchidas (botao Duplicar).
async function abrirTrecho(id, copiarDe) {
  const podeEditar = await cadPodeEditar();
  const t = _tabelas.find(x => x.id === _tabEditando);
  if (!t) return;
  const tr = id ? (t.trechos || []).find(x => x.id === id) : null;
  if (!tr && !podeEditar) return;
  const base = copiarDe ? (t.trechos || []).find(x => x.id === copiarDe) : tr;
  _trEditando = tr ? tr.id : null;
  _tabRegras = JSON.parse(JSON.stringify((base && base.regras) || {}));
  _tabComp = (t.composicao || []).filter(k => k in TAB_ROTULO);

  const ufOpts = sel => '<option value="">UF</option>' + FRETE_UFS.map(u => `<option${u === sel ? ' selected' : ''}>${u}</option>`).join('');
  const titulo = tr ? `Trecho ${tabLugar(tr.origemUf, tr.origemCidade)} → ${tabLugar(tr.destinoUf, tr.destinoCidade)}`
    : copiarDe ? 'Novo trecho (cópia — troque a origem/destino)' : 'Novo trecho';
  tabVista('trechos');
  document.getElementById('cad-tabela-trechos').innerHTML = `
    <h3 style="margin-bottom:4px">${titulo}</h3>
    <div style="font-size:.78rem;color:#64748b;margin-bottom:12px">Tabela ${cadEsc(t.nome)} · vigência ${tabFmtData(t.vigencia)} · cidade em branco = estado todo.</div>
    <div class="tr-form">
      <div><label class="tf-lbl">Origem *</label>
        <div class="tr-par"><select id="tr-ouf">${ufOpts(tr ? tr.origemUf : '')}</select>
          <input id="tr-ocid" type="text" list="tr-ocidades" placeholder="Cidade (em branco = estado todo)" value="${cadEsc(tr ? tr.origemCidade : '')}"></div></div>
      <div><label class="tf-lbl">Destino *</label>
        <div class="tr-par"><select id="tr-duf">${ufOpts(tr ? tr.destinoUf : '')}</select>
          <input id="tr-dcid" type="text" list="tr-dcidades" placeholder="Cidade (em branco = estado todo)" value="${cadEsc(tr ? tr.destinoCidade : '')}"></div></div>
    </div>
    <datalist id="tr-ocidades"></datalist><datalist id="tr-dcidades"></datalist>
    <div class="tf-lbl" style="margin-top:14px">Regras deste trecho</div>
    <div id="tf-regras" class="tf-regras"></div>
    <div id="tr-msg" style="font-size:.78rem;margin:10px 0 0;min-height:1em"></div>
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
      <button id="tr-salvar" class="cad-btn" type="button" onclick="salvarTrecho()">💾 Salvar trecho</button>
      ${tr ? `<button class="cad-btn tr-dup" type="button" style="background:var(--primary-light)" onclick="abrirTrecho(null,'${tr.id}')">📄 Duplicar trecho</button>` : ''}
      <button class="cad-btn" type="button" style="background:#64748b" onclick="abrirTrechos('${t.id}')">← Voltar aos trechos</button>
      ${tr ? '<button class="cad-del" type="button" style="margin-left:auto" onclick="excluirTrecho()">Excluir trecho</button>' : ''}
    </div>`;
  tabRenderRegras();
  cidLigarUf('tr-ouf', 'tr-ocidades');
  cidLigarUf('tr-duf', 'tr-dcidades');
  if (!podeEditar) {
    const box = document.getElementById('cad-tabela-trechos');
    box.querySelectorAll('input,select').forEach(el => { el.disabled = true; });
    box.querySelectorAll('#tr-salvar,.tr-dup,.cad-del,.tf-add-faixa,.tf-del-faixa').forEach(el => el.remove());
  }
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
      r.faixas = [...bl.querySelectorAll('.tf-faixa')].map(row =>
        Object.fromEntries([...row.querySelectorAll('[data-campo]')].map(i => [i.dataset.campo, freteNum(i.value)])));
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
      corpo = `<div class="tf-campos">${tabCampo('fracaoKg', 'Fração (kg)', r.fracaoKg, 'ex.: 100')}${tabCampo('valor', 'Valor por fração (R$)', r.valor)}
          ${tabCampo('franquia', 'Franquia (kg)', r.franquia, 'opcional')}${tabCampo('valorFranquia', 'Valor da franquia (R$)', r.valorFranquia)}</div>
        <div class="tf-dica">peso ÷ fração, arredonda para cima, × valor. Com franquia: até a franquia cobra o valor dela; acima, valor da franquia + (excedente ÷ fração, arredonda para cima) × valor</div>`;
      break;
    case 'FAIXA_PESO':
    case 'FAIXA_M3': {
      const porPeso = tipo === 'FAIXA_PESO';
      const un = porPeso ? 'kg' : 'm³';
      const faixas = r.faixas && r.faixas.length ? r.faixas : [{}];
      const inp = (f, campo, ph) => `<input type="text" inputmode="decimal" data-campo="${campo}" value="${tabInp(f[campo])}"${ph ? ` placeholder="${ph}"` : ''}>`;
      const cls = porPeso ? 'tf-faixa tf-faixa-kg' : 'tf-faixa';
      corpo = `<div class="tf-faixas">
          <div class="${cls.replace('tf-faixa', 'tf-faixa-cab')}"><span>De (${un})</span><span>Até (${un})</span>
            ${porPeso ? '<span>Franquia (kg)</span><span>Valor franquia (R$)</span><span>R$/kg excedente</span>' : `<span>R$ por ${un}</span>`}<span></span></div>
          ${faixas.map((f, i) => `
            <div class="${cls}">
              ${inp(f, 'de', '0')}${inp(f, 'ate', 'vazio = acima')}
              ${porPeso ? inp(f, 'franquia', 'opcional') + inp(f, 'valorFranquia') : ''}${inp(f, 'valor')}
              <button type="button" class="tf-del-faixa" title="Remover faixa" onclick="tabDelFaixa('${k}',${i})">✕</button>
            </div>`).join('')}
          <button type="button" class="tf-add-faixa" onclick="tabAddFaixa('${k}')">+ faixa</button>
        </div>
        <div class="tf-dica">${porPeso
          ? 'Sem franquia: peso × R$/kg da faixa. Com franquia: até a franquia cobra o valor dela; acima, valor da franquia + (peso − franquia) × R$/kg excedente. Ex.: franquia 10 kg = R$ 200, excedente R$ 0,50 → 100 kg = 200 + 90 × 0,50 = R$ 245'
          : 'm³ × valor da faixa em que ele cair'}</div>`;
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
      </div>
    </div>`;
}

// Desenha um bloco de regra para cada item da composicao da tabela.
function tabRenderRegras() {
  document.getElementById('tf-regras').innerHTML = _tabComp.length
    ? _tabComp.map(tabBlocoRegra).join('')
    : '<div style="color:#64748b;font-size:.8rem">A tabela não tem itens na composição — marque-os na tela da tabela.</div>';
}

function tabAddFaixa(k) {
  tabColetarRegras();
  const r = _tabRegras[k] || (_tabRegras[k] = {});
  r.faixas = r.faixas || [];
  // Sugere o "de" logo depois do "ate" da ultima faixa (ex.: ate 1 -> de 1,01)
  // e repete a franquia da faixa anterior (geralmente e a mesma).
  const ult = r.faixas[r.faixas.length - 1];
  const de = ult && ult.ate !== null && ult.ate !== undefined ? Math.round((ult.ate + 0.01) * 100) / 100 : null;
  r.faixas.push({ de, ate: null, franquia: ult ? ult.franquia : null, valorFranquia: null, valor: null });
  tabRenderRegras();
}

function tabDelFaixa(k, i) {
  tabColetarRegras();
  const r = _tabRegras[k];
  if (r && r.faixas) r.faixas.splice(i, 1);
  tabRenderRegras();
}

// Regras so dos itens da composicao, sem faixas totalmente vazias.
function tabRegrasParaGravar(composicao) {
  const out = {};
  for (const k of composicao) {
    const r = { ...(_tabRegras[k] || {}) };
    if (r.faixas) {
      r.faixas = r.faixas.filter(f => Object.values(f).some(v => v !== null && v !== undefined))
        .map(f => ({ ...f, de: f.de ?? 0, ate: f.ate ?? null, valor: f.valor ?? 0 }))
        .sort((a, b) => a.de - b.de);
    }
    // Franquia no nivel do item so existe na regra por fracao (nas faixas de peso ela fica em cada faixa).
    if (TAB_TIPO[k] !== 'FRACAO') { delete r.franquia; delete r.valorFranquia; }
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

async function salvarTrecho() {
  if (!(await cadPodeEditar())) return;
  tabColetarRegras();
  const dados = {
    origemUf: document.getElementById('tr-ouf').value,
    origemCidade: freteNorm(document.getElementById('tr-ocid').value),
    destinoUf: document.getElementById('tr-duf').value,
    destinoCidade: freteNorm(document.getElementById('tr-dcid').value),
  };
  if (!dados.origemUf || !dados.destinoUf) { trMsg('Escolha a UF de origem e a de destino.', true); return; }
  try { await lerCidades(); } catch (e) { /* sem cadastro de cidades: nao valida */ }
  for (const [uf, cid, lado] of [[dados.origemUf, dados.origemCidade, 'origem'], [dados.destinoUf, dados.destinoCidade, 'destino']]) {
    if (cid && (_cidades || []).length && !cidadeExiste(uf, cid)) {
      trMsg(`Cidade de ${lado} "${cid}" não existe em ${uf} no Cadastro > Cidade (confira a grafia ou cadastre).`, true);
      return;
    }
  }
  const regras = tabRegrasParaGravar(_tabComp);
  const erro = tabValidarRegras(regras);
  if (erro) { trMsg(erro, true); return; }

  const btn = document.getElementById('tr-salvar');
  btn.disabled = true;
  trMsg('Salvando...', false);
  try {
    const lista = await lerTabelas();
    const t = lista.find(x => x.id === _tabEditando);
    if (!t) { trMsg('Tabela não encontrada (foi excluída?).', true); return; }
    t.trechos = t.trechos || [];
    const igual = t.trechos.some(x => x.id !== _trEditando && x.origemUf === dados.origemUf && x.destinoUf === dados.destinoUf &&
      freteNorm(x.origemCidade) === dados.origemCidade && freteNorm(x.destinoCidade) === dados.destinoCidade);
    if (igual) { trMsg('Já existe um trecho com essa origem e esse destino nesta tabela.', true); return; }
    const tr = { id: _trEditando || novoId(), ...dados, regras };
    t.trechos = _trEditando ? t.trechos.map(x => (x.id === tr.id ? tr : x)) : [...t.trechos, tr];
    t.atualizadoEm = new Date().toISOString();
    await gravarTabelas(lista);
    _tabelas = lista;
    await abrirTrechos(t.id, 'Trecho salvo.');
  } catch (e) {
    console.error(e);
    trMsg('Não foi possível salvar o trecho (verifique a conexão).', true);
  } finally {
    btn.disabled = false;
  }
}

async function excluirTrecho() {
  if (!(await cadPodeEditar()) || !_trEditando) return;
  if (!confirm('Excluir este trecho e as regras dele?')) return;
  try {
    const lista = await lerTabelas();
    const t = lista.find(x => x.id === _tabEditando);
    if (!t) return;
    t.trechos = (t.trechos || []).filter(x => x.id !== _trEditando);
    t.atualizadoEm = new Date().toISOString();
    await gravarTabelas(lista);
    _tabelas = lista;
    _trEditando = null;
    await abrirTrechos(t.id, 'Trecho excluído.');
  } catch (e) {
    console.error(e);
    trMsg('Não foi possível excluir o trecho (verifique a conexão).', true);
  }
}
