#!/bin/sh
# Gera /config.js com a URL e a chave pública (anon) do Supabase.
# A service_role NUNCA entra aqui (RNF-04).
set -e
cat > /usr/share/nginx/html/config.js <<CFG
window.__PDV_CONFIG__ = {
  SUPABASE_URL: "${SUPABASE_URL:-}",
  SUPABASE_ANON_KEY: "${SUPABASE_ANON_KEY:-}",
  APP_ENV: "${APP_ENV:-producao}"
};
CFG
