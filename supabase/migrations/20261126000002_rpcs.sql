-- Funções transacionais (RPC). Toda operação que mexe em mais de uma tabela passa por aqui.
-- Todas são SECURITY DEFINER e conferem o papel do usuário logado.

-- ---------------------------------------------------------------------------
-- Utilitários
-- ---------------------------------------------------------------------------
create or replace function public.exigir_papel(papeis text[]) returns text
language plpgsql stable as $$
declare p text := public.app_papel();
begin
  if not (p = any(papeis)) then
    raise exception 'Sem permissão para esta ação.' using errcode = '42501';
  end if;
  return p;
end $$;

-- Admin passa direto; o terminal precisa do PIN de 4 dígitos.
create or replace function public.checar_pin(pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare h text;
begin
  if public.app_papel() = 'admin' then return; end if;
  select pin_hash into h from public.config_loja;
  if pin is null or h is null or extensions.crypt(pin, h) <> h then
    raise exception 'PIN incorreto.' using errcode = 'P0001';
  end if;
end $$;

create or replace function public.registrar_auditoria(acao text, entidade text, entidade_id uuid, dados jsonb) returns void
language sql security definer set search_path = public as $$
  insert into public.auditoria (ator, acao, entidade, entidade_id, dados)
  values (case when public.app_papel() = 'admin' then 'admin' else 'terminal' end, acao, entidade, entidade_id, dados);
$$;

create or replace function public.saldo_cliente(p_cliente uuid) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce(sum(valor - valor_pago), 0)::int from public.parcelas
  where cliente_id = p_cliente and status in ('aberta','parcial');
$$;

-- Venda completa no formato usado pela interface e pelo cupom.
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
              'valor_liquido', p.valor_liquido, 'valor_recebido', p.valor_recebido, 'troco', p.troco) order by p.ctid) from public.venda_pagamentos p where p.venda_id = v.id), '[]'),
    'parcelas', coalesce((select jsonb_agg(jsonb_build_object('numero', pa.numero, 'valor', pa.valor, 'vencimento', pa.vencimento) order by pa.numero)
              from public.parcelas pa where pa.venda_id = v.id), '[]'),
    'saldo_cliente', public.saldo_cliente(v.cliente_id)
  )
  from public.vendas v join public.clientes c on c.id = v.cliente_id
  where v.id = p_venda and public.app_papel() in ('terminal','admin');
$$;

-- Configuração sem o hash do PIN, para o terminal montar o cupom e a tela.
create or replace function public.config_publica() returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(c) - 'pin_hash' - 'id' from public.config_loja c
  where public.app_papel() in ('terminal','admin');
$$;

