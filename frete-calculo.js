// frete-calculo.js — motor de calculo das tabelas de frete (Cadastro > Tabela).
//
// Nao depende de tela: e usado pelo Simulador e vai ser usado pela
// auditoria Excel x tabela. Pode ser copiado para outros projetos junto
// com o formato das tabelas (ver topo do cadastro-tabela.js).

// Itens da composicao: [chave gravada, rotulo, tipo de regra].
// Nao renomear chaves ja gravadas (so o rotulo pode mudar).
// Tipos:
//   PCT_NF     % sobre o valor da mercadoria (NF)          regra: {pct}
//   PCT_CTE    % sobre o valor do CT-e                      regra: {pct}
//   FIXO       valor fixo, somado se informado             regra: {valor}
//   FRACAO     arred. p/ cima(peso / fracao) x valor       regra: {fracaoKg, valor, franquia, valorFranquia}
//   FAIXA_PESO peso x R$/kg da faixa                        regra: {faixas:[{de,ate,valor,franquia,valorFranquia}]}
//   FAIXA_M3   m3 x valor da faixa de m3                   regra: {faixas:[{de,ate,valor}]}
//   null       regra ainda nao definida (nao entra no calculo)
// Franquia (so onde a base e kg): ate `franquia` kg cobra `valorFranquia`;
//   acima, valorFranquia + excedente (peso - franquia) cobrado pela regra
//   (FAIXA_PESO: excedente x R$/kg da faixa; FRACAO: arred. p/ cima(excedente / fracao) x valor).
//   Ex.: faixa 0 a 3000, franquia 10 kg = R$ 200, excedente R$ 0,50/kg:
//   100 kg -> 200 + (100 - 10) x 0,50 = R$ 245.
// Todos aceitam {minimo}: o item nunca fica abaixo do preco minimo.
// Peso usado em tudo que e por kg = PESO CONSIDERADO = maior entre o peso real e
// o peso cubado (m3 x tabela.fatorCubagem, em kg/m3). Sem fator, vale o peso real.
const TAB_COMPOSICAO = [
  ['FRETE_COLETA', 'Frete Coleta', 'FAIXA_PESO'],
  ['FRETE_ENTREGA', 'Frete Entrega', 'FAIXA_PESO'],
  ['PERCENTUAL_NF', 'Percentual sobre NF', 'PCT_NF'],
  ['ADVALOREM', 'Advalorem', 'PCT_NF'],
  ['GRIS', 'GRIS', 'PCT_NF'],
  ['DESPACHO', 'Despacho', 'FIXO'],
  ['PEDAGIO', 'Pedágio', 'FRACAO'],
  ['PERCENTUAL_CTE', 'Percentual sobre CT-e', 'PCT_CTE'],
  ['PEDAGIO_FRACAO', 'Pedágio por Fração', 'FRACAO'],
  ['TAXA_TRT', 'Taxa TRT', 'FIXO'],
  ['TAXA_TAS', 'Taxa TAS', 'FIXO'],
  ['TAXA_TDE', 'Taxa TDE', 'FIXO'],
  ['TAXA_SET_CAT', 'Taxa SET/CAT', 'FIXO'],
  ['TAXA_M3', 'Taxa por m³', 'FAIXA_M3'],
];
const TAB_ROTULO = Object.fromEntries(TAB_COMPOSICAO.map(([k, r]) => [k, r]));
const TAB_TIPO = Object.fromEntries(TAB_COMPOSICAO.map(([k, , t]) => [k, t]));

const FRETE_UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB',
  'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];

// Texto para comparacao: maiusculo, sem acento, espacos simples.
function freteNorm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim().replace(/\s+/g, ' ');
}

// Numero digitado no padrao brasileiro ("1.234,56" ou "1,5") -> Number; vazio -> null.
function freteNum(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  let s = String(v).trim().replace(/\s/g, '').replace(/^R\$/i, '');
  if (s === '') return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return isFinite(n) ? n : null;
}

function freteFmt(n, dec = 2) {
  return Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function freteFmtNum(n) {
  return Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 6 });
}

// ---------- TRECHO ----------

// Pontua o quanto um trecho casa com origem/destino: -1 = nao casa;
// cidade em branco no trecho vale para o estado inteiro (casa com menos pontos).
function freteTrechoPontos(tr, origem, destino) {
  if (freteNorm(tr.origemUf) !== freteNorm(origem.uf)) return -1;
  if (freteNorm(tr.destinoUf) !== freteNorm(destino.uf)) return -1;
  let p = 0;
  if (tr.origemCidade) {
    if (freteNorm(tr.origemCidade) !== freteNorm(origem.cidade)) return -1;
    p += 1;
  }
  if (tr.destinoCidade) {
    if (freteNorm(tr.destinoCidade) !== freteNorm(destino.cidade)) return -1;
    p += 2;
  }
  return p;
}

