import { useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icone, type NomeIcone } from './Icone';
import { useOnline, useRelogio } from '../lib/useOnline';
import { horaBR } from '../lib/dates';
import { aoLer } from '../lib/useScanner';

type Variante = 'primario' | 'concluir' | 'perigo' | 'neutro' | 'contorno' | 'link';

const VAR: Record<Variante, string> = {
  primario: 'bg-azul text-white border-azul',
  concluir: 'bg-verde text-white border-verde',
  perigo: 'bg-white text-vermelho border-vermelho-borda',
  neutro: 'bg-white text-tinta border-borda',
  contorno: 'bg-white text-azul border-azul',
  link: 'bg-transparent text-azul border-transparent underline',
};

export function Botao({ variante = 'neutro', icone, children, className = '', grande, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante; icone?: NomeIcone; grande?: boolean }) {
  return (
    <button type="button" {...rest}
      className={`inline-flex min-h-[72px] items-center justify-center gap-3 rounded-2xl border-[3px] px-7 font-bold
        transition-opacity disabled:opacity-40 ${grande ? 'text-[34px]' : 'text-[24px]'} ${VAR[variante]} ${className}`}>
      {icone && <Icone nome={icone} tamanho={grande ? 40 : 28} traco={2.4} />}
      {children}
    </button>
  );
}

/**
 * O terminal é desenhado em 1920×1080 (RNF-08). O palco escala para caber em qualquer tela,
 * mantendo o layout do design.
 */
