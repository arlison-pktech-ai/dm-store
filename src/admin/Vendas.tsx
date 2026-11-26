import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { backend } from '../data';
import type { Venda } from '../domain/types';
import { NOME_FORMA } from '../domain/types';
import { numeroVenda } from '../domain/regras';
import { brl } from '../lib/money';
import { addDias, dataBR, dataHoraBR, hojeISO } from '../lib/dates';
import { mensagem } from '../lib/erros';
import { B, Card, Erro, Linha } from './ui';

/** Vendas do período, com detalhe e cancelamento (RF-18; o admin não precisa do PIN). */
export default function Vendas() {
  const hoje = hojeISO();
  const [dias, setDias] = useState(0);
  const desde = addDias(hoje, -dias);
  const q = useQuery({ queryKey: ['vendasAdmin', desde], queryFn: () => backend.vendas({ desde, ate: hoje, limite: 300 }) });
  const [aberta, setAberta] = useState<string | null>(null);
  const total = (q.data ?? []).filter((v) => v.status === 'concluida').reduce((s, v) => s + v.total, 0);
  return (
    <>
      <h1 className="m-0 text-[22px]">Vendas</h1>
      <div className="flex gap-1.5">
        {[[0, 'Hoje'], [1, 'Ontem e hoje'], [6, '7 dias'], [29, '30 dias']].map(([d, n]) => (
          <button key={d} type="button" onClick={() => setDias(d as number)} className={`h-11 flex-1 rounded-xl border-2 px-3 text-[13px] font-bold md:flex-none md:px-6 ${dias === d ? 'border-azul bg-azul-claro text-azul' : 'border-borda bg-white'}`}>{n}</button>
        ))}
      </div>
      <span className="text-[14px] text-suave">{q.data?.length ?? 0} vendas desde {dataBR(desde)} · concluídas somam <strong className="text-tinta">{brl(total)}</strong></span>
      {q.data?.map((v) => <VendaCard key={v.id} v={v} aberta={aberta === v.id} onToggle={() => setAberta(aberta === v.id ? null : v.id)} />)}
    </>
  );
}

function VendaCard({ v, aberta, onToggle }: { v: Venda; aberta: boolean; onToggle: () => void }) {
  const qc = useQueryClient();
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState('');
  const cancelar = async () => {
    setErro('');
    try {
      await backend.cancelarVenda(v.id, motivo || 'Cancelada pelo administrador');
      qc.invalidateQueries();
    } catch (e) {
      setErro(mensagem(e));
    }
  };
  return (
    <Card>
      <button type="button" onClick={onToggle} className="flex items-center justify-between border-none bg-transparent p-0 text-left">
        <span className="flex flex-col">
          <span className={`text-[15px] font-bold ${v.status === 'cancelada' ? 'text-suave line-through' : ''}`}>{numeroVenda(v.numero)} · {v.cliente.nome}</span>
          <span className="text-[13px] text-suave">{dataHoraBR(v.criada_em)} · {v.pagamentos.map((p) => NOME_FORMA[p.forma]).join(' + ')}{v.para_entrega ? ' · entrega' : ''}</span>
        </span>
        <span className="text-[16px] font-bold">{brl(v.total)}</span>
      </button>
      {aberta && <>
        {v.itens.map((i, k) => <Linha key={k} esq={`${i.quantidade}× ${i.descricao}`} dir={brl(i.quantidade * i.preco_unitario)} sub={`custo ${brl(i.custo_unitario)}`} />)}
        {v.desconto > 0 && <Linha esq="Desconto" dir={`− ${brl(v.desconto)}`} />}
        {v.pagamentos.map((p, k) => (
          <Linha key={k} esq={NOME_FORMA[p.forma] + (p.parcelas_cartao ? ` ${p.parcelas_cartao}×` : '')} dir={brl(p.valor)}
            sub={p.taxa ? `${p.acrescimo ? `cobrado ${brl(p.valor_recebido ?? p.valor)} (taxa repassada ${brl(p.acrescimo)}) · ` : ''}taxa ${brl(p.taxa)} · líquido ${brl(p.valor_liquido)}` : p.troco ? `recebido ${brl(p.valor_recebido ?? 0)} · troco ${brl(p.troco)}` : undefined} />
        ))}
        {v.parcelas.length > 0 && <span className="text-[13px] text-suave">Parcelas: {v.parcelas.map((p) => `${brl(p.valor)} em ${dataBR(p.vencimento)}`).join(' · ')}</span>}
        {v.status === 'cancelada'
          ? <span className="text-[13px] font-bold text-vermelho">Cancelada em {dataHoraBR(v.cancelada_em!)}: {v.motivo_cancelamento}</span>
          : <div className="flex gap-2">
            <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo do cancelamento" className="min-h-11 min-w-0 flex-1 rounded-xl border-2 border-borda px-3 text-[15px]" />
            <B variante="perigo" onClick={cancelar}>Cancelar venda</B>
          </div>}
        <Erro>{erro}</Erro>
      </>}
    </Card>
  );
}