create or replace function public.conferir_pin(pin text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public.exigir_papel(array['terminal','admin']);
  return exists (select 1 from public.config_loja where extensions.crypt(pin, pin_hash) = pin_hash);
end $$;

-- ---------------------------------------------------------------------------
-- finalizar_venda (RF-16): uma única transação, idempotente.
-- ---------------------------------------------------------------------------
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

    if v_forma = 'cartao' then
      if v_parc not between 1 and 12 then raise exception 'Parcelas do cartão entre 1 e 12.'; end if;
      v_taxa := round(v_valor * coalesce((v_cfg.taxas_cartao ->> v_parc::text)::numeric, 0) / 10000);
    elsif v_forma = 'debito' then
      v_taxa := round(v_valor * v_cfg.taxa_debito::numeric / 10000);
    elsif v_forma = 'dinheiro' then
      v_rec := coalesce((pg ->> 'valor_recebido')::int, v_valor);
      if v_rec < v_valor then raise exception 'Valor recebido em dinheiro menor que o pagamento.'; end if;
    elsif v_forma not in ('pix','fiado') then
      raise exception 'Forma de pagamento inválida: %', v_forma;
    end if;

    insert into public.venda_pagamentos (venda_id, forma, valor, parcelas_cartao, taxa, valor_liquido, valor_recebido, troco)
    values (v_id, v_forma, v_valor, case when v_forma = 'cartao' then v_parc end, v_taxa, v_valor - v_taxa, v_rec,
            case when v_forma = 'dinheiro' then v_rec - v_valor else 0 end)
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
      -- Recebíveis previstos (fase 2 usa para conciliar com a maquininha)
      v_base := v_valor / v_parc;
      for i in 1..v_parc loop
        insert into public.recebiveis_cartao (venda_pagamento_id, parcela, valor_bruto, taxa, valor_liquido, data_prevista)
        values (v_pg_id, i,
                case when i = v_parc then v_valor - v_base * (v_parc - 1) else v_base end,
                case when i = v_parc then v_taxa - (v_taxa / v_parc) * (v_parc - 1) else v_taxa / v_parc end,
                (case when i = v_parc then v_valor - v_base * (v_parc - 1) else v_base end)
                  - (case when i = v_parc then v_taxa - (v_taxa / v_parc) * (v_parc - 1) else v_taxa / v_parc end),
                public.hoje_loja() + (case when v_forma = 'debito' then 1 else 30 * i end));
      end loop;
    end if;
  end loop;

  update public.clientes set ultima_compra_em = now() where id = v_cliente;
  return public.venda_detalhe(v_id);
end $$;

-- ---------------------------------------------------------------------------
-- cancelar_venda (RF-18)
-- ---------------------------------------------------------------------------
create or replace function public.cancelar_venda(venda_id uuid, motivo text, pin text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v public.vendas;
begin
  perform public.exigir_papel(array['terminal','admin']);
  perform public.checar_pin(pin);
  if coalesce(trim(motivo), '') = '' then raise exception 'Informe o motivo.'; end if;

  select * into v from public.vendas where id = venda_id for update;
  if not found then raise exception 'Venda não encontrada.'; end if;
  if v.status = 'cancelada' then raise exception 'Essa venda já está cancelada.'; end if;
  if exists (select 1 from public.parcelas p where p.venda_id = v.id and p.valor_pago > 0) then
    raise exception 'Essa venda tem parcela com pagamento. Estorne o recebimento primeiro.';
  end if;

  update public.vendas set status = 'cancelada', cancelada_em = now(), motivo_cancelamento = motivo where id = v.id;
  update public.parcelas set status = 'cancelada' where parcelas.venda_id = v.id;
  update public.recebiveis_cartao r set status = 'cancelado'
    from public.venda_pagamentos vp where vp.id = r.venda_pagamento_id and vp.venda_id = v.id;
  insert into public.estoque_movimentos (produto_id, tipo, quantidade, origem_id, motivo)
    select i.produto_id, 'cancelamento', i.quantidade, v.id, motivo from public.venda_itens i
    where i.venda_id = v.id and i.produto_id is not null;
  perform public.registrar_auditoria('cancelar_venda', 'vendas', v.id, jsonb_build_object('numero', v.numero, 'total', v.total, 'motivo', motivo));
end $$;

-- ---------------------------------------------------------------------------
-- registrar_recebimento (RF-41/42): abate das parcelas mais antigas para as mais novas.
-- pagamentos: [{ "forma": "pix", "valor": 10000 }, ...]
-- ---------------------------------------------------------------------------
create or replace function public.registrar_recebimento(cliente_id uuid, pagamentos jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cli uuid := cliente_id;
  v_grupo uuid := gen_random_uuid();
  v_total int;
  v_devido int;
  r record;
  pa record;
  v_rec_id uuid;
  v_rec_resta int;
  v_ab int;
  v_ab_orig int;
  v_parte int;
  v_abat jsonb := '[]';
  v_ts timestamptz := now();
  v_recs uuid[] := '{}';
  v_valores int[] := '{}';
  ri int := 1;
begin
  perform public.exigir_papel(array['terminal','admin']);
  if jsonb_array_length(coalesce(pagamentos, '[]')) = 0 then raise exception 'Informe como ela pagou.'; end if;

  select coalesce(sum((x ->> 'valor')::int), 0) into v_total from jsonb_array_elements(pagamentos) x;
  if v_total <= 0 or exists (select 1 from jsonb_array_elements(pagamentos) x where (x ->> 'valor')::int <= 0) then
    raise exception 'Informe o valor recebido.';
  end if;

  perform 1 from public.parcelas p where p.cliente_id = v_cli and p.status in ('aberta','parcial') for update;
  v_devido := public.saldo_cliente(v_cli);
  if v_total > v_devido then raise exception 'O valor é maior do que ela deve.'; end if;

  for r in select x ->> 'forma' as forma, (x ->> 'valor')::int as valor from jsonb_array_elements(pagamentos) x loop
    if r.forma not in ('pix','dinheiro','cartao','debito') then raise exception 'Forma inválida: %', r.forma; end if;
    insert into public.recebimentos (grupo_id, cliente_id, valor, forma, recebido_em)
    values (v_grupo, v_cli, r.valor, r.forma, v_ts) returning id into v_rec_id;
    v_recs := v_recs || v_rec_id;
    v_valores := v_valores || r.valor;
  end loop;

  v_rec_resta := v_valores[1];
  for pa in
    select p.* from public.parcelas p
    where p.cliente_id = v_cli and p.status in ('aberta','parcial')
    order by p.vencimento, p.numero
  loop
    exit when v_total <= 0;
    v_ab := least(pa.valor - pa.valor_pago, v_total);
    v_ab_orig := v_ab;
    v_total := v_total - v_ab;
    update public.parcelas set valor_pago = valor_pago + v_ab,
      status = case when valor_pago + v_ab >= valor then 'paga' else 'parcial' end
    where id = pa.id;
    -- liga cada linha de recebimento às parcelas que abateu
    while v_ab > 0 loop
      v_parte := least(v_ab, v_rec_resta);
      insert into public.recebimento_parcelas (recebimento_id, parcela_id, valor) values (v_recs[ri], pa.id, v_parte);
      v_ab := v_ab - v_parte;
      v_rec_resta := v_rec_resta - v_parte;
      if v_rec_resta = 0 and ri < array_length(v_recs, 1) then
        ri := ri + 1;
        v_rec_resta := v_valores[ri];
      end if;
    end loop;
    v_abat := v_abat || jsonb_build_object(
      'venda_numero', (select numero from public.vendas where id = pa.venda_id),
      'numero', pa.numero, 'total_parcelas', pa.total_parcelas, 'vencimento', pa.vencimento,
      'valor', v_ab_orig,
      'quitada', v_ab_orig = pa.valor - pa.valor_pago);
  end loop;

  return jsonb_build_object(
    'grupo_id', v_grupo,
    'cliente', (select jsonb_build_object('nome', nome, 'telefone', telefone) from public.clientes where id = v_cli),
    'recebido_em', v_ts,
    'pagamentos', pagamentos,
    'total', (select sum(valor) from public.recebimentos where grupo_id = v_grupo),
    'abatimentos', v_abat,
    'saldo_restante', public.saldo_cliente(v_cli));
end $$;

-- ---------------------------------------------------------------------------
-- estornar_recebimento (RF-44)
-- ---------------------------------------------------------------------------
create or replace function public.estornar_recebimento(grupo_id uuid, motivo text, pin text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_grupo uuid := grupo_id; rp record; v_valor int;
begin
  perform public.exigir_papel(array['terminal','admin']);
  perform public.checar_pin(pin);
  select sum(valor) into v_valor from public.recebimentos r where r.grupo_id = v_grupo and not r.estornado;
  if v_valor is null then raise exception 'Recebimento não encontrado ou já estornado.'; end if;

  for rp in
    select x.parcela_id, sum(x.valor)::int as valor from public.recebimento_parcelas x
    join public.recebimentos r on r.id = x.recebimento_id
    where r.grupo_id = v_grupo and not r.estornado group by x.parcela_id
  loop
    update public.parcelas set valor_pago = valor_pago - rp.valor,
      status = case when status = 'cancelada' then status when valor_pago - rp.valor <= 0 then 'aberta' else 'parcial' end
    where id = rp.parcela_id;
  end loop;
  update public.recebimentos r set estornado = true, estornado_em = now(), motivo_estorno = motivo
  where r.grupo_id = v_grupo and not r.estornado;
  perform public.registrar_auditoria('estornar_recebimento', 'recebimentos', v_grupo, jsonb_build_object('valor', v_valor, 'motivo', motivo));
end $$;

-- ---------------------------------------------------------------------------
-- registrar_entrada (RF-21): itens [{ produto_id, quantidade, custo_unitario }]
-- ---------------------------------------------------------------------------
create or replace function public.registrar_entrada(itens jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_compra uuid; it jsonb; p public.produtos; q int; c int; v_total int := 0;
begin
  perform public.exigir_papel(array['terminal','admin']);
  if jsonb_array_length(coalesce(itens, '[]')) = 0 then raise exception 'Nenhum produto na lista.'; end if;
  insert into public.compras default values returning id into v_compra;
  for it in select * from jsonb_array_elements(itens) loop
    q := (it ->> 'quantidade')::int;
    c := coalesce((it ->> 'custo_unitario')::int, 0);
    if q is null or q <= 0 then raise exception 'Quantidade inválida.'; end if;
    select * into p from public.produtos where id = (it ->> 'produto_id')::uuid for update;
    if not found then raise exception 'Produto não encontrado.'; end if;
    update public.produtos set custo_medio = case when p.estoque_atual <= 0 then c
      else round((p.estoque_atual * p.custo_medio + q * c)::numeric / (p.estoque_atual + q)) end
    where id = p.id;
    insert into public.compra_itens (compra_id, produto_id, quantidade, custo_unitario) values (v_compra, p.id, q, c);
    insert into public.estoque_movimentos (produto_id, tipo, quantidade, custo_unitario, origem_id) values (p.id, 'entrada', q, c, v_compra);
    v_total := v_total + q * c;
  end loop;
  update public.compras set total = v_total where id = v_compra;
  return v_compra;
end $$;

-- ---------------------------------------------------------------------------
-- ajustar_estoque (RF-23)
-- ---------------------------------------------------------------------------
create or replace function public.ajustar_estoque(produto_id uuid, quantidade integer, motivo text, pin text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_papel(array['terminal','admin']);
  perform public.checar_pin(pin);
  if coalesce(trim(motivo), '') = '' then raise exception 'Informe o motivo.'; end if;
  if quantidade = 0 then raise exception 'Quantidade inválida.'; end if;
  insert into public.estoque_movimentos (produto_id, tipo, quantidade, motivo) values (produto_id, 'ajuste', quantidade, motivo);
  perform public.registrar_auditoria('ajustar_estoque', 'produtos', produto_id, jsonb_build_object('quantidade', quantidade, 'motivo', motivo));
end $$;

-- ---------------------------------------------------------------------------
-- Cadastros (o terminal cadastra cliente e produto; preço só muda com PIN)
-- ---------------------------------------------------------------------------
create or replace function public.salvar_cliente(dados jsonb) returns public.clientes
language plpgsql security definer set search_path = public as $$
declare r public.clientes;
begin
  perform public.exigir_papel(array['terminal','admin']);
  if coalesce(trim(dados ->> 'nome'), '') = '' or length(regexp_replace(coalesce(dados ->> 'telefone', ''), '\D', '', 'g')) < 8 then
    raise exception 'Nome e telefone são obrigatórios.';
  end if;
  if dados ? 'id' and dados ->> 'id' is not null then
    update public.clientes set
      nome = trim(dados ->> 'nome'), telefone = dados ->> 'telefone',
      endereco = dados ->> 'endereco', bairro = dados ->> 'bairro', referencia = dados ->> 'referencia',
      observacoes = dados ->> 'observacoes',
      limite_credito = case when public.app_papel() = 'admin' then (dados ->> 'limite_credito')::int else limite_credito end
    where id = (dados ->> 'id')::uuid returning * into r;
  else
    insert into public.clientes (nome, telefone, endereco, bairro, referencia, observacoes, limite_credito)
    values (trim(dados ->> 'nome'), dados ->> 'telefone', dados ->> 'endereco', dados ->> 'bairro', dados ->> 'referencia',
            dados ->> 'observacoes', case when public.app_papel() = 'admin' then (dados ->> 'limite_credito')::int end)
    returning * into r;
  end if;
  return r;
end $$;

create or replace function public.salvar_produto(dados jsonb, pin text default null) returns public.produtos
language plpgsql security definer set search_path = public as $$
declare r public.produtos; antigo int;
begin
  perform public.exigir_papel(array['terminal','admin']);
  if dados ? 'id' and dados ->> 'id' is not null then
    select preco_venda into antigo from public.produtos where id = (dados ->> 'id')::uuid;
    if antigo is distinct from (dados ->> 'preco_venda')::int then
      perform public.checar_pin(pin);
      perform public.registrar_auditoria('alterar_preco', 'produtos', (dados ->> 'id')::uuid,
        jsonb_build_object('de', antigo, 'para', (dados ->> 'preco_venda')::int));
    end if;
    update public.produtos set
      nome = trim(dados ->> 'nome'), marca = dados ->> 'marca', categoria = dados ->> 'categoria',
      volume_ml = (dados ->> 'volume_ml')::int, codigo_barras = nullif(trim(dados ->> 'codigo_barras'), ''),
      preco_venda = (dados ->> 'preco_venda')::int, estoque_minimo = coalesce((dados ->> 'estoque_minimo')::int, estoque_minimo),
      foto_url = dados ->> 'foto_url', ativo = coalesce((dados ->> 'ativo')::boolean, ativo)
    where id = (dados ->> 'id')::uuid returning * into r;
  else
    insert into public.produtos (nome, marca, categoria, volume_ml, codigo_barras, preco_venda, estoque_minimo, foto_url, ativo)
    values (trim(dados ->> 'nome'), dados ->> 'marca', dados ->> 'categoria', (dados ->> 'volume_ml')::int,
            nullif(trim(dados ->> 'codigo_barras'), ''), (dados ->> 'preco_venda')::int,
            coalesce((dados ->> 'estoque_minimo')::int, 1), dados ->> 'foto_url', coalesce((dados ->> 'ativo')::boolean, true))
    returning * into r;
  end if;
  return r;
exception when unique_violation then
  raise exception 'Já existe um produto com esse código.';
end $$;

-- Importação inicial de clientes com saldo em aberto (RF-34). Só admin.
-- linhas: [{ nome, telefone, endereco?, bairro?, saldo_aberto?, vencimento? }]
create or replace function public.importar_clientes(linhas jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare l jsonb; c public.clientes; v uuid; n int := 0;
begin
  perform public.exigir_papel(array['admin']);
  for l in select * from jsonb_array_elements(linhas) loop
    c := public.salvar_cliente(l - 'id');
    if coalesce((l ->> 'saldo_aberto')::int, 0) > 0 then
      insert into public.vendas (cliente_id, subtotal, total, idempotency_key)
      values (c.id, (l ->> 'saldo_aberto')::int, (l ->> 'saldo_aberto')::int, 'import-' || c.id) returning id into v;
      insert into public.venda_itens (venda_id, descricao, quantidade, preco_unitario) values (v, 'Saldo anterior (importado)', 1, (l ->> 'saldo_aberto')::int);
      insert into public.venda_pagamentos (venda_id, forma, valor, valor_liquido) values (v, 'fiado', (l ->> 'saldo_aberto')::int, (l ->> 'saldo_aberto')::int);
      insert into public.parcelas (venda_id, cliente_id, numero, total_parcelas, valor, vencimento)
      values (v, c.id, 1, 1, (l ->> 'saldo_aberto')::int, coalesce((l ->> 'vencimento')::date, public.hoje_loja()));
    end if;
    n := n + 1;
  end loop;
  perform public.registrar_auditoria('importar_clientes', 'clientes', null, jsonb_build_object('linhas', n));
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Consultas agregadas
-- ---------------------------------------------------------------------------
create or replace function public.resumo_receber() returns jsonb
language sql stable security definer set search_path = public as $$
  with ab as (
    select p.*, p.valor - p.valor_pago as resto from public.parcelas p
    where p.status in ('aberta','parcial') and public.app_papel() in ('terminal','admin')
  ), hoje as (select public.hoje_loja() as d)
  select jsonb_build_object(
    'total_aberto', coalesce((select sum(resto) from ab), 0),
    'total_vencido', coalesce((select sum(resto) from ab, hoje where vencimento < hoje.d), 0),
    'a_vencer_7', coalesce((select sum(resto) from ab, hoje where vencimento between hoje.d and hoje.d + 7), 0),
    'a_vencer_30', coalesce((select sum(resto) from ab, hoje where vencimento between hoje.d and hoje.d + 30), 0),
    'clientes', coalesce((
      select jsonb_agg(x order by x.dias_atraso desc, x.devido desc) from (
        select c.id as cliente_id, c.nome, c.telefone, sum(ab.resto)::int as devido,
          coalesce(sum(ab.resto) filter (where ab.vencimento < hoje.d), 0)::int as vencido,
          coalesce(hoje.d - min(ab.vencimento) filter (where ab.vencimento < hoje.d), 0) as dias_atraso
        from ab join public.clientes c on c.id = ab.cliente_id, hoje
        group by c.id, c.nome, c.telefone, hoje.d
      ) x), '[]'));
$$;

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
    'recebido_fiado', coalesce((select sum(valor) from public.recebimentos r
       where not r.estornado and (r.recebido_em at time zone 'America/Manaus')::date between desde and ate
       ), 0)));
end $$;

create or replace function public.salvar_config(dados jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_papel(array['admin']);
  update public.config_loja set
    nome = dados ->> 'nome', telefone = dados ->> 'telefone', instagram = dados ->> 'instagram',
    rodape_cupom = dados ->> 'rodape_cupom', taxas_cartao = dados -> 'taxas_cartao',
    taxa_debito = (dados ->> 'taxa_debito')::int,
    formas_ativas = array(select jsonb_array_elements_text(dados -> 'formas_ativas')),
    vias_fiado = (dados ->> 'vias_fiado')::boolean, teto_mei = dados -> 'teto_mei',
    fiado_max_parcelas = (dados ->> 'fiado_max_parcelas')::int, atualizado_em = now();
  perform public.registrar_auditoria('alterar_config', 'config_loja', null, dados);
end $$;

create or replace function public.trocar_pin(novo_pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public.exigir_papel(array['admin']);
  if novo_pin !~ '^\d{4}$' then raise exception 'O PIN tem 4 dígitos.'; end if;
  update public.config_loja set pin_hash = extensions.crypt(novo_pin, extensions.gen_salt('bf'));
  perform public.registrar_auditoria('trocar_pin', 'config_loja', null, null);
end $$;
