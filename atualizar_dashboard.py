#!/usr/bin/env python3
"""
atualizar_dashboard.py — Atualiza index.html do Indicador a partir de
uma planilha consolidada (clientes de clientes_portal) exportada do relatorio 106
(Emissoes) do sistema Brudam.

Uso: python atualizar_dashboard.py <planilha.xlsx> [pasta_do_dashboard]
Padrao pasta_do_dashboard: diretorio deste script.
"""

import sys
import json
from datetime import datetime
from pathlib import Path

import pandas as pd

from config import CONFIG

MES_ABREV = {1: 'Jan', 2: 'Fev', 3: 'Mar', 4: 'Abr', 5: 'Mai', 6: 'Jun',
             7: 'Jul', 8: 'Ago', 9: 'Set', 10: 'Out', 11: 'Nov', 12: 'Dez'}

# Excecoes manuais de STATUS por MINUTA, para casos onde o sistema
# classifica errado (ex: TIPO EMISSAO = DEVOLUCAO mas a carga foi
# entregue normalmente). Fica em cliente_config.json para persistir a
# cada atualizacao.
STATUS_OVERRIDES = CONFIG.get("status_overrides", {})

# Correcoes manuais de datas por MINUTA, para erros de digitacao no
# portal (ex: agendamento cadastrado com o ano errado). Fica em
# cliente_config.json para persistir a cada atualizacao.
DATE_OVERRIDES = CONFIG.get("date_overrides", {})

# Mural de observacoes por MINUTA, mostrado na aba Em Transito logo
# abaixo da descricao da ultima ocorrencia -- uma "conversa" (lista de
# mensagens, mais recente por ultimo) que o time PortoEx escreve na
# ferramenta interna (Artifact com banco compartilhado) e que este
# pipeline sincroniza para dentro de cliente_config.json, para ficar
# visivel (somente leitura) para quem abrir o dashboard publico,
# inclusive o cliente. Formato por minuta:
#   [{"autor": "Nome", "texto": "...", "data": "17/09/2026 14:30"}, ...]
OBSERVACOES_TRANSITO = CONFIG.get("observacoes_transito", {})

# Padroniza a grafia do destinatario quando o mesmo cadastro aparece
# escrito de jeitos diferentes no portal (ex.: "MRH VEICULOS LTDA." e
# "MRH VEICULOS" -> "MRH VEICULOS LTDA"). So troca o nome exibido; a
# cidade/UF de cada minuta continua a original.
GRAFIA_DESTINATARIO = CONFIG.get("grafia_destinatario", {})

# Se true, minutas de REENTREGA entram na performance (No prazo / Em atraso /
# Em transito) pelo proprio prazo, em vez de ficarem com status REENTREGA.
REENTREGA_CONTA_PERFORMANCE = bool(CONFIG.get("reentrega_conta_performance", False))

UF_REGIAO = {
    'AC': 'Norte', 'AP': 'Norte', 'AM': 'Norte', 'PA': 'Norte', 'RO': 'Norte', 'RR': 'Norte', 'TO': 'Norte',
    'AL': 'Nordeste', 'BA': 'Nordeste', 'CE': 'Nordeste', 'MA': 'Nordeste', 'PB': 'Nordeste',
    'PE': 'Nordeste', 'PI': 'Nordeste', 'RN': 'Nordeste', 'SE': 'Nordeste',
    'DF': 'Centro-Oeste', 'GO': 'Centro-Oeste', 'MT': 'Centro-Oeste', 'MS': 'Centro-Oeste',
    'ES': 'Sudeste', 'MG': 'Sudeste', 'RJ': 'Sudeste', 'SP': 'Sudeste',
    'PR': 'Sul', 'RS': 'Sul', 'SC': 'Sul',
}

# Centroides aproximados por UF (uso apenas decorativo no mapa do dashboard).
UF_CENTROID = {
    'AC': (-9.02, -70.81), 'AL': (-9.57, -36.78), 'AM': (-3.47, -65.10),
    'AP': (0.90, -52.00), 'BA': (-12.96, -41.70), 'CE': (-5.50, -39.32),
    'DF': (-15.78, -47.93), 'ES': (-19.19, -40.34), 'GO': (-15.83, -49.83),
    'MA': (-5.42, -45.44), 'MG': (-18.51, -44.55), 'MS': (-20.77, -54.79),
    'MT': (-12.64, -55.42), 'PA': (-3.42, -52.29), 'PB': (-7.06, -36.72),
    'PE': (-8.38, -37.86), 'PI': (-7.72, -42.73), 'PR': (-24.89, -51.55),
    'RJ': (-22.25, -42.66), 'RN': (-5.40, -36.95), 'RO': (-10.83, -63.34),
    'RR': (1.99, -61.33), 'RS': (-30.17, -53.50), 'SC': (-27.45, -50.95),
    'SE': (-10.57, -37.45), 'SP': (-22.25, -48.63), 'TO': (-10.25, -48.25),
}