export function Palco({ children }: { children: ReactNode }) {
  const [escala, setEscala] = useState(1);
  useLayoutEffect(() => {
    const f = () => setEscala(Math.min(window.innerWidth / 1920, window.innerHeight / 1080));
    f();
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  return (
    <div className="terminal fixed inset-0 overflow-hidden bg-fundo">
      <div style={{ width: 1920, height: 1080, transform: `scale(${escala})`, transformOrigin: 'top left' }}
        className="relative flex flex-col bg-fundo text-[22px] text-tinta">
        {children}
      </div>
    </div>
  );
}

export function FaixaSemInternet() {
  const online = useOnline();
  if (online) return null;
  return (
    <div role="alert" className="flex h-[56px] shrink-0 items-center justify-center gap-3 bg-vermelho text-[26px] font-bold text-white">
      <Icone nome="alerta" /> Sem internet. A venda fica guardada até a conexão voltar.
    </div>
  );
}

export function Cabecalho({ voltar, titulo, centro, direita }: { voltar?: { para: string; texto: string } | { onClick: () => void; texto: string }; titulo: string; centro?: ReactNode; direita?: ReactNode }) {
  const agora = useRelogio();
  const cls = 'flex h-[72px] items-center gap-3 rounded-2xl border-[3px] border-borda bg-white px-7 text-[26px] font-bold text-tinta no-underline';
  return (
    <>
      <FaixaSemInternet />
      <header className="flex h-[104px] shrink-0 items-center justify-between gap-8 border-b-2 border-borda bg-white px-12">
        <div className="flex items-center gap-7">
          {voltar && ('para' in voltar
            ? <Link to={voltar.para} className={cls}><Icone nome="voltar" traco={2.2} />{voltar.texto}</Link>
            : <button type="button" onClick={voltar.onClick} className={cls}><Icone nome="voltar" traco={2.2} />{voltar.texto}</button>)}
          <span className="text-[36px] font-bold">{titulo}</span>
        </div>
        {centro}
        <span className="text-[24px]">{direita ?? horaBR(agora)}</span>
      </header>
    </>
  );
}

export function Etapas({ atual }: { atual: 1 | 2 | 3 }) {
  const nomes = ['Cliente', 'Produtos', 'Pagamento'];
  return (
    <ol className="m-0 flex list-none gap-3 p-0 text-[24px]">
      {nomes.map((n, i) => {
        const k = i + 1;
        const cls = k < atual ? 'bg-verde-claro text-verde-escuro font-bold' : k === atual ? 'bg-azul text-white font-bold' : 'bg-cinza text-suave';
        return <li key={n} className={`rounded-full px-6 py-3 ${cls}`}>{k} · {n}{k < atual ? ' ✓' : ''}</li>;
      })}
    </ol>
  );
}

/** Teclados na tela montados agora; só o último (o mais à frente) recebe o teclado físico. */
const tecladosAtivos: object[] = [];

/**
 * Deixa o teclado físico funcionar junto com o teclado na tela, sem mudar nada no visual.
 * As teclas esperam 60 ms antes de entrar: se for o leitor de código de barras (teclas muito
 * rápidas terminando em Enter), a leitura é descartada aqui e segue só para o leitor.
 */
function useTecladoFisico(onTecla: (t: string) => void, traduzir: (e: KeyboardEvent) => string | null) {
  const ref = useRef({ onTecla, traduzir });
  ref.current = { onTecla, traduzir };
  useEffect(() => {
    const eu = {};
    tecladosAtivos.push(eu);
    let pendentes: string[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soltar = () => { const p = pendentes; pendentes = []; p.forEach((t) => ref.current.onTecla(t)); };
    const descartar = () => { pendentes = []; clearTimeout(timer); };
    const ouvir = (e: KeyboardEvent) => {
      if (tecladosAtivos[tecladosAtivos.length - 1] !== eu) return;
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement;
      if (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !['checkbox', 'radio', 'button'].includes(el.type))) return;
      const t = ref.current.traduzir(e);
      if (t === null) return;
      e.preventDefault();
      pendentes.push(t);
      clearTimeout(timer);
      timer = setTimeout(soltar, 60);
    };
    window.addEventListener('keydown', ouvir);
    const sair = aoLer(descartar);
    return () => {
      window.removeEventListener('keydown', ouvir);
      sair();
      clearTimeout(timer);
      const i = tecladosAtivos.indexOf(eu);
      if (i >= 0) tecladosAtivos.splice(i, 1);
    };
  }, []);
}

const LINHAS_TEXTO = ['QWERTYUIOP', 'ASDFGHJKLÇ', 'ZXCVBNM'];
const BLOCO_NUMEROS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '0'];

/** Teclado na tela, teclas grandes (princípio "digitação mínima"): letras e, ao lado, os números. */
export function TecladoTexto({ onTecla, className = '', comArroba }: { onTecla: (t: string) => void; className?: string; comArroba?: boolean }) {
  useTecladoFisico(onTecla, (e) => {
    if (e.key === 'Backspace') return '⌫';
    return e.key.length === 1 ? e.key : null;
  });
  const tecla = 'min-w-0 rounded-[14px] border-none bg-white text-[32px] font-bold text-tinta shadow-[0_2px_0_var(--color-tecla-sombra)] active:bg-azul-claro';
  return (
    <div role="group" aria-label="Teclado na tela" className={`flex gap-6 rounded-[22px] bg-teclado p-5 ${className}`}>
      <div className="flex min-w-0 flex-[10] flex-col gap-3">
        {LINHAS_TEXTO.map((l) => (
          <div key={l} className="flex flex-1 gap-3">
            {l.split('').map((c) => <button key={c} type="button" className={`${tecla} flex-1`} onClick={() => onTecla(c)}>{c}</button>)}
          </div>
        ))}
        <div className="flex flex-1 gap-3">
          {comArroba && <button type="button" className={`${tecla} flex-1`} onClick={() => onTecla(',')}>,</button>}
          <button type="button" className={tecla} style={{ flex: 6 }} onClick={() => onTecla(' ')}>Espaço</button>
          <button type="button" className={tecla} style={{ flex: 3 }} onClick={() => onTecla('⌫')}>Apagar</button>
        </div>
      </div>
      <div role="group" aria-label="Números" className="grid min-w-0 flex-[3] grid-cols-3 gap-3" style={{ gridTemplateRows: 'repeat(4, minmax(0, 1fr))' }}>
        {BLOCO_NUMEROS.map((c) => (
          <button key={c} type="button" className={`${tecla} ${c === '0' ? 'col-span-3' : ''}`} onClick={() => onTecla(c)}>{c}</button>
        ))}
      </div>
    </div>
  );
}

export function TecladoNumerico({ onTecla, className = '', semVirgula }: { onTecla: (t: string) => void; className?: string; semVirgula?: boolean }) {
  useTecladoFisico(onTecla, (e) => {
    if (e.key === 'Backspace') return '⌫';
    if (/^[0-9]$/.test(e.key)) return e.key;
    if (!semVirgula && (e.key === ',' || e.key === '.')) return ',';
    return null;
  });
  const teclas = ['1', '2', '3', '4', '5', '6', '7', '8', '9', semVirgula ? '' : ',', '0', '⌫'];
  return (
    <div role="group" aria-label="Teclado numérico" className={`grid grid-cols-3 gap-3 rounded-[20px] bg-teclado p-4 ${className}`} style={{ gridAutoRows: 'minmax(0, 1fr)' }}>
      {teclas.map((t, i) => t === '' ? <span key={i} /> : (
        <button key={i} type="button" aria-label={t === '⌫' ? 'Apagar' : t} onClick={() => onTecla(t)}
          className="min-h-[72px] rounded-[14px] border-none bg-white text-[40px] font-bold text-tinta shadow-[0_2px_0_var(--color-tecla-sombra)] active:bg-azul-claro">
          {t === '⌫' ? <span className="flex flex-col items-center gap-1 leading-none"><span>⌫</span><span className="text-[20px]">Apagar</span></span> : t}
        </button>
      ))}
    </div>
  );
}

/** Aplica uma tecla a um texto. */
export function aplicarTecla(texto: string, t: string, opts: { numerico?: boolean; max?: number } = {}): string {
  if (t === '⌫') return texto.slice(0, -1);
  if (opts.numerico && t === ',' && texto.includes(',')) return texto;
  if (opts.numerico && texto.includes(',') && texto.split(',')[1].length >= 2) return texto;
  const novo = texto + t;
  return opts.max && novo.length > opts.max ? texto : novo;
}

/** Janela única (sem modais empilhados). */
export function Janela({ titulo, children, onFechar, largura = 1100 }: { titulo: string; children: ReactNode; onFechar?: () => void; largura?: number }) {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/40" role="dialog" aria-modal="true" aria-label={titulo}>
      <div className="flex max-h-[1020px] flex-col gap-6 rounded-[28px] bg-white p-10 shadow-2xl" style={{ width: largura }}>
        <div className="flex items-center justify-between gap-6">
          <h2 className="m-0 text-[40px] font-bold">{titulo}</h2>
          {onFechar && <Botao variante="neutro" icone="x" onClick={onFechar}>Fechar</Botao>}
        </div>
        {children}
      </div>
    </div>
  );
}

