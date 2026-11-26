#!/bin/sh
# Backup diário do banco do PDV (RNF-02).
# - pg_dump em formato custom, comprimido, enviado para fora da VPS e do Supabase via rclone.
# - Retenção: 30 cópias diárias e 12 mensais (a do dia 1º de cada mês).
# - Se falhar, chama ALERTA_URL com a mensagem.
# Uso: backup.sh            → faz um backup agora
#      backup.sh --agendado → fica rodando e faz o backup todo dia às 02:00 (TZ=America/Manaus)
set -eu

alerta() {
  echo "ERRO: $1" >&2
  [ -n "${ALERTA_URL:-}" ] && curl -fsS -m 20 -X POST -H 'Content-Type: application/json' \
    -d "{\"texto\":\"Backup do PDV falhou: $1\"}" "$ALERTA_URL" >/dev/null || true
}

backup_agora() {
  DATA=$(date +%Y-%m-%d)
  ARQ="/tmp/pdv-$DATA.dump"
  echo "$(date) iniciando backup"
  if ! pg_dump --format=custom --no-owner --no-privileges --schema=public --schema=auth "$DATABASE_URL" -f "$ARQ"; then
    alerta "pg_dump falhou em $DATA"; return 1
  fi
  if [ "$(stat -c %s "$ARQ")" -lt 2048 ]; then alerta "arquivo de backup pequeno demais"; return 1; fi
  if ! rclone copyto "$ARQ" "$RCLONE_DESTINO/diario/pdv-$DATA.dump"; then alerta "envio do backup diário falhou"; return 1; fi
  if [ "$(date +%d)" = "01" ]; then
    rclone copyto "$ARQ" "$RCLONE_DESTINO/mensal/pdv-$(date +%Y-%m).dump" || alerta "envio do backup mensal falhou"
  fi
  rm -f "$ARQ"
  # Retenção
  rclone delete --min-age 31d "$RCLONE_DESTINO/diario" || true
  rclone delete --min-age 370d "$RCLONE_DESTINO/mensal" || true
  echo "$(date) backup concluído"
}

if [ "${1:-}" = "--agendado" ]; then
  while true; do
    agora=$(date +%s)
    alvo=$(date -d "$(date +%Y-%m-%d) 02:00" +%s 2>/dev/null || date -d "02:00" +%s)
    [ "$alvo" -le "$agora" ] && alvo=$((alvo + 86400))
    echo "próximo backup em $(( (alvo - agora) / 60 )) min"
    sleep $((alvo - agora))
    backup_agora || true
  done
else
  backup_agora
fi
