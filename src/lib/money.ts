/** Todos os valores de dinheiro são inteiros em centavos. */
export type Centavos = number;

const fmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 12990 → "R$ 129,90" */
export function brl(c: Centavos): string {
  const neg = c < 0;
  const s = 'R$ ' + fmt.format(Math.abs(c) / 100);
  return neg ? '− ' + s : s;
}

/** 12990 → "129,90" (sem símbolo, para o cupom) */
export function num(c: Centavos): string {
  return (c < 0 ? '−' : '') + fmt.format(Math.abs(c) / 100);
}

/** Texto digitado no teclado numérico ("129,9") → centavos. */
export function parseBRL(texto: string): Centavos {
  const limpo = texto.replace(/[^\d,]/g, '');
  if (!limpo) return 0;
  const [inteiro, frac = ''] = limpo.split(',');
  return (parseInt(inteiro || '0', 10) * 100) + parseInt((frac + '00').slice(0, 2), 10);
}

/** Centavos → texto editável no teclado ("129,90"). */
export function toInput(c: Centavos): string {
  return fmt.format(c / 100).replace(/\./g, '');
}
