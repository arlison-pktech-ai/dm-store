import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { backend } from '../data';
import type { Produto } from '../domain/types';
import { Icone } from '../components/Icone';
import { Aviso, Botao, Cabecalho, Janela, TecladoNumerico, TecladoTexto, aplicarTecla, useToast } from '../components/ui';
import { brl, parseBRL, toInput } from '../lib/money';
import { mensagem } from '../lib/erros';
import { somErro, somOk } from '../lib/som';
import { useScanner } from '../lib/useScanner';
import { CadastroRapidoProduto, CampoTela, PinJanela } from './componentes';
import { useInvalidar, useProdutos } from './dados';
import { descricaoProduto } from './vendaAtual';

interface Linha { produto: Produto; quantidade: number; custo: number }

const KEY = 'pdv-entrada-atual';

export default function ChegouMercadoria() {
  const nav = useNavigate();
  const { porCodigo, produtos } = useProdutos();
  const invalidar = useInvalidar();
  const [linhas, setLinhasRaw] = useState<Linha[]>(() => JSON.parse(localStorage.getItem(KEY) ?? '[]'));
  const setLinhas = (f: (l: Linha[]) => Linha[]) => setLinhasRaw((l) => {
    const n = f(l);
    localStorage.setItem(KEY, JSON.stringify(n));
    return n;
  });
  const [editando, setEditando] = useState<Produto | null>(null);
  const [novoCodigo, setNovoCodigo] = useState<string | null>(null);
  const [procurar, setProcurar] = useState<false | 'entrada' | 'ajuste'>(false);
  const [ajuste, setAjuste] = useState<Produto | null>(null);
  const [erro, setErro] = useState('');
  const [toast, mostrar] = useToast();
  const [salvando, setSalvando] = useState(false);

  useScanner((codigo) => {
    if (editando || novoCodigo !== null || procurar || ajuste) return;
    const p = porCodigo.get(codigo);
    if (p) {
      somOk();
      setEditando(p);
    } else {
      somErro();
      setNovoCodigo(codigo);
    }
  });

  const total = linhas.reduce((s, l) => s + l.quantidade * l.custo, 0);

  const concluir = async () => {
    setErro('');
    setSalvando(true);
    try {
      await backend.registrarEntrada(linhas.map((l) => ({ produto_id: l.produto.id, quantidade: l.quantidade, custo_unitario: l.custo })));
      setLinhas(() => []);
      invalidar('produtos');
      mostrar('Estoque atualizado!');
      setTimeout(() => nav('/terminal'), 1200);
    } catch (e) {
      somErro();
      setErro(mensagem(e));
    }
    setSalvando(false);
  };

  return (
    <>
      <Cabecalho voltar={{ para: '/terminal', texto: 'Início' }} titulo="Chegou mercadoria" />
      <main className="flex min-h-0 flex-1 gap-8 px-12 py-8">
        <section className="flex min-w-0 flex-1 flex-col gap-5">
          <div className="flex h-[88px] shrink-0 items-center gap-5 rounded-[20px] bg-azul-claro pl-7 pr-4">
            <Icone nome="barras" tamanho={44} className="text-azul" />
            <span className="text-[30px] font-bold text-azul-escuro">Passe o produto que chegou no leitor</span>
            <Botao variante="contorno" icone="busca" className="ml-auto" onClick={() => setProcurar('entrada')}>Procurar pelo nome</Botao>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
            {linhas.length === 0 && <div className="rounded-[20px] border-2 border-dashed border-borda p-10 text-center text-[28px] text-suave">Nenhum produto ainda. Bipe o primeiro.</div>}
            {linhas.map((l) => (
              <div key={l.produto.id} className="grid h-[112px] shrink-0 grid-cols-[minmax(0,1fr)_220px_240px_200px] items-center gap-4 rounded-[20px] border-2 border-borda bg-white px-6">
                <span className="flex min-w-0 flex-col"><span className="truncate text-[30px] font-bold">{descricaoProduto(l.produto)}</span><span className="text-[22px] text-suave">Estoque agora: {l.produto.estoque_atual}</span></span>
                <span className="text-[30px]"><strong>{l.quantidade}</strong> un. × {brl(l.custo)}</span>
                <span className="text-right text-[32px] font-bold">{brl(l.quantidade * l.custo)}</span>
                <span className="flex gap-2">
                  <Botao variante="neutro" className="!px-4 !text-[22px]" onClick={() => setEditando(l.produto)}>Alterar</Botao>
                  <Botao variante="perigo" className="!px-4 !text-[22px]" onClick={() => setLinhas((ls) => ls.filter((x) => x.produto.id !== l.produto.id))}>Tirar</Botao>
                </span>
              </div>
            ))}
          </div>
        </section>
        <aside className="flex w-[560px] shrink-0 flex-col gap-5 rounded-3xl border-2 border-borda bg-white p-9">
          <span className="text-[26px] text-suave">{linhas.length} produto{linhas.length !== 1 ? 's' : ''} · {linhas.reduce((s, l) => s + l.quantidade, 0)} unidades</span>
          <div className="flex items-baseline justify-between border-t-2 border-borda pt-5"><span className="text-[32px] font-bold">Total da mercadoria</span></div>
          <span className="text-[64px] font-bold">{brl(total)}</span>
          {erro && <Aviso>{erro}</Aviso>}
          <Botao variante="concluir" grande icone="check" className="mt-auto h-[120px]" disabled={!linhas.length || salvando} onClick={concluir}>Concluir entrada</Botao>
          <Botao variante="neutro" icone="cadeado" onClick={() => setProcurar('ajuste')}>Ajustar estoque (com PIN)</Botao>
        </aside>
      </main>
      {editando && (
        <QuantidadeCusto produto={editando} atual={linhas.find((l) => l.produto.id === editando.id)} onFechar={() => setEditando(null)}
          onOk={(quantidade, custo) => {
            setLinhas((ls) => [...ls.filter((x) => x.produto.id !== editando.id), { produto: editando, quantidade, custo }]);
            setEditando(null);
          }} />
      )}
      {novoCodigo !== null && (
        <CadastroRapidoProduto codigo={novoCodigo || undefined} titulo={novoCodigo ? 'Produto novo' : 'Cadastrar produto'} onFechar={() => setNovoCodigo(null)}
          onSalvo={(p) => { setNovoCodigo(null); invalidar('produtos'); setEditando(p); }} />
      )}
      {procurar && (
        <EscolherProduto produtos={produtos} modoInicial={procurar} onFechar={() => setProcurar(false)} onNovo={() => { setProcurar(false); setNovoCodigo(''); }}
          onEscolher={(p, modo) => { setProcurar(false); if (modo === 'ajuste') setAjuste(p); else setEditando(p); }} />
      )}
      {ajuste && <AjusteEstoque produto={ajuste} onFechar={() => setAjuste(null)} onFeito={() => { setAjuste(null); invalidar('produtos'); mostrar('Estoque ajustado.'); }} />}
      {toast}
    </>
  );
}

