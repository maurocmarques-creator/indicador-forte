// cadastro-icms.js — Cadastro > ICMS: aliquota de ICMS (rodoviario) por
// UF de origem x UF de destino.
//
// Fica no Supabase da PortoEx (app_config, chave CAD_ICMS_KEY), generica
// para outros projetos lerem. Formato:
//   { aliquotas: { 'SC-SP': 12, 'SC-SC': 17, ... },  // chave 'ORIGEM-DESTINO', valor em %
//     atualizadoEm (ISO) }
// Usado pelo motor (frete-calculo.js) quando a tabela tem "Soma ICMS ao
// frete" = SIM: total = soma dos itens / (1 - aliquota/100).
// Script classico: usa getDb(), cadPodeEditar(), cadEsc(), freteNum(), FRETE_UFS.

const CAD_ICMS_KEY = 'cadastro_icms';
let _icms = {};          // aliquotas gravadas
let _icmsEdit = {};      // copia em edicao na tela

async function lerIcms() {
  const db = getDb();
  if (!db) throw new Error('Supabase indisponível');
  const { data, error } = await db.from('app_config').select('value').eq('key', CAD_ICMS_KEY).maybeSingle();
  if (error) throw error;
  return (data && data.value && data.value.aliquotas) || {};
}

async function gravarIcms(aliquotas) {
  const { error } = await getDb().from('app_config')
    .upsert({ key: CAD_ICMS_KEY, value: { aliquotas, atualizadoEm: new Date().toISOString() }, updated_at: new Date().toISOString() });
  if (error) throw error;
}

function icmsMsg(txt, erro) {
  const el = document.getElementById('cad-icms-msg');
  el.textContent = txt;
  el.style.color = erro ? '#b91c1c' : '#64748b';
}

async function carregarIcms() {
  icmsMsg('Carregando...');
  try {
    const podeEditar = await cadPodeEditar();
    document.getElementById('cad-icms-acoes').style.display = podeEditar ? 'flex' : 'none';
    _icms = await lerIcms();
    _icmsEdit = { ..._icms };
    renderIcms(podeEditar);
    const n = Object.keys(_icms).length;
    icmsMsg(n ? `${n} combinações cadastradas.` : 'Nenhuma alíquota cadastrada ainda — importe a planilha.');
  } catch (e) {
    console.error(e);
    icmsMsg('Não foi possível carregar as alíquotas (verifique a conexão).', true);
  }
}

// Matriz: linhas = UF origem, colunas = UF destino.
function renderIcms(podeEditar) {
  const cel = (o, d) => {
    const v = _icmsEdit[`${o}-${d}`];
    const txt = v === undefined || v === null ? '' : String(v).replace('.', ',');
    const cls = o === d ? ' icms-interna' : '';
    return podeEditar
      ? `<td class="${cls.trim()}"><input data-k="${o}-${d}" value="${txt}" inputmode="decimal" onchange="icmsAlterou(this)"></td>`
      : `<td class="${cls.trim()}">${txt}</td>`;
  };
  document.getElementById('cad-icms-matriz').innerHTML = `
    <table class="icms-tab">
      <thead><tr><th>Orig. ↓ / Dest. →</th>${FRETE_UFS.map(u => `<th>${u}</th>`).join('')}</tr></thead>
      <tbody>${FRETE_UFS.map(o => `<tr><th>${o}</th>${FRETE_UFS.map(d => cel(o, d)).join('')}</tr>`).join('')}</tbody>
    </table>`;
}

function icmsAlterou(inp) {
  const n = freteNum(inp.value);
  if (inp.value.trim() !== '' && (n === null || n < 0 || n >= 100)) {
    inp.style.background = '#fee2e2';
    return;
  }
  inp.style.background = '#fef9c3';
  if (n === null) delete _icmsEdit[inp.dataset.k];
  else _icmsEdit[inp.dataset.k] = n;
  icmsMsg('Alterações ainda não salvas — clique em Salvar.');
}

async function salvarIcms() {
  if (!(await cadPodeEditar())) return;
  if (document.querySelector('#cad-icms-matriz input[style*="fee2e2"]')) {
    icmsMsg('Há alíquotas inválidas (em vermelho). Use um número entre 0 e 99,99.', true);
    return;
  }
  icmsMsg('Salvando...');
  try {
    await gravarIcms(_icmsEdit);
    _icms = { ..._icmsEdit };
    renderIcms(true);
    icmsMsg(`Alíquotas salvas (${Object.keys(_icms).length} combinações).`);
  } catch (e) {
    console.error(e);
    icmsMsg('Não foi possível salvar (verifique a conexão).', true);
  }
}

// Importa uma planilha no formato do Brudam: colunas UF ORIGEM, UF DESTINO,
// ALIQUOTA (o nome so precisa conter essas palavras). Preenche a matriz;
// grava so quando clicar em Salvar.
async function importarIcms(input) {
  const arq = input.files && input.files[0];
  input.value = '';
  if (!arq) return;
  try {
    const wb = XLSX.read(await arq.arrayBuffer(), { type: 'array' });
    const linhas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false });
    const cab = (linhas[0] || []).map(c => freteNorm(c));
    const iO = cab.findIndex(c => c.includes('ORIGEM'));
    const iD = cab.findIndex(c => c.includes('DESTINO'));
    const iA = cab.findIndex(c => c.includes('ALIQ'));
    if (iO < 0 || iD < 0 || iA < 0) {
      icmsMsg('Planilha sem as colunas UF ORIGEM, UF DESTINO e ALIQUOTA.', true);
      return;
    }
    const novo = {};
    let ignoradas = 0;
    for (const l of linhas.slice(1)) {
      const o = freteNorm(l[iO]), d = freteNorm(l[iD]), a = freteNum(l[iA]);
      if (FRETE_UFS.includes(o) && FRETE_UFS.includes(d) && a !== null) novo[`${o}-${d}`] = a;
      else if (l.some(x => x !== undefined && x !== '')) ignoradas++;
    }
    _icmsEdit = { ..._icmsEdit, ...novo };
    renderIcms(true);
    icmsMsg(`${Object.keys(novo).length} alíquotas lidas de "${arq.name}"${ignoradas ? ` (${ignoradas} linhas ignoradas)` : ''} — confira e clique em Salvar.`);
  } catch (e) {
    console.error(e);
    icmsMsg('Não foi possível ler a planilha.', true);
  }
}
