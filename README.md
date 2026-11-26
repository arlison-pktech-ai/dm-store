# PDV Dalva Cosméticos

Sistema web de vendas, estoque, clientes e fiado para a Dalva Cosméticos, feito a partir do
**PRD — PDV Perfumaria** e das telas do Claude Design. A operadora usa um terminal touch
(1920×1080, Chrome em quiosque) e o administrador usa o celular.

| Área | Endereço | Quem usa |
| --- | --- | --- |
| Terminal | `/terminal` | Operadora: Vender, Receber fiado, Chegou mercadoria, Clientes, Estoque (ver, ajustar e contar) |
| Administrador | `/admin` | Painel, vendas, clientes, estoque, configurações, exportação, auditoria |

## Rodar no computador (modo demonstração)

Sem configurar o Supabase, o app roda em **modo demonstração**: os dados ficam no navegador,
com produtos e clientes de exemplo. É o protótipo da **Fase 0** do PRD, para testar com ela
antes de existir banco.

```bash
npm install
npm run dev            # http://localhost:5173/terminal  e  /admin (senha "demo")
```

- PIN do terminal na demonstração: `1234`.
- Para simular o leitor de código de barras, digite rápido o código e Enter, por exemplo
  `7891000000017` (Essência Âmbar), `7891000000024` (Flor de Lótus), `7891000000031` (Hidratante).
- "Mais › Recomeçar demonstração" no admin apaga os dados de exemplo.

## Como está organizado

```
src/
  domain/      regras de negócio puras (parcelas, troco, taxa, abatimento, custo médio) + testes
  data/        Backend: SupabaseBackend (produção) e LocalBackend (demonstração)
  terminal/    telas da operadora (touch, 1920×1080)
  admin/       área do administrador (celular)
  print/       cupom 80 mm e recibo (impressão sem janela)
supabase/
  migrations/  17 tabelas, RPCs transacionais e RLS
  tests/       testes SQL das RPCs (rodam num Postgres comum)
e2e/           testes Playwright de venda e fiado
docker/, Dockerfile, docker-stack.yml   imagem nginx + stack do Swarm com Traefik
backup/        imagem do backup diário (pg_dump + rclone) e script de restauração
docs/          instalação do terminal e folha "o que fazer se…"
```

Regras que valem em todo o código: dinheiro em **centavos** (inteiros), datas no fuso
**America/Manaus**, nada de negócio é apagado (cancelado/estornado por status), e toda
operação que mexe em mais de uma tabela passa por uma **RPC** do Postgres numa única transação.

## Colocar em produção

### 1. Supabase

1. Crie o projeto no Supabase (região São Paulo).
2. Aplique as migrações: `npx supabase link --project-ref <ref>` e `npx supabase db push`
   (ou cole os arquivos de `supabase/migrations` no SQL Editor, na ordem).
3. Crie dois usuários em *Authentication › Users* (e-mail e senha), por exemplo
   `terminal@<domínio>` e o seu e-mail de administrador. Depois defina o papel de cada um no SQL Editor:

   ```sql
   update auth.users set raw_app_meta_data = raw_app_meta_data || '{"papel":"terminal"}' where email = 'terminal@seudominio.com.br';
   update auth.users set raw_app_meta_data = raw_app_meta_data || '{"papel":"admin"}'    where email = 'seu@email.com';
   ```
4. Em *Authentication › Providers*, desligue o cadastro aberto (*Allow new users to sign up*).
5. Troque o PIN do terminal em `/admin › Mais › PIN do terminal` (o inicial é `1234`).

### 2. VPS (Docker Swarm + Traefik)

1. O GitHub Actions publica `ghcr.io/arlison-pktech-ai/dm-store` e `...-backup` a cada push na `main`.
2. Crie o segredo do rclone e faça o deploy da stack (ou pelo Portainer):

   ```bash
   docker secret create rclone_conf ./rclone.conf
   export PDV_DOMINIO=pdv.seudominio.com.br SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<anon>
   export BACKUP_DATABASE_URL='postgresql://postgres:<senha>@db.<ref>.supabase.co:5432/postgres'
   export BACKUP_RCLONE_DESTINO=b2:pdv-backups BACKUP_ALERTA_URL=https://<webhook>
   docker stack deploy -c docker-stack.yml pdv
   ```
3. Para o deploy automático, crie o webhook do serviço no Portainer e salve como segredo
   `PORTAINER_WEBHOOK` no repositório.

O navegador só recebe a chave **anon**; a `service_role` nunca sai do servidor. A connection string
do backup fica só no serviço de backup.

### 3. Backup e restauração (RNF-02 e RNF-03)

- O serviço `backup` roda `pg_dump` todo dia às 2h (Manaus), envia para fora da VPS e do Supabase
  e guarda 30 cópias diárias e 12 mensais. Se falhar, chama `BACKUP_ALERTA_URL`.
- Teste mensal: crie um projeto Supabase separado e rode
  `docker run --rm -e RCLONE_DESTINO=... -e RESTAURAR_DATABASE_URL=... -v ./rclone.conf:/config/rclone/rclone.conf ghcr.io/arlison-pktech-ai/dm-store-backup restaurar.sh`.

### 4. Terminal (mini PC com Windows)

Passo a passo em [docs/terminal-windows.md](docs/terminal-windows.md). Ao lado do terminal, deixe
impressa a folha [docs/o-que-fazer-se.md](docs/o-que-fazer-se.md).

## Testes

```bash
npm test                 # regras de negócio (Vitest)
npm run typecheck
scripts/test-db.sh       # migrações + testes SQL das RPCs num Postgres (PGHOST/PGUSER...)
npm run e2e              # Playwright: venda com pagamento misto, fiado, bloqueios
```

O CI roda tudo isso a cada pull request. A impressão precisa ser testada na impressora real a cada versão.

## O que fica para depois (fase 2 e 3 do PRD)

Compras com fornecedor, contas a pagar, recebíveis do cartão conciliados, fluxo de caixa,
relatório mensal do MEI, lembrete automático no WhatsApp (n8n), inventário por contagem e
modo offline. As tabelas da fase 2 já existem no banco, e a venda no cartão já grava os
recebíveis previstos.
