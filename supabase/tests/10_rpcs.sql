-- Testes das RPCs: venda, idempotência, recebimento abatendo as parcelas mais antigas,
-- cancelamento com PIN, estorno e permissões (RNF-11).
\set ON_ERROR_STOP 1

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","app_metadata":{"papel":"terminal"}}', false);

do $$
declare
  c uuid; pa uuid; pb uuid; v jsonb; v2 jsonb; r jsonb; n int; s text; g uuid;
  pay jsonb;
begin
  -- Cadastros pelo terminal
  c := (public.salvar_cliente('{"nome":"Rosa Almeida","telefone":"(92) 99812-4471"}')).id;
  pa := (public.salvar_produto('{"nome":"Essência Âmbar","codigo_barras":"789100","preco_venda":25000}')).id;
  pb := (public.salvar_produto('{"nome":"Flor de Lótus","preco_venda":12990}')).id;
  assert (select codigo_interno from public.produtos where id = pb) like 'INT%', 'gera código interno';

  -- Entrada de mercadoria e custo médio
  perform public.registrar_entrada(jsonb_build_array(jsonb_build_object('produto_id', pa, 'quantidade', 2, 'custo_unitario', 5000)));
  perform public.registrar_entrada(jsonb_build_array(jsonb_build_object('produto_id', pa, 'quantidade', 2, 'custo_unitario', 7000)));
  assert (select estoque_atual from public.produtos where id = pa) = 4, 'estoque após entrada';
  assert (select custo_medio from public.produtos where id = pa) = 6000, 'custo médio ponderado';

  -- Venda: PIX + dinheiro com troco + fiado em 2 parcelas
  pay := jsonb_build_object(
    'idempotency_key', 'venda-teste-0001', 'cliente_id', c, 'desconto', 0, 'para_entrega', true,
    'itens', jsonb_build_array(jsonb_build_object('produto_id', pa, 'descricao', 'Essência Âmbar', 'quantidade', 2, 'preco_unitario', 25000)),
    'pagamentos', jsonb_build_array(
      jsonb_build_object('forma', 'pix', 'valor', 15000),
      jsonb_build_object('forma', 'dinheiro', 'valor', 15000, 'valor_recebido', 20000),
      jsonb_build_object('forma', 'fiado', 'valor', 20001, 'parcelas', 2, 'primeiro_vencimento', '2026-12-26')));
  -- soma errada é recusada
  begin
    perform public.finalizar_venda(pay);
    raise exception 'esperava erro';
  exception when others then
    if sqlerrm = 'esperava erro' then raise; end if;
    assert sqlerrm like 'A soma dos pagamentos%', sqlerrm;
  end;
  pay := jsonb_set(pay, '{pagamentos,2,valor}', '20000');
  v := public.finalizar_venda(pay);
  assert (v ->> 'total')::int = 50000, 'total';
  assert jsonb_array_length(v -> 'parcelas') = 2, 'duas parcelas';
  assert (v -> 'parcelas' -> 1 ->> 'vencimento') = '2027-01-26', 'segundo vencimento mensal';
  assert (v -> 'pagamentos' -> 1 ->> 'troco')::int = 5000, 'troco';
  assert (v ->> 'saldo_cliente')::int = 20000, 'saldo da cliente no cupom';
  assert (select estoque_atual from public.produtos where id = pa) = 2, 'baixa de estoque';

  -- Idempotência: repetir não duplica
  v2 := public.finalizar_venda(pay);
  assert (v2 ->> 'numero') = (v ->> 'numero'), 'mesma venda';
  assert (select count(*) from public.vendas) = 1, 'sem duplicidade';

  -- Venda no cartão gera recebíveis com taxa
  v2 := public.finalizar_venda(jsonb_build_object(
    'idempotency_key', 'venda-teste-0002', 'cliente_id', c, 'desconto', 990, 'para_entrega', false,
    'itens', jsonb_build_array(jsonb_build_object('produto_id', pb, 'descricao', 'Flor de Lótus', 'quantidade', 1, 'preco_unitario', 12990)),
    -- passou 126,36 na maquininha: 6,36 de taxa repassada à cliente
    'pagamentos', jsonb_build_array(jsonb_build_object('forma', 'cartao', 'valor', 12000, 'parcelas', 3, 'valor_recebido', 12636))));
  assert (v2 ->> 'total')::int = 12000, 'taxa repassada não entra no total da venda';
  assert (v2 -> 'pagamentos' -> 0 ->> 'acrescimo')::int = 636, 'acréscimo do cartão';
  assert (v2 -> 'pagamentos' -> 0 ->> 'troco')::int = 0, 'cartão não dá troco';
  assert (v2 -> 'pagamentos' -> 0 ->> 'taxa')::int = round(12636 * 529 / 10000.0), 'taxa do cartão 3x sobre o cobrado';
  assert (v2 -> 'pagamentos' -> 0 ->> 'valor_liquido')::int = 12636 - round(12636 * 529 / 10000.0), 'líquido sobre o cobrado';
  begin
    perform public.finalizar_venda(jsonb_build_object(
      'idempotency_key', 'venda-teste-0003', 'cliente_id', c, 'desconto', 0, 'para_entrega', false,
      'itens', jsonb_build_array(jsonb_build_object('produto_id', pb, 'quantidade', 1, 'preco_unitario', 1000)),
      'pagamentos', jsonb_build_array(jsonb_build_object('forma', 'pix', 'valor', 1000, 'valor_recebido', 0))));
    perform public.finalizar_venda(jsonb_build_object(
      'idempotency_key', 'venda-teste-0004', 'cliente_id', c, 'desconto', 0, 'para_entrega', false,
      'itens', jsonb_build_array(jsonb_build_object('produto_id', pb, 'quantidade', 1, 'preco_unitario', 1000)),
      'pagamentos', jsonb_build_array(jsonb_build_object('forma', 'cartao', 'valor', 1000, 'valor_recebido', 900))));
    raise exception 'esperava erro';
  exception when others then
    if sqlerrm = 'esperava erro' then raise; end if;
    assert sqlerrm like 'Valor cobrado no cartão menor%', sqlerrm;
  end;
  assert (select estoque_atual from public.produtos where id = pb) = -1, 'estoque pode ficar negativo';

  -- Recebimento parcial: 13000 abate 10000 da 1ª e 3000 da 2ª
  r := public.registrar_recebimento(c, '[{"forma":"pix","valor":8000},{"forma":"dinheiro","valor":5000}]');
  assert (r ->> 'saldo_restante')::int = 7000, 'saldo depois do recebimento: ' || (r ->> 'saldo_restante');
  assert (r -> 'abatimentos' -> 0 ->> 'valor')::int = 10000 and (r -> 'abatimentos' -> 0 ->> 'quitada')::boolean, 'quita a mais antiga';
  assert (r -> 'abatimentos' -> 1 ->> 'valor')::int = 3000, 'abate o resto da seguinte';
  assert (select status from public.parcelas where numero = 2 and venda_id = (v ->> 'id')::uuid) = 'parcial', 'parcial';
  assert (select count(*) from public.recebimento_parcelas) = 3, 'ligações recebimento↔parcela: 8000→p1, 2000→p1, 3000→p2';
  g := (r ->> 'grupo_id')::uuid;

  -- Valor acima do devido é recusado
  begin
    perform public.registrar_recebimento(c, '[{"forma":"pix","valor":7001}]');
    raise exception 'esperava erro';
  exception when others then
    if sqlerrm = 'esperava erro' then raise; end if;
  end;

  -- Cancelar: PIN errado recusa; com pagamento recusa
  begin
    perform public.cancelar_venda((v ->> 'id')::uuid, 'teste', '0000');
    raise exception 'esperava erro';
  exception when others then
    if sqlerrm = 'esperava erro' then raise; end if;
    assert sqlerrm = 'PIN incorreto.', sqlerrm;
  end;
  begin
    perform public.cancelar_venda((v ->> 'id')::uuid, 'teste', '1234');
    raise exception 'esperava erro';
  exception when others then
    if sqlerrm = 'esperava erro' then raise; end if;
    assert sqlerrm like '%Estorne o recebimento%', sqlerrm;
  end;

  -- Estorno devolve as parcelas; depois o cancelamento funciona
  perform public.estornar_recebimento(g, 'lançado errado', '1234');
  assert (select sum(valor_pago) from public.parcelas) = 0, 'estorno zera os pagamentos';
  perform public.cancelar_venda((v ->> 'id')::uuid, 'cliente desistiu', '1234');
  assert (select status from public.vendas where id = (v ->> 'id')::uuid) = 'cancelada', 'venda cancelada';
  assert (select count(*) from public.parcelas where status = 'cancelada') = 2, 'parcelas canceladas';
  assert (select estoque_atual from public.produtos where id = pa) = 4, 'estoque estornado';
  assert public.saldo_cliente(c) = 0, 'sem saldo';

  -- Ajuste de estoque com PIN
  perform public.ajustar_estoque(pa, -1, 'quebra', '1234');
  assert (select estoque_atual from public.produtos where id = pa) = 3, 'ajuste';

  -- Contagem: sem PIN é recusada e nada muda; com PIN cada produto fica com o contado
  begin
    perform public.registrar_contagem(jsonb_build_array(jsonb_build_object('produto_id', pa, 'contado', 7)), '0000');
    raise exception 'esperava erro';
  exception when others then
    if sqlerrm = 'esperava erro' then raise; end if;
  end;
  assert (select estoque_atual from public.produtos where id = pa) = 3, 'contagem sem PIN não muda';
  assert public.registrar_contagem(jsonb_build_array(jsonb_build_object('produto_id', pa, 'contado', 7)), '1234') = 1, 'contagem ajusta 1';
  assert (select estoque_atual from public.produtos where id = pa) = 7, 'contagem fixa o contado';

  -- Tela de preços: sem PIN é recusada; com PIN muda só o que é diferente
  begin
    perform public.atualizar_precos(jsonb_build_array(jsonb_build_object('produto_id', pa, 'preco_venda', 9990)), '0000');
    raise exception 'esperava erro';
  exception when others then
    if sqlerrm = 'esperava erro' then raise; end if;
  end;
  assert public.atualizar_precos(jsonb_build_array(
    jsonb_build_object('produto_id', pa, 'preco_venda', 9990),
    jsonb_build_object('produto_id', pb, 'preco_venda', (select preco_venda from public.produtos where id = pb))), '1234') = 1, 'atualiza 1 preço';
  assert (select preco_venda from public.produtos where id = pa) = 9990, 'preço novo';

  -- Preço corrigido na venda: sem PIN é recusado; com PIN vende pelo preço corrigido e o cadastro não muda
  begin
    perform public.finalizar_venda(jsonb_build_object(
      'idempotency_key', 'venda-teste-preco-1', 'cliente_id', c, 'desconto', 0, 'para_entrega', false,
      'itens', jsonb_build_array(jsonb_build_object('produto_id', pa, 'descricao', 'Essência Âmbar', 'quantidade', 1, 'preco_unitario', 8000, 'preco_original', 9990)),
      'pagamentos', jsonb_build_array(jsonb_build_object('forma', 'pix', 'valor', 8000))));
    raise exception 'esperava erro';
  exception when others then
    if sqlerrm = 'esperava erro' then raise; end if;
    assert sqlerrm like 'PIN incorreto%', sqlerrm;
  end;
  v2 := public.finalizar_venda(jsonb_build_object(
    'idempotency_key', 'venda-teste-preco-2', 'cliente_id', c, 'desconto', 0, 'para_entrega', false, 'pin_preco', '1234',
    'itens', jsonb_build_array(jsonb_build_object('produto_id', pa, 'descricao', 'Essência Âmbar', 'quantidade', 1, 'preco_unitario', 8000, 'preco_original', 9990)),
    'pagamentos', jsonb_build_array(jsonb_build_object('forma', 'pix', 'valor', 8000))));
  assert (v2 ->> 'total')::int = 8000, 'vendeu pelo preço corrigido';
  assert (select preco_venda from public.produtos where id = pa) = 9990, 'cadastro não muda';
  perform public.cancelar_venda((v2 ->> 'id')::uuid, 'teste', '1234');
  assert public.registrar_contagem(jsonb_build_array(jsonb_build_object('produto_id', pa, 'contado', 7)), '1234') = 0, 'contagem igual não gera movimento';

  -- Alterar preço sem PIN é recusado
  begin
    perform public.salvar_produto(jsonb_build_object('id', pa, 'nome', 'Essência Âmbar', 'preco_venda', 1), null);
    raise exception 'esperava erro';
  exception when others then
    if sqlerrm = 'esperava erro' then raise; end if;
  end;

  -- Permissões do terminal (RLS)
  select count(*) into n from public.auditoria;
  assert n = 0, 'terminal não lê auditoria';
  select count(*) into n from public.config_loja;
  assert n = 0, 'terminal não lê configurações';
  assert (public.config_publica() ? 'nome') and not (public.config_publica() ? 'pin_hash'), 'config pública sem PIN';
  begin
    perform public.trocar_pin('9999');
    raise exception 'esperava erro';
  exception when others then
    if sqlerrm = 'esperava erro' then raise; end if;
    assert sqlerrm like 'Sem permissão%', sqlerrm;
  end;
  begin
    insert into public.vendas (cliente_id, subtotal, total, idempotency_key) values (c, 1, 1, 'direto');
    raise exception 'esperava erro';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.painel(current_date, current_date);
    raise exception 'esperava erro';
  exception when others then
    if sqlerrm = 'esperava erro' then raise; end if;
  end;

  raise notice 'RPCs do terminal: OK';
