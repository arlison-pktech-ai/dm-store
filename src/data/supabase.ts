import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Backend, ItemEntrada, NovaCliente, NovoProduto, Papel, Sessao, SituacaoCliente } from './backend';
import { ErroNegocio } from './backend';
import type {
  Auditoria, Cliente, ConfigLoja, FinalizarVendaPayload, FormaRecebimento, MovimentoEstoque, Painel,
  Parcela, Produto, Recebimento, Recibo, ResumoReceber, Venda,
} from '../domain/types';
import { hojeISO } from '../lib/dates';
import type { Centavos } from '../lib/money';

type Row = Record<string, unknown>;

function falha(e: { message: string } | null): never {
  throw new ErroNegocio(e?.message ?? 'Erro ao falar com o servidor.');
}

/** Início/fim do dia em Manaus (UTC−4, sem horário de verão) como timestamptz. */
const inicioDia = (d: string) => `${d}T00:00:00-04:00`;
const fimDia = (d: string) => `${d}T23:59:59.999-04:00`;

export class SupabaseBackend implements Backend {
  readonly modo = 'supabase' as const;
  private sb: SupabaseClient;

  constructor(url: string, anonKey: string) {
    this.sb = createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'pdv-auth' },
    });
  }

  private async rpc<T>(fn: string, args?: Row): Promise<T> {
    const { data, error } = await this.sb.rpc(fn, args ?? {});
    if (error) falha(error);
    return data as T;
  }

  // ---------- Sessão
  async sessao(): Promise<Sessao | null> {
    const { data } = await this.sb.auth.getSession();
    const u = data.session?.user;
    if (!u) return null;
    const papel = (u.app_metadata?.papel as Papel | undefined) ?? null;
    if (papel !== 'terminal' && papel !== 'admin') return null;
    return { papel, email: u.email ?? null };
  }
  async entrar(email: string, senha: string) {
    const { error } = await this.sb.auth.signInWithPassword({ email, password: senha });
    if (error) throw new ErroNegocio('E-mail ou senha incorretos.');
    const s = await this.sessao();
    if (!s) throw new ErroNegocio('Este usuário não tem papel definido (terminal ou admin).');
    return s;
  }
  async sair() {
    await this.sb.auth.signOut();
  }

  // ---------- Config
  config() {
    return this.rpc<ConfigLoja>('config_publica');
  }
  salvarConfig(c: ConfigLoja) {
    return this.rpc<void>('salvar_config', { dados: c });
  }
  trocarPin(novoPin: string) {
    return this.rpc<void>('trocar_pin', { novo_pin: novoPin });
  }
  conferirPin(pin: string) {
    return this.rpc<boolean>('conferir_pin', { pin });
  }

  // ---------- Produtos
  async produtos(): Promise<Produto[]> {
    const { data, error } = await this.sb.from('produtos').select('*').order('nome');
    if (error) falha(error);
    // "Mais vendidos" para a grade de procurar produto (últimos 90 dias)
    const desde = new Date(Date.now() - 90 * 86400000).toISOString();
    const { data: itens } = await this.sb.from('venda_itens').select('produto_id, quantidade, vendas!inner(status, criada_em)')
      .eq('vendas.status', 'concluida').gte('vendas.criada_em', desde).limit(5000);
    const vend = new Map<string, number>();
    (itens ?? []).forEach((i: Row) => vend.set(i.produto_id as string, (vend.get(i.produto_id as string) ?? 0) + (i.quantidade as number)));
    return (data as Produto[]).map((p) => ({ ...p, vendidos: vend.get(p.id) ?? 0 }));
  }
  salvarProduto(p: NovoProduto & { id?: string }, pin?: string) {
    return this.rpc<Produto>('salvar_produto', { dados: p, pin: pin ?? null });
  }
  async movimentos(produtoId: string) {
    const { data, error } = await this.sb.from('estoque_movimentos').select('*').eq('produto_id', produtoId).order('criado_em', { ascending: false }).limit(200);
    if (error) falha(error);
    return data as MovimentoEstoque[];
  }
  async registrarEntrada(itens: ItemEntrada[]) {
    await this.rpc('registrar_entrada', { itens });
  }
  async ajustarEstoque(produtoId: string, quantidade: number, motivo: string, pin?: string) {
    await this.rpc('ajustar_estoque', { produto_id: produtoId, quantidade, motivo, pin: pin ?? null });
  }
  async registrarContagem(itens: { produto_id: string; contado: number }[], pin?: string) {
    return (await this.rpc('registrar_contagem', { itens, pin: pin ?? null })) as number;
  }
  async importarProdutos(linhas: NovoProduto[]) {
    let n = 0;
    for (const l of linhas) {
      await this.salvarProduto(l);
      n++;
    }
    return n;
  }

  // ---------- Clientes
  async buscarClientes(q: string) {
    const t = q.trim().replace(/[%,()]/g, ' ');
    const dig = t.replace(/\D/g, '');
    let query = this.sb.from('clientes').select('*').eq('ativo', true).order('nome').limit(12);
    query = dig.length >= 3 && dig.length === t.replace(/[\s()-]/g, '').length
      ? query.ilike('telefone_digitos', `%${dig}%`)
      : query.ilike('nome', `%${t}%`);
    const { data, error } = await query;
    if (error) falha(error);
    return data as Cliente[];
  }
  async ultimasClientes(n: number) {
    const { data, error } = await this.sb.from('clientes').select('*').eq('ativo', true).not('ultima_compra_em', 'is', null)
      .order('ultima_compra_em', { ascending: false }).limit(n);
    if (error) falha(error);
    return data as Cliente[];
  }
  async cliente(id: string) {
    const { data, error } = await this.sb.from('clientes').select('*').eq('id', id).single();
    if (error) falha(error);
    return data as Cliente;
  }
  salvarCliente(c: NovaCliente & { id?: string }) {
    return this.rpc<Cliente>('salvar_cliente', { dados: c });
  }
  async situacaoCliente(id: string): Promise<SituacaoCliente> {
    const { data, error } = await this.sb.from('parcelas').select('*, vendas(numero)').eq('cliente_id', id).in('status', ['aberta', 'parcial'])
      .order('vencimento').order('numero');
    if (error) falha(error);
    const hoje = hojeISO();
    const parcelas: Parcela[] = (data as Row[]).map((p) => ({ ...(p as unknown as Parcela), venda_numero: (p.vendas as { numero: number }).numero }));
    const vencidas = parcelas.filter((p) => p.vencimento < hoje);
    return {
      devido: parcelas.reduce((s, p) => s + p.valor - p.valor_pago, 0),
      vencido: vencidas.reduce((s, p) => s + p.valor - p.valor_pago, 0),
      qtd_atrasadas: vencidas.length,
      parcelas,
    };
  }
  async vendasCliente(id: string) {
    const { data, error } = await this.sb.from('vendas').select('id').eq('cliente_id', id).order('numero', { ascending: false }).limit(50);
    if (error) falha(error);
    return Promise.all((data as Row[]).map((v) => this.venda(v.id as string)));
  }
  importarClientes(linhas: (NovaCliente & { saldo_aberto?: Centavos; vencimento?: string })[]) {
    return this.rpc<number>('importar_clientes', { linhas });
  }

  // ---------- Vendas
  finalizarVenda(p: FinalizarVendaPayload) {
    return this.rpc<Venda>('finalizar_venda', { payload: p });
  }
  async venda(id: string) {
    const v = await this.rpc<Venda | null>('venda_detalhe', { p_venda: id });
    if (!v) throw new ErroNegocio('Venda não encontrada.');
    return v;
  }
  async vendas(filtro: { desde?: string; ate?: string; limite?: number }) {
    let q = this.sb.from('vendas').select('id').order('numero', { ascending: false }).limit(filtro.limite ?? 100);
    if (filtro.desde) q = q.gte('criada_em', inicioDia(filtro.desde));
    if (filtro.ate) q = q.lte('criada_em', fimDia(filtro.ate));
    const { data, error } = await q;
    if (error) falha(error);
    return Promise.all((data as Row[]).map((v) => this.venda(v.id as string)));
  }
  async cancelarVenda(id: string, motivo: string, pin?: string) {
    await this.rpc('cancelar_venda', { venda_id: id, motivo, pin: pin ?? null });
  }

  // ---------- Fiado
  registrarRecebimento(clienteId: string, pagamentos: { forma: FormaRecebimento; valor: Centavos }[]) {
    return this.rpc<Recibo>('registrar_recebimento', { cliente_id: clienteId, pagamentos });
  }
  async recebimentos(filtro: { desde?: string; clienteId?: string }) {
    let q = this.sb.from('recebimentos').select('*, clientes(nome)').order('recebido_em', { ascending: false }).limit(200);
    if (filtro.desde) q = q.gte('recebido_em', inicioDia(filtro.desde));
    if (filtro.clienteId) q = q.eq('cliente_id', filtro.clienteId);
    const { data, error } = await q;
    if (error) falha(error);
    return (data as Row[]).map((r) => ({ ...(r as unknown as Recebimento), cliente_nome: (r.clientes as { nome: string }).nome }));
  }
  async estornarRecebimento(grupoId: string, motivo: string, pin?: string) {
    await this.rpc('estornar_recebimento', { grupo_id: grupoId, motivo, pin: pin ?? null });
  }
  resumoReceber() {
    return this.rpc<ResumoReceber>('resumo_receber');
  }

  // ---------- Admin
  painel(desde: string, ate: string) {
    return this.rpc<Painel>('painel', { desde, ate });
  }
  async auditoria(limite: number) {
    const { data, error } = await this.sb.from('auditoria').select('*').order('criado_em', { ascending: false }).limit(limite);
    if (error) falha(error);
    return data as Auditoria[];
  }
  async exportar(tabela: 'vendas' | 'venda_itens' | 'clientes' | 'parcelas' | 'produtos') {
    const { data, error } = await this.sb.from(tabela).select('*').limit(100000);
    if (error) falha(error);
    return data as Row[];
  }
}
