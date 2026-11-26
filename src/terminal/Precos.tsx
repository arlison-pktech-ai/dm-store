import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { backend } from '../data';
import type { Produto } from '../domain/types';
import { Icone } from '../components/Icone';
import { Aviso, Botao, Cabecalho, Janela, TecladoNumerico, aplicarTecla, useToast } from '../components/ui';
import { brl, parseBRL } from '../lib/money';
import { somErro, somOk } from '../lib/som';
import { useScanner } from '../lib/useScanner';
import { PinJanela } from './componentes';
import { useInvalidar, useProdutos } from './dados';
import { ProcurarJanela } from './Estoque';
import { descricaoProduto, detalheProduto } from './vendaAtual';

/**
 * Tela de preços: bipa ou procura o produto, digita o novo preço e, no fim, salva todos de uma
 * vez com o PIN. Nada muda antes de salvar.
 */
export default function Precos() {
  const nav = useNavigate();
  const { produtos, porCodigo, carregando } = useProdutos();
  const invalidar = useInvalidar();
  const [q, setQ] = useState('');
  const [novos, setNovos] = useState<Record<string, number>>({});
  const [editando, setEditando] = useState<Produto | null>(null);
  const [procurar, setProcurar] = useState(false);
  const [pin, setPin] = useState(false);
  const [destaque, setDestaque] = useState<string | null>(null);
  const [toast, mostrar] = useToast();

  useScanner((codigo) => {
    if (editando || procurar || pin) return;
    const p = porCodigo.get(codigo);
    if (!p) { somErro(); mostrar('Produto não encontrado.', 'erro'); return; }
    somOk();
    setDestaque(p.id);
    setEditando(p);
  });

  useEffect(() => {
    if (destaque) document.getElementById(`preco-${destaque}`)?.scrollIntoView({ block: 'center' });
  }, [destaque]);

  const t = q.trim().toLowerCase();
  const lista = useMemo(() => produtos
    .filter((p) => !t || p.nome.toLowerCase().includes(t) || (p.marca ?? '').toLowerCase().includes(t))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')), [produtos, t]);
  const mudancas = produtos.filter((p) => novos[p.id] != null && novos[p.id] !== p.preco_venda);

  return (
    <>
      <Cabecalho voltar={{ para: '/terminal/estoque', texto: 'Estoque' }} titulo="Preços" />
      <main className="flex min-h-0 flex-1 gap-8 px-12 py-8">
        <section className="flex min-w-0 flex-1 flex-col gap-5">
          <div className="flex shrink-0 items-center gap-4">
            <button type="button" onClick={() => setProcurar(true)} className="flex h-[88px] min-w-0 flex-1 items-center gap-4 rounded-[20px] border-[3px] border-borda bg-white px-6 text-left">
              <Icone nome="busca" tamanho={36} className="text-azul" />
              <span className={`truncate text-[30px] ${q ? 'font-bold' : 'text-suave'}`}>{q || 'Procurar pelo nome ou passe no leitor'}</span>
            </button>
            {q && <Botao variante="neutro" icone="x" className="h-[88px]" onClick={() => setQ('')}>Limpar</Botao>}
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
            {!carregando && lista.length === 0 && <div className="rounded-[20px] border-2 border-dashed border-borda p-10 text-center text-[28px] text-suave">Nenhum produto aqui.</div>}
            {lista.map((p) => {
              const novo = novos[p.id];
              const mudou = novo != null && novo !== p.preco_venda;
              return (
                <div key={p.id} id={`preco-${p.id}`} data-testid="linha-preco"
                  className={`grid h-[112px] shrink-0 grid-cols-[minmax(0,1fr)_380px_200px] items-center gap-4 rounded-[20px] border-[3px] bg-white px-6 ${mudou ? 'border-azul bg-azul-claro' : destaque === p.id ? 'border-verde' : 'border-borda'}`}>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-[30px] font-bold">{descricaoProduto(p)}</span>
                    <span className="truncate text-[22px] text-suave">{[p.marca, detalheProduto(p), `custo médio ${brl(p.custo_medio)}`].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="text-right text-[34px] font-bold">
                    {mudou ? <><span className="text-[24px] font-normal text-suave line-through">{brl(p.preco_venda)}</span> {brl(novo)}</> : brl(p.preco_venda)}
                  </span>
                  <span className="flex justify-end">
                    <Botao variante="contorno" className="!px-4 !text-[22px]" onClick={() => setEditando(p)}>Mudar preço</Botao>
                  </span>
                </div>
              );
            })}
          </div>
        </section>
        <aside className="flex w-[560px] shrink-0 flex-col gap-5 rounded-3xl border-2 border-borda bg-white p-9">
          <span className="text-[26px] text-suave">{produtos.length} produtos</span>
          <div className="flex items-baseline justify-between border-t-2 border-borda pt-5"><span className="text-[32px] font-bold">Preços alterados</span></div>
          <span className="text-[64px] font-bold">{mudancas.length}</span>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
            {mudancas.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 text-[24px]">
                <span className="truncate">{descricaoProduto(p)}</span>
                <span className="shrink-0 font-bold">{brl(novos[p.id])}</span>
              </div>
            ))}
          </div>
          <Aviso tipo="info">Os preços só mudam quando você salvar com o PIN. Vendas já feitas não mudam.</Aviso>
          <Botao variante="concluir" grande icone="check" className="h-[120px] shrink-0" disabled={!mudancas.length} onClick={() => setPin(true)}>Salvar preços</Botao>
          <Botao variante="perigo" icone="lixo" disabled={!mudancas.length} onClick={() => setNovos({})}>Desfazer mudanças</Botao>
        </aside>
      </main>
      {procurar && <ProcurarJanela titulo="Procurar produto" valor={q} produtos={produtos} onFechar={(v) => { setQ(v); setProcurar(false); }} />}
      {editando && (
        <NovoPreco produto={editando} atual={novos[editando.id]} onFechar={() => setEditando(null)}
          onOk={(v) => { setNovos((n) => ({ ...n, [editando.id]: v })); setEditando(null); }} />
      )}
      {pin && (
        <PinJanela titulo="Salvar preços" descricao={`${mudancas.length} preço${mudancas.length !== 1 ? 's' : ''} vão mudar.`} onFechar={() => setPin(false)}
          onConfirmar={async (p) => {
            const n = await backend.atualizarPrecos(mudancas.map((x) => ({ produto_id: x.id, preco_venda: novos[x.id] })), p);
            setNovos({});
            setPin(false);
            invalidar('produtos');
            mostrar(`Preços salvos: ${n}.`);
            setTimeout(() => nav('/terminal/estoque'), 1200);
          }} />
      )}
      {toast}
    </>
  );
}

