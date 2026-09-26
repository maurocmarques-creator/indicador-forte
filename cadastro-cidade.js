// cadastro-cidade.js — Cadastro > Cidade: cidades do Brasil por UF.
//
// Fica no Supabase da PortoEx (app_config, chave CAD_CIDADES_KEY), generica
// para outros projetos lerem. Formato: [{ ibge: '4208203', nome: 'Itajaí', uf: 'SC' }, ...]
// Carregado em 25/09/2026 com os 5.571 municipios do IBGE
// (servicodados.ibge.gov.br/api/v1/localidades/municipios); da para incluir/excluir.
// Tambem alimenta as sugestoes de cidade nos trechos e no Simulador.
// Script classico: usa getDb(), cadPodeEditar(), cadEsc(), freteNorm(), FRETE_UFS.

const CAD_CIDADES_KEY = 'cadastro_cidades';
const CID_LIMITE_TELA = 300;
let _cidades = null;   // cache (lista grande: le uma vez por carregamento)

async function lerCidades(forcar) {
  if (_cidades && !forcar) return _cidades;
  const db = getDb();
  if (!db) throw new Error('Supabase indisponível');
  const { data, error } = await db.from('app_config').select('value').eq('key', CAD_CIDADES_KEY).maybeSingle();
  if (error) throw error;
  _cidades = Array.isArray(data && data.value) ? data.value : [];
  return _cidades;
}

async function gravarCidades(lista) {
  const { error } = await getDb().from('app_config')
    .upsert({ key: CAD_CIDADES_KEY, value: lista, updated_at: new Date().toISOString() });
  if (error) throw error;
  _cidades = lista;
}

// Cidades de uma UF (para sugestao em campos de cidade). Usa o cache; se
// ainda nao carregou, devolve [] e carrega em segundo plano.
function cidadesDaUf(uf) {
  if (!_cidades) { lerCidades().catch(() => {}); return []; }
  return _cidades.filter(c => c.uf === uf).map(c => c.nome);
}

// Existe essa cidade na UF? (comparacao sem acento/maiuscula)
function cidadeExiste(uf, nome) {
  const n = freteNorm(nome);
  return (_cidades || []).some(c => c.uf === uf && freteNorm(c.nome) === n);
}

// Liga um <select> de UF a um <datalist> de cidades: ao trocar a UF,
// as sugestoes passam a ser as cidades daquela UF.
function cidLigarUf(selectId, datalistId) {
  const sel = document.getElementById(selectId);
  const dl = document.getElementById(datalistId);
  if (!sel || !dl) return;
  const encher = () => { dl.innerHTML = cidadesDaUf(sel.value).map(n => `<option value="${cadEsc(n)}">`).join(''); };
  sel.addEventListener('change', encher);
  lerCidades().then(encher).catch(() => {});
}

// ---------- BUSCA DE CIDADE (autocomplete Cidade/UF) ----------

// Liga um campo de texto a uma lista de sugestoes Cidade/UF do cadastro.
// So vale o que for escolhido na lista: ao escolher, grava a UF no <select>
// ufId e o nome no campo cidId (hidden) e dispara 'change' neles; se o
// texto for mexido depois, os dois sao limpos (evita cidade/UF errada).
const CID_UF_NOMES = {
  AC: 'Acre', AL: 'Alagoas', AM: 'Amazonas', AP: 'Amapá', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal',
  ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MG: 'Minas Gerais', MS: 'Mato Grosso do Sul',
  MT: 'Mato Grosso', PA: 'Pará', PB: 'Paraíba', PE: 'Pernambuco', PI: 'Piauí', PR: 'Paraná',
  RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RO: 'Rondônia', RR: 'Roraima', RS: 'Rio Grande do Sul',
  SC: 'Santa Catarina', SE: 'Sergipe', SP: 'São Paulo', TO: 'Tocantins',
};

