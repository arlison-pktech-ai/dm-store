import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { backend } from '../data';
import type { Produto } from '../domain/types';
import { Icone } from '../components/Icone';
import { Aviso, Botao, Cabecalho, Janela, TecladoNumerico, TecladoTexto, aplicarTecla, useToast } from '../components/ui';
import { somErro, somOk } from '../lib/som';
import { useScanner } from '../lib/useScanner';
import { PinJanela } from './componentes';
import { AjusteEstoque } from './ChegouMercadoria';
import { useInvalidar, useProdutos } from './dados';
import { descricaoProduto, detalheProduto } from './vendaAtual';

const baixo = (p: Produto) => p.estoque_atual <= p.estoque_minimo;

/** Procura de produto pelo nome, com o teclado na tela. */
function ProcurarJanela({ titulo, valor, produtos, onEscolher, onFechar }: {
  titulo: string; valor?: string; produtos: Produto[]; onEscolher?: (p: Produto) => void; onFechar: (q: string) => void;
}) {
  const [q, setQ] = useState(valor ?? '');
  const t = q.trim().toLowerCase();
  const lista = produtos.filter((p) => !t || p.nome.toLowerCase().includes(t) || (p.marca ?? '').toLowerCase().includes(t)).slice(0, 8);
  return (
    <Janela titulo={titulo} onFechar={() => onFechar(q)} largura={1700}>
      <div className="flex h-[88px] items-center gap-4 rounded-[20px] border-4 border-azul bg-white px-6">
        <Icone nome="busca" tamanho={36} className="text-azul" />
        <span className={`text-[34px] ${q ? '' : 'text-suave'}`}>{q || 'Digite o nome'}</span>
      </div>
      {onEscolher && (
        <div className="grid grid-cols-4 gap-3">
          {lista.map((p) => (
            <button key={p.id} type="button" onClick={() => onEscolher(p)} className="flex h-[100px] flex-col justify-center gap-1 rounded-2xl border-[3px] border-borda bg-white px-5 text-left">
              <span className="truncate text-[26px] font-bold">{descricaoProduto(p)}</span>
              <span className="text-[22px] text-suave">{p.estoque_atual} no sistema</span>
            </button>
          ))}
        </div>
      )}
      <TecladoTexto onTecla={(k) => setQ((v) => aplicarTecla(v, k))} className="h-[320px]" />
      {!onEscolher && <Botao variante="primario" grande icone="check" onClick={() => onFechar(q)}>Ver os produtos</Botao>}
    </Janela>
  );
}

