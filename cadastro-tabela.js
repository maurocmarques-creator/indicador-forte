// cadastro-tabela.js — Cadastro > Tabela (tabelas de frete)
//
// Script classico carregado depois do script principal do index.html: usa
// getDb(), cadPodeEditar() e cadEsc() de la.
//
// As tabelas ficam no Supabase da PortoEx (tabela app_config, chave
// CAD_TABELAS_KEY) com uma chave generica de proposito: a ideia e outros
// projetos (ex.: Calculadora de Frete) lerem as mesmas tabelas. Formato:
//   [{ id, nome, referencia, tipo: 'VENDA'|'COMPRA', vigencia: 'AAAA-MM-DD',
//      somaIcms, descontoIcmsFretePeso, permiteDesconto, permiteAcrescimo,
//      negociaTarifa (booleans), precisao (2..5),
//      composicao: ['FRETE_COLETA', ...],   // itens marcados (TAB_COMPOSICAO)
//      regras: { FRETE_COLETA: {...}, ... }, // regras de cada item (a definir)
//      criadoEm, atualizadoEm (ISO) }, ...]

const CAD_TABELAS_KEY = 'cadastro_tabelas';

// Itens da composicao — a chave e o que fica gravado; nao renomear chaves
// ja usadas (so o rotulo pode mudar).
const TAB_COMPOSICAO = [
  ['FRETE_COLETA', 'Frete Coleta'],
  ['FRETE_ENTREGA', 'Frete Entrega'],
  ['PERCENTUAL_NF', 'Percentual sobre NF'],
  ['ADVALOREM', 'Advalorem'],
  ['GRIS', 'GRIS'],
  ['DESPACHO', 'Despacho'],
  ['REDESPACHO', 'Redespacho'],
  ['FAIXAS_PESO', 'Faixas de peso'],
  ['KM_RODADO', 'KM rodado'],
  ['PEDAGIO', 'Pedágio'],
  ['PERCENTUAL_CTE', 'Percentual sobre CTE'],
  ['VOLUME', 'Volume'],
  ['PEDAGIO_FRACAO', 'Pedágio por Fração'],
  ['TAXA_EMERGENCIA', 'Taxa de emergência'],
  ['TAXA_TRT', 'Taxa TRT'],
  ['TAXA_TAS', 'Taxa TAS'],
  ['PESO_FRACAO', 'Peso por Fração'],
  ['TAXA_TDE', 'Taxa TDE'],
  ['TAXA_SET_CAT', 'Taxa SET/CAT'],
  ['PERCENTUAL_CUSTOS', 'Percentual Sobre Custos'],
  ['TAXA_NF', 'Taxa por NF'],
  ['TAXA_M3', 'Taxa por m³'],
];
const TAB_ROTULO = Object.fromEntries(TAB_COMPOSICAO);

// Opcoes SIM/NAO do cabecalho: [campo, rotulo, padrao]
const TAB_SIMNAO = [
  ['somaIcms', 'Soma imposto (ICMS) ao frete', false],
  ['descontoIcmsFretePeso', 'Aplica desconto de ICMS sobre Frete Peso', false],
  ['permiteDesconto', 'Permite desconto', true],
  ['permiteAcrescimo', 'Permite acréscimo', true],
  ['negociaTarifa', 'Negocia tarifa', false],
];

let _tabelas = [];
let _tabEditando = null; // id da tabela aberta no formulario (null = nova)

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

// ---------- LISTA ----------

