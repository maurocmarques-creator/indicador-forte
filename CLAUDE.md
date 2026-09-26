# Indicador Forte Transportes — contexto para o Claude

Dashboard de performance logística da PortoEx para o cliente **Forte Transportes**
(no portal: `FORTE TRANSPORTES DO BRASIL LTDA`). É uma cópia do Indicador Ansell
(repo `maurocmarques-creator/indicador-ansell`, site `ansell.portoexapps.com.br`),
com os mesmos scripts genéricos; tudo o que é específico do cliente fica em
`cliente_config.json`.

## Publicação
- Repo: `https://github.com/maurocmarques-creator/indicador-forte` (branch `main`, público).
- Site estático via GitHub Pages, domínio próprio `forte.portoexapps.com.br` (arquivo `CNAME`).
- O domínio fica atrás do **Cloudflare Access** da PortoEx (login obrigatório), então
  não dá para conferir o site via curl — só o redirecionamento 302 para `portoex.cloudflareaccess.com`.
- DNS no Cloudflare: CNAME `forte` → `maurocmarques-creator.github.io`, proxied.
- Qualquer push no `main` publica. **Pedir confirmação ao usuário antes de dar push.**
- O pipeline automático também faz commits (`Atualizacao automatica ...`) — sempre
  `git pull` antes de começar a mexer, para evitar conflito no `index.html`.

## Arquivos
- `cliente_config.json` — configuração do cliente:
  - `clientes_portal`: filtro(s) de cliente usados no portal Brudam (`FORTE TRANSPORTES`).
  - `template_relatorio`: relatório personalizado reaproveitado da Ansell (`AUDITORIA TELA 106_ANSELL`).
  - `onedrive_consolidado`: onde a planilha consolidada `Base_Jan_<Mes>.xlsx` é salva
    (`OneDrive - PORTOEXPRESS LOGISTICA LTDA\Analise Forte`).
  - `email_destino`, `link_dashboard`, `nome_exibicao` (usado no assunto/remetente do e-mail).
  - `reentrega_conta_performance: true` (só a Forte): REENTREGA entra na performance pelo próprio prazo (No prazo /
    Em atraso / Em trânsito) em vez de ficar com status REENTREGA. DEVOLUÇÃO continua fora. Na Ansell fica ausente (false).
  - `status_overrides` / `date_overrides`: correções manuais por MINUTA (status errado, data digitada errada no portal).
  - `grafia_destinatario`: padroniza nomes de destinatário escritos de jeitos diferentes no portal
    (ex.: variações de "MRH VEICULOS" → "MRH VEICULOS LTDA"); só troca o nome, cidade/UF ficam as originais.
  - `observacoes_transito`: mensagens do Mural por MINUTA (preenchido pela sincronização do Mural).
- `extrair_portal.py` — Playwright: login no portal Brudam → relatório 106 Emissões →
  filtro cliente + período (01/01 do ano até ontem) → Personalizado Excel → baixa o xlsx.
- `atualizar_dashboard.py` — lê o xlsx (aba `Brudam`), calcula STATUS/prazos e reescreve
  o blob `const RAW = {...}` dentro do `index.html`; gera `em_transito.json`.
- `pipeline_atualizar.py` — pipeline completo: extrai → consolida → atualiza `index.html`
  e `em_transito.json` → commit + push (só se mudou) → e-mail de aviso. Tem trava
  (`pipeline.lock`) contra execuções simultâneas e log em `pipeline.log`.