// opts.estadoTodo: a lista tambem oferece "UF — estado todo" (cidade vazia),
// usado nos trechos das tabelas.
// opts.grupoId: id de um <input hidden>; a lista tambem oferece os trechos
// cadastrados (Cadastro > Trecho) e grava o id escolhido nele.
function cidAutocomplete(inputId, ufId, cidId, opts = {}) {
  const inp = document.getElementById(inputId);
  const lista = inp.parentElement.querySelector('.cid-ac-lista');
  const ufEl = document.getElementById(ufId);
  const cidEl = document.getElementById(cidId);
  const grpEl = opts.grupoId ? document.getElementById(opts.grupoId) : null;
  let itens = [];
  let ativo = -1;

  const fechar = () => { lista.hidden = true; ativo = -1; };
  const marcarAtivo = () => lista.querySelectorAll('.cid-ac-item').forEach((el, i) => el.classList.toggle('ativo', i === ativo));

  function escolher(c) {
    if (grpEl) grpEl.value = c.grupo ? c.id : '';
    if (c.grupo) {
      ufEl.value = '';
      cidEl.value = '';
      inp.value = `Trecho ${c.nome}`;
      inp.classList.add('cid-ok');
      grpEl.dispatchEvent(new Event('change'));
      fechar();
      return;
    }
    ufEl.value = c.uf;
    cidEl.value = c.estado ? '' : c.nome;
    inp.value = c.estado ? `${c.uf} — estado todo` : `${c.nome}/${c.uf}`;
    inp.classList.add('cid-ok');
    ufEl.dispatchEvent(new Event('change'));
    cidEl.dispatchEvent(new Event('change'));
    fechar();
  }

  function buscar() {
    ufEl.value = '';
    cidEl.value = '';
    if (grpEl) grpEl.value = '';
    inp.classList.remove('cid-ok');
    // aceita "itajai", "itajai sc" ou "itajai/sc"
    const txt = freteNorm(inp.value).replace('/', ' ');
    if (txt.length < 2) { fechar(); return; }
    const m = txt.match(/^(.*?)[\s]+([A-Z]{2})$/);
    const nomeBusca = m && FRETE_UFS.includes(m[2]) ? m[1].trim() : txt;
    const ufBusca = m && FRETE_UFS.includes(m[2]) ? m[2] : '';
    const todas = (_cidades || []).filter(c => !ufBusca || c.uf === ufBusca);
    const comeca = [], contem = [];
    for (const c of todas) {
      const n = freteNorm(c.nome);
      if (n.startsWith(nomeBusca)) comeca.push(c);
      else if (n.includes(nomeBusca)) contem.push(c);
    }
    // nome exato primeiro, depois os mais curtos (ex.: "campinas" -> Campinas/SP antes de Campinas do Piaui)
    const ordem = (a, b) => (freteNorm(b.nome) === nomeBusca) - (freteNorm(a.nome) === nomeBusca) ||
      a.nome.length - b.nome.length || a.nome.localeCompare(b.nome);
    itens = comeca.sort(ordem).concat(contem.sort(ordem)).slice(0, 15);
    if (opts.estadoTodo) {
      // "sp", "sao paulo", "santa cat"... -> oferece o estado inteiro no topo
      const estados = FRETE_UFS.filter(u => u === txt ||
        (txt.length >= 3 && freteNorm(CID_UF_NOMES[u]).startsWith(nomeBusca) && (!ufBusca || u === ufBusca)))
        .map(u => ({ uf: u, nome: CID_UF_NOMES[u], estado: true }));
      // cidade com o nome exato digitado vem antes do estado (ex.: "sao paulo sp" -> cidade, depois estado)
      const exatas = itens.filter(c => freteNorm(c.nome) === nomeBusca);
      itens = exatas.concat(estados, itens.filter(c => !exatas.includes(c))).slice(0, 15);
    }
    if (grpEl) {
      const grupos = (_freteGruposLista || []).filter(g => freteNorm(g.nome).includes(txt) || freteNorm(g.nome).includes(nomeBusca))
        .map(g => ({ grupo: true, id: g.id, nome: g.nome, n: g.cidades.length }));
      // ordem: cidade de nome exato e estado primeiro, depois os trechos cadastrados, depois as demais cidades
      const k = itens.findIndex(c => !(c.estado || freteNorm(c.nome) === nomeBusca));
      const pos = k < 0 ? itens.length : k;
      itens = itens.slice(0, pos).concat(grupos, itens.slice(pos)).slice(0, 15);
    }
    ativo = itens.length ? 0 : -1;
    lista.innerHTML = itens.length
      ? itens.map((c, i) => c.grupo
          ? `<div class="cid-ac-item" data-i="${i}"><span><b>Trecho</b> · ${cadEsc(c.nome)}</span><span class="uf">${c.n} cidade(s)</span></div>`
          : c.estado
          ? `<div class="cid-ac-item" data-i="${i}"><span><b>Estado todo</b> · ${cadEsc(c.nome)}</span><span class="uf">${c.uf}</span></div>`
          : `<div class="cid-ac-item" data-i="${i}"><b>${cadEsc(c.nome)}</b><span class="uf">${c.uf}</span></div>`).join('')
      : `<div class="cid-ac-vazio">${_cidades ? 'Nenhuma cidade encontrada.' : 'Carregando cidades...'}</div>`;
    marcarAtivo();
    lista.hidden = false;
  }

  inp.addEventListener('input', () => {
    if (!_cidades) lerCidades().then(buscar).catch(() => {});
    buscar();
  });
  inp.addEventListener('keydown', e => {
    if (lista.hidden) return;
    if (e.key === 'ArrowDown') { ativo = Math.min(ativo + 1, itens.length - 1); marcarAtivo(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { ativo = Math.max(ativo - 1, 0); marcarAtivo(); e.preventDefault(); }
    else if (e.key === 'Enter') { if (itens[ativo]) escolher(itens[ativo]); e.preventDefault(); }
    else if (e.key === 'Escape') fechar();
  });
  // mousedown (antes do blur) para o clique na sugestao valer
  lista.addEventListener('mousedown', e => {
    const it = e.target.closest('.cid-ac-item');
    if (it) { e.preventDefault(); escolher(itens[+it.dataset.i]); }
  });
  inp.addEventListener('blur', () => setTimeout(fechar, 150));
  lerCidades().catch(() => {});

  // Para preencher por codigo (ex.: Auditoria -> Abrir no Simulador).
  return {
    definir(uf, nome, grupoId) {
      if (grupoId) {
        const g = (_freteGruposLista || []).find(x => x.id === grupoId);
        escolher({ grupo: true, id: grupoId, nome: g ? g.nome : '(trecho excluído)' });
        return;
      }
      if (grpEl) grpEl.value = '';
      if (uf && !nome && opts.estadoTodo) { escolher({ uf, nome: CID_UF_NOMES[uf] || uf, estado: true }); return; }
      const c = (_cidades || []).find(x => x.uf === uf && freteNorm(x.nome) === freteNorm(nome));
      if (c) { escolher(c); return; }
      ufEl.value = uf || '';
      cidEl.value = nome || '';
      inp.value = nome ? `${nome}/${uf}` : '';
      inp.classList.toggle('cid-ok', !!(uf && nome));
    },
  };
}

// Liga um <select> com os trechos cadastrados ao campo de busca: escolher no
// select preenche o campo com o trecho; escolher no campo atualiza o select.
function cidLigarSeletorGrupo(selId, grpId, ac) {
  const sel = document.getElementById(selId);
  const grp = document.getElementById(grpId);
  if (!sel || !grp) return;
  const encher = () => {
    const atual = grp.value;
    sel.innerHTML = '<option value="">ou escolha um trecho cadastrado…</option>' +
      [...(_freteGruposLista || [])].sort((a, b) => a.nome.localeCompare(b.nome))
        .map(g => `<option value="${g.id}"${g.id === atual ? ' selected' : ''}>${cadEsc(g.nome)} (${g.cidades.length} cidades)</option>`).join('');
    if (!(_freteGruposLista || []).length) sel.innerHTML = '<option value="">nenhum trecho cadastrado (Cadastro ▾ > Trecho)</option>';
  };
  encher();
  sel.addEventListener('change', () => { if (sel.value) ac.definir('', '', sel.value); });
  grp.addEventListener('change', () => { sel.value = grp.value || ''; });
  // quando o campo e redigitado o grupo e limpo sem evento: acompanha pelo input
  const inp = sel.parentElement.querySelector('.cid-ac input[type=text]');
  if (inp) inp.addEventListener('input', () => { sel.value = ''; });
}

// ---------- TELA ----------

function cidMsg(txt, erro) {
  const el = document.getElementById('cad-cidade-msg');
  el.textContent = txt;
  el.style.color = erro ? '#b91c1c' : '#64748b';
}

async function carregarCidadesTela() {
  const selUf = document.getElementById('cid-f-uf');
  if (!selUf.options.length) {
    selUf.innerHTML = '<option value="">Todas as UFs</option>' + FRETE_UFS.map(u => `<option>${u}</option>`).join('');
    document.getElementById('cid-n-uf').innerHTML = '<option value="">UF</option>' + FRETE_UFS.map(u => `<option>${u}</option>`).join('');
  }
  cidMsg('Carregando...');
  try {
    const podeEditar = await cadPodeEditar();
    document.getElementById('cad-cidade-form').style.display = podeEditar ? 'flex' : 'none';
    await lerCidades(true);
    renderCidades();
  } catch (e) {
    console.error(e);
    cidMsg('Não foi possível carregar as cidades (verifique a conexão).', true);
  }
}

function renderCidades() {
  const uf = document.getElementById('cid-f-uf').value;
  const busca = freteNorm(document.getElementById('cid-f-busca').value);
  const lista = (_cidades || []).filter(c => (!uf || c.uf === uf) && (!busca || freteNorm(c.nome).includes(busca)));
  const pode = _cadPodeEditar;
  document.getElementById('tb-cad-cidade').innerHTML = lista.slice(0, CID_LIMITE_TELA).map(c => `<tr>
      <td>${cadEsc(c.nome)}</td><td>${c.uf}</td><td style="color:#64748b">${cadEsc(c.ibge || '—')}</td>
      <td style="text-align:right">${pode ? `<button class="cad-del" type="button" onclick="excluirCidade('${c.uf}','${cadEsc(c.nome).replace(/'/g, "\\'")}')">Excluir</button>` : ''}</td>
    </tr>`).join('');
  const total = (_cidades || []).length;
  cidMsg(`${lista.length.toLocaleString('pt-BR')} cidade(s) encontradas de ${total.toLocaleString('pt-BR')} cadastradas` +
    (lista.length > CID_LIMITE_TELA ? ` — mostrando as ${CID_LIMITE_TELA} primeiras; filtre por UF ou busque pelo nome.` : '.'));
}

async function incluirCidade() {
  if (!(await cadPodeEditar())) return;
  const nome = document.getElementById('cid-n-nome').value.trim();
  const uf = document.getElementById('cid-n-uf').value;
  const ibge = document.getElementById('cid-n-ibge').value.trim();
  if (!nome || !uf) { cidMsg('Informe o nome e a UF da cidade.', true); return; }
  try {
    const lista = [...await lerCidades(true)];
    if (lista.some(c => c.uf === uf && freteNorm(c.nome) === freteNorm(nome))) { cidMsg(`${nome}/${uf} já está cadastrada.`, true); return; }
    lista.push({ ibge, nome, uf });
    lista.sort((a, b) => a.uf.localeCompare(b.uf) || a.nome.localeCompare(b.nome));
    await gravarCidades(lista);
    document.getElementById('cid-n-nome').value = '';
    document.getElementById('cid-n-ibge').value = '';
    renderCidades();
    cidMsg(`${nome}/${uf} incluída.`);
  } catch (e) {
    console.error(e);
    cidMsg('Não foi possível salvar (verifique a conexão).', true);
  }
}

async function excluirCidade(uf, nome) {
  if (!(await cadPodeEditar()) || !confirm(`Excluir a cidade ${nome}/${uf}?`)) return;
  try {
    const lista = (await lerCidades(true)).filter(c => !(c.uf === uf && c.nome === nome));
    await gravarCidades(lista);
    renderCidades();
    cidMsg(`${nome}/${uf} excluída.`);
  } catch (e) {
    console.error(e);
    cidMsg('Não foi possível excluir (verifique a conexão).', true);
  }
}