export function Aviso({ tipo = 'erro', children }: { tipo?: 'erro' | 'ok' | 'info'; children: ReactNode }) {
  const cls = tipo === 'erro' ? 'bg-vermelho-claro text-vermelho border-vermelho' : tipo === 'ok' ? 'bg-verde-claro text-verde-escuro border-verde' : 'bg-azul-claro text-azul-escuro border-azul';
  return <div role={tipo === 'erro' ? 'alert' : 'status'} className={`rounded-2xl border-[3px] px-6 py-4 text-[26px] font-bold ${cls}`}>{children}</div>;
}

/** Mensagem passageira no rodapé da tela (ex.: "Produto adicionado"). */
export function useToast(): [ReactNode, (m: string, tipo?: 'erro' | 'ok') => void] {
  const [msg, setMsg] = useState<{ m: string; tipo: 'erro' | 'ok'; k: number } | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), msg.tipo === 'erro' ? 5000 : 2500);
    return () => clearTimeout(t);
  }, [msg]);
  const el = msg ? (
    <div key={msg.k} role="status" className={`absolute top-[124px] left-1/2 z-50 -translate-x-1/2 rounded-2xl px-10 py-5 text-[30px] font-bold shadow-xl
      ${msg.tipo === 'erro' ? 'bg-vermelho text-white' : 'bg-verde text-white'}`}>{msg.m}</div>
  ) : null;
  return [el, (m, tipo = 'ok') => setMsg({ m, tipo, k: Date.now() })];
}

export function iniciais(nome: string) {
  const p = nome.trim().split(/\s+/);
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}
