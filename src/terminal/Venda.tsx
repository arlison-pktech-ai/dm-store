import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { backend } from '../data';
import type { Produto } from '../domain/types';
import { avisosCliente } from '../domain/regras';
import { Icone } from '../components/Icone';
import { Aviso, Botao, Cabecalho, Etapas, Janela, TecladoNumerico, TecladoTexto, aplicarTecla, iniciais, useToast } from '../components/ui';
import { brl, parseBRL, toInput } from '../lib/money';
import { somErro, somOk } from '../lib/som';
import { useScanner } from '../lib/useScanner';
import { BuscaCliente, CadastroRapidoProduto, EnderecoJanela, PinJanela } from './componentes';
import { ErroNegocio } from '../data/backend';
import { useInvalidar, useProdutos } from './dados';
import { totais, useVendaAtual, venda } from './vendaAtual';

type JanelaAberta = null | { tipo: 'naoEncontrado'; codigo: string } | { tipo: 'procurar' } | { tipo: 'desconto' } | { tipo: 'endereco' } | { tipo: 'descartar' } | { tipo: 'semCodigo' } | { tipo: 'preco'; produtoId: string };

export default function Venda() {
  const v = useVendaAtual();
  const nav = useNavigate();
  const { porCodigo, produtos, carregando } = useProdutos();
  const fila = useRef<string[]>([]);
  const invalidar = useInvalidar();
  const [janela, setJanela] = useState<JanelaAberta>(null);
  const [piscarCliente, setPiscarCliente] = useState(0);
  const [ultimoBipe, setUltimoBipe] = useState<{ id: string; k: number } | null>(null);
  const [toast, mostrar] = useToast();
  const t = totais(v);

  const situacao = useQuery({
    queryKey: ['situacao', v.cliente?.id],
    queryFn: () => backend.situacaoCliente(v.cliente!.id),
    enabled: !!v.cliente,
  });

  const adicionar = (p: Produto) => {
    venda.adicionar(p);
    somOk();
    setUltimoBipe({ id: p.id, k: Date.now() });
    if (!venda.get().cliente) {
      setPiscarCliente(Date.now());
      mostrar(`${p.nome} guardado. Escolha a cliente.`);
    }
  };

  // RF-04: o leitor funciona a qualquer momento, sem tocar em nenhum campo.
  const lerCodigo = (codigo: string) => {
    const p = porCodigo.get(codigo);
    if (p && p.ativo) return adicionar(p);
    somErro();
    setJanela({ tipo: 'naoEncontrado', codigo });
  };
  useScanner((codigo) => {
    if (janela) return;
    // Lista de produtos ainda carregando: guarda o bipe e processa em seguida.
    if (carregando) fila.current.push(codigo);
    else lerCodigo(codigo);
  });
  useEffect(() => {
    if (carregando || fila.current.length === 0) return;
    const codigos = fila.current;
    fila.current = [];
    codigos.forEach(lerCodigo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carregando]);

  const avisos = situacao.data && v.cliente
    ? avisosCliente({ vencido: situacao.data.vencido, qtdAtrasadas: situacao.data.qtd_atrasadas, devido: situacao.data.devido, limite: v.cliente.limite_credito })
    : [];

  const janelas = (
    <>
      {janela?.tipo === 'naoEncontrado' && (
        <CadastroRapidoProduto codigo={janela.codigo} onFechar={() => setJanela(null)}
          onSalvo={(p) => { setJanela(null); invalidar('produtos'); adicionar(p); }} />
      )}
      {janela?.tipo === 'semCodigo' && (
        <CadastroRapidoProduto titulo="Cadastrar produto sem código" onFechar={() => setJanela(null)}
          onSalvo={(p) => { setJanela(null); invalidar('produtos'); adicionar(p); }} />
      )}
      {janela?.tipo === 'procurar' && (
        <ProcurarProduto produtos={produtos} onFechar={() => setJanela(null)} onCadastrar={() => setJanela({ tipo: 'semCodigo' })}
          onEscolher={(p) => { setJanela(null); adicionar(p); }} />
      )}
      {janela?.tipo === 'preco' && (() => {
        const item = v.itens.find((i) => i.produto_id === janela.produtoId);
        return item ? <CorrigirPreco item={item} onFechar={() => setJanela(null)} onFeito={() => { setJanela(null); invalidar('produtos'); mostrar('Preço corrigido.'); }} /> : null;
      })()}
      {janela?.tipo === 'desconto' && <DescontoJanela subtotal={t.subtotal} atual={v.desconto} onFechar={() => setJanela(null)} onAplicar={(c) => { venda.desconto(c); setJanela(null); }} />}
      {janela?.tipo === 'endereco' && v.cliente && (
        <EnderecoJanela cliente={v.cliente} onFechar={() => setJanela(null)}
          onSalva={(c) => { venda.atualizarCliente(c); venda.entrega(true); setJanela(null); }} />
      )}
      {janela?.tipo === 'descartar' && (
        <Janela titulo="Descartar esta venda?" largura={900}>
          <span className="text-[30px]">Os produtos e os pagamentos lançados saem da tela. Nada é gravado.</span>
          <div className="grid grid-cols-2 gap-4">
            <Botao variante="neutro" grande onClick={() => setJanela(null)}>Não, continuar</Botao>
            <Botao variante="perigo" grande icone="lixo" onClick={() => { venda.descartar(); setJanela(null); nav('/terminal'); }}>Sim, descartar</Botao>
          </div>
        </Janela>
      )}
    </>
  );

  // Etapa 1 — cliente
  if (!v.cliente) {
    return (
      <>
        <Cabecalho voltar={{ para: '/terminal', texto: 'Início' }} titulo="Nova venda" centro={<Etapas atual={1} />} />
        <BuscaCliente titulo="Quem está comprando?" piscar={piscarCliente} onEscolher={(c) => venda.escolherCliente(c)}
          extraTopo={v.itens.length > 0 && (
            <div className="mb-4 flex items-center justify-between gap-6 rounded-2xl bg-azul-claro px-6 py-3 text-[26px] font-bold text-azul-escuro">
              <span>{t.unidades} produto{t.unidades > 1 ? 's' : ''} já guardado{t.unidades > 1 ? 's' : ''} no carrinho · {brl(t.subtotal)}. Escolha a cliente.</span>
              <Botao variante="perigo" icone="lixo" onClick={() => setJanela({ tipo: 'descartar' })}>Descartar</Botao>
            </div>
          )} />
        {janelas}
        {toast}
      </>
    );
  }

  // Etapa 2 — carrinho
  const c = v.cliente;
  return (
    <>
      <Cabecalho voltar={{ para: '/terminal', texto: 'Início' }} titulo="Nova venda" centro={<Etapas atual={2} />} />
      <main className="flex min-h-0 flex-1 flex-col gap-6 px-12 py-8">
        <section aria-label="Cliente da venda" className="flex h-[96px] shrink-0 items-center gap-6 rounded-[20px] border-2 border-borda bg-white pl-6 pr-4">
          <span className="flex size-16 items-center justify-center rounded-full bg-azul-claro text-[26px] font-bold text-azul">{iniciais(c.nome)}</span>
          <span className="flex flex-col gap-0.5"><span className="text-[34px] font-bold">{c.nome}</span><span className="text-[22px] text-suave">{c.telefone}</span></span>
          {avisos.length > 0 && (
            <span className="flex items-center gap-2.5 rounded-full bg-vermelho-claro px-5 py-3 text-[24px] font-bold text-vermelho">
              <Icone nome="alerta" traco={2.2} />
              {avisos.join(' · ')}{situacao.data && situacao.data.vencido > 0 ? ` · ${brl(situacao.data.vencido)}` : ''}
            </span>
          )}
          <Botao variante="neutro" className="ml-auto" onClick={() => venda.trocarCliente()}>Trocar cliente</Botao>
        </section>
        <div className="flex min-h-0 flex-1 gap-8">
          <section aria-label="Carrinho" className="flex min-w-0 flex-1 flex-col gap-5">
            <div className="flex h-[88px] shrink-0 items-center gap-5 rounded-[20px] bg-azul-claro pl-7 pr-4">
              <Icone nome="barras" tamanho={44} className="text-azul" />
              <span className="text-[30px] font-bold text-azul-escuro">Passe o produto no leitor</span>
              <Botao variante="contorno" icone="busca" className="ml-auto" onClick={() => setJanela({ tipo: 'procurar' })}>Procurar produto sem código</Botao>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_280px_200px_200px] gap-4 px-6 text-[22px] text-suave">
              <span>Produto</span><span className="text-center">Quantidade</span><span className="text-right">Valor</span><span />
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
              {v.itens.length === 0 && <div className="rounded-[20px] border-2 border-dashed border-borda p-10 text-center text-[28px] text-suave">O carrinho está vazio. Passe o primeiro produto no leitor.</div>}
              {v.itens.map((i) => (
                <div key={i.produto_id + (ultimoBipe?.id === i.produto_id ? ultimoBipe.k : '')}
                  className={`grid h-[120px] shrink-0 grid-cols-[minmax(0,1fr)_280px_200px_200px] items-center gap-4 rounded-[20px] border-2 border-borda bg-white px-6 ${ultimoBipe?.id === i.produto_id ? 'pisca-verde' : ''}`}>
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="truncate text-[30px] font-bold">{i.descricao}</span>
                    <span className="text-[22px] text-suave">{[i.detalhe, i.quantidade > 1 ? `${brl(i.preco_unitario)} cada` : ''].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="flex items-center justify-center gap-4">
                    <button type="button" aria-label="Diminuir" onClick={() => venda.mudarQtd(i.produto_id, -1)} className="size-[72px] rounded-2xl border-[3px] border-borda bg-white text-[40px] font-bold">−</button>
                    <span className="min-w-14 text-center text-[40px] font-bold">{i.quantidade}</span>
                    <button type="button" aria-label="Aumentar" onClick={() => venda.mudarQtd(i.produto_id, 1)} className="size-[72px] rounded-2xl border-[3px] border-borda bg-white text-[40px] font-bold">+</button>
                  </span>
                  <button type="button" aria-label={`Corrigir preço de ${i.descricao}`} onClick={() => setJanela({ tipo: 'preco', produtoId: i.produto_id })}
                    className="flex flex-col items-end gap-1 border-none bg-transparent p-0 text-right">
                    <span className="text-[32px] font-bold">{brl(i.preco_unitario * i.quantidade)}</span>
                    <span className={`whitespace-nowrap text-[20px] font-bold underline ${i.preco_original != null ? 'text-vermelho' : 'text-azul'}`}>
                      {i.preco_original != null ? `era ${brl(i.preco_original)} cada` : 'corrigir preço'}
                    </span>
                  </button>
                  <Botao variante="perigo" icone="lixo" className="!text-[22px]" onClick={() => venda.remover(i.produto_id)}>Remover</Botao>
                </div>
              ))}
            </div>
            {v.historico.length > 0 && (
              <Botao variante="neutro" icone="desfazer" className="self-start" onClick={() => venda.desfazer()}>Desfazer</Botao>
            )}
          </section>
          <aside aria-label="Resumo da venda" className="flex w-[600px] shrink-0 flex-col gap-5 rounded-3xl border-2 border-borda bg-white p-9">
            <span className="text-[26px] text-suave">{v.itens.length} produto{v.itens.length !== 1 ? 's' : ''} · {t.unidades} unidade{t.unidades !== 1 ? 's' : ''}</span>
            <div className="flex justify-between text-[30px]"><span>Subtotal</span><span>{brl(t.subtotal)}</span></div>
            <div className="flex items-center justify-between text-[30px]">
              <span>Desconto</span>
              <span className="flex items-center gap-4">
                <span>{v.desconto ? '− ' + brl(v.desconto) : 'R$ 0,00'}</span>
                <Botao variante="neutro" className="!min-h-[64px] !px-5 !text-[22px]" disabled={!v.itens.length} onClick={() => setJanela({ tipo: 'desconto' })}>{v.desconto ? 'Alterar' : 'Dar desconto'}</Botao>
              </span>
            </div>
            <div className="flex items-baseline justify-between border-t-2 border-borda pt-5">
              <span className="text-[34px] font-bold">Total</span><span className="text-[64px] font-bold">{brl(t.total)}</span>
            </div>
            <label className="flex cursor-pointer items-start gap-5 rounded-[18px] bg-fundo p-5">
              <input type="checkbox" checked={v.para_entrega} className="m-0 size-10 shrink-0 accent-azul"
                onChange={(e) => {
                  if (e.target.checked && !c.endereco) setJanela({ tipo: 'endereco' });
                  else venda.entrega(e.target.checked);
                }} />
              <span className="flex flex-col gap-1.5">
                <span className="text-[28px] font-bold">Para entrega</span>
                <span className="text-[22px] text-suave">{c.endereco ? [c.endereco, c.bairro].filter(Boolean).join(' · ') : 'Sem endereço: ao marcar, pede o endereço'}</span>
              </span>
            </label>
            <Botao variante="primario" grande className="mt-auto h-[120px] !text-[40px]" disabled={!v.itens.length} onClick={() => nav('/terminal/venda/pagamento')}>
              Ir para o pagamento <Icone nome="avancar" tamanho={40} traco={2.4} />
            </Botao>
            <Botao variante="perigo" onClick={() => setJanela({ tipo: 'descartar' })}>Descartar esta venda</Botao>
          </aside>
        </div>
      </main>
      {janelas}
      {toast}
    </>
  );
}

function ProcurarProduto({ produtos, onEscolher, onCadastrar, onFechar }: { produtos: Produto[]; onEscolher: (p: Produto) => void; onCadastrar: () => void; onFechar: () => void }) {
  const [q, setQ] = useState('');
  const ativos = produtos.filter((p) => p.ativo);
  const termo = q.trim().toLowerCase();
  const lista = termo
    ? ativos.filter((p) => `${p.nome} ${p.marca ?? ''} ${p.categoria ?? ''}`.toLowerCase().includes(termo)).slice(0, 12)
    : [...ativos].sort((a, b) => (b.vendidos ?? 0) - (a.vendidos ?? 0)).slice(0, 12);
  return (
    <Janela titulo="Procurar produto" onFechar={onFechar} largura={1700}>
      <div className="flex h-[96px] items-center gap-5 rounded-[20px] border-4 border-azul bg-white px-7">
        <Icone nome="busca" tamanho={40} className="text-azul" />
        <span className={`flex-1 text-[38px] ${q ? '' : 'text-suave'}`}>{q || 'Digite o nome do produto'}</span>
        <Botao variante="neutro" icone="mais" onClick={onCadastrar}>Cadastrar novo</Botao>
      </div>
      <span className="text-[24px] text-suave">{termo ? `${lista.length} encontrado${lista.length !== 1 ? 's' : ''}` : 'Os 12 mais vendidos'}</span>
      <div className="grid grid-cols-4 gap-3">
        {lista.map((p) => (
          <button key={p.id} type="button" onClick={() => onEscolher(p)} className="flex h-[104px] flex-col justify-center gap-1 rounded-2xl border-[3px] border-borda bg-white px-5 text-left">
            <span className="truncate text-[26px] font-bold">{p.nome}{p.volume_ml ? ` ${p.volume_ml} ml` : ''}</span>
            <span className="text-[22px] text-suave">{brl(p.preco_venda)} · {p.estoque_atual} em estoque</span>
          </button>
        ))}
      </div>
      <TecladoTexto onTecla={(t) => setQ((v) => aplicarTecla(v, t))} className="h-[330px]" />
    </Janela>
  );
}

function DescontoJanela({ subtotal, atual, onAplicar, onFechar }: { subtotal: number; atual: number; onAplicar: (c: number) => void; onFechar: () => void }) {
  const [txt, setTxt] = useState(atual ? toInput(atual) : '');
  const c = parseBRL(txt);
  const invalido = c > subtotal;
  return (
    <Janela titulo="Desconto em reais" onFechar={onFechar} largura={1000}>
      <div className="grid grid-cols-2 gap-8">
        <div className="flex flex-col gap-4">
          <span className="text-[26px] text-suave">Subtotal {brl(subtotal)}</span>
          <span className="text-[72px] font-bold">− {brl(c)}</span>
          <span className="text-[30px]">Total fica <strong>{brl(Math.max(0, subtotal - c))}</strong></span>
          {invalido && <Aviso>O desconto não pode passar do subtotal.</Aviso>}
          <Botao variante="neutro" onClick={() => onAplicar(0)}>Tirar o desconto</Botao>
        </div>
        <TecladoNumerico onTecla={(t) => setTxt((v) => aplicarTecla(v, t, { numerico: true, max: 9 }))} className="h-[420px]" />
      </div>
      <Botao variante="concluir" grande icone="check" disabled={invalido} onClick={() => onAplicar(c)}>Aplicar desconto</Botao>
    </Janela>
  );
}

/** Corrigir o preço de um item na venda, com PIN. Pode salvar também como novo preço do produto. */
function CorrigirPreco({ item, onFeito, onFechar }: { item: { produto_id: string; descricao: string; preco_unitario: number; preco_original?: number }; onFeito: () => void; onFechar: () => void }) {
  const [txt, setTxt] = useState('');
  const [salvarProduto, setSalvarProduto] = useState(false);
  const [pin, setPin] = useState(false);
  const novo = parseBRL(txt);
  const catalogo = item.preco_original ?? item.preco_unitario;
  if (pin) {
    return (
      <PinJanela titulo="Corrigir preço" onFechar={onFechar}
        descricao={`${item.descricao}: de ${brl(item.preco_unitario)} para ${brl(novo)}${salvarProduto ? ', também no cadastro do produto' : ', só nesta venda'}.`}
        onConfirmar={async (p) => {
          if (salvarProduto) await backend.atualizarPrecos([{ produto_id: item.produto_id, preco_venda: novo }], p);
          else if (!(await backend.conferirPin(p))) throw new ErroNegocio('PIN incorreto.');
          venda.corrigirPreco(item.produto_id, novo, p, salvarProduto ? novo : catalogo);
          onFeito();
        }} />
    );
  }
  return (
    <Janela titulo={`Corrigir preço · ${item.descricao}`} onFechar={onFechar} largura={1100}>
      <span className="text-[26px] text-suave">Preço do cadastro {brl(catalogo)}{item.preco_original != null ? ` · nesta venda ${brl(item.preco_unitario)}` : ''}</span>
      <div className="grid grid-cols-2 gap-8">
        <div className="flex flex-col gap-5">
          <span className="text-[26px] font-bold">Novo preço de cada um</span>
          <span className="text-[72px] font-bold" data-testid="novo-preco">{brl(novo)}</span>
          <button type="button" onClick={() => setSalvarProduto((s) => !s)}
            className={`flex min-h-[88px] items-center gap-4 rounded-2xl border-[3px] px-5 text-left text-[26px] font-bold ${salvarProduto ? 'border-azul bg-azul-claro' : 'border-borda bg-white'}`}>
            <span className={`flex size-10 shrink-0 items-center justify-center rounded-lg border-[3px] ${salvarProduto ? 'border-azul bg-azul text-white' : 'border-borda'}`}>{salvarProduto && <Icone nome="check" tamanho={26} traco={3} />}</span>
            Salvar também como preço do produto
          </button>
        </div>
        <TecladoNumerico onTecla={(t) => setTxt((v) => aplicarTecla(v, t, { numerico: true, max: 9 }))} className="h-[400px]" />
      </div>
      <Botao variante="primario" grande icone="cadeado" disabled={novo <= 0 || novo === item.preco_unitario} onClick={() => setPin(true)}>Continuar com o PIN</Botao>
    </Janela>
  );
}