end $$;

-- Admin vê auditoria e painel
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","app_metadata":{"papel":"admin"}}', false);
do $$
begin
  assert (select count(*) from public.auditoria) >= 3, 'auditoria registrada';
  assert (select count(*) from public.auditoria where ator = 'terminal' and acao = 'cancelar_venda') = 2, 'ator terminal';
  assert (select count(*) from public.auditoria where acao = 'contagem_estoque') = 2, 'contagem auditada';
  assert (select count(*) from public.auditoria where acao = 'alterar_preco') >= 1, 'preço auditado';
  assert (select count(*) from public.auditoria where acao = 'preco_corrigido_venda') = 1, 'correção na venda auditada';
  assert (public.painel(public.hoje_loja(), public.hoje_loja()) ->> 'vendas_qtd')::int = 1, 'painel conta só concluídas';
  assert (select sum(valor_bruto) from public.recebiveis_cartao) = 12636, 'recebíveis sobre o cobrado';
  assert (public.painel(public.hoje_loja(), public.hoje_loja()) ->> 'acrescimo_cartao')::int = 636, 'painel mostra a taxa repassada';
  assert (public.painel(public.hoje_loja(), public.hoje_loja()) ->> 'vendido')::int = 12000, 'vendido sem a taxa repassada';
  perform public.trocar_pin('4321');
  perform public.ajustar_estoque((select id from public.produtos limit 1), 1, 'contagem');  -- admin sem PIN
  raise notice 'RPCs do admin: OK';
