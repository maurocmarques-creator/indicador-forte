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
  - `status_overrides` / `date_overrides`: correções manuais por MINUTA (status errado, data digitada errada no portal).
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
- Tarefas no Agendador de Tarefas: **ainda não criadas** (o usuário pediu para aguardar).
  Plano: `GithubRunner_IndicadorForte` (no logon, roda `run.cmd`) e `IndicadorForte_Atualizacao`
  (06:20, 12:20, 18:20, 00:20 — defasado 20 min da Ansell, que usa o mesmo login do portal).
  Confirmar com o usuário antes de mexer no Agendador.

## Pendências
- Criar o Mural da Forte (Artifact com banco compartilhado, usando o Mural da Ansell como
  modelo, sem o código de sync direto para o GitHub, que não funciona por causa da sandbox
  do Artifact), preencher `MURAL_URL` no `index.html` e criar a rotina de sincronização
  Mural ↔ dashboard (modelo: `C:\Users\Mauro Cesar Marques\sync-mural-ansell\sync_mural.py`).
- Criar as tarefas agendadas (ver acima).
