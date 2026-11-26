#!/usr/bin/env bash
# Roda as migrações e os testes SQL num Postgres comum.
# Uso: PGHOST=... PGPORT=... PGUSER=postgres scripts/test-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${TEST_DB:-pdv_test}
psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
psql -v ON_ERROR_STOP=1 -q -d "$DB" -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname='supa_owner') then create role supa_owner login bypassrls; end if; end \$\$" \
  -c "grant all on database $DB to supa_owner" -c "alter schema public owner to supa_owner"
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/tests/00_supabase_stub.sql
psql -v ON_ERROR_STOP=1 -q -d "$DB" -c "grant all on schema extensions to supa_owner; grant usage on schema auth to supa_owner; create extension if not exists pgcrypto with schema extensions;"
for f in supabase/migrations/*.sql; do
  echo "migração: $f"
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -U supa_owner -f "$f"
done
for f in supabase/tests/[1-9]*.sql; do
  echo "teste: $f"
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f"
done
echo "OK: todos os testes SQL passaram"
