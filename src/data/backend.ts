import type { Centavos } from '../lib/money';
import type {
  Auditoria, Cliente, ConfigLoja, FinalizarVendaPayload, FormaRecebimento, MovimentoEstoque,
  Painel, Parcela, Produto, Recebimento, Recibo, ResumoReceber, Venda,
} from '../domain/types';

export type Papel = 'terminal' | 'admin';

export interface Sessao {
  papel: Papel;
  email: string | null;
}

export interface NovoProduto {
  nome: string;
  preco_venda: Centavos;
  codigo_barras?: string | null;
  marca?: string | null;
  categoria?: string | null;
  volume_ml?: number | null;
  estoque_minimo?: number;
  ativo?: boolean;
  foto_url?: string | null;
}

export interface NovaCliente {
  nome: string;
  telefone: string;
  endereco?: string | null;
  bairro?: string | null;
  referencia?: string | null;
  observacoes?: string | null;
  limite_credito?: Centavos | null;
}

export interface ItemEntrada {
  produto_id: string;
  quantidade: number;
  custo_unitario: Centavos;
}

export interface SituacaoCliente {
  devido: Centavos;
  vencido: Centavos;
  qtd_atrasadas: number;
  parcelas: Parcela[];
}

/**
 * Tudo o que a interface pede aos dados. Duas implementações:
 * - SupabaseBackend: produção, chama as RPCs e tabelas no Supabase.
 * - LocalBackend: modo demonstração/protótipo (Fase 0), grava no navegador.
 */
export interface Backend {
  readonly modo: 'supabase' | 'demo';

  // Sessão
  sessao(): Promise<Sessao | null>;
  entrar(email: string, senha: string): Promise<Sessao>;
  sair(): Promise<void>;

  // Configuração
  config(): Promise<ConfigLoja>;
  salvarConfig(c: ConfigLoja): Promise<void>;
  trocarPin(novoPin: string): Promise<void>;
  conferirPin(pin: string): Promise<boolean>;

  // Produtos e estoque
  produtos(): Promise<Produto[]>;
  salvarProduto(p: NovoProduto & { id?: string }, pin?: string): Promise<Produto>;
  movimentos(produtoId: string): Promise<MovimentoEstoque[]>;
  registrarEntrada(itens: ItemEntrada[]): Promise<void>;
  ajustarEstoque(produtoId: string, quantidade: number, motivo: string, pin?: string): Promise<void>;
  importarProdutos(linhas: NovoProduto[]): Promise<number>;

  // Clientes
  buscarClientes(q: string): Promise<Cliente[]>;
  ultimasClientes(n: number): Promise<Cliente[]>;
  cliente(id: string): Promise<Cliente>;
  salvarCliente(c: NovaCliente & { id?: string }): Promise<Cliente>;
  situacaoCliente(id: string): Promise<SituacaoCliente>;
  vendasCliente(id: string): Promise<Venda[]>;
  importarClientes(linhas: (NovaCliente & { saldo_aberto?: Centavos; vencimento?: string })[]): Promise<number>;

  // Vendas
  finalizarVenda(p: FinalizarVendaPayload): Promise<Venda>;
  venda(id: string): Promise<Venda>;
  vendas(filtro: { desde?: string; ate?: string; limite?: number }): Promise<Venda[]>;
  cancelarVenda(id: string, motivo: string, pin?: string): Promise<void>;

  // Fiado
  registrarRecebimento(clienteId: string, pagamentos: { forma: FormaRecebimento; valor: Centavos }[]): Promise<Recibo>;
  recebimentos(filtro: { desde?: string; clienteId?: string }): Promise<Recebimento[]>;
  estornarRecebimento(grupoId: string, motivo: string, pin?: string): Promise<void>;
  resumoReceber(): Promise<ResumoReceber>;

  // Admin
  painel(desde: string, ate: string): Promise<Painel>;
  auditoria(limite: number): Promise<Auditoria[]>;
  exportar(tabela: 'vendas' | 'venda_itens' | 'clientes' | 'parcelas' | 'produtos'): Promise<Record<string, unknown>[]>;
}

export class ErroNegocio extends Error {}