function QuantidadeCusto({ produto, atual, onOk, onFechar }: { produto: Produto; atual?: Linha; onOk: (q: number, c: number) => void; onFechar: () => void }) {
  const [qtd, setQtd] = useState(String(atual?.quantidade ?? 1));
  const [custo, setCusto] = useState(toInput(atual?.custo ?? produto.custo_medio));
  const [campo, setCampo] = useState<'qtd' | 'custo'>('qtd');
  return (
    <Janela titulo={descricaoProduto(produto)} onFechar={onFechar} largura={1200}>
      <span className="text-[26px] text-suave">Estoque agora: {produto.estoque_atual} · custo médio {brl(produto.custo_medio)} · preço de venda {brl(produto.preco_venda)}</span>
      <div className="grid grid-cols-2 gap-8">
        <div className="flex flex-col gap-4">
          <CampoTela rotulo="Quantidade que chegou" valor={qtd} ativo={campo === 'qtd'} onToque={() => setCampo('qtd')} grande />
          <CampoTela rotulo="Custo de cada um (sugerido o último)" valor={'R$ ' + (custo || '0')} ativo={campo === 'custo'} onToque={() => setCampo('custo')} grande />
          <span className="text-[28px]">Total: <strong>{brl((parseInt(qtd || '0', 10)) * parseBRL(custo))}</strong></span>
        </div>
        <TecladoNumerico semVirgula={campo === 'qtd'} className="h-[420px]"
          onTecla={(t) => campo === 'qtd' ? setQtd((v) => aplicarTecla(v === '1' && !atual ? '' : v, t, { max: 4 })) : setCusto((v) => aplicarTecla(v, t, { numerico: true, max: 9 }))} />
      </div>
      <Botao variante="concluir" grande icone="check" disabled={!parseInt(qtd || '0', 10)} onClick={() => onOk(parseInt(qtd, 10), parseBRL(custo))}>Pôr na lista</Botao>
    </Janela>
  );
}

