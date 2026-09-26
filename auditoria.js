// auditoria.js — aba Auditoria: recalcula cada minuta do Excel do portal
// (RAW.rows) pelas tabelas cadastradas (Cadastro > Tabela) e compara com o
// frete cobrado. Somente leitura. Aba visivel so para CAD_EDITORES.
//
// Por minuta: servico = coluna SERVICO do Excel (casada pelo nome com o
// Cadastro > Servico); data = emissao (vigencia); origem = CIDADE/UF ORIGEM;
// destino = local de entrega efetivo (EFF_CIDADE/EFF_UF, o mesmo do
// dashboard); peso = PESO CALC; cubagem = METRAGEM CUBICA; valor da
// mercadoria = NF VALOR; valor do CT-e (base do "% sobre CT-e") = FRETE TOTAL.

let _audTabelas = [];
let _audServicos = [];
let _audIcms = {};
let _audRes = [];          // resultado de todas as minutas
let _audFiltrado = [];
const AUD_LIMITE_TELA = 400;

// Colunas de taxa do Excel mostradas no detalhe da minuta.
const AUD_EXCEL_ITENS = [
  ['TX. COLETA', 'Coleta'], ['TX. ENTREGA', 'Entrega'], ['TX. FRETE PESO', 'Frete peso'],
  ['TX. GRIS', 'GRIS'], ['TX. PEDAGIO', 'Pedágio'], ['TX. DESPACHO', 'Despacho'],
  ['TX. NOTA', 'Taxa nota'], ['TX. OUTROS', 'Outros'], ['FRETE TAS', 'TAS'], ['FRETE TRT', 'TRT'],
  ['FRETE TDE', 'TDE'], ['FRETE SET/CAT', 'SET/CAT'], ['VALOR ICMS', 'ICMS'],
];

// O relatorio do portal nao traz a coluna do Advalorem: na Forte a diferenca
// entre o FRETE TOTAL e a soma das taxas e 0,25% da NF em ~97% das minutas.
function audNaoDetalhado(r) {
  const soma = AUD_EXCEL_ITENS.reduce((s, [c]) => s + (+r[c] || 0), 0);
  return Math.round(((+r['FRETE TOTAL'] || 0) - soma) * 100) / 100;
}

const AUD_STATUS = {
  OK: ['OK', '#16a34a'],
  DIVERGENTE: ['Divergente', '#dc2626'],
  SEM_TABELA: ['Sem tabela/trecho', '#b45309'],
  SEM_SERVICO: ['Serviço não cadastrado', '#64748b'],
};

async function carregarAuditoria() {
  const msg = document.getElementById('aud-msg');
  msg.textContent = 'Carregando tabelas...';
  try {
    [_audTabelas, _audServicos, _audIcms] = await Promise.all([lerTabelas(), lerServicos(), lerIcms()]);
  } catch (e) {
    console.error(e);
    msg.textContent = 'Não foi possível carregar as tabelas (verifique a conexão).';
    return;
  }
  msg.textContent = '';
  audMontarFiltros();
  audCalcularTudo();
  audAplicarFiltros();
}

function audMontarFiltros() {
  const rows = RAW.rows;
  const encher = (id, valores, rotuloTodos, fmt) => {
    const sel = document.getElementById(id);
    const atual = sel.value;
    sel.innerHTML = `<option value="">${rotuloTodos}</option>` +
      valores.map(v => `<option value="${cadEsc(v)}"${v === atual ? ' selected' : ''}>${cadEsc(fmt ? fmt(v) : v)}</option>`).join('');
  };
  encher('aud-f-mes', [...new Set(rows.map(r => r.MES))].sort().reverse(), 'Todos os meses', m => MES_NOMES[m] || m);
  encher('aud-f-servico', [...new Set(rows.map(r => r.SERVICO).filter(Boolean))].sort(), 'Todos os serviços');
  encher('aud-f-uf', [...new Set(rows.map(r => r.EFF_UF).filter(Boolean))].sort(), 'Todas as UFs');
}

