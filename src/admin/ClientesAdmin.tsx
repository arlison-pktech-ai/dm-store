import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { backend } from '../data';
import type { Cliente } from '../domain/types';
import { NOME_FORMA } from '../domain/types';
import { brl, parseBRL, toInput } from '../lib/money';
import { dataHoraBR } from '../lib/dates';
import { mensagem } from '../lib/erros';
import { B, Campo, Card, Erro, Linha, Ok } from './ui';

export default function ClientesAdmin() {
  const [aba, setAba] = useState<'receber' | 'busca' | 'recebimentos'>('receber');
  return (
    <>
      <h1 className="m-0 text-[22px]">Clientes</h1>
      <div className="flex gap-1.5">
        {([['receber', 'A receber'], ['busca', 'Buscar / editar'], ['recebimentos', 'Recebimentos']] as const).map(([k, n]) => (
          <button key={k} type="button" onClick={() => setAba(k)} className={`h-11 flex-1 rounded-xl border-2 text-[13px] font-bold ${aba === k ? 'border-azul bg-azul-claro text-azul' : 'border-borda bg-white'}`}>{n}</button>
        ))}
      </div>
      {aba === 'receber' && <AReceber />}
      {aba === 'busca' && <Busca />}
      {aba === 'recebimentos' && <Recebimentos />}
    </>
  );
}

/** RF-45: visão "A receber", ordenada por atraso. */
function AReceber() {
  const q = useQuery({ queryKey: ['resumoReceber'], queryFn: () => backend.resumoReceber() });
  const r = q.data;
  return (
    <>
      <Card titulo="Total em aberto" direita={<strong className="text-[22px]">{brl(r?.total_aberto ?? 0)}</strong>}>
        <span className="text-[14px]">Vencido <strong className="text-vermelho">{brl(r?.total_vencido ?? 0)}</strong> · em 7 dias {brl(r?.a_vencer_7 ?? 0)} · em 30 dias {brl(r?.a_vencer_30 ?? 0)}</span>
      </Card>
      <Card titulo="Por cliente (mais atrasadas primeiro)">
        {r?.clientes.length === 0 && <span className="text-[14px] text-suave">Ninguém deve nada.</span>}
        {r?.clientes.map((c) => (
          <Linha key={c.cliente_id} esq={c.nome} sub={c.dias_atraso > 0 ? <span className="text-vermelho">{brl(c.vencido)} vencido · {c.dias_atraso} dias</span> : c.telefone}
            dir={<strong>{brl(c.devido)}</strong>} />
        ))}
      </Card>
    </>
  );
}

function Busca() {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Cliente | null>(null);
  const r = useQuery({ queryKey: ['buscaCliente', q], queryFn: () => backend.buscarClientes(q), enabled: q.trim().length >= 2 });
  if (sel) return <Editar c={sel} onFechar={() => setSel(null)} />;
  return (
    <>
      <div className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome ou telefone" className="min-h-11 flex-1 rounded-xl border-2 border-borda px-3 text-[16px]" />
        <B variante="primario" onClick={() => setSel({ id: '', nome: '', telefone: '', endereco: null, bairro: null, referencia: null, observacoes: null, limite_credito: null, ativo: true })}>Nova</B>
      </div>
      <Card>
        {(r.data ?? []).map((c) => (
          <button key={c.id} type="button" onClick={() => setSel(c)} className="border-none bg-transparent p-0 text-left">
            <Linha esq={c.nome} sub={c.telefone} dir={c.limite_credito != null ? `limite ${brl(c.limite_credito)}` : undefined} />
          </button>
        ))}
        {q.trim().length < 2 && <span className="text-[14px] text-suave">Digite ao menos 2 letras.</span>}
      </Card>
    </>
  );
}

