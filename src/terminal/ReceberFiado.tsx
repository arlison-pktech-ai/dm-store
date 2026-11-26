import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { backend } from '../data';
import type { FormaRecebimento } from '../domain/types';
import { NOME_FORMA } from '../domain/types';
import { alocarRecebimento, numeroVenda } from '../domain/regras';
import { Icone } from '../components/Icone';
import { Aviso, Botao, Cabecalho, TecladoNumerico, aplicarTecla, iniciais } from '../components/ui';
import { brl, parseBRL } from '../lib/money';
import { dataBR, diaMes, diaExtenso, diasEntre, hojeISO, horaBR } from '../lib/dates';
import { mensagem, registrarErro } from '../lib/erros';
import { somErro, somOk } from '../lib/som';
import { useRelogio } from '../lib/useOnline';
import { ReciboPagamento, imprimir } from '../print/Impressao';
import { BuscaCliente } from './componentes';
import { useConfig } from './dados';

const FORMAS: FormaRecebimento[] = ['pix', 'dinheiro', 'cartao'];

export default function ReceberFiado() {
  const { clienteId } = useParams();
  const nav = useNavigate();
  const agora = useRelogio();
  const titulo = `${diaExtenso(agora)} · ${horaBR(agora)}`;
  if (!clienteId) {
    return (
      <>
        <Cabecalho voltar={{ para: '/terminal', texto: 'Início' }} titulo="Receber crediário" direita={titulo} />
        <BuscaCliente titulo="Quem está pagando?" mostrarDivida onEscolher={(c) => nav(`/terminal/receber/${c.id}`)} />
      </>
    );
  }
  return <Receber clienteId={clienteId} />;
}