function audCalcularTudo() {
  const srvPorNome = Object.fromEntries(_audServicos.map(s => [freteNorm(s.nome), s.id]));
  _audRes = RAW.rows.map(r => {
    const excel = +r['FRETE TOTAL'] || 0;
    const base = { r, excel, calc: null, dif: null, escolha: null, res: null };
    const servicoId = srvPorNome[freteNorm(r.SERVICO)];
    if (!servicoId) return { ...base, status: 'SEM_SERVICO' };
    const origem = { uf: r.ORIG_UF, cidade: r.ORIG_CIDADE };
    const destino = { uf: r.EFF_UF, cidade: r.EFF_CIDADE };
    const escolha = freteAcharTabela(_audTabelas, { servicoId, data: r['DATA EMISSAO'], origem, destino });
    if (!escolha) return { ...base, status: 'SEM_TABELA' };
    const res = freteCalcular(escolha.tabela, escolha.trecho, {
      peso: r.PESO_CALC, m3: r.M3, valorNF: r['NF VALOR'], valorCte: excel,
      ufOrigem: r.ORIG_UF, ufDestino: r.EFF_UF,
    }, _audIcms);
    const dif = Math.round((res.total - excel) * 100) / 100;
    return { ...base, calc: res.total, dif, escolha, res, status: 'CALCULADO' };
  });
}

function audTolerancia() {
  const t = freteNum(document.getElementById('aud-f-tol').value);
  return t === null ? 0.1 : Math.abs(t);
}

function audStatusFinal(x) {
  if (x.status !== 'CALCULADO') return x.status;
  return Math.abs(x.dif) <= audTolerancia() ? 'OK' : 'DIVERGENTE';
}

function audAplicarFiltros() {
  const v = id => document.getElementById(id).value;
  const mes = v('aud-f-mes'), srv = v('aud-f-servico'), uf = v('aud-f-uf'), st = v('aud-f-status');
  const busca = freteNorm(v('aud-f-busca'));
  const base = _audRes.filter(x => (!mes || x.r.MES === mes) && (!srv || x.r.SERVICO === srv) && (!uf || x.r.EFF_UF === uf) &&
    (!busca || freteNorm(`${x.r.MINUTA} ${x.r.CTE} ${x.r.NF_DOC} ${x.r.EFF_LOCAL} ${x.r.EFF_CIDADE}`).includes(busca)));
  base.forEach(x => { x.sf = audStatusFinal(x); });
  _audFiltrado = st ? base.filter(x => x.sf === st) : base;
  audRenderResumo(base);
  audRenderTabela();
}

function audRenderResumo(base) {
  const cont = k => base.filter(x => x.sf === k).length;
  const calc = base.filter(x => x.calc !== null);
  const somaExcel = calc.reduce((s, x) => s + x.excel, 0);
  const somaCalc = calc.reduce((s, x) => s + x.calc, 0);
  const card = (rot, val, cor, st) => `<div class="aud-card" ${st ? `onclick="audFiltrarStatus('${st}')" style="cursor:pointer"` : ''}>
      <div class="aud-card-rot">${rot}</div><div class="aud-card-val" style="color:${cor || 'var(--primary)'}">${val}</div></div>`;
  document.getElementById('aud-resumo').innerHTML =
    card('Minutas no filtro', base.length.toLocaleString('pt-BR')) +
    card('OK', cont('OK').toLocaleString('pt-BR'), AUD_STATUS.OK[1], 'OK') +
    card('Divergentes', cont('DIVERGENTE').toLocaleString('pt-BR'), AUD_STATUS.DIVERGENTE[1], 'DIVERGENTE') +
    card('Sem tabela/trecho', cont('SEM_TABELA').toLocaleString('pt-BR'), AUD_STATUS.SEM_TABELA[1], 'SEM_TABELA') +
    card('Serviço não cadastrado', cont('SEM_SERVICO').toLocaleString('pt-BR'), AUD_STATUS.SEM_SERVICO[1], 'SEM_SERVICO') +
    card('Excel × tabela (calculadas)', `R$ ${freteFmt(somaExcel)}<br><span style="font-size:.75rem">tabela R$ ${freteFmt(somaCalc)} · dif. R$ ${freteFmt(somaCalc - somaExcel)}</span>`);
}

function audFiltrarStatus(st) {
  const sel = document.getElementById('aud-f-status');
  sel.value = sel.value === st ? '' : st;
  audAplicarFiltros();
}