def num(r, col):
    """Valor numerico de uma coluna (0.0 se vazia ou se a coluna nao existir)."""
    v = r.get(col)
    if v is None or pd.isna(v):
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def txt(r, col):
    v = r.get(col)
    return '' if v is None or pd.isna(v) else str(v).strip()


def iso(d):
    if pd.isna(d):
        return ''
    return d.strftime('%Y-%m-%d')


def compute_status(tipo_emissao, data_entrega, prev_entrega, data_agendamento, hoje, descricao_ultimo=''):
    if tipo_emissao == 'DEVOLUCAO':
        return 'DEVOLUCAO'
    # Reentrega fica fora da performance, a menos que o cliente peca para
    # contar (cliente_config.json: "reentrega_conta_performance": true) --
    # ai ela e avaliada pelo proprio prazo como qualquer entrega.
    if tipo_emissao == 'REENTREGA' and not REENTREGA_CONTA_PERFORMANCE:
        return 'REENTREGA'
    efetivo = data_agendamento if not pd.isna(data_agendamento) else prev_entrega

    # A "DATA ENTREGA" as vezes fica em branco mesmo com a entrega ja
    # confirmada na descricao da ultima ocorrencia — nesses casos nao e
    # "Em Transito" de verdade, e sim uma entrega sem a data batida no
    # sistema. Usamos hoje como data de referencia (nao temos a data real).
    descricao_ultimo = (descricao_ultimo or '')
    entregue_sem_data = pd.isna(data_entrega) and 'ENTREGA REALIZADA NORMALMENTE' in descricao_ultimo.upper()
    data_ref = hoje if entregue_sem_data else data_entrega

    if pd.isna(data_ref):
        # Sem baixa e sem confirmacao de entrega: compara hoje contra o
        # prazo (agendamento, se tiver; senao a propria previsao de entrega).
        if not pd.isna(efetivo) and hoje > efetivo:
            return 'EM TRANSITO FORA DO PRAZO'
        return 'EM TRANSITO DENTRO DO PRAZO'
    if pd.isna(efetivo):
        return 'EM ATRASO'
    return 'NO PRAZO' if data_ref <= efetivo else 'EM ATRASO'


def find_tipo_emissao_col(df):
    # O cabeçalho "TIPO EMISSÃO" costuma vir com o "Ã" corrompido no Excel
    # exportado pelo portal (caractere de substituição real, não só exibição).
    candidates = [c for c in df.columns if c.startswith('TIPO EMISS')]
    if not candidates:
        raise ValueError('Coluna "TIPO EMISSAO" nao encontrada na planilha')
    return candidates[0]


def prazo_efetivo(prev_entrega, data_agendamento, data_emissao):
    """Data que rege as metricas de PERFORMANCE (por oposicao as de
    faturamento, que usam DATA EMISSAO): se tiver agendamento, usa o
    agendamento; senao usa a previsao de entrega; se nenhum dos dois
    existir (raro), cai de volta pra emissao para a linha nao sumir dos
    filtros de mes."""
    if not pd.isna(data_agendamento):
        return data_agendamento
    if not pd.isna(prev_entrega):
        return prev_entrega
    return data_emissao


