-- PDV Dalva Cosméticos — esquema principal
-- Regras: valores em centavos (integer), datas em timestamptz (exibidas em America/Manaus),
-- nada de negócio é apagado (status), chaves uuid, RLS em todas as tabelas.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Papel do usuário logado: vem de app_metadata.papel ('terminal' | 'admin')
-- ---------------------------------------------------------------------------
create or replace function public.app_papel() returns text
language sql stable as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'papel', '')
$$;

create or replace function public.hoje_loja() returns date
language sql stable as $$
  select (now() at time zone 'America/Manaus')::date
$$;

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------
create table public.config_loja (
  id boolean primary key default true check (id),           -- linha única
  nome text not null default 'Dalva Cosméticos',
  telefone text not null default '',
  instagram text not null default '',
  rodape_cupom text not null default 'Obrigada pela preferência!',
  taxas_cartao jsonb not null default '{"1":349,"2":459,"3":529,"4":599,"5":669,"6":739,"7":809,"8":879,"9":949,"10":1019,"11":1089,"12":1159}',
  taxa_debito integer not null default 199,                  -- pontos-base
  formas_ativas text[] not null default array['cartao','pix','dinheiro','fiado'],
  vias_fiado boolean not null default true,
  pin_hash text not null default extensions.crypt('1234', extensions.gen_salt('bf')),
  teto_mei jsonb not null default '{"2026":8100000,"2027":11000000,"2028":14000000}',
  fiado_max_parcelas integer not null default 4,
  atualizado_em timestamptz not null default now()
);
insert into public.config_loja default values;

create sequence public.produtos_codigo_interno_seq;

create table public.produtos (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(trim(nome)) > 0),
  marca text,
  categoria text,
  volume_ml integer,
  codigo_barras text unique,
  codigo_interno text not null unique default ('INT' || lpad(nextval('public.produtos_codigo_interno_seq')::text, 6, '0')),
  preco_venda integer not null check (preco_venda > 0),
  custo_medio integer not null default 0,
  estoque_minimo integer not null default 1,
  estoque_atual integer not null default 0,                  -- mantido por trigger
  foto_url text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create table public.estoque_movimentos (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null references public.produtos(id),
  tipo text not null check (tipo in ('entrada','venda','ajuste','cancelamento')),
  quantidade integer not null check (quantidade <> 0),
  custo_unitario integer,
  origem_id uuid,
  motivo text,
  criado_em timestamptz not null default now()
);
create index on public.estoque_movimentos (produto_id, criado_em desc);

create table public.clientes (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(trim(nome)) > 0),
  telefone text not null,
  telefone_digitos text generated always as (regexp_replace(telefone, '\D', '', 'g')) stored,
  endereco text,
  bairro text,
  referencia text,
  observacoes text,
  limite_credito integer,
  ativo boolean not null default true,
  ultima_compra_em timestamptz,
  criado_em timestamptz not null default now()
);
create index on public.clientes (telefone_digitos);
create index on public.clientes (lower(nome));

create sequence public.vendas_numero_seq start 1;

create table public.vendas (
  id uuid primary key default gen_random_uuid(),
  numero integer not null unique default nextval('public.vendas_numero_seq'),
  cliente_id uuid not null references public.clientes(id),
  status text not null default 'concluida' check (status in ('concluida','cancelada')),
  subtotal integer not null,
  desconto integer not null default 0 check (desconto >= 0),
  total integer not null check (total >= 0),
  para_entrega boolean not null default false,
  idempotency_key text not null unique,
  criada_em timestamptz not null default now(),
  cancelada_em timestamptz,
  motivo_cancelamento text
);
create index on public.vendas (criada_em desc);
create index on public.vendas (cliente_id);

create table public.venda_itens (
  id uuid primary key default gen_random_uuid(),
  venda_id uuid not null references public.vendas(id),
  produto_id uuid references public.produtos(id),
  descricao text not null,
  quantidade integer not null check (quantidade > 0),
  preco_unitario integer not null,
  custo_unitario integer not null default 0
);
create index on public.venda_itens (venda_id);

create table public.venda_pagamentos (
  id uuid primary key default gen_random_uuid(),
  venda_id uuid not null references public.vendas(id),
  forma text not null check (forma in ('cartao','pix','fiado','dinheiro','debito')),
  valor integer not null check (valor > 0),
  parcelas_cartao integer,
  taxa integer not null default 0,
  valor_liquido integer not null,
  valor_recebido integer,
  troco integer not null default 0,
  check (forma = 'dinheiro' or troco = 0)
);
create index on public.venda_pagamentos (venda_id);

