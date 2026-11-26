-- ---------------------------------------------------------------------------
-- Cartão com taxa repassada: a operadora pode passar na maquininha um valor maior que o
-- pagamento. A venda continua com o total dos produtos; o excedente fica em
-- venda_pagamentos.acrescimo (não é troco nem venda), e taxa, líquido e recebíveis
-- são calculados sobre o valor cobrado na maquininha (valor_recebido).
-- ---------------------------------------------------------------------------
alter table public.venda_pagamentos
  add column acrescimo integer not null default 0 check (acrescimo >= 0),
  add constraint acrescimo_so_no_cartao check (forma = 'cartao' or acrescimo = 0);

create or replace function public.venda_detalhe(p_venda uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', v.id, 'numero', v.numero, 'cliente_id', v.cliente_id, 'status', v.status,
    'subtotal', v.subtotal, 'desconto', v.desconto, 'total', v.total, 'para_entrega', v.para_entrega,
    'criada_em', v.criada_em, 'cancelada_em', v.cancelada_em, 'motivo_cancelamento', v.motivo_cancelamento,
    'cliente', jsonb_build_object('nome', c.nome, 'telefone', c.telefone, 'endereco', c.endereco, 'bairro', c.bairro, 'referencia', c.referencia),
    'itens', coalesce((select jsonb_agg(jsonb_build_object('produto_id', i.produto_id, 'descricao', i.descricao, 'quantidade', i.quantidade,
              'preco_unitario', i.preco_unitario, 'custo_unitario', i.custo_unitario) order by i.ctid) from public.venda_itens i where i.venda_id = v.id), '[]'),
    'pagamentos', coalesce((select jsonb_agg(jsonb_build_object('forma', p.forma, 'valor', p.valor, 'parcelas_cartao', p.parcelas_cartao, 'taxa', p.taxa,
              'valor_liquido', p.valor_liquido, 'valor_recebido', p.valor_recebido, 'troco', p.troco, 'acrescimo', p.acrescimo) order by p.ctid) from public.venda_pagamentos p where p.venda_id = v.id), '[]'),
    'parcelas', coalesce((select jsonb_agg(jsonb_build_object('numero', pa.numero, 'valor', pa.valor, 'vencimento', pa.vencimento) order by pa.numero)
              from public.parcelas pa where pa.venda_id = v.id), '[]'),
    'saldo_cliente', public.saldo_cliente(v.cliente_id)
  )
  from public.vendas v join public.clientes c on c.id = v.cliente_id
  where v.id = p_venda and public.app_papel() in ('terminal','admin');
$$;

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
    -- RF-24: estoque pode ficar negativo
    insert into public.estoque_movimentos (produto_id, tipo, quantidade, origem_id)
    values ((it ->> 'produto_id')::uuid, 'venda', -(it ->> 'quantidade')::int, v_id);
  end loop;

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
      if pg ->> 'primeiro_vencimento' is null then raise exception 'Informe o primeiro vencimento do fiado.'; end if;
      v_base := v_valor / v_parc;  -- divisão inteira; centavos na última
      for i in 1..v_parc loop
        v_num := v_num + 1;
        insert into public.parcelas (venda_id, cliente_id, numero, total_parcelas, valor, vencimento)
        values (v_id, v_cliente, v_num, v_total_parc,
                case when i = v_parc then v_valor - v_base * (v_parc - 1) else v_base end,
                ((pg ->> 'primeiro_vencimento')::date + make_interval(months => i - 1))::date);
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

create or replace function public.painel(desde date, ate date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_papel(array['admin']);
  return (
  with vs as (
    select * from public.vendas v
    where v.status = 'concluida' and (v.criada_em at time zone 'America/Manaus')::date between desde and ate
  )
  select jsonb_build_object(
    'vendas_qtd', (select count(*) from vs),
    'vendido', coalesce((select sum(total) from vs), 0),
    'por_forma', (select jsonb_build_object(
        'cartao', coalesce(sum(valor) filter (where forma = 'cartao'), 0),
        'pix', coalesce(sum(valor) filter (where forma = 'pix'), 0),
        'dinheiro', coalesce(sum(valor) filter (where forma = 'dinheiro'), 0),
        'fiado', coalesce(sum(valor) filter (where forma = 'fiado'), 0),
        'debito', coalesce(sum(valor) filter (where forma = 'debito'), 0))
      from public.venda_pagamentos where venda_id in (select id from vs)),
    -- Taxa da maquininha repassada à cliente: entra no cartão, mas não é venda de produto
    'acrescimo_cartao', coalesce((select sum(acrescimo) from public.venda_pagamentos where venda_id in (select id from vs)), 0),
    'recebido_fiado', coalesce((select sum(valor) from public.recebimentos r
       where not r.estornado and (r.recebido_em at time zone 'America/Manaus')::date between desde and ate
       ), 0)));
end $$;
