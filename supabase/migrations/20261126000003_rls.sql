-- RLS em todas as tabelas (RNF-04/RNF-05).
-- Leitura: terminal e admin leem as tabelas de negócio; só o admin lê auditoria e configurações.
-- Escrita: nenhuma política de insert/update/delete — tudo passa pelas RPCs SECURITY DEFINER.

-- Leitura explícita (não depende dos privilégios padrão do projeto); o RLS filtra as linhas.
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;

do $$
declare t text;
begin
  foreach t in array array[
    'config_loja','produtos','estoque_movimentos','clientes','vendas','venda_itens','venda_pagamentos',
    'parcelas','recebimentos','recebimento_parcelas','recebiveis_cartao','fornecedores','compras',
    'compra_itens','contas_pagar','lancamentos','auditoria'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;

  foreach t in array array[
    'produtos','estoque_movimentos','clientes','vendas','venda_itens','venda_pagamentos',
    'parcelas','recebimentos','recebimento_parcelas','compras','compra_itens'
  ] loop
    execute format($p$create policy leitura_operacao on public.%I for select to authenticated
      using (public.app_papel() in ('terminal','admin'))$p$, t);
  end loop;

  foreach t in array array['config_loja','auditoria','recebiveis_cartao','fornecedores','contas_pagar','lancamentos'] loop
    execute format($p$create policy leitura_admin on public.%I for select to authenticated
      using (public.app_papel() = 'admin')$p$, t);
  end loop;
end $$;

-- O hash do PIN nunca sai do banco, nem para o admin.
revoke select on public.config_loja from authenticated;
grant select (nome, telefone, instagram, rodape_cupom, taxas_cartao, taxa_debito, formas_ativas, vias_fiado,
              teto_mei, fiado_max_parcelas, atualizado_em) on public.config_loja to authenticated;

-- Funções: só usuários autenticados executam; as funções internas não ficam expostas.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.checar_pin(text) from authenticated;
revoke execute on function public.registrar_auditoria(text, text, uuid, jsonb) from authenticated;
revoke execute on function public.tg_estoque_saldo() from authenticated;
revoke execute on function public.tg_bloquear_alteracao() from authenticated;

alter default privileges in schema public revoke execute on functions from public, anon;
