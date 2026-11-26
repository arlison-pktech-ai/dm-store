/**
 * Regras de negócio puras. As mesmas regras estão implementadas nas RPCs do
 * Postgres (supabase/migrations); este módulo é usado pela interface (prévias)
 * e pelo modo demonstração, e é coberto por testes.
 */
import type { Centavos } from '../lib/money';
import { addMeses } from '../lib/dates';
import type { FinalizarVendaPayload, FormaPagamento, ItemCarrinho, Parcela } from './types';

export const MAX_PAGAMENTOS = 4;

export function subtotalCarrinho(itens: Pick<ItemCarrinho, 'preco_unitario' | 'quantidade'>[]): Centavos {
  return itens.reduce((s, i) => s + i.preco_unitario * i.quantidade, 0);
}

/** RF-14: divide em partes iguais; a diferença de centavos vai para a última. */
export function dividirParcelas(valor: Centavos, n: number, primeiroVencimento: string): { numero: number; valor: Centavos; vencimento: string }[] {
  if (n < 1) throw new Error('Número de parcelas inválido');
  const base = Math.floor(valor / n);
  return Array.from({ length: n }, (_, i) => ({
    numero: i + 1,
    valor: i === n - 1 ? valor - base * (n - 1) : base,
    vencimento: addMeses(primeiroVencimento, i),
  }));
}

/** RF-13: taxa da maquininha em centavos, a partir de pontos-base por nº de parcelas. */
export function taxaCartao(valor: Centavos, parcelas: number, taxas: Record<string, number>): Centavos {
  const bp = taxas[String(parcelas)] ?? 0;
  return Math.round((valor * bp) / 10000);
}

/**
 * RF-10/RF-12: quanto de um valor escolhido entra como pagamento, e o troco.
 * Dinheiro acima do que falta gera troco. Cartão acima do que falta é a taxa da maquininha
 * repassada à cliente (acréscimo): passa na maquininha, mas não muda o total da venda.
 */
export function aplicarValor(forma: FormaPagamento, escolhido: Centavos, falta: Centavos): { aplicado: Centavos; troco: Centavos; acrescimo: Centavos } {
  const aplicado = Math.max(0, Math.min(escolhido, falta));
  const sobra = Math.max(0, escolhido - falta);
  return { aplicado, troco: forma === 'dinheiro' ? sobra : 0, acrescimo: forma === 'cartao' ? sobra : 0 };
}

export interface Abatimento {
  parcela_id: string;
  valor: Centavos;
  quitada: boolean;
}

/** RF-41: abate primeiro as parcelas mais antigas. Recusa valor acima do devido. */
export function alocarRecebimento(
  parcelas: Pick<Parcela, 'id' | 'valor' | 'valor_pago' | 'vencimento' | 'status' | 'numero'>[],
  valor: Centavos,
): Abatimento[] {
  const abertas = parcelas
    .filter((p) => p.status === 'aberta' || p.status === 'parcial')
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.numero - b.numero);
  const devido = abertas.reduce((s, p) => s + (p.valor - p.valor_pago), 0);
  if (valor <= 0) throw new Error('Informe o valor recebido.');
  if (valor > devido) throw new Error('O valor é maior do que ela deve.');
  const out: Abatimento[] = [];
  let resta = valor;
  for (const p of abertas) {
    if (resta <= 0) break;
    const aberto = p.valor - p.valor_pago;
    const v = Math.min(aberto, resta);
    out.push({ parcela_id: p.id, valor: v, quitada: v === aberto });
    resta -= v;
  }
  return out;
}

/** RF-21: custo médio ponderado. Com estoque zerado ou negativo, vale o custo novo. */
export function novoCustoMedio(estoqueAtual: number, custoAtual: Centavos, qtd: number, custoUnit: Centavos): Centavos {
  if (estoqueAtual <= 0) return custoUnit;
  return Math.round((estoqueAtual * custoAtual + qtd * custoUnit) / (estoqueAtual + qtd));
}

/** RF-16: validações da finalização. Devolve a mensagem de erro, ou null. */
export function validarVenda(p: FinalizarVendaPayload): string | null {
  if (!p.cliente_id) return 'Escolha a cliente.';
  if (p.itens.length === 0) return 'O carrinho está vazio.';
  if (p.pagamentos.length === 0) return 'Lance o pagamento.';
  if (p.pagamentos.length > MAX_PAGAMENTOS) return 'No máximo 4 pagamentos por venda.';
  const subtotal = subtotalCarrinho(p.itens);
  if (p.desconto < 0 || p.desconto > subtotal) return 'Desconto inválido.';
  const total = subtotal - p.desconto;
  const soma = p.pagamentos.reduce((s, x) => s + x.valor, 0);
  if (soma !== total) return 'A soma dos pagamentos não fecha com o total.';
  for (const x of p.pagamentos) {
    if (x.valor <= 0) return 'Pagamento com valor inválido.';
    if (x.forma === 'dinheiro' && (x.valor_recebido ?? x.valor) < x.valor) return 'Valor recebido em dinheiro menor que o pagamento.';
    if (x.forma === 'cartao' && (x.valor_recebido ?? x.valor) < x.valor) return 'Valor cobrado no cartão menor que o pagamento.';
    if (x.forma === 'cartao' && (!x.parcelas || x.parcelas < 1 || x.parcelas > 12)) return 'Parcelas do cartão entre 1 e 12.';
    if (x.forma === 'fiado' && (!x.parcelas || x.parcelas < 1 || !x.primeiro_vencimento)) return 'Informe as parcelas do fiado.';
  }
  return null;
}

/** RF-03: avisos sobre a cliente (não bloqueiam a venda). */
export function avisosCliente(opts: { vencido: Centavos; qtdAtrasadas: number; devido: Centavos; limite: Centavos | null; fiadoNovo?: Centavos }): string[] {
  const avisos: string[] = [];
  if (opts.qtdAtrasadas > 0) avisos.push(`${opts.qtdAtrasadas} parcela${opts.qtdAtrasadas > 1 ? 's' : ''} atrasada${opts.qtdAtrasadas > 1 ? 's' : ''}`);
  if (opts.limite != null && opts.devido + (opts.fiadoNovo ?? 0) > opts.limite) avisos.push('Passa do limite de crédito');
  return avisos;
}

/** Código interno para produto sem código de barras (RF-20). */
export function gerarCodigoInterno(seq: number): string {
  return 'INT' + String(seq).padStart(6, '0');
}

export function numeroVenda(n: number): string {
  return String(n).padStart(6, '0');
}