async function carregarTabelas() {
  tabMostrarLista();
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
      <td>${tabFmtData(t.vigencia)}</td>
      <td>${t.tipo === 'COMPRA' ? 'Compra' : 'Venda'}</td>
      <td style="color:#64748b;font-size:.78rem">${(t.composicao || []).length} itens</td>
    </tr>`).join('');
}

function tabMostrarLista() {
  document.getElementById('cad-tabela-lista').style.display = '';
  document.getElementById('cad-tabela-form').style.display = 'none';
}

// ---------- FORMULARIO ----------

function novaTabela() {
  abrirTabela(null);
}

async function abrirTabela(id) {
  const podeEditar = await cadPodeEditar();
  const t = id ? _tabelas.find(x => x.id === id) : null;
  if (!t && !podeEditar) return;
  _tabEditando = t ? t.id : null;

  const f = document.getElementById('cad-tabela-form');
  document.getElementById('cad-tabela-lista').style.display = 'none';
  f.style.display = '';

  const v = t || {
    nome: '', referencia: '', tipo: 'VENDA', vigencia: '', precisao: 2, composicao: [], regras: {},
    ...Object.fromEntries(TAB_SIMNAO.map(([k, , pad]) => [k, pad])),
  };
  const simNao = (campo, valor) => `
    <select id="tf-${campo}">
      <option value="1"${valor ? ' selected' : ''}>SIM</option>
      <option value="0"${valor ? '' : ' selected'}>NÃO</option>
    </select>`;

  f.innerHTML = `
    <h3 style="margin-bottom:14px">${t ? 'Tabela — ' + cadEsc(t.nome) : 'Cadastrar nova tabela'}</h3>
    <div class="tf-grid">
      <div class="tf-col">
        <label class="tf-lbl">Nome *</label>
        <input id="tf-nome" type="text" maxlength="120" value="${cadEsc(v.nome)}">
        <label class="tf-lbl">Referência</label>
        <input id="tf-referencia" type="text" maxlength="120" value="${cadEsc(v.referencia || '')}">
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
    <div class="tf-lbl" style="margin-top:18px">Regras da tabela</div>
    <div id="tf-regras" class="tf-regras"></div>
    <div id="tf-msg" style="font-size:.78rem;margin:10px 0 0;min-height:1em"></div>
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
      <button id="tf-salvar" class="cad-btn" type="button" onclick="salvarTabela()">💾 Salvar</button>
      <button class="cad-btn" type="button" style="background:#64748b" onclick="carregarTabelas()">Voltar</button>
      ${t ? '<button class="cad-del" type="button" style="margin-left:auto" onclick="excluirTabela()">Excluir tabela</button>' : ''}
    </div>`;

  // Somente leitura para quem nao e editor
  if (!podeEditar) {
    f.querySelectorAll('input,select').forEach(el => { el.disabled = true; });
    f.querySelector('#tf-salvar').remove();
    const del = f.querySelector('.cad-del');
    if (del) del.remove();
  }
  tabRenderRegras();
}

function tabComposicaoMarcada() {
  return [...document.querySelectorAll('#cad-tabela-form .tf-comp input:checked')].map(i => i.value);
}

// Mostra so os itens marcados na composicao. As regras de cada item serao
// definidas depois — por enquanto cada item aparece como um bloco vazio.
function tabRenderRegras() {
  const marcados = tabComposicaoMarcada();
  const el = document.getElementById('tf-regras');
  el.innerHTML = marcados.length
    ? marcados.map(k => `
        <div class="tf-regra">
          <div class="tf-regra-tit">${TAB_ROTULO[k]}</div>
          <div class="tf-regra-vazia">Regras deste item a definir</div>
        </div>`).join('')
    : '<div style="color:#64748b;font-size:.8rem">Marque ao lado os itens da composição — só eles aparecem aqui.</div>';
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
  const nome = nomeEl.value.trim();
  const vigencia = vigEl.value;
  nomeEl.style.borderColor = nome ? '' : '#ef4444';
  vigEl.style.borderColor = vigencia ? '' : '#ef4444';
  if (!nome || !vigencia) { tfMsg('Preencha o nome e a vigência.', true); return; }

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
    const tab = {
      ...(antiga || {}),
      id: antiga ? antiga.id : Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      nome,
      referencia: document.getElementById('tf-referencia').value.trim(),
      tipo: document.getElementById('tf-tipo').value,
      vigencia,
      precisao: +document.getElementById('tf-precisao').value,
      ...Object.fromEntries(TAB_SIMNAO.map(([k]) => [k, document.getElementById('tf-' + k).value === '1'])),
      composicao: tabComposicaoMarcada(),
      regras: (antiga && antiga.regras) || {},
      criadoEm: antiga ? antiga.criadoEm : agora,
      atualizadoEm: agora,
    };
    const nova = antiga ? lista.map(x => (x.id === tab.id ? tab : x)) : [...lista, tab];
    await gravarTabelas(nova);
    _tabelas = nova;
    _tabEditando = tab.id;
    tfMsg(`Tabela "${nome}" salva.`, false);
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