function EscolherProduto({ produtos, modoInicial, onEscolher, onNovo, onFechar }: { produtos: Produto[]; modoInicial: 'entrada' | 'ajuste'; onEscolher: (p: Produto, modo: 'entrada' | 'ajuste') => void; onNovo: () => void; onFechar: () => void }) {
  const [q, setQ] = useState('');
  const [modo, setModo] = useState<'entrada' | 'ajuste'>(modoInicial);
  const t = q.trim().toLowerCase();
  const lista = produtos.filter((p) => !t || p.nome.toLowerCase().includes(t)).slice(0, 12);
  return (
    <Janela titulo="Escolher produto" onFechar={onFechar} largura={1700}>
      <div className="flex items-center gap-4">
        <div className="flex h-[88px] flex-1 items-center gap-4 rounded-[20px] border-4 border-azul bg-white px-6">
          <Icone nome="busca" tamanho={36} className="text-azul" />
          <span className={`text-[34px] ${q ? '' : 'text-suave'}`}>{q || 'Digite o nome'}</span>
        </div>
        <button type="button" onClick={() => setModo('entrada')} className={`h-[88px] rounded-2xl border-[3px] px-6 text-[24px] font-bold ${modo === 'entrada' ? 'border-azul bg-azul-claro' : 'border-borda bg-white'}`}>Dar entrada</button>
        <button type="button" onClick={() => setModo('ajuste')} className={`h-[88px] rounded-2xl border-[3px] px-6 text-[24px] font-bold ${modo === 'ajuste' ? 'border-azul bg-azul-claro' : 'border-borda bg-white'}`}>Ajustar estoque</button>
        <Botao variante="neutro" icone="mais" className="h-[88px]" onClick={onNovo}>Produto novo</Botao>
      </div>
      <div className="grid grid-cols-4 gap-3">
        {lista.map((p) => (
          <button key={p.id} type="button" onClick={() => onEscolher(p, modo)} className="flex h-[100px] flex-col justify-center gap-1 rounded-2xl border-[3px] border-borda bg-white px-5 text-left">
            <span className="truncate text-[26px] font-bold">{descricaoProduto(p)}</span>
            <span className={`text-[22px] ${p.estoque_atual <= p.estoque_minimo ? 'font-bold text-vermelho' : 'text-suave'}`}>{p.estoque_atual} em estoque</span>
          </button>
        ))}
      </div>
      <TecladoTexto onTecla={(k) => setQ((v) => aplicarTecla(v, k))} className="h-[320px]" />
    </Janela>
  );
}

/** RF-23: ajuste com motivo obrigatório e PIN. */
function AjusteEstoque({ produto, onFeito, onFechar }: { produto: Produto; onFeito: () => void; onFechar: () => void }) {
  const [novo, setNovo] = useState<string | null>(null);
  if (novo === null) {
    return <ContarEstoque produto={produto} onFechar={onFechar} onOk={(n) => setNovo(String(n))} />;
  }
  const diff = parseInt(novo, 10) - produto.estoque_atual;
  return (
    <PinJanela titulo="Ajustar estoque" pedirMotivo motivos={['Perda', 'Quebra', 'Brinde', 'Contagem']} onFechar={onFechar}
      descricao={`${descricaoProduto(produto)}: de ${produto.estoque_atual} para ${novo} (${diff > 0 ? '+' : ''}${diff}).`}
      onConfirmar={async (pin, motivo) => {
        if (diff === 0) return onFeito();
        await backend.ajustarEstoque(produto.id, diff, motivo.toLowerCase(), pin);
        onFeito();
      }} />
  );
}

function ContarEstoque({ produto, onOk, onFechar }: { produto: Produto; onOk: (n: number) => void; onFechar: () => void }) {
  const [n, setN] = useState('');
  return (
    <Janela titulo={`Quantos ${descricaoProduto(produto)} tem de verdade?`} onFechar={onFechar} largura={1000}>
      <span className="text-[28px]">O sistema diz {produto.estoque_atual}.</span>
      <div className="grid grid-cols-2 gap-8">
        <span className="text-[96px] font-bold">{n || '0'}</span>
        <TecladoNumerico semVirgula onTecla={(t) => setN((v) => aplicarTecla(v, t, { max: 4 }))} className="h-[380px]" />
      </div>
      <Botao variante="primario" grande disabled={n === ''} onClick={() => onOk(parseInt(n, 10))}>Continuar</Botao>
    </Janela>
  );
}
