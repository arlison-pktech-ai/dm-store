import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { backend } from '../data';
import type { Produto } from '../domain/types';
import { useProdutos } from '../terminal/dados';
import { brl, parseBRL, toInput } from '../lib/money';
import { dataHoraBR } from '../lib/dates';
import { mensagem } from '../lib/erros';
import { lerCSV } from '../lib/csv';
import { B, Campo, Card, Erro, Linha, Ok } from './ui';

export default function Estoque() {
  const { produtos } = useProdutos();
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState<'todos' | 'repor'>('todos');
  const [sel, setSel] = useState<Produto | 'novo' | 'importar' | null>(null);
  if (sel === 'importar') return <Importar onFechar={() => setSel(null)} />;
  if (sel) return <EditarProduto p={sel === 'novo' ? null : sel} onFechar={() => setSel(null)} />;
  const t = q.trim().toLowerCase();
  const lista = produtos
    .filter((p) => (filtro === 'todos' || (p.ativo && p.estoque_atual <= p.estoque_minimo)))
    .filter((p) => !t || `${p.nome} ${p.marca ?? ''} ${p.codigo_barras ?? ''} ${p.codigo_interno}`.toLowerCase().includes(t));
  return (
    <>
      <h1 className="m-0 text-[22px]">Estoque e produtos</h1>
      <div className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome, marca ou código" className="min-h-11 min-w-0 flex-1 rounded-xl border-2 border-borda px-3 text-[16px]" />
        <B variante="primario" onClick={() => setSel('novo')}>Novo</B>
        <B onClick={() => setSel('importar')}>Importar</B>
      </div>
      <div className="flex gap-1.5">
        {([['todos', 'Todos'], ['repor', 'Lista de reposição']] as const).map(([k, n]) => (
          <button key={k} type="button" onClick={() => setFiltro(k)} className={`h-11 flex-1 rounded-xl border-2 px-3 text-[13px] font-bold md:flex-none md:px-6 ${filtro === k ? 'border-azul bg-azul-claro text-azul' : 'border-borda bg-white'}`}>{n}</button>
        ))}
      </div>
      <Card>
        {lista.length === 0 && <span className="text-[14px] text-suave">Nenhum produto.</span>}
        {lista.map((p) => (
          <button key={p.id} type="button" onClick={() => setSel(p)} className="border-none bg-transparent p-0 text-left">
            <Linha esq={<span className={p.ativo ? '' : 'text-suave line-through'}>{p.nome}{p.volume_ml ? ` ${p.volume_ml} ml` : ''}</span>}
              sub={`${brl(p.preco_venda)} · custo ${brl(p.custo_medio)} · ${p.codigo_barras ?? p.codigo_interno}`}
              dir={<strong className={p.estoque_atual <= 0 ? 'text-vermelho' : p.estoque_atual <= p.estoque_minimo ? 'text-ambar' : ''}>{p.estoque_atual} un.</strong>} />
          </button>
        ))}
      </Card>
    </>
  );
}

