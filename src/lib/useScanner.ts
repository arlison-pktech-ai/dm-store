import { useEffect, useRef } from 'react';

/**
 * Leitor de código de barras em modo teclado (PRD, Arquitetura): reconhece uma leitura quando
 * os caracteres chegam com menos de 50 ms entre si e terminam em Enter. Funciona com
 * qualquer campo focado; os caracteres lidos não ficam no campo.
 *
 * Um único ouvinte global fica ligado desde o início do app. A tela atual registra o seu
 * tratador; uma leitura feita durante a troca de tela é entregue à próxima tela que registrar.
 */
type Tratador = (codigo: string) => void;

const tratadores: Tratador[] = [];
const observadores = new Set<() => void>();

/** Avisa quando uma leitura é reconhecida (o teclado na tela usa para descartar o que o leitor "digitou"). */
export function aoLer(cb: () => void) {
  observadores.add(cb);
  return () => { observadores.delete(cb); };
}
let pendente: { codigo: string; quando: number } | null = null;
let instalado = false;

function entregar(codigo: string) {
  const t = tratadores[tratadores.length - 1];
  if (t) t(codigo);
  else pendente = { codigo, quando: Date.now() };
}

function instalar() {
  if (instalado) return;
  instalado = true;
  let buf = '';
  let ultimo = 0;
  let alvo: HTMLInputElement | null = null;
  let valorAntes = '';

  window.addEventListener('keydown', (e) => {
    const agora = performance.now();
    const rapido = agora - ultimo < 50;
    ultimo = agora;
    if (e.key === 'Enter') {
      if (buf.length >= 4 && rapido) {
        e.preventDefault();
        e.stopPropagation();
        const codigo = buf;
        // Desfaz o que o leitor "digitou" no campo focado (o foco pode ter mudado no meio da leitura).
        const el = document.activeElement;
        if (el instanceof HTMLInputElement) {
          let novo = el.value;
          if (el === alvo) novo = valorAntes;
          else {
            for (let k = codigo.length; k > 0; k--) {
              if (el.value.endsWith(codigo.slice(-k))) { novo = el.value.slice(0, -k); break; }
            }
          }
          if (novo !== el.value) {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
            setter?.call(el, novo);
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
        buf = '';
        alvo = null;
        observadores.forEach((o) => o());
        entregar(codigo);
        return;
      }
      buf = '';
      return;
    }
    if (e.key.length !== 1) return;
    if (!rapido || buf === '') {
      buf = '';
      const el = document.activeElement;
      alvo = el instanceof HTMLInputElement ? el : null;
      valorAntes = alvo?.value ?? '';
    }
    buf += e.key;
  }, true);
}

export function useScanner(onCodigo: Tratador, ativo = true) {
  const cb = useRef(onCodigo);
  cb.current = onCodigo;

  useEffect(() => {
    instalar();
    if (!ativo) return;
    const t: Tratador = (c) => cb.current(c);
    tratadores.push(t);
    if (pendente && Date.now() - pendente.quando < 3000) {
      const c = pendente.codigo;
      pendente = null;
      setTimeout(() => t(c), 0);
    }
    return () => {
      const i = tratadores.indexOf(t);
      if (i >= 0) tratadores.splice(i, 1);
    };
  }, [ativo]);
}

/** Liga o ouvinte cedo (no início do terminal) para não perder a primeira leitura. */
export const instalarLeitor = instalar;
