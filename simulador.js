// simulador.js — aba Simulador: testa as regras das tabelas (Cadastro >
// Tabela) com dados digitados a mao, usando o motor do frete-calculo.js.
// O calculo nao grava nada; "Salvar simulacao" guarda a entrada + resultado
// no Supabase (app_config, chave SIM_SALVAS_KEY), lista compartilhada:
//   [{ id, criadoEm (ISO), criadoPor (e-mail), descricao,
//      entrada: {servicoId, servicoNome, tabelaId (vazio = automatica), data, origem:{uf,cidade},
//                destino:{uf,cidade}, peso, m3, valorNF, valorCte},
//      resultado: {tabelaNome, vigencia, trecho, pesos, itens:[{rotulo, valor}], subtotal, icms, total} }]

let _simTabelas = [];
let _simServicos = [];
let _simIcms = {};
let _simLigado = false;
let _simOrig = null;
let _simDest = null;
let _simUltima = null;     // ultima simulacao calculada (o que "Salvar" grava)
let _simSalvas = [];
const SIM_SALVAS_KEY = 'simulacoes_frete';
const SIM_SALVAS_MAX = 2000;

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
  await cadPodeEditar();
  carregarSimSalvas();
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
  _simUltima = null;
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
  _simUltima = {
    entrada: {
      servicoId, servicoNome: (_simServicos.find(s => s.id === servicoId) || {}).nome || '',
      tabelaId: tabId || '', data: v('sim-data'), origem, destino,
      peso: entrada.peso, m3: entrada.m3, valorNF: entrada.valorNF, valorCte: entrada.valorCte,
    },
    resultado: {
      tabelaNome: t.nome, vigencia: t.vigencia,
      trecho: trechoTxt.replace(/<[^>]+>/g, ''), pesos: res.pesos,
      itens: res.itens.map(i => ({ rotulo: i.rotulo, valor: i.valor })),
      subtotal: res.subtotal, icms: res.icms ? { aliquota: res.icms.aliquota, valor: res.icms.valor } : null, total: res.total,
    },
  };

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
    ${avisos.length ? `<div class="sim-aviso">${avisos.map(cadEsc).join('<br>')}</div>` : ''}
    ${_cadPodeEditar ? `<div class="sim-salvar">
      <input id="sim-desc" type="text" maxlength="150" placeholder="Descrição da simulação (opcional)">
      <button class="cad-btn" type="button" onclick="salvarSimulacao()">💾 Salvar simulação</button>
      <span id="sim-salvar-msg" style="font-size:.78rem"></span>
    </div>` : ''}`;
}

// ---------- SIMULACOES SALVAS ----------

async function lerSimSalvas() {
  const db = getDb();
  if (!db) throw new Error('Supabase indisponível');
  const { data, error } = await db.from('app_config').select('value').eq('key', SIM_SALVAS_KEY).maybeSingle();
  if (error) throw error;
  return Array.isArray(data && data.value) ? data.value : [];
}

async function gravarSimSalvas(lista) {
  const { error } = await getDb().from('app_config')
    .upsert({ key: SIM_SALVAS_KEY, value: lista, updated_at: new Date().toISOString() });
  if (error) throw error;
}

async function carregarSimSalvas() {
  const msg = document.getElementById('sim-salvas-msg');
  try {
    _simSalvas = await lerSimSalvas();
    renderSimSalvas();
  } catch (e) {
    console.error(e);
    msg.textContent = 'Não foi possível carregar as simulações salvas.';
  }
}

async function salvarSimulacao() {
  if (!(await cadPodeEditar()) || !_simUltima) return;
  const msg = document.getElementById('sim-salvar-msg');
  msg.style.color = '#64748b';
  msg.textContent = 'Salvando...';
  try {
    const lista = await lerSimSalvas();   // rele antes de gravar para nao apagar a de outra pessoa
    const nova = {
      id: novoId(),
      criadoEm: new Date().toISOString(),
      criadoPor: _cadEmail || '',
      descricao: document.getElementById('sim-desc').value.trim(),
      ..._simUltima,
    };
    const final = [nova, ...lista].slice(0, SIM_SALVAS_MAX);
    await gravarSimSalvas(final);
    _simSalvas = final;
    renderSimSalvas();
    msg.style.color = '#16a34a';
    msg.textContent = 'Simulação salva.';
    document.getElementById('sim-desc').value = '';
  } catch (e) {
    console.error(e);
    msg.style.color = '#b91c1c';
    msg.textContent = 'Não foi possível salvar (verifique a conexão).';
  }
}

function simFmtDataHora(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function simSalvasFiltradas() {
  const busca = freteNorm(document.getElementById('sim-salvas-busca').value);
  if (!busca) return _simSalvas;
  return _simSalvas.filter(s => freteNorm([s.descricao, s.entrada.servicoNome, s.resultado.tabelaNome,
    s.entrada.origem.cidade, s.entrada.origem.uf, s.entrada.destino.cidade, s.entrada.destino.uf, s.criadoPor].join(' ')).includes(busca));
}

function renderSimSalvas() {
  const lista = simSalvasFiltradas();
  const lugar = p => `${cadEsc(p.cidade)}/${p.uf}`;
  document.getElementById('tb-sim-salvas').innerHTML = lista.map(s => `<tr>
      <td style="white-space:nowrap">${simFmtDataHora(s.criadoEm)}<div style="font-size:.68rem;color:#64748b">${cadEsc((s.criadoPor || '').split('@')[0])}</div></td>
      <td>${cadEsc(s.descricao || '—')}</td>
      <td style="font-size:.76rem">${cadEsc(s.entrada.servicoNome)}<div style="color:#64748b">${cadEsc(s.resultado.tabelaNome)}</div></td>
      <td>${lugar(s.entrada.origem)} → ${lugar(s.entrada.destino)}</td>
      <td style="text-align:right">${freteFmtNum(s.entrada.peso)}</td>
      <td style="text-align:right">${freteFmtNum(s.entrada.m3)}</td>
      <td style="text-align:right">${freteFmtNum(s.resultado.pesos ? s.resultado.pesos.considerado : s.entrada.peso)}</td>
      <td style="text-align:right">R$ ${freteFmt(s.entrada.valorNF)}</td>
      <td style="text-align:right;font-weight:700">R$ ${freteFmt(s.resultado.total)}</td>
      <td style="white-space:nowrap;text-align:right">
        <button class="cad-btn" type="button" style="padding:4px 10px;font-size:.74rem" onclick="abrirSimulacao('${s.id}')">Abrir</button>
        ${_cadPodeEditar ? `<button class="cad-del" type="button" onclick="excluirSimulacao('${s.id}')">Excluir</button>` : ''}
      </td>
    </tr>`).join('') || '<tr><td colspan="10" style="color:#64748b">Nenhuma simulação salva.</td></tr>';
  document.getElementById('sim-salvas-msg').textContent =
    `${lista.length.toLocaleString('pt-BR')} simulação(ões)${lista.length !== _simSalvas.length ? ` de ${_simSalvas.length.toLocaleString('pt-BR')}` : ''}.`;
}

// Recarrega a simulacao no formulario e recalcula com as tabelas de hoje.
async function abrirSimulacao(id) {
  const s = _simSalvas.find(x => x.id === id);
  if (!s) return;
  const e = s.entrada;
  const br = n => (n === null || n === undefined) ? '' : String(n).replace('.', ',');
  document.getElementById('sim-servico').value = e.servicoId;
  simAtualizarTabelas();
  document.getElementById('sim-tabela').value = _simTabelas.some(t => t.id === e.tabelaId) ? e.tabelaId : '';
  document.getElementById('sim-data').value = e.data || '';
  await lerCidades().catch(() => {});
  _simOrig.definir(e.origem.uf, e.origem.cidade);
  _simDest.definir(e.destino.uf, e.destino.cidade);
  document.getElementById('sim-peso').value = br(e.peso);
  document.getElementById('sim-m3').value = br(e.m3);
  document.getElementById('sim-nf').value = br(e.valorNF);
  document.getElementById('sim-cte').value = br(e.valorCte);
  simular();
  const box = document.getElementById('sim-resultado');
  const totalAgora = _simUltima ? _simUltima.resultado.total : null;
  if (totalAgora !== null && Math.abs(totalAgora - s.resultado.total) >= 0.01) {
    box.insertAdjacentHTML('afterbegin', `<div class="sim-aviso" style="margin:0 0 10px">Salva em ${simFmtDataHora(s.criadoEm)} com total R$ ${freteFmt(s.resultado.total)}. Com as tabelas de hoje o total é R$ ${freteFmt(totalAgora)} (a tabela mudou desde então).</div>`);
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function excluirSimulacao(id) {
  if (!(await cadPodeEditar())) return;
  const s = _simSalvas.find(x => x.id === id);
  if (!s || !confirm(`Excluir a simulação ${s.descricao ? '"' + s.descricao + '"' : 'de ' + simFmtDataHora(s.criadoEm)}?`)) return;
  try {
    const lista = (await lerSimSalvas()).filter(x => x.id !== id);
    await gravarSimSalvas(lista);
    _simSalvas = lista;
    renderSimSalvas();
  } catch (e) {
    console.error(e);
    document.getElementById('sim-salvas-msg').textContent = 'Não foi possível excluir (verifique a conexão).';
  }
}

function exportarSimSalvas() {
  const dados = simSalvasFiltradas().map(s => {
    const e = s.entrada, r = s.resultado;
    return {
      'Salva em': simFmtDataHora(s.criadoEm), 'Salva por': s.criadoPor || '', Descrição: s.descricao || '',
      Serviço: e.servicoNome, Tabela: r.tabelaNome, 'Vigência': r.vigencia, 'Data do frete': e.data, Trecho: r.trecho,
      Origem: `${e.origem.cidade}/${e.origem.uf}`, Destino: `${e.destino.cidade}/${e.destino.uf}`,
      'Peso real (kg)': e.peso, 'Cubagem (m³)': e.m3, 'Peso considerado (kg)': r.pesos ? r.pesos.considerado : e.peso,
      'Valor NF': e.valorNF, 'Valor CT-e informado': e.valorCte ?? '',
      ...Object.fromEntries((r.itens || []).map(i => [i.rotulo, i.valor])),
      'Subtotal': r.subtotal, 'ICMS': r.icms ? r.icms.valor : '', 'Total': r.total,
    };
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dados), 'Simulações');
  XLSX.writeFile(wb, `simulacoes_frete_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
