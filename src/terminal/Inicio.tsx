import { Link } from 'react-router-dom';
import { Icone, type NomeIcone } from '../components/Icone';
import { FaixaSemInternet } from '../components/ui';
import { useOnline, useRelogio } from '../lib/useOnline';
import { diaExtenso, horaBR, saudacao } from '../lib/dates';
import { useConfig } from './dados';
import { backend } from '../data';

function Opcao({ para, icone, titulo, sub, destaque, className = '' }: { para: string; icone: NomeIcone; titulo: string; sub: string; destaque?: boolean; className?: string }) {
  return (
    <Link to={para}
      className={`flex min-h-0 items-center gap-12 rounded-[28px] px-16 no-underline ${className} ${destaque ? 'bg-azul text-white' : 'border-[3px] border-borda bg-white text-tinta'}`}>
      <span className={`flex size-[128px] shrink-0 items-center justify-center rounded-full ${destaque ? 'bg-white/15 text-white' : 'bg-azul-claro text-azul'}`}>
        <Icone nome={icone} tamanho={80} traco={1.8} />
      </span>
      <span className="flex flex-col gap-2.5">
        <span className={`font-bold leading-none ${destaque ? 'text-[72px]' : 'text-[56px]'}`}>{titulo}</span>
        <span className={`text-[30px] ${destaque ? '' : 'text-suave'}`}>{sub}</span>
      </span>
    </Link>
  );
}

export default function Inicio() {
  const cfg = useConfig();
  const agora = useRelogio();
  const online = useOnline();
  return (
    <>
      <FaixaSemInternet />
      <header className="flex h-[104px] shrink-0 items-center justify-between border-b-2 border-borda bg-white px-12">
        <div className="flex flex-col gap-0.5">
          <span className="text-[34px] font-bold">{cfg.nome}</span>
          <span className="text-[20px] text-suave">Perfumaria · PDV{backend.modo === 'demo' ? ' · modo demonstração' : ''}</span>
        </div>
        <div className="flex items-center gap-8 text-[24px]">
          <span>{diaExtenso(agora)} · {horaBR(agora)}</span>
          <span className={`flex items-center gap-2.5 rounded-full px-5 py-2.5 font-bold ${online ? 'bg-verde-claro text-verde-escuro' : 'bg-vermelho-claro text-vermelho'}`}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill={online ? '#17803D' : '#B42318'} /></svg>
            {online ? 'Conectado' : 'Sem internet'}
          </span>
        </div>
      </header>
      <main className="flex flex-1 flex-col gap-10 px-12 pb-12 pt-14">
        <h1 className="m-0 text-[52px] font-bold">{saudacao(agora)}! O que vamos fazer?</h1>
        <div className="grid flex-1 grid-cols-2 grid-rows-3 gap-7">
          <Opcao para="/terminal/venda" icone="sacola" titulo="Vender" sub="Começa pela cliente" destaque className="col-span-2" />
          <Opcao para="/terminal/receber" icone="carteira" titulo="Receber crediário" sub="Quando a cliente paga uma parcela" />
          <Opcao para="/terminal/mercadoria" icone="caixa" titulo="Chegou mercadoria" sub="Dar entrada no estoque" />
          <Opcao para="/terminal/clientes" icone="pessoas" titulo="Clientes" sub="Buscar, cadastrar, ver o que deve" />
          <Opcao para="/terminal/estoque" icone="grafico" titulo="Estoque" sub="Ver, contar e mudar preços" />
        </div>
      </main>
    </>
  );
}
