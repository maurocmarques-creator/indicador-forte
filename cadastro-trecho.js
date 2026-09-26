// cadastro-trecho.js — Cadastro > Trecho: grupos de cidades com nome
// (ex.: "SC_Capital" = Itajai, Navegantes, Balneario Camboriu...).
//
// Um trecho cadastrado pode ser usado como origem ou destino nos trechos das
// tabelas (Cadastro > Tabela): a regra vale para qualquer cidade do grupo.
// Fica no Supabase da PortoEx (app_config, chave CAD_GRUPOS_KEY), generica:
//   [{ id, nome, cidades: [{uf, nome}], criadoEm, atualizadoEm }]
// Script classico: usa getDb(), cadPodeEditar(), cadEsc(), freteNorm(),
// novoId(), cidAutocomplete(), freteDefinirGrupos().

const CAD_GRUPOS_KEY = 'cadastro_trechos';
let _grupos = [];
let _grupoEditando = null;   // id do trecho aberto (null = novo)
let _grupoCidades = [];      // cidades em edicao

async function lerGrupos() {
  const db = getDb();
  if (!db) throw new Error('Supabase indisponível');
  const { data, error } = await db.from('app_config').select('value').eq('key', CAD_GRUPOS_KEY).maybeSingle();
  if (error) throw error;
  const lista = Array.isArray(data && data.value) ? data.value : [];
  freteDefinirGrupos(lista);
  return lista;
}

async function gravarGrupos(lista) {
  const { error } = await getDb().from('app_config')
    .upsert({ key: CAD_GRUPOS_KEY, value: lista, updated_at: new Date().toISOString() });
  if (error) throw error;
  freteDefinirGrupos(lista);
}

function grpMsg(txt, erro) {
  const el = document.getElementById('cad-grupo-msg');
  if (!el) return;
  el.textContent = txt;
  el.style.color = erro ? '#b91c1c' : '#64748b';
}

function grpVista(qual) {
  document.getElementById('cad-grupo-lista').style.display = qual === 'lista' ? '' : 'none';
  document.getElementById('cad-grupo-form').style.display = qual === 'form' ? '' : 'none';
}

// ---------- LISTA ----------

async function carregarGrupos() {
  grpVista('lista');
  grpMsg('Carregando...');
  try {
    const podeEditar = await cadPodeEditar();
    document.getElementById('cad-grupo-novo').style.display = podeEditar ? '' : 'none';
    _grupos = await lerGrupos();
    renderGrupos();
    grpMsg(_grupos.length ? '' : 'Nenhum trecho cadastrado ainda.');
  } catch (e) {
    console.error(e);
    grpMsg('Não foi possível carregar os trechos (verifique a conexão).', true);
  }
}

function renderGrupos() {
  const lista = [..._grupos].sort((a, b) => a.nome.localeCompare(b.nome));
  document.getElementById('tb-cad-grupo').innerHTML = lista.map(g => {
    const ufs = [...new Set(g.cidades.map(c => c.uf))].sort().join(', ');
    const amostra = g.cidades.slice(0, 6).map(c => cadEsc(c.nome)).join(', ') + (g.cidades.length > 6 ? '…' : '');
    return `<tr style="cursor:pointer" onclick="abrirGrupo('${g.id}')" title="Abrir trecho">
      <td><b>${cadEsc(g.nome)}</b></td>
      <td>${g.cidades.length}</td>
      <td>${ufs}</td>
      <td style="font-size:.76rem;color:#475569">${amostra}</td>
    </tr>`;
  }).join('');
}

// ---------- FORMULARIO ----------

function novoGrupo() {
  return abrirGrupo(null);
}