- `config.py` — só carrega o `cliente_config.json`.
- `index.html` — dashboard inteiro num arquivo só (Chart.js, logos em base64, dados em `RAW`).
  Abas: Totais, Totais por CX, Performance, Perf. Destinatário, Barra Performance,
  Em Trânsito, Mapa, botão "Atualizar Agora" e link do Mural.
  - Diferenças em relação à Ansell: sem a aba **Expectativa** (a Forte não tem previsão
    de volume/faturamento), logo da Forte Logística no lugar dos logos Ansell/Hercules (+ logo PortoEx).
  - `GH_REPO = 'indicador-forte'`, `GH_TOKEN_KEY = 'indicador_forte_gh_token'`.
  - `MURAL_URL` vazio → a aba Mural fica escondida até o Mural da Forte ser criado.
  - Destinatário/cidade/UF: usa LOCAL/CIDADE/UF ENTREGA; quando vazio (maioria das minutas da Forte),
    cai para DESTINO/CIDADE/UF DESTINO (`atualizar_dashboard.py`).
  - Perf. Destinatário: `DEST_GRUPOS = []` → lista cada destinatário direto (sem a linha DIVERSOS de abrir/fechar da Ansell).
  - Menu **Cadastro ▾ > Serviço** (aba `tab-cad-servico`): lista compartilhada de serviços, salva no Supabase
    da PortoEx (o mesmo da Calculadora de Frete, tabela `app_config`, chave `forte_servicos`,
    array de `{id, nome, criadoEm}`). Relê antes de gravar para não sobrescrever o que outra pessoa salvou.
    Só `CAD_EDITORES` (mauro.cesar@ e brenda.elicia@portoex.com.br) incluem/excluem — o e-mail vem do
    Cloudflare Access (`/cdn-cgi/access/get-identity`); os demais (cliente) só veem. Trava só de tela.
  - Menu **Cadastro ▾ > Tabela** (aba `tab-cad-tabela`, `cadastro-tabela.js`): a **tabela** tem nome, referência,
    serviço, tipo Venda/Compra, vigência, precisão, SIM/NÃO (soma ICMS, desconto ICMS s/ frete peso, negocia tarifa) e a
    **composição** (quais itens de `TAB_COMPOSICAO` entram). As **regras (valores) são sempre por trecho** origem→destino
    (`trechos[].regras`; cidade vazia = estado todo). Ao salvar a tabela abre a lista de trechos; cada trecho tem editor
    próprio com as regras de todos os itens da composição e botão Duplicar. Supabase `app_config`, chave genérica
    `cadastro_tabelas` — formato no topo do `cadastro-tabela.js`. Não renomear chaves de `TAB_COMPOSICAO` já gravadas.
    Removidos a pedido: Permite desconto/acréscimo; itens Peso por Fração e Taxa por NF.
  - `frete-calculo.js`: motor sem tela (reusar na auditoria Excel × tabela e em outros projetos). Tipos de regra:
    PCT_NF (% sobre valor da mercadoria: GRIS, Advalorem, % sobre NF), PCT_CTE (% sobre CT-e; sem CT-e informado usa a
    soma dos demais itens), FIXO (TDE, TAS, TRT, Despacho, SET/CAT), FRACAO (Pedágio e Pedágio por fração:
    ⌈peso÷fração⌉×valor), FAIXA_PESO (Frete Coleta/Entrega: peso × R$/kg da faixa), FAIXA_M3 (Taxa por m³). Todos têm
    preço mínimo. **Franquia** (só onde a base é kg — em cada faixa de peso e na regra por fração): até a franquia
    cobra o valor da franquia; acima, valor da franquia + excedente pela regra (ex. do usuário: faixa 0–3000, franquia
    10 kg = R$ 200, excedente R$ 0,50/kg → 100 kg = 200 + 90×0,50 = R$ 245). **A definir**: uso de "desconto de ICMS
    sobre frete peso" e "negocia tarifa" no cálculo.
    **ICMS**: se a tabela tem "Soma ICMS ao frete" = SIM, total = soma dos itens ÷ (1 − alíquota UF origem→destino).
  - Menu **Cadastro ▾ > ICMS** (aba `tab-cad-icms`, `cadastro-icms.js`): matriz UF origem × destino com a alíquota
    rodoviária; Supabase `app_config`, chave genérica `cadastro_icms` = `{aliquotas: {'SC-SP': 12, ...}}`. Botão importa
    planilha com colunas UF ORIGEM / UF DESTINO / ALIQUOTA (formato do Brudam). Carregada em 25/09/2026 com a
    planilha "Regra Icms.xlsx" do usuário (729 combinações).
    Escolha da tabela (`freteAcharTabela`): mesmo serviço, vigência ≤ data, trecho que casa; vence a vigência mais
    recente, depois o trecho mais específico. Itens removidos a pedido: Redespacho, KM rodado, Faixas de peso, Volume,
    Taxa de emergência, Percentual sobre custos, Peso por Fração, Taxa por NF.
  - Aba **🧮 Simulador** (`simulador.js`): escolhe serviço/tabela (ou automática), data, origem, destino, peso, m³,
    valor NF e CT-e e mostra o cálculo item a item. Só lê, não grava.
  - Menu **Cadastro ▾ > Cidade** (`cadastro-cidade.js`): cidades por UF no Supabase, chave genérica `cadastro_cidades`
    = `[{ibge, nome, uf}]`; carregado em 25/09/2026 com os 5.571 municípios do IBGE (API servicodados.ibge.gov.br).
    Alimenta as sugestões de cidade (por UF) nos trechos; o trecho só aceita cidade cadastrada. No Simulador, origem e
    destino são uma busca Cidade/UF (`cidAutocomplete`): digita parte do nome e só vale o que for escolhido na lista.
  - Aba **🔍 Auditoria** (`auditoria.js`, só aparece para `CAD_EDITORES`): recalcula cada minuta do RAW pela tabela
    (serviço = coluna SERVICO casada pelo nome com o Cadastro > Serviço; vigência pela emissão; origem CIDADE/UF ORIGEM;
    destino = local de entrega efetivo EFF_*; peso = PESO CALC; cubagem = METRAGEM CUBICA; mercadoria = NF VALOR;
    CT-e = FRETE TOTAL) e compara com o FRETE TOTAL. Status OK/Divergente (tolerância)/Sem tabela/Serviço não cadastrado,
    detalhe item a item, "Abrir no Simulador" e exportação Excel. Para isso o RAW ganhou CTE, ORIG_CIDADE/UF, SERVICO,
    TABELA_PORTAL, PESO_CALC, M3 e as taxas TX./FRETE (`atualizar_dashboard.py`).
  - Achado: o relatório "AUDITORIA TELA 106_ANSELL" **não tem a coluna do Advalorem** — na Forte, FRETE TOTAL − soma das
    taxas = 0,25% da NF em ~97% das minutas. A auditoria mostra isso como "Não detalhado no relatório (provável Advalorem)".
  - **Ocultos a pedido do cliente** (só `display:none`, o código continua): na aba Totais os cards Frete Total e
    % Frete/NF e o gráfico % Frete/Valor NF por Mês; a aba Totais por CX inteira.
  - **Filtros globais com seleção múltipla** (Cliente, Região, Tipo Emissão, UF, Ano, Mês, Cotação): cada
    `<select multiple>` fica escondido e `msMontar`/`msRender` desenham botão + caixinhas; ler com `msValores(id)`
    (lista vazia = todos). Cada clique já roda `applyFilters()`, que refaz as opções de cada filtro só com os valores
    que têm minutas dados os OUTROS filtros (`DIMS`); opção sem dados some e é desmarcada.
  - Aba **Entregas Antecipadas** (`renderAntecipacao` no `index.html`, logo após Performance, mesmos filtros e mesma base
    `filteredRowsPerf`): só entregas NO PRAZO com DATA ENTREGA, separadas pelos **dias úteis** entre a entrega e o prazo
    efetivo (agendamento, senão prev. entrega): no dia do prazo / 1 / 2 / 3+ dias antes. Cards, barras por mês, rosca
    e tabela por mês. Fora da conta (avisado na nota): no prazo sem data de entrega e as marcadas no prazo por correção
    manual com entrega depois do prazo.
  - Não editar o `RAW` à mão: ele é regerado a cada rodada do pipeline.