function audRenderTabela() {
  const lugar = (cid, uf) => cid ? `${cadEsc(cid)}/${uf}` : (uf || '—');
  const linhas = _audFiltrado.slice(0, AUD_LIMITE_TELA);
  document.getElementById('tb-auditoria').innerHTML = linhas.map((x, i) => {
    const r = x.r;
    const [rot, cor] = AUD_STATUS[x.sf];
    return `<tr style="cursor:pointer" onclick="audDetalhe(${i})">
      <td><b>${cadEsc(r.MINUTA)}</b><div style="font-size:.7rem;color:#64748b">CT-e ${cadEsc(r.CTE || '—')}</div></td>
      <td>${r['DATA EMISSAO'] ? tabFmtData(r['DATA EMISSAO']) : ''}</td>
      <td style="font-size:.74rem">${cadEsc(r.SERVICO || '—')}</td>
      <td>${lugar(r.ORIG_CIDADE, r.ORIG_UF)}</td>
      <td>${lugar(r.EFF_CIDADE, r.EFF_UF)}</td>
      <td style="text-align:right">R$ ${freteFmt(r['NF VALOR'])}</td>
      <td style="text-align:right">${freteFmtNum(r.PESO_CALC)}</td>
      <td style="text-align:right">${freteFmtNum(r.M3)}</td>
      <td style="text-align:right">R$ ${freteFmt(x.excel)}</td>
      <td style="text-align:right">${x.calc !== null ? 'R$ ' + freteFmt(x.calc) : '—'}</td>
      <td style="text-align:right;font-weight:700;color:${x.dif === null ? '#64748b' : Math.abs(x.dif) <= audTolerancia() ? '#16a34a' : '#dc2626'}">${x.dif !== null ? freteFmt(x.dif) : '—'}</td>
      <td><span class="aud-st" style="background:${cor}1a;color:${cor}">${rot}</span></td>
    </tr>
    <tr id="aud-det-${i}" style="display:none"><td colspan="12" class="aud-det"></td></tr>`;
  }).join('') || '<tr><td colspan="12" style="color:#64748b">Nenhuma minuta neste filtro.</td></tr>';
  document.getElementById('aud-rodape').textContent = _audFiltrado.length > AUD_LIMITE_TELA
    ? `Mostrando ${AUD_LIMITE_TELA} de ${_audFiltrado.length.toLocaleString('pt-BR')} minutas — use os filtros ou exporte para Excel para ver todas.`
    : `${_audFiltrado.length.toLocaleString('pt-BR')} minuta(s).`;
}

function audDetalhe(i) {
  const tr = document.getElementById('aud-det-' + i);
  if (tr.style.display !== 'none') { tr.style.display = 'none'; return; }
  const x = _audFiltrado[i];
  const r = x.r;
  const excelItens = AUD_EXCEL_ITENS.filter(([c]) => +r[c]).map(([c, rot]) =>
    `<tr><td>${rot}</td><td style="text-align:right">R$ ${freteFmt(r[c])}</td></tr>`).join('') + (() => {
      const nd = audNaoDetalhado(r);
      return Math.abs(nd) >= 0.01 ? `<tr><td>Não detalhado no relatório <span style="color:#64748b;font-size:.68rem">(provável Advalorem: ${freteFmtNum(Math.round(nd / (+r['NF VALOR'] || 1) * 100000) / 1000)}% da NF)</span></td><td style="text-align:right">R$ ${freteFmt(nd)}</td></tr>` : '';
    })();
  let calcHtml;
  if (x.res) {
    const t = x.escolha.tabela, trc = x.escolha.trecho;
    const lugar = (uf, cid) => cid ? `${cadEsc(cid)}/${uf}` : `${uf} (estado todo)`;
    calcHtml = `<div style="font-size:.74rem;color:#475569;margin-bottom:4px">Tabela <b>${cadEsc(t.nome)}</b> (vig. ${tabFmtData(t.vigencia)}) · trecho ${lugar(trc.origemUf, trc.origemCidade)} → ${lugar(trc.destinoUf, trc.destinoCidade)}</div>
      <table class="aud-mini">${x.res.itens.map(it => `<tr><td>${it.rotulo}<div style="font-size:.68rem;color:#64748b">${cadEsc(it.conta)}${it.obs.length ? ' · ' + it.obs.map(cadEsc).join(' · ') : ''}</div></td><td style="text-align:right">R$ ${freteFmt(it.valor)}</td></tr>`).join('')}
      ${x.res.icms ? `<tr><td>ICMS ${freteFmtNum(x.res.icms.aliquota)}%</td><td style="text-align:right">R$ ${freteFmt(x.res.icms.valor)}</td></tr>` : ''}
      <tr style="font-weight:800"><td>Total tabela</td><td style="text-align:right">R$ ${freteFmt(x.res.total)}</td></tr></table>
      ${x.res.avisos.length ? `<div class="sim-aviso">${x.res.avisos.map(cadEsc).join('<br>')}</div>` : ''}`;
  } else if (x.status === 'SEM_SERVICO') {
    calcHtml = `<div class="sim-aviso">O serviço "${cadEsc(r.SERVICO || '(vazio)')}" não está no Cadastro > Serviço.</div>`;
  } else {
    calcHtml = `<div class="sim-aviso">Nenhuma tabela do serviço ${cadEsc(r.SERVICO)} vigente em ${tabFmtData(r['DATA EMISSAO'])} tem trecho para ${cadEsc(r.ORIG_CIDADE)}/${r.ORIG_UF} → ${cadEsc(r.EFF_CIDADE)}/${r.EFF_UF}.</div>`;
  }
  tr.firstElementChild.innerHTML = `
    <div class="aud-det-grid">
      <div><div class="tf-lbl">Excel (portal) — tabela ${cadEsc(r.TABELA_PORTAL || '—')}</div>
        <table class="aud-mini">${excelItens || '<tr><td colspan="2" style="color:#64748b">Sem taxas detalhadas</td></tr>'}
        <tr style="font-weight:800"><td>Frete total</td><td style="text-align:right">R$ ${freteFmt(x.excel)}</td></tr></table>
        <div style="font-size:.7rem;color:#64748b;margin-top:4px">Destinatário: ${cadEsc(r.EFF_LOCAL || '—')} · NF ${cadEsc(r.NF_DOC)}</div></div>
      <div><div class="tf-lbl">Calculado pela tabela</div>${calcHtml}</div>
    </div>
    <button class="cad-btn" type="button" style="margin-top:8px;background:var(--primary-light)" onclick="audAbrirSimulador(${i})">🧮 Abrir no Simulador</button>`;
  tr.style.display = '';
}

