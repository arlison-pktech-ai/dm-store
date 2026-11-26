import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { backend } from '../data';
import { numeroVenda } from '../domain/regras';
import { Icone } from '../components/Icone';
import { Botao, Cabecalho } from '../components/ui';
import { brl } from '../lib/money';
import { Cupom, imprimir } from '../print/Impressao';
import { useConfig } from './dados';

export default function Concluida() {
  const { id } = useParams();
  const cfg = useConfig();
  const q = useQuery({ queryKey: ['venda', id], queryFn: () => backend.venda(id!) });
  const v = q.data;
  const troco = v?.pagamentos.reduce((s, p) => s + p.troco, 0) ?? 0;
  return (
    <>
      <Cabecalho voltar={{ para: '/terminal', texto: 'Início' }} titulo="Venda concluída" />
      <main className="flex flex-1 flex-col items-center justify-center gap-10 px-12">
        <span className="flex size-[180px] items-center justify-center rounded-full bg-verde text-white"><Icone nome="check" tamanho={110} traco={2.6} /></span>
        {v && <>
          <h1 className="m-0 text-center text-[64px] font-bold">Venda nº {numeroVenda(v.numero)} concluída</h1>
          <span className="text-[36px]">{v.cliente.nome} · total <strong>{brl(v.total)}</strong></span>
          {troco > 0 && (
            <div className="rounded-[28px] border-4 border-verde bg-verde-claro px-16 py-8 text-center text-verde-escuro">
              <div className="text-[36px] font-bold">Troco para entregar</div>
              <div className="text-[96px] font-bold leading-none">{brl(troco)}</div>
            </div>
          )}
          <span className="text-[28px] text-suave">O cupom está saindo na impressora.</span>
        </>}
        <div className="grid w-[1400px] grid-cols-3 gap-6">
          <Botao variante="neutro" grande icone="impressora" disabled={!v} onClick={() => v && imprimir(<Cupom venda={v} cfg={cfg} reimpressao />)} className="h-[120px]">Imprimir de novo</Botao>
          <Link to="/terminal/venda" className="flex h-[120px] items-center justify-center gap-3 rounded-2xl bg-azul text-[34px] font-bold text-white no-underline">
            <Icone nome="sacola" tamanho={40} />Nova venda
          </Link>
          <Link to="/terminal" className="flex h-[120px] items-center justify-center gap-3 rounded-2xl border-[3px] border-borda bg-white text-[34px] font-bold text-tinta no-underline">
            <Icone nome="casa" tamanho={40} />Início
          </Link>
        </div>
      </main>
    </>
  );
}