function NovoPreco({ produto, atual, onOk, onFechar }: { produto: Produto; atual?: number; onOk: (v: number) => void; onFechar: () => void }) {
  const [txt, setTxt] = useState('');
  const v = parseBRL(txt);
  const margem = v > 0 && produto.custo_medio > 0 ? Math.round(((v - produto.custo_medio) / v) * 100) : null;
  return (
    <Janela titulo={`Novo preço · ${descricaoProduto(produto)}`} onFechar={onFechar} largura={1100}>
      <span className="text-[26px] text-suave">Preço atual {brl(produto.preco_venda)}{atual != null ? ` · já alterado para ${brl(atual)}` : ''} · custo médio {brl(produto.custo_medio)}</span>
      <div className="grid grid-cols-2 gap-8">
        <div className="flex flex-col gap-4">
          <span className="text-[26px] font-bold">Novo preço de venda</span>
          <span className="text-[72px] font-bold" data-testid="novo-preco">{brl(v)}</span>
          {margem !== null && <span className={`text-[26px] ${margem < 0 ? 'font-bold text-vermelho' : 'text-suave'}`}>{margem < 0 ? 'Abaixo do custo!' : `Margem de ${margem}% sobre o preço`}</span>}
        </div>
        <TecladoNumerico onTecla={(t) => setTxt((s) => aplicarTecla(s, t, { numerico: true, max: 9 }))} className="h-[400px]" />
      </div>
      <Botao variante="primario" grande icone="check" disabled={v <= 0} onClick={() => onOk(v)}>Usar este preço</Botao>
    </Janela>
  );
}