function freteMelhorTrecho(tabela, origem, destino) {
  let melhor = null;
  for (const tr of tabela.trechos || []) {
    const p = freteTrechoPontos(tr, origem, destino);
    if (p >= 0 && (!melhor || p > melhor.pontos)) melhor = { trecho: tr, pontos: p };
  }
  return melhor;
}

// Escolhe a tabela para um frete: mesmo servico, vigencia ate a data e um
// trecho que case com origem/destino. Entre as candidatas vale a vigencia
// mais recente; empate -> o trecho mais especifico (com cidade).
// Retorna {tabela, trecho, pontos} ou null.
function freteAcharTabela(tabelas, { servicoId, data, origem, destino }) {
  let melhor = null;
  for (const t of tabelas) {
    if (servicoId && t.servicoId !== servicoId) continue;
    if (data && t.vigencia && t.vigencia > data) continue;
    const m = freteMelhorTrecho(t, origem, destino);
    if (!m) continue;
    if (!melhor || t.vigencia > melhor.tabela.vigencia ||
        (t.vigencia === melhor.tabela.vigencia && m.pontos > melhor.pontos)) {
      melhor = { tabela: t, ...m };
    }
  }
  return melhor;
}

// ---------- CALCULO ----------

function freteFaixa(faixas, x) {
  return (faixas || []).find(f => x >= (f.de ?? 0) && (f.ate === null || f.ate === undefined || x <= f.ate)) || null;
}