async function abrirGrupo(id) {
  const podeEditar = await cadPodeEditar();
  const g = id ? _grupos.find(x => x.id === id) : null;
  if (!g && !podeEditar) return;
  _grupoEditando = g ? g.id : null;
  _grupoCidades = g ? g.cidades.map(c => ({ ...c })) : [];
  grpVista('form');
  const f = document.getElementById('cad-grupo-form');
  f.innerHTML = `
    <h3 style="margin-bottom:12px">${g ? 'Trecho — ' + cadEsc(g.nome) : 'Novo trecho'}</h3>
    <label class="tf-lbl">Nome do trecho *</label>
    <input id="grp-nome" type="text" maxlength="80" value="${cadEsc(g ? g.nome : '')}" placeholder="ex.: SC_Capital"
      style="width:100%;max-width:420px;border:1px solid var(--border);border-radius:6px;padding:7px 10px;font-size:.85rem;margin-bottom:14px">
    <label class="tf-lbl">Cidades do trecho</label>
    <div class="grp-add">
      <div class="cid-ac" style="flex:1;min-width:260px"><input id="grp-cid-busca" type="text" autocomplete="off" placeholder="Digite a cidade para incluir..."><div class="cid-ac-lista" hidden></div>
        <select id="grp-cid-uf" hidden><option value="">UF</option>${FRETE_UFS.map(u => `<option>${u}</option>`).join('')}</select><input id="grp-cid-nome" type="hidden"></div>
    </div>
    <div class="tf-dica" style="margin:4px 0 6px">Escolha a cidade na lista e ela entra no trecho na hora — ou cole uma relação inteira:</div>
    <div class="grp-colar-acoes">
      <button class="cad-btn grp-so-editor" type="button" style="background:var(--primary-light);padding:5px 12px;font-size:.78rem" onclick="grpAbrirColar()">📋 Colar lista de cidades</button>
      <button class="cad-del grp-so-editor" type="button" onclick="grpLimparCidades()">Tirar todas</button>
    </div>
    <div id="grp-colar" class="grp-colar" hidden>
      <textarea id="grp-colar-txt" rows="7" placeholder="Cole aqui (do Excel, e-mail...). Aceita uma cidade por linha, 'Itajaí/SC', 'Itajaí - SC', 'Itajaí SC', duas colunas cidade | UF, ou várias separadas por vírgula."></textarea>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px">
        <label style="font-size:.76rem;color:#475569">UF quando a linha não trouxer
          <select id="grp-colar-uf"><option value="">— nenhuma —</option>${FRETE_UFS.map(u => `<option>${u}</option>`).join('')}</select></label>
        <button class="cad-btn" type="button" onclick="grpProcessarColagem()">Processar</button>
        <button class="cad-btn" type="button" style="background:#64748b" onclick="document.getElementById('grp-colar').hidden = true">Fechar</button>
      </div>
      <div id="grp-colar-res" style="font-size:.78rem;margin-top:8px"></div>
    </div>
    <div id="grp-cidades" class="grp-cidades"></div>
    <div id="grp-msg" style="font-size:.78rem;margin:10px 0 0;min-height:1em"></div>
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
      <button id="grp-salvar" class="cad-btn" type="button" onclick="salvarGrupo()">💾 Salvar trecho</button>
      <button class="cad-btn" type="button" style="background:#64748b" onclick="carregarGrupos()">Voltar</button>
      ${g ? '<button class="cad-del" type="button" style="margin-left:auto" onclick="excluirGrupo()">Excluir trecho</button>' : ''}
    </div>`;
  renderGrupoCidades(podeEditar);
  if (podeEditar) {
    try { await lerCidades(); } catch (e) { /* a busca avisa */ }
    const ac = cidAutocomplete('grp-cid-busca', 'grp-cid-uf', 'grp-cid-nome');
    // ao escolher uma cidade na lista, ja inclui no trecho e limpa a busca
    document.getElementById('grp-cid-nome').addEventListener('change', () => {
      const uf = document.getElementById('grp-cid-uf').value;
      const nome = document.getElementById('grp-cid-nome').value;
      if (!uf || !nome) return;
      if (!_grupoCidades.some(c => c.uf === uf && freteNorm(c.nome) === freteNorm(nome))) {
        _grupoCidades.push({ uf, nome });
        _grupoCidades.sort((a, b) => a.uf.localeCompare(b.uf) || a.nome.localeCompare(b.nome));
      }
      ac.definir('', '');
      const busca = document.getElementById('grp-cid-busca');
      busca.value = '';
      busca.classList.remove('cid-ok');
      busca.focus();
      renderGrupoCidades(true);
    });
  } else {
    f.querySelectorAll('input,select').forEach(el => { el.disabled = true; });
    f.querySelectorAll('#grp-salvar,.cad-del,.grp-so-editor').forEach(el => el.remove());
  }
}