/** Tela Estoque: ver o estoque, dar entrada, ajustar (com PIN) e começar a contagem. */
export default function Estoque() {
  const nav = useNavigate();
  const { produtos, porCodigo, carregando } = useProdutos();
  const invalidar = useInvalidar();
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState<'todos' | 'baixo'>('todos');
  const [procurar, setProcurar] = useState(false);
  const [ajuste, setAjuste] = useState<Produto | null>(null);
  const [destaque, setDestaque] = useState<string | null>(null);
  const [toast, mostrar] = useToast();
  const contagemAberta = lerContagem().length > 0;

  useScanner((codigo) => {
    if (procurar || ajuste) return;
    const p = porCodigo.get(codigo);
    if (!p) { somErro(); mostrar('Produto não encontrado.', 'erro'); return; }
    somOk();
    setQ('');
    setFiltro('todos');
    setDestaque(p.id);
  });

  useEffect(() => {
    if (destaque) document.getElementById(`estoque-${destaque}`)?.scrollIntoView({ block: 'center' });
  }, [destaque]);

  const t = q.trim().toLowerCase();
  const lista = useMemo(() => produtos
    .filter((p) => filtro === 'todos' || baixo(p))
    .filter((p) => !t || p.nome.toLowerCase().includes(t) || (p.marca ?? '').toLowerCase().includes(t))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')), [produtos, filtro, t]);
  const qtdBaixo = produtos.filter(baixo).length;
  const unidades = produtos.reduce((s, p) => s + Math.max(0, p.estoque_atual), 0);

  const chip = (ativo: boolean) => `h-[88px] shrink-0 rounded-2xl border-[3px] px-6 text-[24px] font-bold ${ativo ? 'border-azul bg-azul-claro' : 'border-borda bg-white'}`;

  return (
    <>
      <Cabecalho voltar={{ para: '/terminal', texto: 'Início' }} titulo="Estoque" />
      <main className="flex min-h-0 flex-1 gap-8 px-12 py-8">
        <section className="flex min-w-0 flex-1 flex-col gap-5">
          <div className="flex shrink-0 items-center gap-4">
            <button type="button" onClick={() => setProcurar(true)} className="flex h-[88px] min-w-0 flex-1 items-center gap-4 rounded-[20px] border-[3px] border-borda bg-white px-6 text-left">
              <Icone nome="busca" tamanho={36} className="text-azul" />
              <span className={`truncate text-[30px] ${q ? 'font-bold' : 'text-suave'}`}>{q || 'Procurar pelo nome ou passe no leitor'}</span>
            </button>
            {q && <Botao variante="neutro" icone="x" className="h-[88px]" onClick={() => setQ('')}>Limpar</Botao>}
            <button type="button" className={chip(filtro === 'todos')} onClick={() => setFiltro('todos')}>Todos</button>
            <button type="button" className={chip(filtro === 'baixo')} onClick={() => setFiltro('baixo')}>Estoque baixo ({qtdBaixo})</button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
            {!carregando && lista.length === 0 && <div className="rounded-[20px] border-2 border-dashed border-borda p-10 text-center text-[28px] text-suave">Nenhum produto aqui.</div>}
            {lista.map((p) => (
              <div key={p.id} id={`estoque-${p.id}`} data-testid="linha-estoque"
                className={`grid h-[112px] shrink-0 grid-cols-[minmax(0,1fr)_220px_330px] items-center gap-4 rounded-[20px] border-[3px] bg-white px-6 ${destaque === p.id ? 'border-verde bg-verde-claro' : 'border-borda'}`}>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[30px] font-bold">{descricaoProduto(p)}</span>
                  <span className="truncate text-[22px] text-suave">{[p.marca, detalheProduto(p), `mínimo ${p.estoque_minimo}`].filter(Boolean).join(' · ')}</span>
                </span>
                <span className={`text-right text-[40px] font-bold ${baixo(p) ? 'text-vermelho' : ''}`}>
                  {p.estoque_atual} <span className="text-[24px] font-normal">un.</span>
                </span>
                <span className="flex justify-end gap-2">
                  <Botao variante="contorno" className="!px-4 !text-[22px]" onClick={() => nav('/terminal/mercadoria', { state: { produto: p } })}>Dar entrada</Botao>
                  <Botao variante="neutro" icone="cadeado" className="!px-4 !text-[22px]" onClick={() => setAjuste(p)}>Ajustar</Botao>
                </span>
              </div>
            ))}
          </div>
        </section>
        <aside className="flex w-[560px] shrink-0 flex-col gap-5 rounded-3xl border-2 border-borda bg-white p-9">
          <span className="text-[26px] text-suave">{produtos.length} produtos</span>
          <div className="flex items-baseline justify-between border-t-2 border-borda pt-5"><span className="text-[32px] font-bold">Unidades em estoque</span></div>
          <span className="text-[64px] font-bold">{unidades}</span>
          {qtdBaixo > 0 && <Aviso tipo="info">{qtdBaixo} produto{qtdBaixo !== 1 ? 's' : ''} no estoque mínimo ou abaixo.</Aviso>}
          <Botao variante="concluir" grande icone="barras" className="mt-auto h-[120px]" onClick={() => nav('/terminal/estoque/contagem')}>
            {contagemAberta ? 'Continuar contagem' : 'Contar estoque'}
          </Botao>
          <Botao variante="primario" icone="caixa" onClick={() => nav('/terminal/mercadoria')}>Chegou mercadoria</Botao>
        </aside>
      </main>
      {procurar && <ProcurarJanela titulo="Procurar produto" valor={q} produtos={produtos} onFechar={(v) => { setQ(v); setDestaque(null); setProcurar(false); }} />}
      {ajuste && <AjusteEstoque produto={ajuste} onFechar={() => setAjuste(null)} onFeito={() => { setAjuste(null); invalidar('produtos'); mostrar('Estoque ajustado.'); }} />}
      {toast}
    </>
  );
}

// ---------------------------------------------------------------------------
// Contagem: bipa cada peça (ou digita a quantidade) e, no fim, confirma com PIN.
// Nada muda no estoque antes da confirmação. A contagem fica guardada se a tela recarregar.
// ---------------------------------------------------------------------------

interface Contado { produto_id: string; contado: number }
const KEY_CONTAGEM = 'pdv-contagem-atual';

function lerContagem(): Contado[] {
  try { return JSON.parse(localStorage.getItem(KEY_CONTAGEM) ?? '[]'); } catch { return []; }
}

export function Contagem() {
  const nav = useNavigate();
  const { produtos, porCodigo } = useProdutos();
  const invalidar = useInvalidar();
  const [itens, setItensRaw] = useState<Contado[]>(lerContagem);
  const setItens = (f: (l: Contado[]) => Contado[]) => setItensRaw((l) => {
    const n = f(l);
    localStorage.setItem(KEY_CONTAGEM, JSON.stringify(n));
    return n;
  });
  const [ultimo, setUltimo] = useState<string | null>(null);
  const [procurar, setProcurar] = useState(false);
  const [digitar, setDigitar] = useState<Produto | null>(null);
  const [revisar, setRevisar] = useState(false);
  const [pin, setPin] = useState(false);
  const [descartar, setDescartar] = useState(false);
  const [toast, mostrar] = useToast();

  const porId = useMemo(() => new Map(produtos.map((p) => [p.id, p])), [produtos]);
  const somar = (p: Produto, n: number) => {
    setItens((l) => {
      const i = l.findIndex((x) => x.produto_id === p.id);
      if (i < 0) return [{ produto_id: p.id, contado: Math.max(0, n) }, ...l];
      return l.map((x, k) => (k === i ? { ...x, contado: Math.max(0, x.contado + n) } : x));
    });
    setUltimo(p.id);
  };
  const definir = (p: Produto, n: number) => {
    setItens((l) => l.some((x) => x.produto_id === p.id)
      ? l.map((x) => (x.produto_id === p.id ? { ...x, contado: n } : x))
      : [{ produto_id: p.id, contado: n }, ...l]);
    setUltimo(p.id);
  };

  useScanner((codigo) => {
    if (procurar || digitar || revisar || pin || descartar) return;
    const p = porCodigo.get(codigo);
    if (!p) { somErro(); mostrar('Produto não encontrado.', 'erro'); return; }
    somOk();
    somar(p, 1);
  });

  const linhas = itens.map((i) => ({ ...i, produto: porId.get(i.produto_id) })).filter((l): l is Contado & { produto: Produto } => !!l.produto);
  const diferencas = linhas.filter((l) => l.contado !== l.produto.estoque_atual);
  const pecas = linhas.reduce((s, l) => s + l.contado, 0);

  return (
    <>
      <Cabecalho voltar={{ para: '/terminal/estoque', texto: 'Estoque' }} titulo="Contagem de estoque" />
      <main className="flex min-h-0 flex-1 gap-8 px-12 py-8">
        <section className="flex min-w-0 flex-1 flex-col gap-5">
          <div className="flex h-[88px] shrink-0 items-center gap-5 rounded-[20px] bg-azul-claro pl-7 pr-4">
            <Icone nome="barras" tamanho={44} className="text-azul" />
            <span className="text-[30px] font-bold text-azul-escuro">Bipe cada peça que você contar</span>
            <Botao variante="contorno" icone="busca" className="ml-auto" onClick={() => setProcurar(true)}>Procurar pelo nome</Botao>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
            {linhas.length === 0 && <div className="rounded-[20px] border-2 border-dashed border-borda p-10 text-center text-[28px] text-suave">Nenhum produto contado ainda. Bipe a primeira peça.</div>}
            {linhas.map((l) => {
              const dif = l.contado - l.produto.estoque_atual;
              return (
                <div key={l.produto_id} data-testid="linha-contagem"
                  className={`grid h-[112px] shrink-0 grid-cols-[minmax(0,1fr)_260px_200px_220px] items-center gap-4 rounded-[20px] border-[3px] bg-white px-6 ${ultimo === l.produto_id ? 'border-verde bg-verde-claro' : 'border-borda'}`}>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-[30px] font-bold">{descricaoProduto(l.produto)}</span>
                    <span className="text-[22px] text-suave">Sistema: {l.produto.estoque_atual}</span>
                  </span>
                  <span className="flex items-center justify-center gap-3">
                    <button type="button" aria-label="Menos um" onClick={() => somar(l.produto, -1)} className="size-[64px] rounded-2xl border-[3px] border-borda bg-white text-[36px] font-bold">−</button>
                    <button type="button" aria-label="Digitar quantidade" onClick={() => setDigitar(l.produto)} className="min-w-[90px] rounded-2xl border-[3px] border-transparent bg-transparent text-[40px] font-bold underline decoration-dotted">{l.contado}</button>
                    <button type="button" aria-label="Mais um" onClick={() => somar(l.produto, 1)} className="size-[64px] rounded-2xl border-[3px] border-borda bg-white text-[36px] font-bold">+</button>
                  </span>
                  <span data-testid="diferenca" className={`text-right text-[30px] font-bold ${dif === 0 ? 'text-verde-escuro' : 'text-vermelho'}`}>
                    {dif === 0 ? 'Confere' : `${dif > 0 ? '+' : ''}${dif}`}
                  </span>
                  <span className="flex justify-end">
                    <Botao variante="perigo" className="!px-4 !text-[22px]" onClick={() => setItens((ls) => ls.filter((x) => x.produto_id !== l.produto_id))}>Tirar</Botao>
                  </span>
                </div>
              );
            })}
          </div>
        </section>
        <aside className="flex w-[560px] shrink-0 flex-col gap-5 rounded-3xl border-2 border-borda bg-white p-9">
          <span className="text-[26px] text-suave">{linhas.length} produto{linhas.length !== 1 ? 's' : ''} contado{linhas.length !== 1 ? 's' : ''} · {pecas} peças</span>
          <div className="flex items-baseline justify-between border-t-2 border-borda pt-5"><span className="text-[32px] font-bold">Diferenças</span></div>
          <span className={`text-[64px] font-bold ${diferencas.length ? 'text-vermelho' : ''}`}>{diferencas.length}</span>
          <Aviso tipo="info">O estoque só muda quando você terminar e confirmar com o PIN. Produtos não contados ficam como estão.</Aviso>
          <Botao variante="concluir" grande icone="check" className="mt-auto h-[120px]" disabled={!linhas.length} onClick={() => setRevisar(true)}>Terminar contagem</Botao>
          <Botao variante="perigo" icone="lixo" disabled={!linhas.length} onClick={() => setDescartar(true)}>Descartar contagem</Botao>
        </aside>
      </main>

      {procurar && <ProcurarJanela titulo="Contar produto" produtos={produtos} onFechar={() => setProcurar(false)} onEscolher={(p) => { setProcurar(false); setDigitar(p); }} />}
      {digitar && <QuantidadeContada produto={digitar} atual={itens.find((i) => i.produto_id === digitar.id)?.contado}
        onFechar={() => setDigitar(null)} onOk={(n) => { definir(digitar, n); setDigitar(null); }} />}

      {revisar && !pin && (
        <Janela titulo="Conferir a contagem" onFechar={() => setRevisar(false)} largura={1300}>
          {diferencas.length === 0
            ? <span className="text-[30px]">Tudo confere com o sistema. Nada vai mudar no estoque.</span>
            : <>
              <span className="text-[28px]">Estes produtos vão ficar com a quantidade contada:</span>
              <div className="flex max-h-[520px] flex-col gap-2 overflow-y-auto">
                {diferencas.map((l) => {
                  const dif = l.contado - l.produto.estoque_atual;
                  return (
                    <div key={l.produto_id} className="grid grid-cols-[minmax(0,1fr)_320px_140px] items-center gap-4 rounded-2xl border-2 border-borda px-6 py-4 text-[28px]">
                      <span className="truncate font-bold">{descricaoProduto(l.produto)}</span>
                      <span>de {l.produto.estoque_atual} para <strong>{l.contado}</strong></span>
                      <span className={`text-right font-bold ${dif > 0 ? 'text-verde-escuro' : 'text-vermelho'}`}>{dif > 0 ? '+' : ''}{dif}</span>
                    </div>
                  );
                })}
              </div>
            </>}
          <div className="grid grid-cols-2 gap-4">
            <Botao variante="neutro" grande onClick={() => setRevisar(false)}>Voltar e continuar contando</Botao>
            <Botao variante="concluir" grande icone="check" onClick={() => {
              if (diferencas.length === 0) { setItens(() => []); setRevisar(false); nav('/terminal/estoque'); return; }
              setPin(true);
            }}>{diferencas.length === 0 ? 'Terminar' : 'Confirmar e ajustar'}</Botao>
          </div>
        </Janela>
      )}
      {pin && (
        <PinJanela titulo="Ajustar pela contagem" descricao={`${diferencas.length} produto${diferencas.length !== 1 ? 's' : ''} com diferença.`}
          onFechar={() => setPin(false)}
          onConfirmar={async (p) => {
            const n = await backend.registrarContagem(linhas.map((l) => ({ produto_id: l.produto_id, contado: l.contado })), p);
            setItens(() => []);
            setPin(false);
            setRevisar(false);
            invalidar('produtos');
            mostrar(`Estoque ajustado: ${n} produto${n !== 1 ? 's' : ''}.`);
            setTimeout(() => nav('/terminal/estoque'), 1200);
          }} />
      )}
      {descartar && (
        <Janela titulo="Descartar a contagem?" onFechar={() => setDescartar(false)} largura={1000}>
          <span className="text-[28px]">O que foi contado até agora some. O estoque não muda.</span>
          <div className="grid grid-cols-2 gap-4">
            <Botao variante="neutro" grande onClick={() => setDescartar(false)}>Não, voltar</Botao>
            <Botao variante="perigo" grande icone="lixo" onClick={() => { setItens(() => []); setDescartar(false); nav('/terminal/estoque'); }}>Sim, descartar</Botao>
          </div>
        </Janela>
      )}
      {toast}
    </>
  );
}

function QuantidadeContada({ produto, atual, onOk, onFechar }: { produto: Produto; atual?: number; onOk: (n: number) => void; onFechar: () => void }) {
  const [n, setN] = useState('');
  return (
    <Janela titulo={`Quantos ${descricaoProduto(produto)} você contou?`} onFechar={onFechar} largura={1000}>
      <span className="text-[28px]">O sistema diz {produto.estoque_atual}.{atual !== undefined ? ` Contado até agora: ${atual}.` : ''}</span>
      <div className="grid grid-cols-2 gap-8">
        <span className="text-[96px] font-bold">{n || '0'}</span>
        <TecladoNumerico semVirgula onTecla={(t) => setN((v) => aplicarTecla(v, t, { max: 4 }))} className="h-[380px]" />
      </div>
      <Botao variante="primario" grande icone="check" disabled={n === ''} onClick={() => onOk(parseInt(n, 10))}>Usar esta quantidade</Botao>
    </Janela>
  );
}
