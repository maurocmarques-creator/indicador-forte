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