- `.github/workflows/atualizar-manual.yml` — workflow `workflow_dispatch` disparado pelo
  botão "Atualizar Agora"; roda `python pipeline_atualizar.py` no runner self-hosted,
  direto na pasta local do projeto (não clona).

## Rodar local
- Visualizar: `python -m http.server 8935` nesta pasta (há `.claude/launch.json` com o nome `indicador-forte`).
- Só extrair + atualizar o dashboard, sem commit nem e-mail:
  `python extrair_portal.py` e depois `python atualizar_dashboard.py "downloads_tmp\forte transportes.xlsx"`.
- Credenciais **nunca** no código: variáveis de ambiente `PORTAL_USER`/`PORTAL_PASS`
  (portal Brudam) e `EMAIL_USER`/`EMAIL_PASS` (Gmail + senha de app, remetente do aviso).
  Elas existem só no PC do Mauro.

## Infraestrutura no PC do Mauro (não vai no repo)
- Pasta do projeto: `C:\Users\Mauro Cesar Marques\OneDrive - PORTOEXPRESS LOGISTICA LTDA\Forte Logistica`
  (dentro do OneDrive — se o git travar sem motivo, suspeitar da sincronização do OneDrive no `.git`).
- Runner GitHub Actions próprio da Forte em `C:\actions-runner-forte` (separado do da Ansell,
  que fica em `C:\actions-runner`). Registrado, sem serviço — iniciado por `run.cmd`.
- Tarefas no Agendador de Tarefas (criadas em 25/09/2026): `IndicadorForte_Atualizacao` roda
  `python pipeline_atualizar.py >> run_output.log` nesta pasta às **08:00, 14:00, 16:00 e 18:30** (a Ansell roda
  06/12/18/23:59 com o mesmo login do portal); `GithubRunner_IndicadorForte` sobe `C:\actions-runner-forte\run.cmd`
  no logon (botão Atualizar Agora). O aviso de horário no cabeçalho do `index.html` tem que bater com isso.
- **Mural** (Artifact com banco, capacidades `db` + `user`): https://claude.ai/artifact/XYivj9hbyRCDPE6q7h3Gvu
  (`MURAL_URL` no `index.html`). Coleções `mensagens_transito/<minuta>` = `{mensagens:[{id, autor_id, texto,
  criado_em, criado_em_fmt}]}` e `meta/em_transito` = `{lista, atualizado_em}`. Sincronização: tarefa agendada do
  Claude `sync-mural-forte` (15 min depois de cada rodada do pipeline) com o script
  `C:\Users\Mauro Cesar Marques\sync-mural-forte\sync_mural.py` (preparar / obs = Mural → cliente_config +
  index.html / transito = em_transito.json → Mural / commit). Diferente do script da Ansell, aceita Mural sem mensagens.

## Pendências
- Regras de "desconto de ICMS sobre frete peso" e "negocia tarifa" no cálculo.
- Coluna do Advalorem no relatório do portal (hoje só estimada na Auditoria).