function EditarProduto({ p, onFechar }: { p: Produto | null; onFechar: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    nome: p?.nome ?? '', marca: p?.marca ?? '', categoria: p?.categoria ?? '', volume: p?.volume_ml ? String(p.volume_ml) : '',
    codigo: p?.codigo_barras ?? '', preco: p ? toInput(p.preco_venda) : '', minimo: String(p?.estoque_minimo ?? 1), ativo: p?.ativo ?? true, foto: p?.foto_url ?? '',
  });
  const [ajuste, setAjuste] = useState({ qtd: '', motivo: 'contagem' });
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState('');
  const mov = useQuery({ queryKey: ['movimentos', p?.id], queryFn: () => backend.movimentos(p!.id), enabled: !!p });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((v) => ({ ...v, [k]: e.target.value }));

  const salvar = async () => {
    setErro('');
    setOk('');
    try {
      await backend.salvarProduto({
        ...(p ? { id: p.id } : {}), nome: f.nome, marca: f.marca || null, categoria: f.categoria || null, volume_ml: f.volume ? parseInt(f.volume, 10) : null,
        codigo_barras: f.codigo || null, preco_venda: parseBRL(f.preco), estoque_minimo: parseInt(f.minimo || '0', 10), ativo: f.ativo, foto_url: f.foto || null,
      });
      qc.invalidateQueries({ queryKey: ['produtos'] });
      if (!p) onFechar();
      else setOk('Salvo.');
    } catch (e) {
      setErro(mensagem(e));
    }
  };
  const ajustar = async () => {
    setErro('');
    setOk('');
    const n = parseInt(ajuste.qtd, 10);
    if (!n) return setErro('Digite a quantidade (use − para tirar).');
    try {
      await backend.ajustarEstoque(p!.id, n, ajuste.motivo);
      qc.invalidateQueries({ queryKey: ['produtos'] });
      qc.invalidateQueries({ queryKey: ['movimentos', p!.id] });
      setAjuste({ qtd: '', motivo: 'contagem' });
      setOk('Estoque ajustado.');
    } catch (e) {
      setErro(mensagem(e));
    }
  };
  const NOMES_MOV = { entrada: 'Entrada', venda: 'Venda', ajuste: 'Ajuste', cancelamento: 'Cancelamento' };
  return (
    <div className="grid items-start gap-3 md:gap-4 lg:grid-cols-2">
      <Card titulo={p ? 'Editar produto' : 'Novo produto'} direita={<B onClick={onFechar}>Voltar</B>}>
        <Campo rotulo="Nome" value={f.nome} onChange={set('nome')} />
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-2">
          <Campo rotulo="Marca" value={f.marca} onChange={set('marca')} />
          <Campo rotulo="Categoria" value={f.categoria} onChange={set('categoria')} />
          <Campo rotulo="Volume (ml)" value={f.volume} onChange={set('volume')} inputMode="numeric" />
          <Campo rotulo="Estoque mínimo" value={f.minimo} onChange={set('minimo')} inputMode="numeric" />
          <Campo rotulo="Preço de venda (R$)" value={f.preco} onChange={set('preco')} inputMode="decimal" />
          <Campo rotulo="Código de barras" value={f.codigo} onChange={set('codigo')} />
        </div>
        <Campo rotulo="Foto (URL, opcional)" value={f.foto} onChange={set('foto')} />
        <label className="flex items-center gap-2 text-[15px]"><input type="checkbox" checked={f.ativo} onChange={(e) => setF((v) => ({ ...v, ativo: e.target.checked }))} className="size-5" /> Ativo (aparece no terminal)</label>
        {p && <span className="text-[13px] text-suave">Código interno {p.codigo_interno} · custo médio {brl(p.custo_medio)} · estoque {p.estoque_atual}</span>}
        <Erro>{erro}</Erro>
        <Ok>{ok}</Ok>
        <B variante="primario" onClick={salvar}>Salvar</B>
      </Card>
      {p && <div className="flex min-w-0 flex-col gap-3 md:gap-4">
        <Card titulo="Ajustar estoque">
          <div className="grid grid-cols-2 gap-2">
            <Campo rotulo="Quantidade (+ ou −)" value={ajuste.qtd} onChange={(e) => setAjuste((a) => ({ ...a, qtd: e.target.value }))} inputMode="numeric" placeholder="-1" />
            <label className="flex flex-col gap-1 text-[13px] font-bold text-suave">Motivo
              <select value={ajuste.motivo} onChange={(e) => setAjuste((a) => ({ ...a, motivo: e.target.value }))} className="min-h-11 rounded-xl border-2 border-borda bg-white px-2 text-[16px] font-normal text-tinta">
                {['perda', 'quebra', 'brinde', 'contagem'].map((m) => <option key={m}>{m}</option>)}
              </select>
            </label>
          </div>
          <B onClick={ajustar}>Lançar ajuste</B>
        </Card>
        <Card titulo="Histórico de movimentos">
          {mov.data?.map((m) => (
            <Linha key={m.id} esq={`${NOMES_MOV[m.tipo]}${m.motivo ? ` · ${m.motivo}` : ''}`} sub={dataHoraBR(m.criado_em)}
              dir={<strong className={m.quantidade < 0 ? 'text-vermelho' : 'text-verde-escuro'}>{m.quantidade > 0 ? '+' : ''}{m.quantidade}</strong>} />
          ))}
        </Card>
      </div>}
    </div>
  );
}