// As regras (valores) sao de cada TRECHO: trecho.regras = {GRIS: {...}, ...};
// a tabela so diz quais itens entram (composicao) e as opcoes gerais.
// entrada: {peso (kg, peso REAL), m3, valorNF, valorCte (opcional), ufOrigem, ufDestino}
// aliquotasIcms: {'SC-SP': 12, ...} (Cadastro > ICMS) — usado se a tabela
//   tiver "Soma ICMS ao frete" = SIM: total = subtotal / (1 - aliquota/100).
// Retorna {itens:[{item, rotulo, valor, conta, obs:[]}], subtotal,
//   icms: null | {aliquota, valor, conta}, total, avisos:[],
//   pesos: {real, m3, fator, cubado, considerado}}
function freteCalcular(tabela, trecho, entrada, aliquotasIcms) {
  const regras = (trecho && trecho.regras) || {};
  const dec = Number.isInteger(tabela.precisao) ? tabela.precisao : 2;
  const arred = v => Math.round(v * 10 ** dec) / 10 ** dec;
  const pesoReal = +entrada.peso || 0;
  const m3 = +entrada.m3 || 0;
  const fator = +tabela.fatorCubagem || 0;
  const pesoCubado = fator > 0 ? Math.round(m3 * fator * 1000) / 1000 : 0;
  const peso = Math.max(pesoReal, pesoCubado);   // peso considerado
  const nf = +entrada.valorNF || 0;
  const temCte = entrada.valorCte !== null && entrada.valorCte !== undefined && entrada.valorCte !== '';

  const comp = (tabela.composicao || []).filter(k => k in TAB_ROTULO);
  // % sobre CT-e por ultimo: sem valor de CT-e informado, a base e a soma dos demais itens.
  const ordem = comp.filter(k => TAB_TIPO[k] !== 'PCT_CTE').concat(comp.filter(k => TAB_TIPO[k] === 'PCT_CTE'));

  const itens = [];
  const avisos = [];
  let subtotal = 0;

  for (const k of ordem) {
    const r = regras[k] || {};
    const tipo = TAB_TIPO[k];
    const rotulo = TAB_ROTULO[k];
    const obs = [];
    let valor = 0;
    let conta = '';

    if (!tipo) {
      itens.push({ item: k, rotulo, valor: 0, conta: 'Regra a definir — não calculado', obs });
      avisos.push(`${rotulo}: regra ainda não definida, ficou fora do total.`);
      continue;
    }

    switch (tipo) {
      case 'PCT_NF': {
        const pct = r.pct || 0;
        valor = nf * pct / 100;
        conta = `R$ ${freteFmt(nf)} (NF) × ${freteFmtNum(pct)}%`;
        break;
      }
      case 'PCT_CTE': {
        const pct = r.pct || 0;
        const base = temCte ? +entrada.valorCte : subtotal;
        valor = base * pct / 100;
        conta = `R$ ${freteFmt(base)} (${temCte ? 'CT-e informado' : 'soma dos demais itens'}) × ${freteFmtNum(pct)}%`;
        break;
      }
      case 'FIXO': {
        valor = r.valor || 0;
        conta = r.valor ? 'valor fixo' : 'não informado';
        break;
      }
      case 'FRACAO': {
        if (!r.fracaoKg) {
          conta = 'fração (kg) não informada';
          avisos.push(`${rotulo}: informe a fração em kg na tabela.`);
          break;
        }
        if (r.franquia > 0) {
          if (peso <= r.franquia) {
            valor = r.valorFranquia || 0;
            conta = `${freteFmtNum(peso)} kg dentro da franquia (até ${freteFmtNum(r.franquia)} kg) = R$ ${freteFmt(r.valorFranquia)}`;
          } else {
            const exc = peso - r.franquia;
            const qtd = Math.ceil(exc / r.fracaoKg);
            valor = (r.valorFranquia || 0) + qtd * (r.valor || 0);
            conta = `franquia ${freteFmtNum(r.franquia)} kg = R$ ${freteFmt(r.valorFranquia)} + excedente ${freteFmtNum(exc)} kg ÷ ${freteFmtNum(r.fracaoKg)} kg = ${qtd} fração(ões) × R$ ${freteFmt(r.valor)}`;
          }
          break;
        }
        const qtd = Math.ceil(peso / r.fracaoKg);
        valor = qtd * (r.valor || 0);
        conta = `${freteFmtNum(peso)} kg ÷ ${freteFmtNum(r.fracaoKg)} kg = ${qtd} fração(ões) × R$ ${freteFmt(r.valor)}`;
        break;
      }
      case 'FAIXA_PESO':
      case 'FAIXA_M3': {
        const porPeso = tipo === 'FAIXA_PESO';
        const x = porPeso ? peso : m3;
        const un = porPeso ? 'kg' : 'm³';
        const f = freteFaixa(r.faixas, x);
        if (!f) {
          conta = `${freteFmtNum(x)} ${un} fora das faixas cadastradas`;
          avisos.push(`${rotulo}: ${freteFmtNum(x)} ${un} não cai em nenhuma faixa da tabela.`);
          break;
        }
        const ate = f.ate === null || f.ate === undefined ? 'acima' : freteFmtNum(f.ate);
        const nomeFaixa = `faixa ${freteFmtNum(f.de ?? 0)} a ${ate} ${un}`;
        if (porPeso && f.franquia > 0) {
          if (x <= f.franquia) {
            valor = f.valorFranquia || 0;
            conta = `${freteFmtNum(x)} kg dentro da franquia (até ${freteFmtNum(f.franquia)} kg) = R$ ${freteFmt(f.valorFranquia)} (${nomeFaixa})`;
          } else {
            const exc = x - f.franquia;
            valor = (f.valorFranquia || 0) + exc * (f.valor || 0);
            conta = `franquia ${freteFmtNum(f.franquia)} kg = R$ ${freteFmt(f.valorFranquia)} + excedente ${freteFmtNum(exc)} kg × R$ ${freteFmt(f.valor)} (${nomeFaixa})`;
          }
          break;
        }
        valor = x * (f.valor || 0);
        conta = `${freteFmtNum(x)} ${un} × R$ ${freteFmt(f.valor)} (${nomeFaixa})`;
        break;
      }
    }

    if (r.minimo > 0 && valor < r.minimo) {
      valor = r.minimo;
      obs.push(`abaixo do mínimo → R$ ${freteFmt(r.minimo)}`);
    }

    valor = arred(valor);
    subtotal += valor;
    itens.push({ item: k, rotulo, valor, conta, obs });
  }

  subtotal = arred(subtotal);
  let icms = null;
  let total = subtotal;
  if (tabela.somaIcms) {
    const chave = `${freteNorm(entrada.ufOrigem)}-${freteNorm(entrada.ufDestino)}`;
    const aliq = (aliquotasIcms || {})[chave];
    if (aliq === undefined || aliq === null) {
      avisos.push(`ICMS: sem alíquota cadastrada para ${chave} (Cadastro > ICMS) — total sem ICMS.`);
    } else {
      total = arred(subtotal / (1 - aliq / 100));
      icms = {
        aliquota: aliq,
        valor: arred(total - subtotal),
        conta: `R$ ${freteFmt(subtotal, dec)} ÷ (1 − ${freteFmtNum(aliq)}%) = R$ ${freteFmt(total, dec)} (${chave})`,
      };
    }
  }

  return { itens, subtotal, icms, total, avisos,
    pesos: { real: pesoReal, m3, fator, cubado: pesoCubado, considerado: peso } };
}
