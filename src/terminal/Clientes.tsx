import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { backend } from '../data';
import type { Venda } from '../domain/types';
import { NOME_FORMA } from '../domain/types';
import { numeroVenda } from '../domain/regras';
import { Icone } from '../components/Icone';
import { Botao, Cabecalho, iniciais, useToast } from '../components/ui';
import { brl } from '../lib/money';
import { dataBR, dataHoraBR, diasEntre, hojeISO } from '../lib/dates';
import { Cupom, imprimir } from '../print/Impressao';
import { BuscaCliente, EnderecoJanela, PinJanela } from './componentes';
import { useConfig } from './dados';
import { venda as vendaAtual } from './vendaAtual';

export default function Clientes() {
  const { id } = useParams();
  const nav = useNavigate();
  if (!id) {
    return (
      <>
        <Cabecalho voltar={{ para: '/terminal', texto: 'Início' }} titulo="Clientes" />
        <BuscaCliente titulo="Qual cliente?" mostrarDivida onEscolher={(c) => nav(`/terminal/clientes/${c.id}`)} />
      </>
    );
  }
  return <Ficha id={id} />;
}

/** RF-32: ficha da cliente. */
function Ficha({ id }: { id: string }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const cfg = useConfig();
  const cli = useQuery({ queryKey: ['cliente', id], queryFn: () => backend.cliente(id) });
  const sit = useQuery({ queryKey: ['situacao', id], queryFn: () => backend.situacaoCliente(id) });
  const vendas = useQuery({ queryKey: ['vendasCliente', id], queryFn: () => backend.vendasCliente(id) });
  const [cancelar, setCancelar] = useState<Venda | null>(null);
  const [endereco, setEndereco] = useState(false);
  const [toast, mostrar] = useToast();
  const c = cli.data;
  const hoje = hojeISO();

  return (
    <>
      <Cabecalho voltar={{ para: '/terminal/clientes', texto: 'Clientes' }} titulo="Ficha da cliente" />
      <main className="flex min-h-0 flex-1 gap-7 px-12 py-8">
        <section className="flex w-[640px] shrink-0 flex-col gap-5 rounded-3xl border-2 border-borda bg-white p-8">
          <div className="flex items-center gap-5">
            <span className="flex size-20 items-center justify-center rounded-full bg-azul-claro text-[32px] font-bold text-azul">{c ? iniciais(c.nome) : ''}</span>
            <span className="flex flex-col"><span className="text-[40px] font-bold">{c?.nome}</span><span className="text-[26px] text-suave">{c?.telefone}</span></span>
          </div>
          <span className="text-[24px]">{c?.endereco ? [c.endereco, c.bairro, c.referencia && `Ref.: ${c.referencia}`].filter(Boolean).join(' · ') : 'Sem endereço cadastrado'}</span>
          {c?.observacoes && <span className="rounded-2xl bg-fundo p-4 text-[22px]">{c.observacoes}</span>}
          <Botao variante="neutro" onClick={() => setEndereco(true)}>{c?.endereco ? 'Alterar endereço' : 'Pôr endereço'}</Botao>
          <div className="mt-2 border-t-2 border-borda pt-5">
            <span className="text-[26px] text-suave">Total que ela deve</span>
            <div className="text-[72px] font-bold leading-tight">{brl(sit.data?.devido ?? 0)}</div>
            {sit.data && sit.data.vencido > 0 && <div className="text-[28px] font-bold text-vermelho">Vencido {brl(sit.data.vencido)} · {sit.data.qtd_atrasadas} parcela{sit.data.qtd_atrasadas > 1 ? 's' : ''}</div>}
            {c?.limite_credito != null && <div className="text-[24px] text-suave">Limite de crédito {brl(c.limite_credito)}</div>}
          </div>
          <div className="mt-auto grid grid-cols-2 gap-4">
            <Link to={`/terminal/receber/${id}`} className="flex h-[104px] items-center justify-center gap-3 rounded-2xl bg-verde text-[30px] font-bold text-white no-underline"><Icone nome="carteira" tamanho={36} />Receber</Link>
            <Botao variante="primario" icone="sacola" className="h-[104px] !text-[30px]" onClick={() => { if (c) { vendaAtual.escolherCliente(c); nav('/terminal/venda'); } }}>Vender</Botao>
          </div>
        </section>
        <section className="flex min-w-0 flex-1 flex-col gap-4">
          <h2 className="m-0 text-[32px]">Parcelas em aberto</h2>
          <div className="flex max-h-[300px] flex-col gap-2 overflow-y-auto">
            {sit.data?.parcelas.length === 0 && <span className="text-[24px] text-suave">Nenhuma parcela em aberto.</span>}
            {sit.data?.parcelas.map((p) => {
              const atrasada = p.vencimento < hoje;
              return (
                <div key={p.id} className={`flex items-center justify-between rounded-2xl px-6 py-4 text-[24px] ${atrasada ? 'border-[3px] border-vermelho bg-vermelho-claro' : 'border-2 border-borda bg-white'}`}>
                  <span>Venda {numeroVenda(p.venda_numero)} · {p.numero}/{p.total_parcelas} · {atrasada ? <strong className="text-vermelho">venceu {dataBR(p.vencimento)} ({diasEntre(p.vencimento, hoje)} dias)</strong> : `vence ${dataBR(p.vencimento)}`}</span>
                  <strong className="text-[28px]">{brl(p.valor - p.valor_pago)}</strong>
                </div>
              );
            })}
          </div>
          <h2 className="m-0 mt-2 text-[32px]">Compras</h2>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
            {vendas.data?.length === 0 && <span className="text-[24px] text-suave">Nenhuma compra ainda.</span>}
            {vendas.data?.map((v) => (
              <div key={v.id} className="flex items-center gap-4 rounded-2xl border-2 border-borda bg-white px-6 py-3">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={`text-[26px] font-bold ${v.status === 'cancelada' ? 'line-through text-suave' : ''}`}>Venda {numeroVenda(v.numero)} · {brl(v.total)}</span>
                  <span className="truncate text-[20px] text-suave">{dataHoraBR(v.criada_em)} · {v.pagamentos.map((p) => NOME_FORMA[p.forma]).join(' + ')} · {v.itens.map((i) => `${i.quantidade}× ${i.descricao}`).join(', ')}</span>
                  {v.status === 'cancelada' && <span className="text-[20px] font-bold text-vermelho">Cancelada: {v.motivo_cancelamento}</span>}
                </span>
                <Botao variante="neutro" icone="impressora" className="!text-[20px]" onClick={() => imprimir(<Cupom venda={v} cfg={cfg} reimpressao />)}>Reimprimir</Botao>
                {v.status === 'concluida' && <Botao variante="perigo" className="!text-[20px]" onClick={() => setCancelar(v)}>Cancelar</Botao>}
              </div>
            ))}
          </div>
        </section>
      </main>
      {cancelar && (
        <PinJanela titulo={`Cancelar a venda ${numeroVenda(cancelar.numero)}?`} pedirMotivo motivos={['Cliente desistiu', 'Lançada errada', 'Troca', 'Outro']}
          descricao={`${brl(cancelar.total)} · o estoque volta e as parcelas do fiado são canceladas.`}
          onFechar={() => setCancelar(null)}
          onConfirmar={async (pin, motivo) => {
            await backend.cancelarVenda(cancelar.id, motivo, pin);
            setCancelar(null);
            ['vendasCliente', 'situacao', 'produtos', 'resumoReceber'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
            mostrar('Venda cancelada.');
          }} />
      )}
      {endereco && c && <EnderecoJanela cliente={c} onFechar={() => setEndereco(false)} onSalva={() => { setEndereco(false); qc.invalidateQueries({ queryKey: ['cliente', id] }); }} />}
      {toast}
    </>
  );
}
