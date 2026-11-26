import type { Centavos } from '../lib/money';

export type FormaPagamento = 'cartao' | 'pix' | 'dinheiro' | 'fiado' | 'debito';
export type PrazoCrediario = 'mensal' | 'quinzenal' | 'semanal';
export const PRAZOS_CREDIARIO: { valor: PrazoCrediario; rotulo: string; dias: number }[] = [
  { valor: 'mensal', rotulo: 'Mensal', dias: 30 },
  { valor: 'quinzenal', rotulo: 'Quinzenal', dias: 15 },
  { valor: 'semanal', rotulo: 'Semanal', dias: 7 },
];
export type FormaRecebimento = Exclude<FormaPagamento, 'fiado'>;

export const NOME_FORMA: Record<FormaPagamento, string> = {
  cartao: 'Cartão',
  pix: 'PIX',
  dinheiro: 'Dinheiro',
  fiado: 'Crediário',
  debito: 'Débito',
};

export interface ConfigLoja {
  nome: string;
  telefone: string;
  instagram: string;
  rodape_cupom: string;
  /** Taxa em pontos-base (1% = 100) por número de parcelas do cartão: { "1": 349, "2": 459, ... } */
  taxas_cartao: Record<string, number>;
  taxa_debito: number;
  formas_ativas: FormaPagamento[];
  vias_fiado: boolean;
  /** Teto do MEI em centavos por ano */
  teto_mei: Record<string, Centavos>;
  fiado_max_parcelas: number;
}

export interface Produto {
  id: string;
  nome: string;
  marca: string | null;
  categoria: string | null;
  volume_ml: number | null;
  codigo_barras: string | null;
  codigo_interno: string;
  preco_venda: Centavos;
  custo_medio: Centavos;
  estoque_minimo: number;
  estoque_atual: number;
  foto_url: string | null;
  ativo: boolean;
  vendidos?: number;
}

export interface Cliente {
  id: string;
  nome: string;
  telefone: string;
  endereco: string | null;
  bairro: string | null;
  referencia: string | null;
  observacoes: string | null;
  limite_credito: Centavos | null;
  ativo: boolean;
  ultima_compra_em?: string | null;
}

export type StatusParcela = 'aberta' | 'parcial' | 'paga' | 'cancelada';

export interface Parcela {
  id: string;
  venda_id: string;
  venda_numero: number;
  cliente_id: string;
  numero: number;
  total_parcelas: number;
  valor: Centavos;
  valor_pago: Centavos;
  vencimento: string; // YYYY-MM-DD
  status: StatusParcela;
}

/** Item do carrinho (preço congelado quando o item entra — RNF-12). */
export interface ItemCarrinho {
  produto_id: string;
  descricao: string;
  detalhe: string;
  preco_unitario: Centavos;
  quantidade: number;
  /** Preço do catálogo quando o preço foi corrigido na venda (com PIN). */
  preco_original?: Centavos;
}

/** Pagamento lançado na tela de pagamento misto. */
export interface PagamentoLancado {
  id: string;
  forma: FormaPagamento;
  valor: Centavos;
  /** Dinheiro: quanto ela entregou. Cartão: quanto passou na maquininha (com a taxa repassada). */
  valor_recebido?: Centavos;
  /** Cartão: parcelas da maquininha. Fiado: número de parcelas. */
  parcelas?: number;
  /** Crediário: primeiro vencimento YYYY-MM-DD */
  primeiro_vencimento?: string;
  /** Crediário: intervalo entre as parcelas (padrão mensal). */
  prazo?: PrazoCrediario;
}

export interface FinalizarVendaPayload {
  idempotency_key: string;
  cliente_id: string;
  itens: { produto_id: string; descricao: string; quantidade: number; preco_unitario: Centavos; preco_original?: Centavos }[];
  desconto: Centavos;
  para_entrega: boolean;
  pagamentos: Omit<PagamentoLancado, 'id'>[];
  /** PIN que autorizou preço corrigido em algum item. */
  pin_preco?: string;
}

export interface VendaPagamento {
  forma: FormaPagamento;
  valor: Centavos;
  parcelas_cartao: number | null;
  taxa: Centavos;
  valor_liquido: Centavos;
  valor_recebido: Centavos | null;
  troco: Centavos;
  /** Cartão: taxa da maquininha repassada à cliente (cobrado na maquininha − valor). Não é venda. */
  acrescimo?: Centavos;
}

export interface VendaItem {
  produto_id: string;
  descricao: string;
  quantidade: number;
  preco_unitario: Centavos;
  custo_unitario: Centavos;
}

export interface Venda {
  id: string;
  numero: number;
  cliente_id: string;
  cliente: Pick<Cliente, 'nome' | 'telefone' | 'endereco' | 'bairro' | 'referencia'>;
  status: 'concluida' | 'cancelada';
  subtotal: Centavos;
  desconto: Centavos;
  total: Centavos;
  para_entrega: boolean;
  criada_em: string;
  cancelada_em: string | null;
  motivo_cancelamento: string | null;
  itens: VendaItem[];
  pagamentos: VendaPagamento[];
  parcelas: Pick<Parcela, 'numero' | 'valor' | 'vencimento'>[];
  /** Saldo devedor total da cliente depois desta venda (para o cupom). */
  saldo_cliente: Centavos;
}

export interface Recibo {
  grupo_id: string;
  cliente: Pick<Cliente, 'nome' | 'telefone'>;
  recebido_em: string;
  pagamentos: { forma: FormaRecebimento; valor: Centavos }[];
  total: Centavos;
  abatimentos: { venda_numero: number; numero: number; total_parcelas: number; vencimento: string; valor: Centavos; quitada: boolean }[];
  saldo_restante: Centavos;
}

export type TipoMovimento = 'entrada' | 'venda' | 'ajuste' | 'cancelamento';

export interface MovimentoEstoque {
  id: string;
  produto_id: string;
  tipo: TipoMovimento;
  quantidade: number;
  custo_unitario: Centavos | null;
  origem_id: string | null;
  motivo: string | null;
  criado_em: string;
}

export interface ResumoReceber {
  total_aberto: Centavos;
  total_vencido: Centavos;
  a_vencer_7: Centavos;
  a_vencer_30: Centavos;
  clientes: { cliente_id: string; nome: string; telefone: string; devido: Centavos; vencido: Centavos; dias_atraso: number }[];
}

export interface Painel {
  vendas_qtd: number;
  vendido: Centavos;
  por_forma: Record<FormaPagamento, Centavos>;
  recebido_fiado: Centavos;
  /** Taxa da maquininha repassada às clientes no período */
  acrescimo_cartao?: Centavos;
}

export interface Auditoria {
  id: string;
  ator: 'terminal' | 'admin';
  acao: string;
  entidade: string;
  entidade_id: string | null;
  dados: unknown;
  criado_em: string;
}

export interface Recebimento {
  id: string;
  grupo_id: string;
  cliente_id: string;
  cliente_nome: string;
  valor: Centavos;
  forma: FormaRecebimento;
  recebido_em: string;
  estornado: boolean;
}