function renderGrupoCidades(podeEditar) {
  const el = document.getElementById('grp-cidades');
  el.innerHTML = _grupoCidades.length
    ? _grupoCidades.map((c, i) => `<span class="grp-chip">${cadEsc(c.nome)}/${c.uf}${podeEditar ? ` <button type="button" title="Tirar do trecho" onclick="tirarCidadeGrupo(${i})">✕</button>` : ''}</span>`).join('')
    : '<span style="color:#64748b;font-size:.8rem">Nenhuma cidade ainda.</span>';
  const msg = document.getElementById('grp-msg');
  if (msg && !msg.dataset.fixo) { msg.textContent = `${_grupoCidades.length} cidade(s) no trecho.`; msg.style.color = '#64748b'; }
}

// ---------- COLAR LISTA ----------

function grpAbrirColar() {
  const box = document.getElementById('grp-colar');
  box.hidden = false;
  // UF padrao: a UF das cidades que ja estao no trecho, se forem todas da mesma
  const ufs = [...new Set(_grupoCidades.map(c => c.uf))];
  const sel = document.getElementById('grp-colar-uf');
  if (!sel.value && ufs.length === 1) sel.value = ufs[0];
  document.getElementById('grp-colar-txt').focus();
}

function grpLimparCidades() {
  if (!_grupoCidades.length || !confirm(`Tirar as ${_grupoCidades.length} cidade(s) deste trecho? (só vale depois de Salvar)`)) return;
  _grupoCidades = [];
  renderGrupoCidades(true);
}

// Acha a cidade no cadastro. Sem UF: usa a UF padrao; se nao houver, aceita
// so quando o nome e unico no Brasil. Retorna {cidade} | {erro, opcoes}.
function grpAcharCidade(nome, uf, ufPadrao) {
  const n = freteNorm(nome);
  const iguais = (_cidades || []).filter(c => freteNorm(c.nome) === n);
  if (uf) {
    const c = iguais.find(x => x.uf === uf);
    return c ? { cidade: c } : { erro: 'não encontrada' };
  }
  if (ufPadrao) {
    const c = iguais.find(x => x.uf === ufPadrao);
    if (c) return { cidade: c };
  }
  if (iguais.length === 1) return { cidade: iguais[0] };
  if (iguais.length > 1) return { erro: 'existe em mais de um estado', opcoes: iguais.map(x => x.uf) };
  return { erro: 'não encontrada' };
}

// Quebra o texto colado em pares {nome, uf}. Aceita linhas, colunas do Excel
// (tab), ";" e ","; uma parte que seja so uma UF vale para a cidade anterior;
// "Nome/UF", "Nome - UF" e "Nome UF" tambem.
function grpQuebrarColagem(txt) {
  const itens = [];
  for (const linha of txt.split(/\r?\n/)) {
    const partes = linha.split(/\t|;|,/).map(s => s.trim()).filter(Boolean);
    for (const parte of partes) {
      const soUf = freteNorm(parte);
      if (FRETE_UFS.includes(soUf) && soUf.length === 2) {
        if (itens.length && !itens[itens.length - 1].uf) itens[itens.length - 1].uf = soUf;
        continue;
      }
      if (/^(cidade|cidades|municipio|município|uf|estado)$/i.test(parte)) continue;   // cabecalho
      const m = parte.match(/^(.*?)\s*(?:\/|\s-\s|\s)\s*([A-Za-z]{2})$/);
      if (m && FRETE_UFS.includes(m[2].toUpperCase()) && m[1].trim()) {
        itens.push({ nome: m[1].trim(), uf: m[2].toUpperCase(), bruto: parte });
      } else {
        itens.push({ nome: parte.replace(/\s+/g, ' '), uf: '', bruto: parte });
      }
    }
  }
  return itens;
}