def build_rows(df, hoje=None):
    hoje = pd.Timestamp(hoje) if hoje is not None else pd.Timestamp.now().normalize()
    tipo_col = find_tipo_emissao_col(df)
    rows = []
    for _, r in df.iterrows():
        minuta = str(r['MINUTA'])
        data_emissao = r['DATA EMISSAO']
        data_entrega = r['DATA ENTREGA']
        prev_entrega = r['PREV. ENTREGA']
        data_agendamento = r['DATA DE AGENDAMENTO']

        # Corrige erros de digitacao de data cadastrados no portal (ex:
        # ano errado), antes de qualquer calculo usar essas datas.
        date_over = DATE_OVERRIDES.get(minuta, {})
        if 'DATA DE AGENDAMENTO' in date_over:
            data_agendamento = pd.Timestamp(date_over['DATA DE AGENDAMENTO'])
        if 'PREV. ENTREGA' in date_over:
            prev_entrega = pd.Timestamp(date_over['PREV. ENTREGA'])

        tipo = r[tipo_col]
        # Local de entrega efetivo: o portal so preenche LOCAL/CIDADE/UF
        # ENTREGA quando a entrega e num endereco diferente do destinatario
        # (na Forte isso fica vazio na maioria das minutas) -- nesses casos
        # o destinatario/cidade/UF reais estao em DESTINO/CIDADE/UF DESTINO.
        tem_local_entrega = not pd.isna(r['LOCAL ENTREGA'])
        sufixo = 'ENTREGA' if tem_local_entrega else 'DESTINO'
        eff_local = r['LOCAL ENTREGA'] if tem_local_entrega else r.get('DESTINO', '')
        eff_cidade = r[f'CIDADE {sufixo}'] if f'CIDADE {sufixo}' in r else ''
        eff_uf = r[f'UF {sufixo}'] if f'UF {sufixo}' in r else ''
        eff_local = '' if pd.isna(eff_local) else eff_local
        eff_local = GRAFIA_DESTINATARIO.get(eff_local.strip(), eff_local)
        eff_cidade = '' if pd.isna(eff_cidade) else eff_cidade
        eff_uf = '' if pd.isna(eff_uf) else eff_uf
        descricao_ultimo = r.get('DESCRICAO ULTIMO', '')
        descricao_ultimo = '' if pd.isna(descricao_ultimo) else descricao_ultimo
        status = STATUS_OVERRIDES.get(
            minuta, compute_status(tipo, data_entrega, prev_entrega, data_agendamento, hoje, descricao_ultimo)
        )
        prazo_perf = prazo_efetivo(prev_entrega, data_agendamento, data_emissao)

        rows.append({
            'MES': data_emissao.strftime('%Y-%m'),
            'MES_NOME': f"{MES_ABREV[data_emissao.month]}/{data_emissao.year}",
            'MES_PREV': prazo_perf.strftime('%Y-%m'),
            'MES_PREV_NOME': f"{MES_ABREV[prazo_perf.month]}/{prazo_perf.year}",
            'STATUS': status,
            'CLIENTE': r['CLIENTE'],
            'MINUTA': minuta,
            'NF_DOC': str(r['NF/DOC']),
            'VOLUMES': int(r['VOLUMES']) if not pd.isna(r['VOLUMES']) else 0,
            'FRETE TOTAL': float(r['FRETE TOTAL']) if not pd.isna(r['FRETE TOTAL']) else 0.0,
            'NF VALOR': float(r['NF VALOR']) if not pd.isna(r['NF VALOR']) else 0.0,
            'TX. PEDAGIO': float(r['TX. PEDAGIO']) if not pd.isna(r['TX. PEDAGIO']) else 0.0,
            'VALOR ICMS': float(r['VALOR ICMS']) if not pd.isna(r['VALOR ICMS']) else 0.0,
            'TX. GRIS': float(r['TX. GRIS']) if not pd.isna(r['TX. GRIS']) else 0.0,
            'TX. FRETE PESO': float(r['TX. FRETE PESO']) if not pd.isna(r['TX. FRETE PESO']) else 0.0,
            'TX. OUTROS': float(r['TX. OUTROS']) if not pd.isna(r['TX. OUTROS']) else 0.0,
            'TX. NOTA': float(r['TX. NOTA']) if not pd.isna(r['TX. NOTA']) else 0.0,
            'TIPO EMISSÃO': tipo,
            # COTACAO no export bruto e um numero de cotacao (quando negociado
            # fora da tabela) ou vazio — o filtro Sim/Nao do dashboard espera
            # 'S'/'N', entao convertemos presenca/ausencia de valor.
            'COTACAO': 'S' if not pd.isna(r['COTACAO']) else 'N',
            'DATA EMISSAO': iso(data_emissao),
            'DATA ENTREGA': iso(data_entrega),
            'PREV. ENTREGA': iso(prev_entrega),
            'DATA DE AGENDAMENTO': iso(data_agendamento),
            'EFF_LOCAL': eff_local,
            'EFF_CIDADE': eff_cidade,
            'DESCRICAO_ULTIMO': descricao_ultimo,
            'OBSERVACOES': OBSERVACOES_TRANSITO.get(minuta, []),
            'EFF_UF': eff_uf,
            # --- Auditoria (frete do portal x tabela cadastrada) ---
            'CTE': txt(r, 'CTE'),
            'ORIG_CIDADE': txt(r, 'CIDADE ORIGEM'),
            'ORIG_UF': txt(r, 'UF ORIGEM'),
            'SERVICO': txt(r, 'SERVICO'),
            'TABELA_PORTAL': txt(r, 'TABELA'),
            # numero da cotacao do portal (vazio = sem cotacao; COTACAO ja guarda S/N)
            'COTACAO_NUM': (str(int(r['COTACAO'])) if isinstance(r.get('COTACAO'), (int, float)) and not pd.isna(r.get('COTACAO'))
                            else txt(r, 'COTACAO')),
            'PESO_CALC': num(r, 'PESO CALC'),
            'PESO_REAL': num(r, 'PESO REAL'),
            'PESO_CUBADO': num(r, 'PESO CUBADO'),
            'M3': num(r, 'METRAGEM CUBICA'),
            'TX. COLETA': num(r, 'TX. COLETA'),
            'TX. ENTREGA': num(r, 'TX. ENTREGA'),
            'TX. DESPACHO': num(r, 'TX. DESPACHO'),
            'FRETE TAS': num(r, 'FRETE TAS'),
            'FRETE TRT': num(r, 'FRETE TRT'),
            'FRETE TDE': num(r, 'FRETE TDE'),
            'FRETE SET/CAT': num(r, 'FRETE SET/CAT'),
            'REGIAO': UF_REGIAO.get(eff_uf, ''),
            'LAT': UF_CENTROID[eff_uf][0] if eff_uf in UF_CENTROID else None,
            'LNG': UF_CENTROID[eff_uf][1] if eff_uf in UF_CENTROID else None,
        })
    return rows