function Editar({ c, onFechar }: { c: Cliente; onFechar: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ ...c, limite: c.limite_credito != null ? toInput(c.limite_credito) : '' });
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState('');
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((v) => ({ ...v, [k]: e.target.value }));
  const salvar = async () => {
    setErro('');
    try {
      await backend.salvarCliente({
        ...(c.id ? { id: c.id } : {}), nome: f.nome, telefone: f.telefone, endereco: f.endereco || null, bairro: f.bairro || null,
        referencia: f.referencia || null, observacoes: f.observacoes || null, limite_credito: f.limite ? parseBRL(f.limite) : null,
      });
      qc.invalidateQueries();
      setOk('Salvo.');
    } catch (e) {
      setErro(mensagem(e));
    }
  };
  /** RNF-06 (LGPD): anonimizar mantendo as vendas. */
  const anonimizar = async () => {
    if (!confirm('Anonimizar os dados desta cliente? As vendas continuam, mas nome, telefone e endereço somem.')) return;
    try {
      await backend.salvarCliente({ id: c.id, nome: 'Cliente anonimizada', telefone: '00000000000', endereco: null, bairro: null, referencia: null, observacoes: null });
      qc.invalidateQueries();
      onFechar();
    } catch (e) {
      setErro(mensagem(e));
    }
  };
  return (
    <Card titulo={c.id ? 'Editar cliente' : 'Nova cliente'} direita={<B onClick={onFechar}>Voltar</B>}>
      <Campo rotulo="Nome" value={f.nome} onChange={set('nome')} />
      <Campo rotulo="Telefone" value={f.telefone} onChange={set('telefone')} inputMode="tel" />
      <Campo rotulo="Endereço" value={f.endereco ?? ''} onChange={set('endereco')} />
      <Campo rotulo="Bairro" value={f.bairro ?? ''} onChange={set('bairro')} />
      <Campo rotulo="Ponto de referência" value={f.referencia ?? ''} onChange={set('referencia')} />
      <Campo rotulo="Observações" value={f.observacoes ?? ''} onChange={set('observacoes')} />
      <Campo rotulo="Limite de crédito (R$, vazio = sem limite)" value={f.limite} onChange={set('limite')} inputMode="decimal" />
      <Erro>{erro}</Erro>
      <Ok>{ok}</Ok>
      <B variante="primario" onClick={salvar}>Salvar</B>
      {c.id && <B variante="perigo" onClick={anonimizar}>Anonimizar dados (LGPD)</B>}
    </Card>
  );
}

/** RF-44: estorno de recebimento pelo administrador. */
function Recebimentos() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['recebimentos'], queryFn: () => backend.recebimentos({}) });
  const [erro, setErro] = useState('');
  const grupos = new Map<string, NonNullable<typeof q.data>>();
  (q.data ?? []).forEach((r) => grupos.set(r.grupo_id, [...(grupos.get(r.grupo_id) ?? []), r]));
  const estornar = async (g: string) => {
    const motivo = prompt('Motivo do estorno:');
    if (!motivo) return;
    setErro('');
    try {
      await backend.estornarRecebimento(g, motivo);
      qc.invalidateQueries();
    } catch (e) {
      setErro(mensagem(e));
    }
  };
  return (
    <Card titulo="Últimos recebimentos do crediário">
      <Erro>{erro}</Erro>
      {grupos.size === 0 && <span className="text-[14px] text-suave">Nenhum recebimento ainda.</span>}
      {[...grupos.entries()].map(([g, rs]) => (
        <div key={g} className="flex items-center gap-2 border-b border-cinza py-2 last:border-none">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className={`text-[15px] font-bold ${rs[0].estornado ? 'text-suave line-through' : ''}`}>{rs[0].cliente_nome} · {brl(rs.reduce((s, r) => s + r.valor, 0))}</span>
            <span className="text-[13px] text-suave">{dataHoraBR(rs[0].recebido_em)} · {rs.map((r) => NOME_FORMA[r.forma]).join(' + ')}{rs[0].estornado ? ' · estornado' : ''}</span>
          </span>
          {!rs[0].estornado && <B variante="perigo" onClick={() => estornar(g)}>Estornar</B>}
        </div>
      ))}
    </Card>
  );
}