// Leva os dados da minuta para o Simulador (para testar mexendo nos valores).
async function audAbrirSimulador(i) {
  const r = _audFiltrado[i].r;
  document.querySelector(".tabs .tab[onclick*=\"'simulador'\"]").click();
  await carregarSimulador();
  const srv = _simServicos.find(s => freteNorm(s.nome) === freteNorm(r.SERVICO));
  const set = (id, val) => { const el = document.getElementById(id); el.value = val; el.dispatchEvent(new Event('change')); };
  if (srv) set('sim-servico', srv.id);
  simAtualizarTabelas();
  set('sim-data', r['DATA EMISSAO']);
  await lerCidades().catch(() => {});
  _simOrig.definir(r.ORIG_UF, r.ORIG_CIDADE);
  _simDest.definir(r.EFF_UF, r.EFF_CIDADE);
  const br = n => String(n ?? '').replace('.', ',');
  set('sim-peso', br(r.PESO_CALC)); set('sim-m3', br(r.M3)); set('sim-nf', br(r['NF VALOR'])); set('sim-cte', br(r['FRETE TOTAL']));
  simular();
}

function audExportar() {
  const dados = _audFiltrado.map(x => {
    const r = x.r;
    return {
      Minuta: r.MINUTA, 'CT-e': r.CTE, Emissão: r['DATA EMISSAO'], Serviço: r.SERVICO, 'Tabela portal': r.TABELA_PORTAL,
      'Origem': r.ORIG_CIDADE, 'UF origem': r.ORIG_UF, 'Destino': r.EFF_CIDADE, 'UF destino': r.EFF_UF, Destinatário: r.EFF_LOCAL,
      'Valor mercadoria': r['NF VALOR'], 'Peso calc (kg)': r.PESO_CALC, 'Cubagem (m³)': r.M3,
      'Frete Excel': x.excel, 'Frete tabela': x.calc, Diferença: x.dif, Status: AUD_STATUS[x.sf][0],
      'Tabela usada': x.escolha ? x.escolha.tabela.nome : '',
      ...Object.fromEntries(AUD_EXCEL_ITENS.map(([c, rot]) => ['Excel ' + rot, +r[c] || 0])),
      'Excel não detalhado (provável Advalorem)': audNaoDetalhado(r),
      ...(x.res ? Object.fromEntries(x.res.itens.map(it => ['Tabela ' + it.rotulo, it.valor])) : {}),
      ...(x.res && x.res.icms ? { 'Tabela ICMS': x.res.icms.valor } : {}),
    };
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dados), 'Auditoria');
  XLSX.writeFile(wb, `auditoria_frete_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// A aba so aparece para quem pode editar os cadastros (PortoEx).
cadPodeEditar().then(ok => {
  const b = document.getElementById('tab-btn-auditoria');
  if (b) b.style.display = ok ? '' : 'none';
});