def build_raw(rows, gerado_em=None):
    meses = sorted(set(r['MES'] for r in rows))
    tipos = sorted(set(r['TIPO EMISSÃO'] for r in rows))
    ufs = sorted(set(r['EFF_UF'] for r in rows if r['EFF_UF']))
    clientes = sorted(set(r['CLIENTE'] for r in rows))
    return {
        'meta': {
            'meses': meses,
            'tipos_emissao': tipos,
            'ufs': ufs,
            'clientes': clientes,
            'gerado_em': gerado_em or datetime.now().strftime('%d/%m/%Y %H:%M'),
        },
        'rows': rows,
    }


def read_json_blob(content, marker):
    pos = content.find(marker)
    if pos == -1:
        return None
    start = pos + len(marker)
    decoder = json.JSONDecoder()
    data, _ = decoder.raw_decode(content, start)
    return data


def replace_json_blob(content, marker, new_json):
    pos = content.find(marker)
    if pos == -1:
        raise ValueError(f'Marcador nao encontrado: {marker!r}')
    start = pos + len(marker)
    decoder = json.JSONDecoder()
    _, end = decoder.raw_decode(content, start)
    return content[:start] + new_json + content[end:]


def main():
    if len(sys.argv) < 2:
        print('Uso: python atualizar_dashboard.py <planilha.xlsx> [pasta_do_dashboard]')
        sys.exit(1)

    xlsx_path = Path(sys.argv[1])
    dash_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).parent
    index_path = dash_dir / 'index.html'

    if not xlsx_path.exists():
        print(f'Planilha nao encontrada: {xlsx_path}')
        sys.exit(1)

    print(f'Lendo {xlsx_path}...')
    df = pd.read_excel(xlsx_path, sheet_name='Brudam')
    print(f'{len(df)} linhas carregadas.')

    rows = build_rows(df)
    raw = build_raw(rows)

    print(f"Periodo: {raw['meta']['meses'][0]} a {raw['meta']['meses'][-1]}")
    print(f"Clientes: {raw['meta']['clientes']}")
    print(f"Linhas RAW: {len(rows)}")

    index_content = index_path.read_text(encoding='utf-8')
    raw_json = json.dumps(raw, ensure_ascii=False)
    index_content = replace_json_blob(index_content, 'const RAW = ', raw_json)
    index_path.write_text(index_content, encoding='utf-8')
    print(f'Atualizado: {index_path}')

    # em_transito.json -- lista das minutas ainda em transito (mesmo
    # criterio da aba "Em Transito" do dashboard), publicada solta no
    # repo pra o Mural buscar ao vivo (fetch direto do GitHub, sem
    # precisar que eu republique o Mural toda vez que uma minuta e
    # entregue e sai da lista).
    em_transito = [
        {
            'minuta': r['MINUTA'],
            'nf': r['NF_DOC'],
            'cliente': r['CLIENTE'],
            'destinatario': r['EFF_LOCAL'],
            'cidade': r['EFF_CIDADE'],
            'uf': r['EFF_UF'],
            'prazo': r['DATA DE AGENDAMENTO'] or r['PREV. ENTREGA'],
            'descricao': r['DESCRICAO_ULTIMO'],
        }
        for r in rows
        if r['STATUS'] in ('EM TRANSITO DENTRO DO PRAZO', 'EM TRANSITO FORA DO PRAZO')
    ]
    em_transito_path = dash_dir / 'em_transito.json'
    em_transito_path.write_text(json.dumps(em_transito, ensure_ascii=False), encoding='utf-8')
    print(f'Atualizado: {em_transito_path} ({len(em_transito)} minutas em transito)')


if __name__ == '__main__':
    main()
