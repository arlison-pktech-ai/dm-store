import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { backend } from '../data';
import { useConfig, useProdutos } from '../terminal/dados';
import { brl } from '../lib/money';
import { diaMes, hojeISO } from '../lib/dates';
import { Card, Linha } from './ui';

const CORES = { cartao: '#1F5FBF', pix: '#5B8FD9', dinheiro: '#9DBBE8', fiado: '#C98A1B', debito: '#17803D' } as const;
const NOMES = { cartao: 'Cartão', pix: 'PIX', dinheiro: 'Dinheiro', fiado: 'Crediário', debito: 'Débito' } as const;

/** RF-62: painel do dia e do mês. */
export default function Painel() {
  const [periodo, setPeriodo] = useState<'dia' | 'mes'>('dia');
  const hoje = hojeISO();
  const desde = periodo === 'dia' ? hoje : hoje.slice(0, 8) + '01';
  const cfg = useConfig();
  const painel = useQuery({ queryKey: ['painel', desde, hoje], queryFn: () => backend.painel(desde, hoje) });
  const receber = useQuery({ queryKey: ['resumoReceber'], queryFn: () => backend.resumoReceber() });
  const ano = useQuery({ queryKey: ['painel', hoje.slice(0, 4)], queryFn: () => backend.painel(hoje.slice(0, 4) + '-01-01', hoje) });
  const { produtos } = useProdutos();
  const repor = produtos.filter((p) => p.ativo && p.estoque_atual <= p.estoque_minimo).sort((a, b) => a.estoque_atual - b.estoque_atual);
  const p = painel.data;
  const formas = (Object.keys(CORES) as (keyof typeof CORES)[]).filter((f) => (p?.por_forma[f] ?? 0) > 0 || f !== 'debito');
  const teto = cfg.teto_mei[hoje.slice(0, 4)];
  const pctMei = teto && ano.data ? Math.round((ano.data.vendido / teto) * 100) : null;
  const atrasados = receber.data?.clientes.filter((c) => c.vencido > 0) ?? [];

  return (
    <>
      <header className="flex items-center justify-between">
        <span className="flex flex-col"><span className="text-[13px] text-suave">{cfg.nome} · Admin</span><span className="text-[22px] font-bold">{periodo === 'dia' ? `Hoje, ${diaMes(hoje)}` : 'Este mês'}</span></span>
        <div className="flex gap-1.5">
          {(['dia', 'mes'] as const).map((x) => (
            <button key={x} type="button" onClick={() => setPeriodo(x)} className={`h-11 rounded-xl border-2 px-3.5 text-[14px] font-bold ${periodo === x ? 'border-azul bg-azul-claro text-azul' : 'border-borda bg-white'}`}>{x === 'dia' ? 'Dia' : 'Mês'}</button>
          ))}
        </div>
      </header>
      <Card titulo={<span className="font-normal text-suave">Vendido · {p?.vendas_qtd ?? 0} venda{p?.vendas_qtd === 1 ? '' : 's'}</span>} direita={<span className="text-[26px] font-bold">{brl(p?.vendido ?? 0)}</span>}>
        <div className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-cinza">
          {formas.map((f) => (p?.por_forma[f] ?? 0) > 0 && <span key={f} style={{ flex: p!.por_forma[f], background: CORES[f] }} />)}
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[14px]">
          {formas.map((f) => (
            <span key={f} className="flex items-center gap-1.5"><span className="size-2.5 rounded-[3px]" style={{ background: CORES[f] }} />{NOMES[f]} {brl(p?.por_forma[f] ?? 0)}</span>
          ))}
        </div>
        <span className="text-[13px] text-suave">Recebido do crediário no período: <strong className="text-tinta">{brl(p?.recebido_fiado ?? 0)}</strong></span>
        {(p?.acrescimo_cartao ?? 0) > 0 && <span className="text-[13px] text-suave">Taxa do cartão repassada às clientes (fora do vendido): <strong className="text-tinta">{brl(p!.acrescimo_cartao!)}</strong></span>}
      </Card>
      <Card titulo={<span className="font-normal text-suave">A receber do crediário</span>} direita={<span className="text-[26px] font-bold">{brl(receber.data?.total_aberto ?? 0)}</span>}>
        <div className="grid grid-cols-3 gap-2">
          <span className="flex flex-col rounded-[10px] bg-vermelho-claro p-2"><span className="text-[12px] text-vermelho-escuro">Vencido</span><span className="text-[16px] font-bold text-vermelho">{brl(receber.data?.total_vencido ?? 0)}</span></span>
          <span className="flex flex-col rounded-[10px] bg-fundo p-2"><span className="text-[12px] text-suave">Em 7 dias</span><span className="text-[16px] font-bold">{brl(receber.data?.a_vencer_7 ?? 0)}</span></span>
          <span className="flex flex-col rounded-[10px] bg-fundo p-2"><span className="text-[12px] text-suave">Em 30 dias</span><span className="text-[16px] font-bold">{brl(receber.data?.a_vencer_30 ?? 0)}</span></span>
        </div>
      </Card>
      <Card titulo="Em atraso" direita={<span className="text-[13px] text-suave">{atrasados.length} cliente{atrasados.length === 1 ? '' : 's'}</span>}>
        {atrasados.length === 0 && <span className="text-[14px] text-suave">Ninguém em atraso.</span>}
        {atrasados.slice(0, 8).map((c) => (
          <div key={c.cliente_id} className="flex items-center gap-2.5">
            <span className="flex flex-1 flex-col"><span className="text-[15px] font-bold">{c.nome}</span><span className="text-[13px] text-vermelho">{brl(c.vencido)} · {c.dias_atraso} dias</span></span>
            <a className="flex h-11 items-center rounded-xl border-2 border-verde px-3 text-[13px] font-bold text-verde-escuro no-underline" target="_blank" rel="noreferrer"
              href={`https://wa.me/55${c.telefone.replace(/\D/g, '')}?text=${encodeURIComponent(`Oi, ${c.nome.split(' ')[0]}! Tudo bem? Passando para lembrar da parcela de ${brl(c.vencido)} que venceu. Qualquer coisa me avise. ${cfg.nome}`)}`}>
              Cobrar no WhatsApp
            </a>
          </div>
        ))}
      </Card>
      <Card titulo="Repor estoque" direita={<span className="text-[13px] text-suave">{repor.length} produto{repor.length === 1 ? '' : 's'}</span>}>
        {repor.length === 0 && <span className="text-[14px] text-suave">Tudo acima do mínimo.</span>}
        {repor.slice(0, 10).map((x) => (
          <Linha key={x.id} esq={`${x.nome}${x.volume_ml ? ` ${x.volume_ml} ml` : ''}`} sub={`mínimo ${x.estoque_minimo}`}
            dir={<strong className={x.estoque_atual <= 0 ? 'text-vermelho' : ''}>{x.estoque_atual} un.</strong>} />
        ))}
      </Card>
      {pctMei != null && (
        <Card titulo={`Teto do MEI ${hoje.slice(0, 4)}`} direita={<span className="text-[13px] text-suave">{brl(ano.data!.vendido)} de {brl(teto)}</span>}>
          <div className="h-3 overflow-hidden rounded-full bg-cinza"><div className="h-full" style={{ width: `${Math.min(100, pctMei)}%`, background: pctMei >= 100 ? '#B42318' : pctMei >= 80 ? '#C98A1B' : '#17803D' }} /></div>
          <span className={`text-[13px] ${pctMei >= 80 ? 'font-bold text-vermelho' : 'text-suave'}`}>{pctMei}% do teto{pctMei >= 100 ? ' · passou do teto!' : pctMei >= 80 ? ' · atenção, passou de 80%' : ''}</span>
        </Card>
      )}
    </>
  );
}