async function grpProcessarColagem() {
  const res = document.getElementById('grp-colar-res');
  const txt = document.getElementById('grp-colar-txt').value;
  if (!txt.trim()) { res.style.color = '#b91c1c'; res.textContent = 'Cole a relação de cidades na caixa.'; return; }
  try { await lerCidades(); } catch (e) { res.style.color = '#b91c1c'; res.textContent = 'Não foi possível carregar o cadastro de cidades.'; return; }
  const ufPadrao = document.getElementById('grp-colar-uf').value;
  let novas = 0, jaTinha = 0;
  const problemas = [];
  for (const it of grpQuebrarColagem(txt)) {
    // "Nome UF" pode ser nome composto (ex.: "Rio do Sul"): se nao achar com a UF, tenta o texto inteiro
    let r = grpAcharCidade(it.nome, it.uf, ufPadrao);
    if (r.erro && it.uf && it.bruto !== it.nome) {
      const r2 = grpAcharCidade(it.bruto, '', ufPadrao);
      if (r2.cidade) r = r2;
    }
    if (!r.cidade) { problemas.push(`${it.bruto} — ${r.erro}${r.opcoes ? ` (${r.opcoes.join(', ')}; informe a UF)` : ''}`); continue; }
    const c = r.cidade;
    if (_grupoCidades.some(x => x.uf === c.uf && freteNorm(x.nome) === freteNorm(c.nome))) { jaTinha++; continue; }
    _grupoCidades.push({ uf: c.uf, nome: c.nome });
    novas++;
  }
  _grupoCidades.sort((a, b) => a.uf.localeCompare(b.uf) || a.nome.localeCompare(b.nome));
  renderGrupoCidades(true);
  res.style.color = problemas.length ? '#b45309' : '#16a34a';
  res.innerHTML = `<b>${novas}</b> cidade(s) incluída(s)` + (jaTinha ? `, ${jaTinha} já estavam no trecho` : '') +
    (problemas.length ? `. <b>${problemas.length}</b> não entraram:<ul style="margin:4px 0 0 18px">${problemas.map(p => `<li>${cadEsc(p)}</li>`).join('')}</ul>` : '.') +
    `<div style="color:#64748b;margin-top:4px">Confira as cidades e clique em <b>Salvar trecho</b>.</div>`;
  if (!problemas.length) document.getElementById('grp-colar-txt').value = '';
  else document.getElementById('grp-colar-txt').value = problemas.map(p => p.split(' — ')[0]).join('\n');
}

function tirarCidadeGrupo(i) {
  _grupoCidades.splice(i, 1);
  renderGrupoCidades(true);
}

function grpFormMsg(txt, erro) {
  const el = document.getElementById('grp-msg');
  el.textContent = txt;
  el.style.color = erro ? '#b91c1c' : '#16a34a';
}

async function salvarGrupo() {
  if (!(await cadPodeEditar())) return;
  const nome = document.getElementById('grp-nome').value.trim();
  if (!nome) { grpFormMsg('Dê um nome ao trecho.', true); return; }
  if (!_grupoCidades.length) { grpFormMsg('Inclua pelo menos uma cidade.', true); return; }
  const btn = document.getElementById('grp-salvar');
  btn.disabled = true;
  try {
    const lista = await lerGrupos();
    if (lista.some(x => x.id !== _grupoEditando && freteNorm(x.nome) === freteNorm(nome))) {
      grpFormMsg('Já existe um trecho com esse nome.', true);
      return;
    }
    const agora = new Date().toISOString();
    const antigo = _grupoEditando ? lista.find(x => x.id === _grupoEditando) : null;
    const g = { id: antigo ? antigo.id : novoId(), nome, cidades: _grupoCidades, criadoEm: antigo ? antigo.criadoEm : agora, atualizadoEm: agora };
    const nova = antigo ? lista.map(x => (x.id === g.id ? g : x)) : [...lista, g];
    await gravarGrupos(nova);
    _grupos = nova;
    _grupoEditando = g.id;
    grpFormMsg(`Trecho "${nome}" salvo com ${g.cidades.length} cidade(s).`, false);
  } catch (e) {
    console.error(e);
    grpFormMsg('Não foi possível salvar (verifique a conexão).', true);
  } finally {
    btn.disabled = false;
  }
}

async function excluirGrupo() {
  if (!(await cadPodeEditar()) || !_grupoEditando) return;
  const g = _grupos.find(x => x.id === _grupoEditando);
  // nao deixa excluir trecho que alguma tabela usa
  let usos = [];
  try {
    usos = (await lerTabelas()).filter(t => (t.trechos || []).some(tr => tr.origemGrupoId === g.id || tr.destinoGrupoId === g.id)).map(t => t.nome);
  } catch (e) { /* segue */ }
  if (usos.length) { grpFormMsg(`Não dá para excluir: o trecho é usado na(s) tabela(s) ${usos.join(', ')}.`, true); return; }
  if (!g || !confirm(`Excluir o trecho "${g.nome}"?`)) return;
  try {
    const lista = (await lerGrupos()).filter(x => x.id !== g.id);
    await gravarGrupos(lista);
    _grupos = lista;
    _grupoEditando = null;
    await carregarGrupos();
    grpMsg(`Trecho "${g.nome}" excluído.`);
  } catch (e) {
    console.error(e);
    grpFormMsg('Não foi possível excluir (verifique a conexão).', true);
  }
}