create table public.parcelas (
  id uuid primary key default gen_random_uuid(),
  venda_id uuid not null references public.vendas(id),
  cliente_id uuid not null references public.clientes(id),
  numero integer not null,
  total_parcelas integer not null,
  valor integer not null check (valor > 0),
  valor_pago integer not null default 0 check (valor_pago >= 0),
  vencimento date not null,
  status text not null default 'aberta' check (status in ('aberta','parcial','paga','cancelada')),
  check (valor_pago <= valor)
);
create index on public.parcelas (cliente_id, vencimento);

create table public.recebimentos (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null,
  cliente_id uuid not null references public.clientes(id),
  valor integer not null check (valor > 0),
  forma text not null check (forma in ('cartao','pix','dinheiro','debito')),
  recebido_em timestamptz not null default now(),
  estornado boolean not null default false,
  estornado_em timestamptz,
  motivo_estorno text
);
create index on public.recebimentos (grupo_id);
create index on public.recebimentos (cliente_id);

create table public.recebimento_parcelas (
  id uuid primary key default gen_random_uuid(),
  recebimento_id uuid not null references public.recebimentos(id),
  parcela_id uuid not null references public.parcelas(id),
  valor integer not null check (valor > 0)
);

create table public.recebiveis_cartao (                     -- base da fase 2
  id uuid primary key default gen_random_uuid(),
  venda_pagamento_id uuid not null references public.venda_pagamentos(id),
  parcela integer not null,
  valor_bruto integer not null,
  taxa integer not null,
  valor_liquido integer not null,
  data_prevista date not null,
  status text not null default 'previsto' check (status in ('previsto','recebido','cancelado'))
);

create table public.fornecedores (                          -- fase 2
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  telefone text,
  observacoes text
);

create table public.compras (
  id uuid primary key default gen_random_uuid(),
  fornecedor_id uuid references public.fornecedores(id),     -- opcional no MVP
  data date not null default public.hoje_loja(),
  total integer not null default 0,
  frete integer not null default 0,
  criado_em timestamptz not null default now()
);

create table public.compra_itens (
  id uuid primary key default gen_random_uuid(),
  compra_id uuid not null references public.compras(id),
  produto_id uuid not null references public.produtos(id),
  quantidade integer not null check (quantidade > 0),
  custo_unitario integer not null check (custo_unitario >= 0)
);

create table public.contas_pagar (                          -- fase 2
  id uuid primary key default gen_random_uuid(),
  compra_id uuid references public.compras(id),
  descricao text not null,
  categoria text,
  valor integer not null,
  vencimento date not null,
  pago_em date,
  forma text
);

create table public.lancamentos (                           -- fase 2
  id uuid primary key default gen_random_uuid(),
  data date not null,
  tipo text not null check (tipo in ('entrada','saida')),
  categoria text,
  valor integer not null,
  conta text not null check (conta in ('banco_pix','maquininha','dinheiro')),
  origem text,
  origem_id uuid
);

create table public.auditoria (
  id uuid primary key default gen_random_uuid(),
  ator text not null check (ator in ('terminal','admin')),
  usuario_id uuid default auth.uid(),
  acao text not null,
  entidade text not null,
  entidade_id uuid,
  dados jsonb,
  criado_em timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Estoque: saldo = soma dos movimentos (RF-22)
-- ---------------------------------------------------------------------------
create or replace function public.tg_estoque_saldo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.produtos set estoque_atual = estoque_atual + new.quantidade where id = new.produto_id;
  return new;
end $$;

create trigger estoque_saldo after insert on public.estoque_movimentos
for each row execute function public.tg_estoque_saldo();

-- Movimentos são um livro-razão: não se altera nem se apaga.
create or replace function public.tg_bloquear_alteracao() returns trigger
language plpgsql as $$
begin
  raise exception 'Registro imutável: %', tg_table_name;
end $$;

create trigger estoque_imutavel before update or delete on public.estoque_movimentos
for each row execute function public.tg_bloquear_alteracao();
create trigger auditoria_imutavel before update or delete on public.auditoria
for each row execute function public.tg_bloquear_alteracao();
create trigger vendas_sem_delete before delete on public.vendas
for each row execute function public.tg_bloquear_alteracao();
create trigger parcelas_sem_delete before delete on public.parcelas
for each row execute function public.tg_bloquear_alteracao();
create trigger recebimentos_sem_delete before delete on public.recebimentos
for each row execute function public.tg_bloquear_alteracao();
