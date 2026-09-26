// simulador.js — aba Simulador: testa as regras das tabelas (Cadastro >
// Tabela) com dados digitados a mao, usando o motor do frete-calculo.js.
// Somente leitura: nao grava nada.

let _simTabelas = [];
let _simServicos = [];
let _simIcms = {};
let _simLigado = false;
let _simOrig = null;
let _simDest = null;

async function carregarSimulador() {
  const el = document.getElementById('sim-msg');
  el.textContent = 'Carregando tabelas...';
  try {
    [_simTabelas, _simServicos, _simIcms] = await Promise.all([lerTabelas(), lerServicos(), lerIcms()]);
    el.textContent = _simTabelas.length ? '' : 'Nenhuma tabela cadastrada ainda (Cadastro ▾ > Tabela).';
  } catch (e) {
    console.error(e);
    el.textContent = 'Não foi possível carregar as tabelas (verifique a conexão).';
    return;
  }
  const srv = document.getElementById('sim-servico');
  const atual = srv.value;
  srv.innerHTML = '<option value="">— selecione —</option>' +
    _simServicos.map(s => `<option value="${s.id}"${s.id === atual ? ' selected' : ''}>${cadEsc(s.nome)}</option>`).join('');
  const ufOpts = '<option value="">UF</option>' + FRETE_UFS.map(u => `<option>${u}</option>`).join('');
  ['sim-ouf', 'sim-duf'].forEach(id => {
    const s = document.getElementById(id);
    if (!s.options.length) s.innerHTML = ufOpts;
  });
  const data = document.getElementById('sim-data');
  if (!data.value) data.value = new Date().toISOString().slice(0, 10);
  if (!_simLigado) {
    _simLigado = true;
    _simOrig = cidAutocomplete('sim-orig', 'sim-ouf', 'sim-ocid');
    _simDest = cidAutocomplete('sim-dest', 'sim-duf', 'sim-dcid');
  }
  simAtualizarTabelas();
}

// Lista de tabelas do servico escolhido (para escolher uma na mao).
function simAtualizarTabelas() {
  const srvId = document.getElementById('sim-servico').value;
  const sel = document.getElementById('sim-tabela');
  const atual = sel.value;
  const doServico = _simTabelas.filter(t => t.servicoId === srvId)
    .sort((a, b) => (b.vigencia || '').localeCompare(a.vigencia || ''));
  sel.innerHTML = '<option value="">Automática (vigência + trecho)</option>' +
    doServico.map(t => `<option value="${t.id}"${t.id === atual ? ' selected' : ''}>${cadEsc(t.nome)} — ${tabFmtData(t.vigencia)}</option>`).join('');
}

function simerro(txt) {
  document.getElementById('sim-resultado').innerHTML = `<div class="sim-aviso">${cadEsc(txt)}</div>`;
}

function simPesosTxt(p) {
  if (!p.fator) return `Peso considerado: <b>${freteFmtNum(p.considerado)} kg</b> (peso real; a tabela não tem fator de cubagem)`;
  return `Peso real ${freteFmtNum(p.real)} kg · peso cubado ${freteFmtNum(p.m3)} m³ × ${freteFmtNum(p.fator)} kg/m³ = ${freteFmtNum(p.cubado)} kg · ` +
    `peso considerado: <b>${freteFmtNum(p.considerado)} kg</b> (${p.cubado > p.real ? 'cubado' : 'real'})`;
}

function simular() {
  const v = id => document.getElementById(id).value;
  const servicoId = v('sim-servico');
  const origem = { uf: v('sim-ouf'), cidade: v('sim-ocid') };
  const destino = { uf: v('sim-duf'), cidade: v('sim-dcid') };
  const entrada = {
    peso: freteNum(v('sim-peso')) || 0,
    m3: freteNum(v('sim-m3')) || 0,
    valorNF: freteNum(v('sim-nf')) || 0,
    valorCte: freteNum(v('sim-cte')),
    ufOrigem: v('sim-ouf'),
    ufDestino: v('sim-duf'),
  };
  if (!servicoId) return simerro('Escolha o serviço.');
  if (!origem.uf || !origem.cidade) return simerro('Escolha a cidade de origem na lista (digite parte do nome e clique na sugestão).');
  if (!destino.uf || !destino.cidade) return simerro('Escolha a cidade de destino na lista (digite parte do nome e clique na sugestão).');

  let escolha;
  const tabId = v('sim-tabela');
  if (tabId) {
    const t = _simTabelas.find(x => x.id === tabId);
    const m = freteMelhorTrecho(t, origem, destino);
    if (!m) return simerro(`A tabela "${t.nome}" não tem trecho para essa origem e esse destino — as regras ficam no trecho.`);
    escolha = { tabela: t, trecho: m.trecho, manual: true };
  } else {
    escolha = freteAcharTabela(_simTabelas, { servicoId, data: v('sim-data'), origem, destino });
    if (!escolha) {
      return simerro('Nenhuma tabela deste serviço, vigente na data, tem um trecho que case com essa origem e esse destino.');
    }
  }

  const t = escolha.tabela;
  const res = freteCalcular(t, escolha.trecho, entrada, _simIcms);
  const dec = Number.isInteger(t.precisao) ? t.precisao : 2;
  const lugar = (uf, cid) => cid ? `${cadEsc(cid)}/${uf}` : `${uf} (estado todo)`;
  const trechoTxt = `${lugar(escolha.trecho.origemUf, escolha.trecho.origemCidade)} → ${lugar(escolha.trecho.destinoUf, escolha.trecho.destinoCidade)}`;

  const avisos = [...res.avisos];

  document.getElementById('sim-resultado').innerHTML = `
    <div class="sim-cab">
      <div><b>${cadEsc(t.nome)}</b> · vigência ${tabFmtData(t.vigencia)} ${escolha.manual ? '(escolhida na mão)' : '(automática)'}</div>
      <div>Trecho: ${trechoTxt}</div>
      <div>${simPesosTxt(res.pesos)}</div>
    </div>
    <table>
      <thead><tr><th>Item</th><th>Cálculo</th><th style="width:130px;text-align:right">Valor</th></tr></thead>
      <tbody>
        ${res.itens.map(i => `<tr>
          <td><b>${i.rotulo}</b></td>
          <td style="font-size:.78rem">${cadEsc(i.conta)}${i.obs.length ? `<div style="color:#b45309">${i.obs.map(cadEsc).join('<br>')}</div>` : ''}</td>
          <td style="text-align:right">R$ ${freteFmt(i.valor, dec)}</td>
        </tr>`).join('') || '<tr><td colspan="3" style="color:#64748b">A tabela não tem itens na composição.</td></tr>'}
        ${t.somaIcms ? `<tr class="sim-sub"><td colspan="2">Subtotal (sem ICMS)</td><td style="text-align:right">R$ ${freteFmt(res.subtotal, dec)}</td></tr>` : ''}
        ${res.icms ? `<tr><td><b>ICMS ${freteFmtNum(res.icms.aliquota)}%</b></td><td style="font-size:.78rem">${cadEsc(res.icms.conta)}</td><td style="text-align:right">R$ ${freteFmt(res.icms.valor, dec)}</td></tr>` : ''}
        <tr class="sim-total"><td colspan="2">Total do frete${res.icms ? ' (com ICMS)' : ''}</td><td style="text-align:right">R$ ${freteFmt(res.total, dec)}</td></tr>
      </tbody>
    </table>
    ${avisos.length ? `<div class="sim-aviso">${avisos.map(cadEsc).join('<br>')}</div>` : ''}`;
}
