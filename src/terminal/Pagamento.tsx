import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { backend } from '../data';
import type { FormaPagamento } from '../domain/types';
import { NOME_FORMA } from '../domain/types';
import { MAX_PAGAMENTOS, aplicarValor, dividirParcelas } from '../domain/regras';
import { Icone, type NomeIcone } from '../components/Icone';
import { Aviso, Botao, Cabecalho, Etapas, TecladoNumerico, aplicarTecla } from '../components/ui';
import { brl, parseBRL } from '../lib/money';
import { addDias, dataBR, diaMes, hojeISO } from '../lib/dates';
import { mensagem, registrarErro } from '../lib/erros';
import { somErro, somOk } from '../lib/som';
import { Cupom, imprimir } from '../print/Impressao';
import { useConfig } from './dados';
import { totais, useVendaAtual, venda } from './vendaAtual';

type Opcao = 'restante' | 'outro' | number;

const ICONE: Record<FormaPagamento, NomeIcone> = { cartao: 'cartao', pix: 'pix', dinheiro: 'dinheiro', fiado: 'fiado', debito: 'cartao' };
const DESTINO: Record<FormaPagamento, string> = { cartao: 'no cartão', pix: 'no PIX', dinheiro: 'em dinheiro', fiado: 'no fiado', debito: 'no débito' };