end $$;

-- Crediário com prazo quinzenal e semanal (depois das contagens acima)
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","app_metadata":{"papel":"terminal"}}', false);
do $$
declare c uuid; p uuid; v jsonb;
begin
  c := (public.salvar_cliente('{"nome":"Cliente Prazo","telefone":"(92) 99000-0000"}')).id;
  p := (public.salvar_produto('{"nome":"Produto Prazo","preco_venda":9000}')).id;
  perform public.registrar_entrada(jsonb_build_array(jsonb_build_object('produto_id', p, 'quantidade', 5, 'custo_unitario', 1000)));
  v := public.finalizar_venda(jsonb_build_object(
    'idempotency_key', 'venda-prazo-q', 'cliente_id', c, 'desconto', 0, 'para_entrega', false,
    'itens', jsonb_build_array(jsonb_build_object('produto_id', p, 'descricao', 'Produto Prazo', 'quantidade', 1, 'preco_unitario', 9000)),
    'pagamentos', jsonb_build_array(jsonb_build_object('forma', 'fiado', 'valor', 9000, 'parcelas', 3, 'primeiro_vencimento', '2026-12-10', 'prazo', 'quinzenal'))));
  assert (v -> 'parcelas' -> 1 ->> 'vencimento') = '2026-12-25', 'quinzenal: +15 dias';
  assert (v -> 'parcelas' -> 2 ->> 'vencimento') = '2027-01-09', 'quinzenal: +30 dias';
  v := public.finalizar_venda(jsonb_build_object(
    'idempotency_key', 'venda-prazo-s', 'cliente_id', c, 'desconto', 0, 'para_entrega', false,
    'itens', jsonb_build_array(jsonb_build_object('produto_id', p, 'descricao', 'Produto Prazo', 'quantidade', 1, 'preco_unitario', 9000)),
    'pagamentos', jsonb_build_array(jsonb_build_object('forma', 'fiado', 'valor', 9000, 'parcelas', 2, 'primeiro_vencimento', '2026-12-03', 'prazo', 'semanal'))));
  assert (v -> 'parcelas' -> 1 ->> 'vencimento') = '2026-12-10', 'semanal: +7 dias';
  begin
    perform public.finalizar_venda(jsonb_build_object(
      'idempotency_key', 'venda-prazo-x', 'cliente_id', c, 'desconto', 0, 'para_entrega', false,
      'itens', jsonb_build_array(jsonb_build_object('produto_id', p, 'descricao', 'Produto Prazo', 'quantidade', 1, 'preco_unitario', 9000)),
      'pagamentos', jsonb_build_array(jsonb_build_object('forma', 'fiado', 'valor', 9000, 'parcelas', 2, 'primeiro_vencimento', '2026-12-03', 'prazo', 'anual'))));
    raise exception 'esperava erro';
  exception when others then
    if sqlerrm = 'esperava erro' then raise; end if;
    assert sqlerrm like 'Prazo do crediário%', sqlerrm;
  end;
  raise notice 'Crediário com prazo: OK';
end $$;
reset role;

-- Anônimo não executa nada
reset role;
set role anon;
do $$
begin
  begin
    perform public.finalizar_venda('{}');
    raise exception 'esperava erro';
  exception when insufficient_privilege then null;
  end;
  raise notice 'Anônimo bloqueado: OK';
end $$;
reset role;
