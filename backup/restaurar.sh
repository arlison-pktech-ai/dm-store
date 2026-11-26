#!/bin/sh
# Teste mensal de restauração (RNF-03): restaura o backup mais recente num projeto Supabase SEPARADO.
# Uso: RESTAURAR_DATABASE_URL=postgres://... restaurar.sh [arquivo-no-destino]
set -eu
ARQ=${1:-$(rclone lsf "$RCLONE_DESTINO/diario" | sort | tail -1)}
echo "restaurando $ARQ em $RESTAURAR_DATABASE_URL (projeto de teste)"
rclone copyto "$RCLONE_DESTINO/diario/$ARQ" /tmp/restaurar.dump
pg_restore --clean --if-exists --no-owner --no-privileges --schema=public -d "$RESTAURAR_DATABASE_URL" /tmp/restaurar.dump
psql "$RESTAURAR_DATABASE_URL" -c "select (select count(*) from public.vendas) as vendas, (select count(*) from public.clientes) as clientes, (select count(*) from public.parcelas) as parcelas, (select max(criada_em) from public.vendas) as ultima_venda;"
echo "restauração concluída"
