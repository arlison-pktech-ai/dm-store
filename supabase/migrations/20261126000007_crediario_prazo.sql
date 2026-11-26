-- Crediário com prazo: as parcelas podem vencer todo mês (padrão), a cada 15 dias ou toda semana.
-- O terminal manda "prazo" em cada pagamento do crediário: 'mensal' | 'quinzenal' | 'semanal'.
-- Sem prazo, vale mensal (compatível com terminais antigos).

create or replace function public.finalizar_venda(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_cliente uuid := (payload ->> 'cliente_id')::uuid;
  v_key text := payload ->> 'idempotency_key';
  v_desc int := coalesce((payload ->> 'desconto')::int, 0);
  v_sub int;
  v_total int;
  v_soma int;
  v_cfg public.config_loja;
  it jsonb;
  pg jsonb;
  v_pg_id uuid;
  v_forma text;
  v_valor int;
  v_parc int;
  v_taxa int;
  v_rec int;
  v_cobrado int;
  v_preco int;
  v_corrigidos jsonb := '[]'::jsonb;
  v_base int;
  v_num int := 0;
  v_total_parc int;
  i int;
begin
  perform public.exigir_papel(array['terminal','admin']);

  if v_key is null or length(v_key) < 8 then raise exception 'Venda sem chave de idempotência.'; end if;
  select id into v_id from public.vendas where idempotency_key = v_key;
  if found then return public.venda_detalhe(v_id); end if;

  if v_cliente is null or not exists (select 1 from public.clientes where id = v_cliente) then
    raise exception 'Escolha a cliente.';
  end if;
  if jsonb_array_length(coalesce(payload -> 'itens', '[]')) = 0 then raise exception 'O carrinho está vazio.'; end if;
  if jsonb_array_length(coalesce(payload -> 'pagamentos', '[]')) not between 1 and 4 then
    raise exception 'De 1 a 4 pagamentos por venda.';
  end if;

  select coalesce(sum((x ->> 'quantidade')::int * (x ->> 'preco_unitario')::int), 0) into v_sub
  from jsonb_array_elements(payload -> 'itens') x;
  if v_desc < 0 or v_desc > v_sub then raise exception 'Desconto inválido.'; end if;
  v_total := v_sub - v_desc;

  select coalesce(sum((x ->> 'valor')::int), 0) into v_soma from jsonb_array_elements(payload -> 'pagamentos') x;
  if v_soma <> v_total then raise exception 'A soma dos pagamentos (%) não fecha com o total (%).', v_soma, v_total; end if;

  select * into v_cfg from public.config_loja;

  insert into public.vendas (cliente_id, subtotal, desconto, total, para_entrega, idempotency_key)
  values (v_cliente, v_sub, v_desc, v_total, coalesce((payload ->> 'para_entrega')::boolean, false), v_key)
  returning id into v_id;

  for it in select * from jsonb_array_elements(payload -> 'itens') loop
    if (it ->> 'quantidade')::int <= 0 then raise exception 'Quantidade inválida.'; end if;
    insert into public.venda_itens (venda_id, produto_id, descricao, quantidade, preco_unitario, custo_unitario)
    select v_id, p.id, coalesce(it ->> 'descricao', p.nome), (it ->> 'quantidade')::int, (it ->> 'preco_unitario')::int, p.custo_medio
    from public.produtos p where p.id = (it ->> 'produto_id')::uuid;
    if not found then raise exception 'Produto não encontrado.'; end if;
    -- Preço corrigido na venda (com PIN): o terminal manda o preço original do item.
    if it ? 'preco_original' and it ->> 'preco_original' is not null
       and (it ->> 'preco_original')::int <> (it ->> 'preco_unitario')::int then
      v_corrigidos := v_corrigidos || jsonb_build_object('produto_id', it ->> 'produto_id', 'descricao', it ->> 'descricao',
        'de', (it ->> 'preco_original')::int, 'para', (it ->> 'preco_unitario')::int, 'quantidade', (it ->> 'quantidade')::int);
    end if;
    -- RF-24: estoque pode ficar negativo
    insert into public.estoque_movimentos (produto_id, tipo, quantidade, origem_id)
    values ((it ->> 'produto_id')::uuid, 'venda', -(it ->> 'quantidade')::int, v_id);
  end loop;

  if jsonb_array_length(v_corrigidos) > 0 then
    perform public.checar_pin(payload ->> 'pin_preco');
    perform public.registrar_auditoria('preco_corrigido_venda', 'vendas', v_id, jsonb_build_object('itens', v_corrigidos));
  end if;

  select coalesce(sum(coalesce((x ->> 'parcelas')::int, 1)), 0) into v_total_parc
  from jsonb_array_elements(payload -> 'pagamentos') x where x ->> 'forma' = 'fiado';

  for pg in select * from jsonb_array_elements(payload -> 'pagamentos') loop
    v_forma := pg ->> 'forma';
    v_valor := (pg ->> 'valor')::int;
    if v_valor is null or v_valor <= 0 then raise exception 'Pagamento com valor inválido.'; end if;
    v_parc := coalesce((pg ->> 'parcelas')::int, 1);
    v_taxa := 0;
    v_rec := null;

    v_cobrado := v_valor;
    if v_forma = 'cartao' then
      if v_parc not between 1 and 12 then raise exception 'Parcelas do cartão entre 1 e 12.'; end if;
      -- A loja pode repassar a taxa: passa na maquininha um valor maior (valor_recebido).
      -- O que passa do pagamento é acréscimo, não troco; o total da venda não muda.
      v_cobrado := coalesce((pg ->> 'valor_recebido')::int, v_valor);
      if v_cobrado < v_valor then raise exception 'Valor cobrado no cartão menor que o pagamento.'; end if;
      v_rec := v_cobrado;
      v_taxa := round(v_cobrado * coalesce((v_cfg.taxas_cartao ->> v_parc::text)::numeric, 0) / 10000);
    elsif v_forma = 'debito' then
      v_taxa := round(v_valor * v_cfg.taxa_debito::numeric / 10000);
    elsif v_forma = 'dinheiro' then
      v_rec := coalesce((pg ->> 'valor_recebido')::int, v_valor);
      if v_rec < v_valor then raise exception 'Valor recebido em dinheiro menor que o pagamento.'; end if;
    elsif v_forma not in ('pix','fiado') then
      raise exception 'Forma de pagamento inválida: %', v_forma;
    end if;

    insert into public.venda_pagamentos (venda_id, forma, valor, parcelas_cartao, taxa, valor_liquido, valor_recebido, troco, acrescimo)
    values (v_id, v_forma, v_valor, case when v_forma = 'cartao' then v_parc end, v_taxa, v_cobrado - v_taxa, v_rec,
            case when v_forma = 'dinheiro' then v_rec - v_valor else 0 end, v_cobrado - v_valor)
    returning id into v_pg_id;

    if v_forma = 'fiado' then
      if pg ->> 'primeiro_vencimento' is null then raise exception 'Informe o primeiro vencimento do crediário.'; end if;
      if coalesce(pg ->> 'prazo', 'mensal') not in ('mensal','quinzenal','semanal') then raise exception 'Prazo do crediário inválido.'; end if;
      v_base := v_valor / v_parc;  -- divisão inteira; centavos na última
      for i in 1..v_parc loop
        v_num := v_num + 1;
        insert into public.parcelas (venda_id, cliente_id, numero, total_parcelas, valor, vencimento)
        values (v_id, v_cliente, v_num, v_total_parc,
                case when i = v_parc then v_valor - v_base * (v_parc - 1) else v_base end,
                case coalesce(pg ->> 'prazo', 'mensal')
                  when 'quinzenal' then (pg ->> 'primeiro_vencimento')::date + 15 * (i - 1)
                  when 'semanal' then (pg ->> 'primeiro_vencimento')::date + 7 * (i - 1)
                  else ((pg ->> 'primeiro_vencimento')::date + make_interval(months => i - 1))::date
                end);
      end loop;
    elsif v_forma in ('cartao','debito') then
      -- Recebíveis previstos (fase 2 usa para conciliar com a maquininha): sobre o valor cobrado
      v_base := v_cobrado / v_parc;
      for i in 1..v_parc loop
        insert into public.recebiveis_cartao (venda_pagamento_id, parcela, valor_bruto, taxa, valor_liquido, data_prevista)
        values (v_pg_id, i,
                case when i = v_parc then v_cobrado - v_base * (v_parc - 1) else v_base end,
                case when i = v_parc then v_taxa - (v_taxa / v_parc) * (v_parc - 1) else v_taxa / v_parc end,
                (case when i = v_parc then v_cobrado - v_base * (v_parc - 1) else v_base end)
                  - (case when i = v_parc then v_taxa - (v_taxa / v_parc) * (v_parc - 1) else v_taxa / v_parc end),
                public.hoje_loja() + (case when v_forma = 'debito' then 1 else 30 * i end));
      end loop;
    end if;
  end loop;

  update public.clientes set ultima_compra_em = now() where id = v_cliente;
  return public.venda_detalhe(v_id);
end $$;