function Receber({ clienteId }: { clienteId: string }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const cfg = useConfig();
  const agora = useRelogio();
  const cli = useQuery({ queryKey: ['cliente', clienteId], queryFn: () => backend.cliente(clienteId) });
  const sit = useQuery({ queryKey: ['situacao', clienteId], queryFn: () => backend.situacaoCliente(clienteId) });
  const [modo, setModo] = useState<'tudo' | 'outro'>('tudo');
  const [txt, setTxt] = useState('');
  const [forma, setForma] = useState<FormaRecebimento>('pix');
  const [dividir, setDividir] = useState(false);
  const [segunda, setSegunda] = useState<{ forma: FormaRecebimento; txt: string }>({ forma: 'dinheiro', txt: '' });
  const [campo, setCampo] = useState<'valor' | 'segunda'>('valor');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [feito, setFeito] = useState<null | { saldo: number }>(null);

  const devido = sit.data?.devido ?? 0;
  const hoje = hojeISO();
  const valorTotal = modo === 'tudo' ? devido : parseBRL(txt);
  const v2 = dividir ? parseBRL(segunda.txt) : 0;
  const v1 = dividir ? valorTotal - v2 : valorTotal;

  const previa = useMemo(() => {
    if (!sit.data || valorTotal <= 0 || valorTotal > devido) return null;
    try {
      return alocarRecebimento(sit.data.parcelas, valorTotal);
    } catch {
      return null;
    }
  }, [sit.data, valorTotal, devido]);

  const confirmar = async () => {
    setErro('');
    if (valorTotal <= 0) return setErro('Digite quanto ela pagou.');
    if (valorTotal > devido) return setErro(`O valor é maior do que ela deve (${brl(devido)}).`);
    if (dividir && (v2 <= 0 || v1 <= 0)) return setErro('Na divisão, as duas formas precisam ter valor.');
    setEnviando(true);
    try {
      const pagamentos = dividir ? [{ forma, valor: v1 }, { forma: segunda.forma, valor: v2 }] : [{ forma, valor: v1 }];
      const recibo = await backend.registrarRecebimento(clienteId, pagamentos);
      imprimir(<ReciboPagamento recibo={recibo} cfg={cfg} />);
      somOk();
      ['situacao', 'resumoReceber'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      setFeito({ saldo: recibo.saldo_restante });
    } catch (e) {
      registrarErro('registrar_recebimento', e);
      somErro();
      setErro(mensagem(e));
    }
    setEnviando(false);
  };

  const c = cli.data;
  if (feito) {
    return (
      <>
        <Cabecalho voltar={{ para: '/terminal', texto: 'Início' }} titulo="Receber crediário" />
        <main className="flex flex-1 flex-col items-center justify-center gap-10">
          <span className="flex size-[180px] items-center justify-center rounded-full bg-verde text-white"><Icone nome="check" tamanho={110} traco={2.6} /></span>
          <h1 className="m-0 text-[64px] font-bold">Pagamento recebido</h1>
          <span className="text-[40px]">{c?.nome} ainda deve <strong>{brl(feito.saldo)}</strong></span>
          <span className="text-[28px] text-suave">O recibo está saindo na impressora.</span>
          <div className="grid w-[900px] grid-cols-2 gap-6">
            <Botao variante="primario" grande onClick={() => nav('/terminal/receber')} className="h-[120px]">Receber de outra cliente</Botao>
            <Botao variante="neutro" grande icone="casa" onClick={() => nav('/terminal')} className="h-[120px]">Início</Botao>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Cabecalho voltar={{ para: '/terminal', texto: 'Início' }} titulo="Receber crediário" direita={`${diaExtenso(agora)} · ${horaBR(agora)}`} />
      <main className="flex min-h-0 flex-1 flex-col gap-6 px-12 py-8">
        <section aria-label="Cliente" className="flex h-[96px] shrink-0 items-center gap-6 rounded-[20px] border-2 border-borda bg-white pl-6 pr-4">
          <span className="flex size-16 items-center justify-center rounded-full bg-azul-claro text-[26px] font-bold text-azul">{c ? iniciais(c.nome) : ''}</span>
          <span className="flex flex-col gap-0.5"><span className="text-[34px] font-bold">{c?.nome}</span><span className="text-[22px] text-suave">{c?.telefone}</span></span>
          <Botao variante="neutro" className="ml-auto" onClick={() => nav('/terminal/receber')}>Trocar cliente</Botao>
        </section>
        <div className="flex min-h-0 flex-1 gap-7">
          <section aria-label="O que ela deve" className="flex min-w-0 flex-1 flex-col gap-4 rounded-3xl border-2 border-borda bg-white p-8">
            <h2 className="m-0 text-[32px]">O que ela deve</h2>
            <span className="text-[80px] font-bold leading-none">{brl(devido)}</span>
            {sit.data && <span className="text-[26px]"><strong className="text-vermelho">Vencido {brl(sit.data.vencido)}</strong> · a vencer {brl(devido - sit.data.vencido)}</span>}
            <div className="mt-2 flex min-h-0 flex-col gap-3 overflow-y-auto">
              {sit.data?.parcelas.length === 0 && <Aviso tipo="ok">Ela não deve nada.</Aviso>}
              {sit.data?.parcelas.map((p) => {
                const atrasada = p.vencimento < hoje;
                const resto = p.valor - p.valor_pago;
                return (
                  <div key={p.id} className={`flex h-[104px] shrink-0 items-center gap-5 rounded-[18px] px-6 ${atrasada ? 'border-[3px] border-vermelho bg-vermelho-claro' : 'border-2 border-borda bg-white'}`}>
                    <span className={`rounded-full px-3.5 py-2 text-[20px] font-bold ${atrasada ? 'bg-vermelho text-white' : 'bg-cinza text-suave'}`}>{atrasada ? 'Atrasada' : 'A vencer'}</span>
                    <span className="flex flex-1 flex-col gap-0.5">
                      <span className="text-[26px] font-bold">Venda {numeroVenda(p.venda_numero)} · parcela {p.numero}/{p.total_parcelas}</span>
                      <span className={`text-[22px] ${atrasada ? 'text-vermelho-escuro' : 'text-suave'}`}>
                        {atrasada ? `Venceu ${diaMes(p.vencimento)} · ${diasEntre(p.vencimento, hoje)} dias de atraso` : `Vence em ${dataBR(p.vencimento)}`}
                        {p.valor_pago > 0 ? ` · já pagou ${brl(p.valor_pago)}` : ''}
                      </span>
                    </span>
                    <span className="text-[32px] font-bold">{brl(resto)}</span>
                  </div>
                );
              })}
            </div>
          </section>
          <section aria-label="Registrar pagamento" className="flex w-[1000px] shrink-0 flex-col gap-3.5 rounded-3xl border-2 border-borda bg-white p-7">
            <h2 className="m-0 text-[32px]">Quanto ela pagou?</h2>
            <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_380px] grid-rows-[minmax(0,1fr)] gap-6">
              <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
                <button type="button" onClick={() => { setModo('tudo'); setCampo('valor'); }} disabled={devido === 0}
                  className={`h-20 rounded-[18px] border-[3px] text-[28px] font-bold ${modo === 'tudo' ? 'border-azul bg-azul-claro' : 'border-borda bg-white'}`}>Pagou tudo · {brl(devido)}</button>
                <button type="button" onClick={() => { setModo('outro'); setCampo('valor'); }}
                  className={`flex h-24 items-center justify-between rounded-[18px] border-4 px-6 ${modo === 'outro' && campo === 'valor' ? 'border-azul bg-azul-claro' : 'border-borda bg-white'}`}>
                  <span className="text-[24px] font-bold text-azul-escuro">Outro valor</span>
                  <span className="text-[52px] font-bold">{brl(modo === 'outro' ? parseBRL(txt) : devido)}</span>
                </button>
                <span className="mt-1 text-[24px] text-suave">{dividir ? `Primeira forma · ${brl(Math.max(0, v1))}` : 'Como ela pagou?'}</span>
                <div className="grid grid-cols-3 gap-3">
                  {FORMAS.map((f) => (
                    <button key={f} type="button" onClick={() => setForma(f)}
                      className={`h-[72px] rounded-2xl border-[3px] text-[26px] font-bold ${forma === f ? 'border-azul bg-azul text-white' : 'border-borda bg-white text-tinta'}`}>{NOME_FORMA[f]}</button>
                  ))}
                </div>
                {!dividir
                  ? <button type="button" onClick={() => { setDividir(true); setCampo('segunda'); }} className="h-12 self-start border-none bg-transparent px-1 text-[22px] font-bold text-azul underline">Dividir entre duas formas</button>
                  : <>
                    <button type="button" onClick={() => setCampo('segunda')}
                      className={`flex h-20 items-center justify-between rounded-[18px] border-4 px-6 ${campo === 'segunda' ? 'border-azul bg-azul-claro' : 'border-borda bg-white'}`}>
                      <span className="text-[22px] font-bold text-azul-escuro">Segunda forma · valor</span>
                      <span className="text-[40px] font-bold">{brl(v2)}</span>
                    </button>
                    <div className="grid grid-cols-3 gap-3">
                      {FORMAS.filter((f) => f !== forma).map((f) => (
                        <button key={f} type="button" onClick={() => setSegunda((s) => ({ ...s, forma: f }))}
                          className={`h-[72px] rounded-2xl border-[3px] text-[26px] font-bold ${segunda.forma === f ? 'border-azul bg-azul text-white' : 'border-borda bg-white text-tinta'}`}>{NOME_FORMA[f]}</button>
                      ))}
                      <button type="button" onClick={() => { setDividir(false); setSegunda({ forma: 'dinheiro', txt: '' }); setCampo('valor'); }}
                        className="h-[72px] rounded-2xl border-[3px] border-vermelho-borda bg-white text-[22px] font-bold text-vermelho">Não dividir</button>
                    </div>
                  </>}
                <div className="mt-auto flex flex-col gap-1 rounded-2xl bg-fundo px-5 py-3 text-[22px]">
                  {previa ? <>
                    <span className="font-bold">Vai abater, da mais antiga para a mais nova:</span>
                    {previa.map((a) => {
                      const p = sit.data!.parcelas.find((x) => x.id === a.parcela_id)!;
                      return <span key={a.parcela_id}>{brl(a.valor)} da parcela de {diaMes(p.vencimento)} {a.quitada ? '(quitada)' : `(fica ${brl(p.valor - p.valor_pago - a.valor)})`}</span>;
                    })}
                    <span className="font-bold">Saldo depois: {brl(devido - valorTotal)}</span>
                  </> : <span className="text-suave">{valorTotal > devido ? `O valor passa do que ela deve (${brl(devido)}).` : 'Digite o valor para ver o que vai abater.'}</span>}
                </div>
              </div>
              <TecladoNumerico onTecla={(k) => {
                if (campo === 'segunda') setSegunda((s) => ({ ...s, txt: aplicarTecla(s.txt, k, { numerico: true, max: 9 }) }));
                else { setModo('outro'); setTxt((s) => aplicarTecla(modo === 'tudo' ? '' : s, k, { numerico: true, max: 9 })); }
              }} />
            </div>
            {erro && <Aviso>{erro}</Aviso>}
            <Botao variante="concluir" grande icone="check" className="h-[104px] shrink-0" disabled={enviando || devido === 0} onClick={confirmar}>
              {enviando ? 'Gravando…' : 'Confirmar e imprimir recibo'}
            </Botao>
          </section>
        </div>
      </main>
    </>
  );
}