export default function Pagamento() {
  const v = useVendaAtual();
  const cfg = useConfig();
  const qc = useQueryClient();
  const formas = (['cartao', 'pix', 'dinheiro', 'fiado', 'debito'] as FormaPagamento[]).filter((f) => cfg.formas_ativas.includes(f));
  const [forma, setForma] = useState<FormaPagamento>(formas[0] ?? 'pix');
  const [opcao, setOpcao] = useState<Opcao>('restante');
  const [outro, setOutro] = useState('');
  const [parcelas, setParcelas] = useState(1);
  const [vencimento, setVencimento] = useState(() => addDias(hojeISO(), 30));
  const [erro, setErro] = useState('');
  const [concluindo, setConcluindo] = useState(false);
  const [feitaId, setFeitaId] = useState<string | null>(null);

  const situacao = useQuery({ queryKey: ['situacao', v.cliente?.id], queryFn: () => backend.situacaoCliente(v.cliente!.id), enabled: !!v.cliente });

  if (feitaId) return <Navigate to={`/terminal/venda/concluida/${feitaId}`} replace />;
  if (!v.cliente || v.itens.length === 0) return <Navigate to="/terminal/venda" replace />;

  const t = totais(v);
  const quitado = t.falta === 0;
  const cheio = v.pagamentos.length >= MAX_PAGAMENTOS;
  const escolhido = opcao === 'restante' ? t.falta : opcao === 'outro' ? parseBRL(outro) : opcao;
  const { aplicado, troco, acrescimo } = aplicarValor(forma, escolhido, t.falta);
  const temParcelas = forma === 'cartao' || forma === 'fiado';
  const maxParc = forma === 'cartao' ? 12 : Math.max(1, cfg.fiado_max_parcelas);
  const fiadoNovo = v.pagamentos.filter((p) => p.forma === 'fiado').reduce((s, p) => s + p.valor, 0) + (forma === 'fiado' ? aplicado : 0);
  const passaLimite = v.cliente.limite_credito != null && situacao.data && situacao.data.devido + fiadoNovo > v.cliente.limite_credito;

  const escolherForma = (f: FormaPagamento) => {
    setForma(f);
    setOpcao('restante');
    setOutro('');
    setParcelas(1);
    setErro('');
  };

  const lancar = () => {
    setErro('');
    if (quitado || cheio || aplicado <= 0 || acrescimoAlto) return;
    if (forma !== 'dinheiro' && forma !== 'cartao' && escolhido > t.falta) {
      setErro(`Só dinheiro e cartão aceitam valor maior que o que falta (${brl(t.falta)}).`);
      return;
    }
    venda.lancar({
      forma, valor: aplicado,
      ...(forma === 'dinheiro' ? { valor_recebido: Math.max(escolhido, aplicado) } : {}),
      ...(forma === 'cartao' && acrescimo > 0 ? { valor_recebido: aplicado + acrescimo } : {}),
      ...(temParcelas ? { parcelas } : {}),
      ...(forma === 'fiado' ? { primeiro_vencimento: vencimento } : {}),
    });
    somOk();
    // A próxima forma já vem com o novo valor que falta (RF-10).
    setOpcao('restante');
    setOutro('');
    setParcelas(1);
  };

  const concluir = async () => {
    if (concluindo) return;
    setConcluindo(true);
    setErro('');
    try {
      const atual = venda.get();
      const feita = await backend.finalizarVenda({
        idempotency_key: atual.idempotency_key,
        cliente_id: atual.cliente!.id,
        itens: atual.itens.map((i) => ({ produto_id: i.produto_id, descricao: i.descricao, quantidade: i.quantidade, preco_unitario: i.preco_unitario })),
        desconto: atual.desconto,
        para_entrega: atual.para_entrega,
        pagamentos: atual.pagamentos.map(({ id: _id, ...p }) => p),
      });
      imprimir(<Cupom venda={feita} cfg={cfg} />);
      setFeitaId(feita.id);
      venda.descartar();
      ['produtos', 'ultimasClientes', 'resumoReceber', 'situacao'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    } catch (e) {
      // A chave de idempotência continua a mesma: tentar de novo não duplica a venda.
      registrarErro('finalizar_venda', e);
      somErro();
      setErro(mensagem(e));
      setConcluindo(false);
    }
  };

  const chips: { v: Opcao; rotulo: string }[] = forma === 'dinheiro'
    ? [{ v: 'restante', rotulo: 'O que falta' }, { v: 2000, rotulo: 'R$ 20' }, { v: 5000, rotulo: 'R$ 50' }, { v: 10000, rotulo: 'R$ 100' }, { v: 'outro', rotulo: 'Outro valor' }]
    : [{ v: 'restante', rotulo: 'O que falta' }, { v: 'outro', rotulo: 'Outro valor' }];

  const previaFiado = forma === 'fiado' && aplicado > 0 ? dividirParcelas(aplicado, parcelas, vencimento) : [];

  const detalhe = (p: (typeof v.pagamentos)[number]) => {
    if (p.forma === 'dinheiro') return `Recebido ${brl(p.valor_recebido ?? p.valor)}${(p.valor_recebido ?? 0) > p.valor ? ` · troco ${brl(p.valor_recebido! - p.valor)}` : ''}`;
    if (p.forma === 'fiado') return `${p.parcelas} × ${brl(Math.floor(p.valor / p.parcelas!))} · 1º venc. ${diaMes(p.primeiro_vencimento!)}`;
    if (p.forma === 'cartao') return `${p.parcelas}× na maquininha${(p.valor_recebido ?? 0) > p.valor ? ` · passou ${brl(p.valor_recebido!)} (taxa ${brl(p.valor_recebido! - p.valor)})` : ''}`;
    return 'Conferido na conta';
  };

  // Com o teclado aberto a coluna do valor fica estreita: valor menor e parcelas em grade de 4.
  const comTeclado = opcao === 'outro' && !quitado;
  // Proteção contra erro de digitação: taxa repassada acima de 20% do valor não é lançada.
  const acrescimoAlto = forma === 'cartao' && acrescimo > Math.round(aplicado * 0.2);
  return (
    <>
      <Cabecalho voltar={{ para: '/terminal/venda', texto: 'Voltar ao carrinho' }} titulo="Nova venda" centro={<Etapas atual={3} />}
        direita={`${v.cliente.nome} · ${v.cliente.telefone}`} />
      <main className="flex min-h-0 flex-1 flex-col gap-6 px-12 py-7">
        <section aria-label="Resumo do pagamento" className="grid h-[140px] shrink-0 grid-cols-[1fr_1fr_1.4fr] gap-6">
          <div className="flex flex-col justify-center gap-1.5 rounded-[22px] border-2 border-borda bg-white px-8"><span className="text-[26px] text-suave">Total da venda</span><span className="text-[52px] font-bold">{brl(t.total)}</span></div>
          <div className="flex flex-col justify-center gap-1.5 rounded-[22px] border-2 border-borda bg-white px-8"><span className="text-[26px] text-suave">Já lançado</span><span className="text-[52px] font-bold">{brl(t.pago)}</span></div>
          <div className={`flex items-center justify-between gap-4 rounded-[22px] border-4 px-8 ${quitado ? 'border-verde bg-verde-claro text-verde-escuro' : 'border-azul bg-azul-claro text-azul-escuro'}`}>
            <span className="text-[36px] font-bold">{quitado ? 'Tudo pago ✓' : 'Falta pagar'}</span>
            <span className="text-[72px] font-bold" data-testid="falta">{brl(t.falta)}</span>
          </div>
        </section>
        <div className="flex min-h-0 flex-1 gap-7">
          <section aria-label="Forma de pagamento" className="flex w-[600px] shrink-0 flex-col gap-4">
            <h2 className="m-0 text-[32px]">Como ela pagou?</h2>
            <div className="grid grid-cols-2 gap-4">
              {formas.map((f) => (
                <button key={f} type="button" onClick={() => escolherForma(f)} disabled={quitado}
                  className={`flex flex-col items-center justify-center gap-3 rounded-[22px] border-[3px] text-[36px] font-bold disabled:opacity-40
                    ${formas.length > 4 ? 'h-[128px]' : 'h-[168px]'} ${forma === f ? 'border-azul bg-azul text-white' : 'border-borda bg-white text-tinta'}`}>
                  <Icone nome={ICONE[f]} tamanho={56} traco={1.8} />{NOME_FORMA[f]}
                </button>
              ))}
            </div>
            {formas.includes('fiado') && (
              <button type="button" disabled={quitado} onClick={() => escolherForma('fiado')}
                className="flex h-[88px] items-center justify-center gap-3.5 rounded-[20px] border-[3px] border-dashed border-azul bg-white text-[28px] font-bold text-azul disabled:opacity-40">
                <Icone nome="avancar" tamanho={32} traco={2.2} />Restante no fiado
              </button>
            )}
          </section>

          <section aria-label="Valor deste pagamento" className="flex min-w-0 flex-1 flex-col gap-4 rounded-3xl border-2 border-borda bg-white p-7">
            <h2 className="m-0 text-[32px]">Valor deste pagamento · {NOME_FORMA[forma]}</h2>
            <div className="flex flex-wrap gap-3">
              {chips.map((c) => {
                const bloqueado = quitado || (typeof c.v === 'number' && forma !== 'dinheiro' && c.v > t.falta);
                return (
                  <button key={String(c.v)} type="button" disabled={bloqueado} onClick={() => setOpcao(c.v)}
                    className={`h-20 rounded-2xl border-[3px] px-5 text-[26px] font-bold disabled:opacity-40 ${opcao === c.v ? 'border-azul bg-azul-claro' : 'border-borda bg-white'}`}>{c.rotulo}</button>
                );
              })}
            </div>
            <div className="flex min-h-0 flex-1 gap-5">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto">
                <span className={`whitespace-nowrap font-bold leading-none ${comTeclado ? 'text-[56px]' : 'text-[72px]'}`} data-testid="valor-aplicado">{brl(aplicado)}</span>
                {forma === 'dinheiro' && escolhido > 0 && <span className="text-[30px] text-suave">Ela entregou {brl(escolhido)} · <strong className="text-tinta">troco {brl(troco)}</strong></span>}
                {forma === 'cartao' && acrescimo > 0 && (
                  <span className={`${comTeclado ? 'text-[22px]' : 'text-[26px]'} text-suave`} data-testid="maquininha">
                    Passar na maquininha <strong className="text-tinta">{brl(escolhido)}</strong> · taxa repassada {brl(acrescimo)}
                  </span>
                )}
                {acrescimoAlto && <span className="text-[22px] font-bold text-vermelho">Taxa acima de 20% do valor. Confira o que foi digitado.</span>}
                {forma !== 'dinheiro' && forma !== 'cartao' && opcao === 'outro' && escolhido > t.falta && <span className="text-[24px] font-bold text-vermelho">Limitado ao que falta: {brl(t.falta)}</span>}
                {temParcelas && !quitado && (
                  <div className={`flex flex-col ${comTeclado ? 'gap-2' : 'gap-3'}`}>
                    <span className={`${comTeclado ? 'text-[22px]' : 'text-[26px]'} text-suave`}>{forma === 'cartao' ? 'Parcelas na maquininha' : 'Em quantas vezes?'}</span>
                    <div className={comTeclado ? 'grid grid-cols-4 gap-2' : 'flex flex-wrap gap-3'}>
                      {Array.from({ length: maxParc }, (_, i) => i + 1).map((n) => (
                        <button key={n} type="button" onClick={() => setParcelas(n)}
                          className={`rounded-2xl border-[3px] font-bold ${comTeclado ? 'h-[56px] min-w-0 text-[24px]' : `h-[76px] text-[30px] ${forma === 'cartao' ? 'w-[88px]' : 'w-[112px]'}`} ${parcelas === n ? 'border-azul bg-azul-claro' : 'border-borda bg-white'}`}>{n}×</button>
                      ))}
                    </div>
                    {forma === 'fiado' && (
                      <div className={comTeclado ? 'grid grid-cols-2 items-center gap-2' : 'flex flex-wrap items-center gap-3'}>
                        <span className={comTeclado ? 'col-span-2 text-[22px]' : 'text-[26px]'}>1º vencimento <strong>{dataBR(vencimento)}</strong></span>
                        <Botao variante="neutro" className={comTeclado ? '!min-h-[56px] !px-2 !text-[20px]' : '!min-h-[64px] !text-[22px]'} onClick={() => setVencimento((d) => addDias(d, -7))} disabled={vencimento <= addDias(hojeISO(), 7)}>− 7 dias</Botao>
                        <Botao variante="neutro" className={comTeclado ? '!min-h-[56px] !px-2 !text-[20px]' : '!min-h-[64px] !text-[22px]'} onClick={() => setVencimento((d) => addDias(d, 7))}>+ 7 dias</Botao>
                      </div>
                    )}
                    {!(comTeclado && forma === 'cartao') && (
                      <span className={`${comTeclado ? 'text-[22px]' : 'text-[26px]'} font-bold text-azul-escuro`}>
                        {forma === 'fiado'
                          ? previaFiado.map((p) => `${brl(p.valor)} em ${diaMes(p.vencimento)}`).join(' · ')
                          : `${parcelas}× na maquininha`}
                      </span>
                    )}
                    {forma === 'fiado' && passaLimite && <span className="text-[24px] font-bold text-vermelho">Atenção: passa do limite de crédito dela ({brl(v.cliente.limite_credito!)}).</span>}
                  </div>
                )}
              </div>
              {comTeclado && (
                <TecladoNumerico onTecla={(k) => setOutro((s) => aplicarTecla(s, k, { numerico: true, max: 9 }))} className="w-[300px] shrink-0" />
              )}
            </div>
            {erro && <Aviso>{erro}</Aviso>}
            <Botao variante="primario" disabled={quitado || cheio || aplicado <= 0 || acrescimoAlto} onClick={lancar} className="h-24 shrink-0 !text-[34px]">
              {quitado ? 'Nada falta lançar' : cheio ? 'Limite de 4 pagamentos' : `Lançar ${brl(aplicado)} ${DESTINO[forma]}`}
            </Botao>
          </section>

          <section aria-label="Pagamentos lançados" className="flex w-[500px] shrink-0 flex-col gap-3 rounded-3xl border-2 border-borda bg-white p-7">
            <h2 className="m-0 mb-1 text-[32px]">Pagamentos lançados</h2>
            {v.pagamentos.length === 0 && <span className="text-[24px] text-suave">Nenhum pagamento lançado ainda.</span>}
            {v.pagamentos.map((p) => (
              <div key={p.id} className="flex min-h-[84px] items-center gap-3.5 rounded-2xl bg-fundo py-2.5 pl-5 pr-3">
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[28px] font-bold">{NOME_FORMA[p.forma]} · {brl(p.valor)}</span>
                  <span className="text-[20px] text-suave">{detalhe(p)}</span>
                </span>
                <Botao variante="perigo" className="!min-h-[64px] !px-4 !text-[20px]" onClick={() => venda.removerPagamento(p.id)} disabled={concluindo}>Remover</Botao>
              </div>
            ))}
            <div className="mt-auto flex flex-col gap-2.5">
              <Botao variante="concluir" icone="check" grande className="h-[120px]" disabled={!quitado || v.pagamentos.length === 0 || concluindo} onClick={concluir}>
                {concluindo ? 'Gravando…' : 'Concluir e imprimir'}
              </Botao>
              {!quitado && <span className="text-center text-[22px] text-suave">Falta lançar {brl(t.falta)}</span>}
            </div>
          </section>
        </div>
      </main>
    </>
  );
}

