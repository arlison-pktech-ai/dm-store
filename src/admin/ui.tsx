import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

export function Card({ titulo, direita, children, className = '' }: { titulo?: ReactNode; direita?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`flex flex-col gap-2.5 rounded-2xl border border-borda bg-white p-4 ${className}`}>
      {(titulo || direita) && <div className="flex items-baseline justify-between gap-3"><span className="text-[15px] font-bold">{titulo}</span>{direita}</div>}
      {children}
    </section>
  );
}

export function B({ variante = 'neutro', className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: 'primario' | 'neutro' | 'perigo' | 'ok' }) {
  const v = {
    primario: 'bg-azul text-white border-azul',
    neutro: 'bg-white text-tinta border-borda',
    perigo: 'bg-white text-vermelho border-vermelho-borda',
    ok: 'bg-white text-verde-escuro border-verde',
  }[variante];
  return <button type="button" {...rest} className={`min-h-11 rounded-xl border-2 px-3.5 text-[14px] font-bold disabled:opacity-40 ${v} ${className}`} />;
}

export function Campo({ rotulo, ...rest }: InputHTMLAttributes<HTMLInputElement> & { rotulo: string }) {
  return (
    <label className="flex flex-col gap-1 text-[13px] font-bold text-suave">
      {rotulo}
      <input {...rest} className="min-h-11 rounded-xl border-2 border-borda bg-white px-3 text-[16px] font-normal text-tinta outline-none focus:border-azul" />
    </label>
  );
}

export function Erro({ children }: { children: ReactNode }) {
  return children ? <div role="alert" className="rounded-xl bg-vermelho-claro px-3 py-2 text-[14px] font-bold text-vermelho">{children}</div> : null;
}

export function Ok({ children }: { children: ReactNode }) {
  return children ? <div role="status" className="rounded-xl bg-verde-claro px-3 py-2 text-[14px] font-bold text-verde-escuro">{children}</div> : null;
}

export function Linha({ esq, dir, sub, className = '' }: { esq: ReactNode; dir?: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center justify-between gap-3 border-b border-cinza py-2 last:border-none ${className}`}>
      <span className="flex min-w-0 flex-col"><span className="truncate text-[15px] font-bold">{esq}</span>{sub && <span className="text-[13px] text-suave">{sub}</span>}</span>
      {dir && <span className="shrink-0 text-[15px]">{dir}</span>}
    </div>
  );
}
