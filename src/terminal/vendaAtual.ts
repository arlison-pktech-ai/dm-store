/**
 * Venda em andamento (RF-19): cliente, carrinho e pagamentos ficam salvos no navegador
 * até a venda ser concluída ou descartada. Sobrevive a recarregar a página.
 */
import { useSyncExternalStore } from 'react';
import type { Cliente, ItemCarrinho, PagamentoLancado, Produto } from '../domain/types';
import { subtotalCarrinho } from '../domain/regras';

export interface VendaAtual {
  idempotency_key: string;
  cliente: Cliente | null;
  itens: ItemCarrinho[];
  desconto: number;
  para_entrega: boolean;
  pagamentos: PagamentoLancado[];
  /** Pilha para o botão Desfazer do carrinho. */
  historico: ItemCarrinho[][];
}

const KEY = 'pdv-venda-atual';

function nova(): VendaAtual {
  return { idempotency_key: crypto.randomUUID(), cliente: null, itens: [], desconto: 0, para_entrega: false, pagamentos: [], historico: [] };
}

let estado: VendaAtual = (() => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...nova(), ...JSON.parse(raw) } : nova();
  } catch {
    return nova();
  }
})();

const ouvintes = new Set<() => void>();

function set(f: (v: VendaAtual) => VendaAtual) {
  estado = f(estado);
  localStorage.setItem(KEY, JSON.stringify(estado));
  ouvintes.forEach((l) => l());
}

export function useVendaAtual() {
  return useSyncExternalStore((l) => (ouvintes.add(l), () => ouvintes.delete(l)), () => estado);
}

export function detalheProduto(p: Pick<Produto, 'categoria' | 'volume_ml' | 'marca'>) {
  return [p.categoria, p.volume_ml ? `${p.volume_ml} ml` : null].filter(Boolean).join(' · ');
}

export function descricaoProduto(p: Pick<Produto, 'nome' | 'volume_ml'>) {
  return p.volume_ml ? `${p.nome} ${p.volume_ml} ml` : p.nome;
}

const comHistorico = (v: VendaAtual, itens: ItemCarrinho[]): VendaAtual => ({
  ...v, itens, historico: [...v.historico.slice(-19), v.itens],
  // Mudou o carrinho: os pagamentos lançados deixam de valer.
  pagamentos: [],
  desconto: Math.min(v.desconto, subtotalCarrinho(itens)),
});

export const venda = {
  get: () => estado,
  escolherCliente: (c: Cliente) => set((v) => ({ ...v, cliente: c, para_entrega: v.cliente?.id === c.id ? v.para_entrega : false })),
  trocarCliente: () => set((v) => ({ ...v, cliente: null, para_entrega: false })),
  /** RF-05: bipar de novo soma 1. O preço vale a partir de quando o item entra (RNF-12). */
  adicionar: (p: Produto) => set((v) => {
    const i = v.itens.findIndex((x) => x.produto_id === p.id);
    const itens = i >= 0
      ? v.itens.map((x, k) => (k === i ? { ...x, quantidade: x.quantidade + 1 } : x))
      : [...v.itens, { produto_id: p.id, descricao: descricaoProduto(p), detalhe: detalheProduto(p), preco_unitario: p.preco_venda, quantidade: 1 }];
    return comHistorico(v, itens);
  }),
  mudarQtd: (produtoId: string, delta: number) => set((v) => comHistorico(v,
    v.itens.map((x) => (x.produto_id === produtoId ? { ...x, quantidade: x.quantidade + delta } : x)).filter((x) => x.quantidade > 0))),
  remover: (produtoId: string) => set((v) => comHistorico(v, v.itens.filter((x) => x.produto_id !== produtoId))),
  desfazer: () => set((v) => v.historico.length === 0 ? v : ({ ...v, itens: v.historico[v.historico.length - 1], historico: v.historico.slice(0, -1), pagamentos: [] })),
  desconto: (c: number) => set((v) => ({ ...v, desconto: Math.max(0, Math.min(c, subtotalCarrinho(v.itens))), pagamentos: [] })),
  entrega: (on: boolean) => set((v) => ({ ...v, para_entrega: on })),
  lancar: (p: Omit<PagamentoLancado, 'id'>) => set((v) => ({ ...v, pagamentos: [...v.pagamentos, { ...p, id: crypto.randomUUID() }] })),
  removerPagamento: (id: string) => set((v) => ({ ...v, pagamentos: v.pagamentos.filter((p) => p.id !== id) })),
  atualizarCliente: (c: Cliente) => set((v) => ({ ...v, cliente: c })),
  descartar: () => set(() => nova()),
};

export function totais(v: VendaAtual) {
  const subtotal = subtotalCarrinho(v.itens);
  const total = subtotal - v.desconto;
  const pago = v.pagamentos.reduce((s, p) => s + p.valor, 0);
  return { subtotal, total, pago, falta: Math.max(0, total - pago), unidades: v.itens.reduce((s, i) => s + i.quantidade, 0) };
}