/** RF-26/RF-34: importação inicial por planilha CSV. */
function Importar({ onFechar }: { onFechar: () => void }) {
  const qc = useQueryClient();
  const [tipo, setTipo] = useState<'produtos' | 'clientes'>('produtos');
  const [linhas, setLinhas] = useState<Record<string, string>[]>([]);
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState('');
  const ler = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setErro('');
    const f = e.target.files?.[0];
    if (!f) return;
    if (!/\.csv$/i.test(f.name)) return setErro('Salve a planilha como CSV (no Excel: Arquivo › Salvar como › CSV).');
    setLinhas(lerCSV(await f.text()));
  };
  const importar = async () => {
    setErro('');
    try {
      const n = tipo === 'produtos'
        ? await backend.importarProdutos(linhas.map((l) => ({
          nome: l.nome, marca: l.marca || null, categoria: l.categoria || null, volume_ml: l.volume_ml || l.volume ? parseInt(l.volume_ml || l.volume, 10) : null,
          codigo_barras: l.codigo_barras || l.codigo || null, preco_venda: parseBRL(l.preco_venda || l.preco || ''), estoque_minimo: l.estoque_minimo ? parseInt(l.estoque_minimo, 10) : 1,
        })))
        : await backend.importarClientes(linhas.map((l) => ({
          nome: l.nome, telefone: l.telefone, endereco: l.endereco || null, bairro: l.bairro || null, referencia: l.referencia || null,
          saldo_aberto: l.saldo_aberto || l.saldo ? parseBRL(l.saldo_aberto || l.saldo) : 0, vencimento: l.vencimento ? brParaISO(l.vencimento) : undefined,
        })));
      qc.invalidateQueries();
      setOk(`${n} linha${n === 1 ? '' : 's'} importada${n === 1 ? '' : 's'}.`);
      setLinhas([]);
    } catch (e) {
      setErro(mensagem(e));
    }
  };
  return (
    <Card titulo="Importar planilha" direita={<B onClick={onFechar}>Voltar</B>}>
      <div className="flex gap-1.5">
        {(['produtos', 'clientes'] as const).map((k) => (
          <button key={k} type="button" onClick={() => { setTipo(k); setLinhas([]); }} className={`h-11 flex-1 rounded-xl border-2 px-3 text-[13px] font-bold md:flex-none md:px-6 ${tipo === k ? 'border-azul bg-azul-claro text-azul' : 'border-borda bg-white'}`}>{k === 'produtos' ? 'Produtos' : 'Clientes e saldos'}</button>
        ))}
      </div>
      <span className="text-[13px] text-suave">
        Colunas aceitas: {tipo === 'produtos'
          ? 'nome, marca, categoria, volume_ml, codigo_barras, preco_venda, estoque_minimo'
          : 'nome, telefone, endereco, bairro, referencia, saldo_aberto (R$), vencimento (dd/mm/aaaa)'}.
        {tipo === 'produtos' && ' O estoque inicial entra depois pela tela "Chegou mercadoria", com o custo.'}
      </span>
      <input type="file" accept=".csv,text/csv" onChange={ler} className="text-[14px]" />
      {linhas.length > 0 && <span className="text-[14px]">{linhas.length} linhas lidas. Primeira: <strong>{linhas[0].nome}</strong></span>}
      <Erro>{erro}</Erro>
      <Ok>{ok}</Ok>
      <B variante="primario" disabled={!linhas.length} onClick={importar}>Importar {linhas.length || ''}</B>
    </Card>
  );
}

function brParaISO(s: string) {
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
}
