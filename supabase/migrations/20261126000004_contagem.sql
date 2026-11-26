-- ---------------------------------------------------------------------------
-- Contagem de estoque: a operadora conta vários produtos e, no fim, confirma com PIN.
-- Cada produto contado passa a ter exatamente a quantidade contada, numa única transação.
-- A diferença é calculada aqui, com o estoque do momento da confirmação.
-- ---------------------------------------------------------------------------
create or replace function public.registrar_contagem(itens jsonb, pin text default null) returns integer
language plpgsql security definer set search_path = public as $$
declare
  i jsonb;
  pid uuid;
  contado int;
  atual int;
  ajustados int := 0;
  detalhes jsonb := '[]'::jsonb;
begin
  perform public.exigir_papel(array['terminal','admin']);
  perform public.checar_pin(pin);
  if jsonb_typeof(itens) <> 'array' or jsonb_array_length(itens) = 0 then
    raise exception 'Nenhum produto contado.';
  end if;
  for i in select * from jsonb_array_elements(itens) loop
    pid := (i ->> 'produto_id')::uuid;
    contado := (i ->> 'contado')::int;
    if contado is null or contado < 0 then raise exception 'Quantidade contada inválida.'; end if;
    select estoque_atual into atual from public.produtos where id = pid for update;
    if not found then raise exception 'Produto não encontrado.'; end if;
    if contado <> atual then
      insert into public.estoque_movimentos (produto_id, tipo, quantidade, motivo)
      values (pid, 'ajuste', contado - atual, 'contagem');
      ajustados := ajustados + 1;
      detalhes := detalhes || jsonb_build_object('produto_id', pid, 'de', atual, 'para', contado);
    end if;
  end loop;
  perform public.registrar_auditoria('contagem_estoque', 'produtos', null,
    jsonb_build_object('contados', jsonb_array_length(itens), 'ajustados', ajustados, 'itens', detalhes));
  return ajustados;
end $$;

revoke execute on function public.registrar_contagem(jsonb, text) from public, anon;
grant execute on function public.registrar_contagem(jsonb, text) to authenticated;
