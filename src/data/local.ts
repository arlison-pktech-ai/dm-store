/**
 * Modo demonstração (Fase 0 do PRD: protótipo antes de existir banco).
 * Implementa as mesmas regras das RPCs, gravando tudo no localStorage.
 */
import type { Backend, ItemEntrada, NovaCliente, NovoProduto, Sessao, SituacaoCliente } from './backend';
import { ErroNegocio } from './backend';
import type {
  Auditoria, Cliente, ConfigLoja, FinalizarVendaPayload, FormaRecebimento, MovimentoEstoque, Painel,
  Parcela, Produto, Recebimento, Recibo, ResumoReceber, Venda,
} from '../domain/types';
import { alocarRecebimento, dividirParcelas, gerarCodigoInterno, novoCustoMedio, subtotalCarrinho, taxaCartao, validarVenda } from '../domain/regras';
import { addDias, diasEntre, hojeISO } from '../lib/dates';
import type { Centavos } from '../lib/money';
import { sha256 } from '../lib/hash';

interface VendaRow extends Omit<Venda, 'cliente' | 'parcelas' | 'saldo_cliente'> {
  idempotency_key: string;
}
interface RecebimentoRow { id: string; grupo_id: string; cliente_id: string; valor: Centavos; forma: FormaRecebimento; recebido_em: string; estornado: boolean }
interface RecParcelaRow { recebimento_id: string; parcela_id: string; valor: Centavos }
interface ParcelaRow extends Omit<Parcela, 'venda_numero' | 'total_parcelas'> { total_parcelas: number }

interface DB {
  v: number;
  seq_venda: number;
  seq_interno: number;
  config: ConfigLoja;
  pin_hash: string;
  produtos: Omit<Produto, 'estoque_atual' | 'vendidos'>[];
  movimentos: MovimentoEstoque[];
  clientes: Cliente[];
  vendas: VendaRow[];
  parcelas: ParcelaRow[];
  recebimentos: RecebimentoRow[];
  recebimento_parcelas: RecParcelaRow[];
  auditoria: Auditoria[];
}

const KEY = 'pdv-demo-db';
const KEY_SESSAO = 'pdv-demo-sessao';

const uid = () => crypto.randomUUID();
const agora = () => new Date().toISOString();
const diaLocal = (ts: string) => hojeISO(new Date(ts));

export const CONFIG_PADRAO: ConfigLoja = {
  nome: 'Dalva Cosméticos',
  telefone: '(92) 99999-0000',
  instagram: '@dalvacosmeticos',
  rodape_cupom: 'Obrigada pela preferência!',
  taxas_cartao: { '1': 349, '2': 459, '3': 529, '4': 599, '5': 669, '6': 739, '7': 809, '8': 879, '9': 949, '10': 1019, '11': 1089, '12': 1159 },
  taxa_debito: 199,
  formas_ativas: ['cartao', 'pix', 'dinheiro', 'fiado'],
  vias_fiado: true,
  teto_mei: { '2026': 8100000, '2027': 11000000, '2028': 14000000 },
  fiado_max_parcelas: 4,
};

function seed(pinHash: string): DB {
  const hoje = hojeISO();
  const ts = (diasAtras: number) => new Date(Date.now() - diasAtras * 86400000).toISOString();
  const p = (nome: string, marca: string, categoria: string, ml: number | null, cod: string | null, preco: number, custo: number, min: number) => ({
    id: uid(), nome, marca, categoria, volume_ml: ml, codigo_barras: cod, codigo_interno: '', preco_venda: preco, custo_medio: custo,
    estoque_minimo: min, foto_url: null, ativo: true,
  });
  const produtos = [
    p('Essência Âmbar', 'Dalva', 'Deo colônia', 100, '7891000000017', 18990, 9500, 2),
    p('Flor de Lótus', 'Dalva', 'Deo colônia', 75, '7891000000024', 12990, 6200, 2),
    p('Hidratante Lótus', 'Dalva', 'Loção corporal', 200, '7891000000031', 5990, 2400, 3),
    p('Brisa do Mar', 'Dalva', 'Deo colônia', 100, '7891000000048', 15990, 7800, 2),
    p('Óleo Corporal Baunilha', 'Dalva', 'Óleo corporal', 120, '7891000000055', 4990, 1900, 3),
    p('Sabonete Líquido Erva-doce', 'Dalva', 'Sabonete', 250, '7891000000062', 3490, 1200, 4),
    p('Kit Presente Âmbar', 'Dalva', 'Kit', null, null, 24990, 12500, 1),
  ];
  produtos.forEach((x, i) => (x.codigo_interno = gerarCodigoInterno(i + 1)));
  const estoqueInicial = [1, 0, 2, 6, 8, 10, 3];
  const movimentos: MovimentoEstoque[] = produtos.map((x, i) => ({
    id: uid(), produto_id: x.id, tipo: 'entrada', quantidade: estoqueInicial[i], custo_unitario: x.custo_medio, origem_id: null, motivo: 'Estoque inicial', criado_em: ts(40),
  }));
  const c = (nome: string, tel: string, dias: number, extra: Partial<Cliente> = {}): Cliente => ({
    id: uid(), nome, telefone: tel, endereco: null, bairro: null, referencia: null, observacoes: null, limite_credito: null, ativo: true, ultima_compra_em: ts(dias), ...extra,
  });
  const clientes = [
    c('Rosa Almeida', '(92) 99812-4471', 0.1, { endereco: 'Rua das Orquídeas, 120', bairro: 'Parque 10', referencia: 'Portão azul', limite_credito: 50000 }),
    c('Fátima Souza', '(92) 98144-2090', 1),
    c('Cláudia Ribeiro', '(92) 99273-5518', 2),
    c('Marlene Costa', '(92) 98820-6634', 3, { endereco: 'Av. Djalma Batista, 900, ap. 12', bairro: 'Chapada' }),
    c('Joana Lima', '(92) 99407-1185', 4),
    c('Sônia Prado', '(92) 98356-7702', 5),
  ];
  // Uma venda antiga no fiado para Rosa, com parcela atrasada (como no design).
  const vendaId = uid();
  const vendas: VendaRow[] = [{
    id: vendaId, numero: 98, cliente_id: clientes[0].id, status: 'concluida', subtotal: 12000, desconto: 0, total: 12000, para_entrega: false,
    criada_em: ts(46), cancelada_em: null, motivo_cancelamento: null, idempotency_key: uid(),
    itens: [{ produto_id: produtos[4].id, descricao: 'Óleo Corporal Baunilha 120 ml', quantidade: 2, preco_unitario: 6000, custo_unitario: 1900 }],
    pagamentos: [{ forma: 'fiado', valor: 12000, parcelas_cartao: null, taxa: 0, valor_liquido: 12000, valor_recebido: null, troco: 0 }],
  }];
  const parcelas: ParcelaRow[] = [
    { id: uid(), venda_id: vendaId, cliente_id: clientes[0].id, numero: 1, total_parcelas: 2, valor: 6000, valor_pago: 6000, vencimento: addDias(hoje, -46), status: 'paga' },
    { id: uid(), venda_id: vendaId, cliente_id: clientes[0].id, numero: 2, total_parcelas: 2, valor: 6000, valor_pago: 0, vencimento: addDias(hoje, -16), status: 'aberta' },
  ];
  return {
    v: 1, seq_venda: 122, seq_interno: produtos.length, config: CONFIG_PADRAO, pin_hash: pinHash,
    produtos, movimentos, clientes, vendas, parcelas, recebimentos: [], recebimento_parcelas: [], auditoria: [],
  };
}

export class LocalBackend implements Backend {
  readonly modo = 'demo' as const;
  private db!: DB;
  private pronto: Promise<void>;

  constructor() {
    this.pronto = this.carregar();
  }

  private async carregar() {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      this.db = JSON.parse(raw);
    } else {
      this.db = seed(await sha256('1234'));
      this.salvar();
    }
  }

  private salvar() {
    localStorage.setItem(KEY, JSON.stringify(this.db));
  }

  /** Executa uma "transação": se der erro, nada é gravado. */
  private async tx<T>(fn: (db: DB) => T | Promise<T>): Promise<T> {
    await this.pronto;
    const copia: DB = structuredClone(this.db);
    const r = await fn(copia);
    this.db = copia;
    this.salvar();
    return r;
  }

  private async ler<T>(fn: (db: DB) => T): Promise<T> {
    await this.pronto;
    return structuredClone(fn(this.db));
  }

  static resetar() {
    localStorage.removeItem(KEY);
    localStorage.removeItem(KEY_SESSAO);
  }

  private async exigirPin(db: DB, pin?: string) {
    const s = await this.sessao();
    if (s?.papel === 'admin') return;
    if (!pin || (await sha256(pin)) !== db.pin_hash) throw new ErroNegocio('PIN incorreto.');
  }

  private async ator(): Promise<'terminal' | 'admin'> {
    return (await this.sessao())?.papel === 'admin' ? 'admin' : 'terminal';
  }

  private audit(db: DB, ator: 'terminal' | 'admin', acao: string, entidade: string, entidade_id: string | null, dados: unknown) {
    db.auditoria.push({ id: uid(), ator, acao, entidade, entidade_id, dados, criado_em: agora() });
  }

  private estoque(db: DB, produtoId: string) {
    return db.movimentos.filter((m) => m.produto_id === produtoId).reduce((s, m) => s + m.quantidade, 0);
  }

  // ---------- Sessão
  async sessao(): Promise<Sessao | null> {
    const raw = sessionStorage.getItem(KEY_SESSAO);
    return raw ? JSON.parse(raw) : { papel: 'terminal', email: null };
  }
  async entrar(email: string, senha: string): Promise<Sessao> {
    if (senha !== 'demo') throw new ErroNegocio('No modo demonstração, a senha é "demo".');
    const s: Sessao = { papel: 'admin', email };
    sessionStorage.setItem(KEY_SESSAO, JSON.stringify(s));
    return s;
  }
  async sair() {
    sessionStorage.removeItem(KEY_SESSAO);
  }

  // ---------- Config
  config() {
    return this.ler((db) => db.config);
  }
  async salvarConfig(c: ConfigLoja) {
    const ator = await this.ator();
    await this.tx((db) => {
      db.config = c;
      this.audit(db, ator, 'alterar_config', 'config_loja', null, c);
    });
  }
  async trocarPin(novoPin: string) {
    if (!/^\d{4}$/.test(novoPin)) throw new ErroNegocio('O PIN tem 4 dígitos.');
    const h = await sha256(novoPin);
    const ator = await this.ator();
    await this.tx((db) => {
      db.pin_hash = h;
      this.audit(db, ator, 'trocar_pin', 'config_loja', null, null);
    });
  }
  async conferirPin(pin: string) {
    await this.pronto;
    return (await sha256(pin)) === this.db.pin_hash;
  }

  // ---------- Produtos
  produtos() {
    return this.ler((db) => {
      const vendidos = new Map<string, number>();
      db.vendas.filter((v) => v.status === 'concluida').forEach((v) => v.itens.forEach((i) => vendidos.set(i.produto_id, (vendidos.get(i.produto_id) ?? 0) + i.quantidade)));
      return db.produtos.map((p) => ({ ...p, estoque_atual: this.estoque(db, p.id), vendidos: vendidos.get(p.id) ?? 0 }));
    });
  }

  async salvarProduto(p: NovoProduto & { id?: string }, pin?: string): Promise<Produto> {
    const ator = await this.ator();
    return this.tx(async (db) => {
      const cod = p.codigo_barras?.trim() || null;
      if (cod && db.produtos.some((x) => x.codigo_barras === cod && x.id !== p.id)) throw new ErroNegocio('Já existe um produto com esse código.');
      if (!p.nome.trim()) throw new ErroNegocio('Informe o nome do produto.');
      if (p.preco_venda <= 0) throw new ErroNegocio('Informe o preço.');
      let row = p.id ? db.produtos.find((x) => x.id === p.id) : undefined;
      if (row) {
        if (row.preco_venda !== p.preco_venda) {
          if (ator !== 'admin') await this.exigirPin(db, pin);
          this.audit(db, ator, 'alterar_preco', 'produtos', row.id, { de: row.preco_venda, para: p.preco_venda });
        }
        Object.assign(row, {
          nome: p.nome.trim(), marca: p.marca ?? row.marca, categoria: p.categoria ?? row.categoria, volume_ml: p.volume_ml ?? row.volume_ml,
          codigo_barras: cod, preco_venda: p.preco_venda, estoque_minimo: p.estoque_minimo ?? row.estoque_minimo, ativo: p.ativo ?? row.ativo, foto_url: p.foto_url ?? row.foto_url,
        });
      } else {
        db.seq_interno += 1;
        row = {
          id: uid(), nome: p.nome.trim(), marca: p.marca ?? null, categoria: p.categoria ?? null, volume_ml: p.volume_ml ?? null, codigo_barras: cod,
          codigo_interno: gerarCodigoInterno(db.seq_interno), preco_venda: p.preco_venda, custo_medio: 0, estoque_minimo: p.estoque_minimo ?? 1,
          foto_url: p.foto_url ?? null, ativo: p.ativo ?? true,
        };
        db.produtos.push(row);
      }
      return { ...row, estoque_atual: this.estoque(db, row.id) };
    });
  }

  movimentos(produtoId: string) {
    return this.ler((db) => db.movimentos.filter((m) => m.produto_id === produtoId).sort((a, b) => b.criado_em.localeCompare(a.criado_em)));
  }

  async registrarEntrada(itens: ItemEntrada[]) {
    await this.tx((db) => {
      if (itens.length === 0) throw new ErroNegocio('Nenhum produto na lista.');
      const compra = uid();
      for (const it of itens) {
        if (it.quantidade <= 0) throw new ErroNegocio('Quantidade inválida.');
        const p = db.produtos.find((x) => x.id === it.produto_id);
        if (!p) throw new ErroNegocio('Produto não encontrado.');
        p.custo_medio = novoCustoMedio(this.estoque(db, p.id), p.custo_medio, it.quantidade, it.custo_unitario);
        db.movimentos.push({ id: uid(), produto_id: p.id, tipo: 'entrada', quantidade: it.quantidade, custo_unitario: it.custo_unitario, origem_id: compra, motivo: null, criado_em: agora() });
      }
    });
  }

  async ajustarEstoque(produtoId: string, quantidade: number, motivo: string, pin?: string) {
    const ator = await this.ator();
    await this.tx(async (db) => {
      await this.exigirPin(db, pin);
      if (!motivo) throw new ErroNegocio('Informe o motivo.');
      if (quantidade === 0) throw new ErroNegocio('Quantidade inválida.');
      const id = uid();
      db.movimentos.push({ id, produto_id: produtoId, tipo: 'ajuste', quantidade, custo_unitario: null, origem_id: null, motivo, criado_em: agora() });
      this.audit(db, ator, 'ajustar_estoque', 'produtos', produtoId, { quantidade, motivo });
    });
  }

  async registrarContagem(itens: { produto_id: string; contado: number }[], pin?: string) {
    const ator = await this.ator();
    return this.tx(async (db) => {
      await this.exigirPin(db, pin);
      if (!itens.length) throw new ErroNegocio('Nenhum produto contado.');
      const detalhes: { produto_id: string; de: number; para: number }[] = [];
      for (const i of itens) {
        if (!Number.isInteger(i.contado) || i.contado < 0) throw new ErroNegocio('Quantidade contada inválida.');
        const atual = this.estoque(db, i.produto_id);
        if (i.contado === atual) continue;
        db.movimentos.push({ id: uid(), produto_id: i.produto_id, tipo: 'ajuste', quantidade: i.contado - atual, custo_unitario: null, origem_id: null, motivo: 'contagem', criado_em: agora() });
        detalhes.push({ produto_id: i.produto_id, de: atual, para: i.contado });
      }
      this.audit(db, ator, 'contagem_estoque', 'produtos', null, { contados: itens.length, ajustados: detalhes.length, itens: detalhes });
      return detalhes.length;
    });
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
  buscarClientes(q: string) {
    const t = q.trim().toLowerCase();
    const dig = t.replace(/\D/g, '');
    return this.ler((db) =>
      db.clientes
        .filter((c) => c.ativo && (c.nome.toLowerCase().includes(t) || (dig.length >= 3 && c.telefone.replace(/\D/g, '').includes(dig))))
        .sort((a, b) => a.nome.localeCompare(b.nome))
        .slice(0, 12),
    );
  }
  ultimasClientes(n: number) {
    return this.ler((db) =>
      db.clientes.filter((c) => c.ativo && c.ultima_compra_em).sort((a, b) => (b.ultima_compra_em ?? '').localeCompare(a.ultima_compra_em ?? '')).slice(0, n),
    );
  }
  async cliente(id: string) {
    const c = await this.ler((db) => db.clientes.find((x) => x.id === id));
    if (!c) throw new ErroNegocio('Cliente não encontrada.');
    return c;
  }
  async salvarCliente(c: NovaCliente & { id?: string }) {
    return this.tx((db) => {
      if (!c.nome.trim() || c.telefone.replace(/\D/g, '').length < 8) throw new ErroNegocio('Nome e telefone são obrigatórios.');
      let row = c.id ? db.clientes.find((x) => x.id === c.id) : undefined;
      if (row) {
        Object.assign(row, { ...c, nome: c.nome.trim() });
      } else {
        row = {
          id: uid(), nome: c.nome.trim(), telefone: c.telefone, endereco: c.endereco ?? null, bairro: c.bairro ?? null, referencia: c.referencia ?? null,
          observacoes: c.observacoes ?? null, limite_credito: c.limite_credito ?? null, ativo: true, ultima_compra_em: null,
        };
        db.clientes.push(row);
      }
      return row;
    });
  }

  private parcelasDe(db: DB, clienteId: string): Parcela[] {
    return db.parcelas
      .filter((p) => p.cliente_id === clienteId)
      .map((p) => ({ ...p, venda_numero: db.vendas.find((v) => v.id === p.venda_id)?.numero ?? 0 }))
      .sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.numero - b.numero);
  }

  private situacao(db: DB, clienteId: string): SituacaoCliente {
    const hoje = hojeISO();
    const abertas = this.parcelasDe(db, clienteId).filter((p) => p.status === 'aberta' || p.status === 'parcial');
    const vencidas = abertas.filter((p) => p.vencimento < hoje);
    return {
      devido: abertas.reduce((s, p) => s + p.valor - p.valor_pago, 0),
      vencido: vencidas.reduce((s, p) => s + p.valor - p.valor_pago, 0),
      qtd_atrasadas: vencidas.length,
      parcelas: abertas,
    };
  }

  situacaoCliente(id: string) {
    return this.ler((db) => this.situacao(db, id));
  }

  private montarVenda(db: DB, v: VendaRow): Venda {
    const c = db.clientes.find((x) => x.id === v.cliente_id)!;
    return {
      ...v,
      cliente: { nome: c.nome, telefone: c.telefone, endereco: c.endereco, bairro: c.bairro, referencia: c.referencia },
      parcelas: db.parcelas.filter((p) => p.venda_id === v.id).sort((a, b) => a.numero - b.numero).map((p) => ({ numero: p.numero, valor: p.valor, vencimento: p.vencimento })),
      saldo_cliente: this.situacao(db, v.cliente_id).devido,
    };
  }

  vendasCliente(id: string) {
    return this.ler((db) => db.vendas.filter((v) => v.cliente_id === id).sort((a, b) => b.numero - a.numero).map((v) => this.montarVenda(db, v)));
  }

  async importarClientes(linhas: (NovaCliente & { saldo_aberto?: Centavos; vencimento?: string })[]) {
    let n = 0;
    for (const l of linhas) {
      const c = await this.salvarCliente(l);
      if (l.saldo_aberto && l.saldo_aberto > 0) {
        await this.tx((db) => {
          db.seq_venda += 1;
          const vid = uid();
          db.vendas.push({
            id: vid, numero: db.seq_venda, cliente_id: c.id, status: 'concluida', subtotal: l.saldo_aberto!, desconto: 0, total: l.saldo_aberto!, para_entrega: false,
            criada_em: agora(), cancelada_em: null, motivo_cancelamento: null, idempotency_key: uid(),
            itens: [{ produto_id: '', descricao: 'Saldo anterior (importado)', quantidade: 1, preco_unitario: l.saldo_aberto!, custo_unitario: 0 }],
            pagamentos: [{ forma: 'fiado', valor: l.saldo_aberto!, parcelas_cartao: null, taxa: 0, valor_liquido: l.saldo_aberto!, valor_recebido: null, troco: 0 }],
          });
          db.parcelas.push({ id: uid(), venda_id: vid, cliente_id: c.id, numero: 1, total_parcelas: 1, valor: l.saldo_aberto!, valor_pago: 0, vencimento: l.vencimento || hojeISO(), status: 'aberta' });
        });
      }
      n++;
    }
    return n;
  }

  // ---------- Vendas
  async finalizarVenda(p: FinalizarVendaPayload): Promise<Venda> {
    return this.tx((db) => {
      const existente = db.vendas.find((v) => v.idempotency_key === p.idempotency_key);
      if (existente) return this.montarVenda(db, existente);
      const erro = validarVenda(p);
      if (erro) throw new ErroNegocio(erro);
      const cli = db.clientes.find((c) => c.id === p.cliente_id);
      if (!cli) throw new ErroNegocio('Cliente não encontrada.');
      const subtotal = subtotalCarrinho(p.itens);
      const vendaId = uid();
      db.seq_venda += 1;
      const ts = agora();
      const venda: VendaRow = {
        id: vendaId, numero: db.seq_venda, cliente_id: cli.id, status: 'concluida', subtotal, desconto: p.desconto, total: subtotal - p.desconto,
        para_entrega: p.para_entrega, criada_em: ts, cancelada_em: null, motivo_cancelamento: null, idempotency_key: p.idempotency_key,
        itens: p.itens.map((i) => {
          const prod = db.produtos.find((x) => x.id === i.produto_id);
          return { ...i, custo_unitario: prod?.custo_medio ?? 0 };
        }),
        pagamentos: p.pagamentos.map((pg) => {
          // Cartão: taxa e líquido sobre o que passou na maquininha (com a taxa repassada).
          const cobrado = pg.forma === 'cartao' ? Math.max(pg.valor, pg.valor_recebido ?? pg.valor) : pg.valor;
          const taxa = pg.forma === 'cartao' ? taxaCartao(cobrado, pg.parcelas ?? 1, db.config.taxas_cartao)
            : pg.forma === 'debito' ? Math.round((pg.valor * db.config.taxa_debito) / 10000) : 0;
          return {
            forma: pg.forma, valor: pg.valor, parcelas_cartao: pg.forma === 'cartao' ? pg.parcelas ?? 1 : null, taxa, valor_liquido: cobrado - taxa,
            valor_recebido: pg.forma === 'dinheiro' ? pg.valor_recebido ?? pg.valor : pg.forma === 'cartao' ? cobrado : null,
            troco: pg.forma === 'dinheiro' ? Math.max(0, (pg.valor_recebido ?? pg.valor) - pg.valor) : 0,
            acrescimo: cobrado - pg.valor,
          };
        }),
      };
      db.vendas.push(venda);
      for (const i of p.itens) {
        db.movimentos.push({ id: uid(), produto_id: i.produto_id, tipo: 'venda', quantidade: -i.quantidade, custo_unitario: null, origem_id: vendaId, motivo: null, criado_em: ts });
      }
      for (const pg of p.pagamentos.filter((x) => x.forma === 'fiado')) {
        for (const parc of dividirParcelas(pg.valor, pg.parcelas!, pg.primeiro_vencimento!)) {
          db.parcelas.push({ id: uid(), venda_id: vendaId, cliente_id: cli.id, numero: parc.numero, total_parcelas: pg.parcelas!, valor: parc.valor, valor_pago: 0, vencimento: parc.vencimento, status: 'aberta' });
        }
      }
      // Se houver mais de um pagamento no fiado, renumera as parcelas em sequência.
      const ps = db.parcelas.filter((x) => x.venda_id === vendaId).sort((a, b) => a.vencimento.localeCompare(b.vencimento));
      ps.forEach((x, i) => { x.numero = i + 1; x.total_parcelas = ps.length; });
      cli.ultima_compra_em = ts;
      return this.montarVenda(db, venda);
    });
  }

  async venda(id: string) {
    const v = await this.ler((db) => {
      const row = db.vendas.find((x) => x.id === id);
      return row ? this.montarVenda(db, row) : null;
    });
    if (!v) throw new ErroNegocio('Venda não encontrada.');
    return v;
  }

  vendas(filtro: { desde?: string; ate?: string; limite?: number }) {
    return this.ler((db) =>
      db.vendas
        .filter((v) => (!filtro.desde || diaLocal(v.criada_em) >= filtro.desde) && (!filtro.ate || diaLocal(v.criada_em) <= filtro.ate))
        .sort((a, b) => b.numero - a.numero)
        .slice(0, filtro.limite ?? 200)
        .map((v) => this.montarVenda(db, v)),
    );
  }

  async cancelarVenda(id: string, motivo: string, pin?: string) {
    const ator = await this.ator();
    await this.tx(async (db) => {
      await this.exigirPin(db, pin);
      if (!motivo.trim()) throw new ErroNegocio('Informe o motivo.');
      const v = db.vendas.find((x) => x.id === id);
      if (!v) throw new ErroNegocio('Venda não encontrada.');
      if (v.status === 'cancelada') throw new ErroNegocio('Essa venda já está cancelada.');
      const parcs = db.parcelas.filter((p) => p.venda_id === id);
      if (parcs.some((p) => p.valor_pago > 0)) throw new ErroNegocio('Essa venda tem parcela com pagamento. Estorne o recebimento primeiro.');
      const ts = agora();
      v.status = 'cancelada';
      v.cancelada_em = ts;
      v.motivo_cancelamento = motivo;
      parcs.forEach((p) => (p.status = 'cancelada'));
      for (const i of v.itens.filter((x) => x.produto_id)) {
        db.movimentos.push({ id: uid(), produto_id: i.produto_id, tipo: 'cancelamento', quantidade: i.quantidade, custo_unitario: null, origem_id: id, motivo, criado_em: ts });
      }
      this.audit(db, ator, 'cancelar_venda', 'vendas', id, { numero: v.numero, motivo });
    });
  }

  // ---------- Fiado
  async registrarRecebimento(clienteId: string, pagamentos: { forma: FormaRecebimento; valor: Centavos }[]): Promise<Recibo> {
    return this.tx((db) => {
      const total = pagamentos.reduce((s, p) => s + p.valor, 0);
      if (pagamentos.some((p) => p.valor <= 0)) throw new ErroNegocio('Valor inválido.');
      const parcs = db.parcelas.filter((p) => p.cliente_id === clienteId);
      const abat = alocarRecebimento(parcs, total);
      const grupo = uid();
      const ts = agora();
      const recs = pagamentos.map((p) => ({ id: uid(), grupo_id: grupo, cliente_id: clienteId, valor: p.valor, forma: p.forma, recebido_em: ts, estornado: false }));
      db.recebimentos.push(...recs);
      // Distribui os abatimentos entre as linhas de recebimento, na ordem.
      let ri = 0;
      let restaRec = recs[0].valor;
      for (const a of abat) {
        let restaAb = a.valor;
        while (restaAb > 0) {
          const v = Math.min(restaAb, restaRec);
          db.recebimento_parcelas.push({ recebimento_id: recs[ri].id, parcela_id: a.parcela_id, valor: v });
          restaAb -= v;
          restaRec -= v;
          if (restaRec === 0 && ri < recs.length - 1) restaRec = recs[++ri].valor;
        }
        const p = db.parcelas.find((x) => x.id === a.parcela_id)!;
        p.valor_pago += a.valor;
        p.status = p.valor_pago >= p.valor ? 'paga' : 'parcial';
      }
      const c = db.clientes.find((x) => x.id === clienteId)!;
      return {
        grupo_id: grupo,
        cliente: { nome: c.nome, telefone: c.telefone },
        recebido_em: ts,
        pagamentos,
        total,
        abatimentos: abat.map((a) => {
          const p = db.parcelas.find((x) => x.id === a.parcela_id)!;
          return { venda_numero: db.vendas.find((v) => v.id === p.venda_id)?.numero ?? 0, numero: p.numero, total_parcelas: p.total_parcelas, vencimento: p.vencimento, valor: a.valor, quitada: a.quitada };
        }),
        saldo_restante: this.situacao(db, clienteId).devido,
      };
    });
  }

  recebimentos(filtro: { desde?: string; clienteId?: string }) {
    return this.ler((db) =>
      db.recebimentos
        .filter((r) => (!filtro.desde || diaLocal(r.recebido_em) >= filtro.desde) && (!filtro.clienteId || r.cliente_id === filtro.clienteId))
        .sort((a, b) => b.recebido_em.localeCompare(a.recebido_em))
        .map((r) => ({ ...r, cliente_nome: db.clientes.find((c) => c.id === r.cliente_id)?.nome ?? '' })) as Recebimento[],
    );
  }

  async estornarRecebimento(grupoId: string, motivo: string, pin?: string) {
    const ator = await this.ator();
    await this.tx(async (db) => {
      await this.exigirPin(db, pin);
      const recs = db.recebimentos.filter((r) => r.grupo_id === grupoId && !r.estornado);
      if (recs.length === 0) throw new ErroNegocio('Recebimento não encontrado ou já estornado.');
      for (const r of recs) {
        r.estornado = true;
        for (const rp of db.recebimento_parcelas.filter((x) => x.recebimento_id === r.id)) {
          const p = db.parcelas.find((x) => x.id === rp.parcela_id)!;
          p.valor_pago -= rp.valor;
          if (p.status !== 'cancelada') p.status = p.valor_pago <= 0 ? 'aberta' : 'parcial';
        }
      }
      this.audit(db, ator, 'estornar_recebimento', 'recebimentos', grupoId, { motivo, valor: recs.reduce((s, r) => s + r.valor, 0) });
    });
  }

  resumoReceber(): Promise<ResumoReceber> {
    return this.ler((db) => {
      const hoje = hojeISO();
      const em7 = addDias(hoje, 7);
      const em30 = addDias(hoje, 30);
      const abertas = db.parcelas.filter((p) => p.status === 'aberta' || p.status === 'parcial');
      const resto = (p: ParcelaRow) => p.valor - p.valor_pago;
      const porCliente = new Map<string, { devido: number; vencido: number; maisAntiga: string | null }>();
      for (const p of abertas) {
        const e = porCliente.get(p.cliente_id) ?? { devido: 0, vencido: 0, maisAntiga: null };
        e.devido += resto(p);
        if (p.vencimento < hoje) {
          e.vencido += resto(p);
          if (!e.maisAntiga || p.vencimento < e.maisAntiga) e.maisAntiga = p.vencimento;
        }
        porCliente.set(p.cliente_id, e);
      }
      return {
        total_aberto: abertas.reduce((s, p) => s + resto(p), 0),
        total_vencido: abertas.filter((p) => p.vencimento < hoje).reduce((s, p) => s + resto(p), 0),
        a_vencer_7: abertas.filter((p) => p.vencimento >= hoje && p.vencimento <= em7).reduce((s, p) => s + resto(p), 0),
        a_vencer_30: abertas.filter((p) => p.vencimento >= hoje && p.vencimento <= em30).reduce((s, p) => s + resto(p), 0),
        clientes: [...porCliente.entries()]
          .map(([id, e]) => {
            const c = db.clientes.find((x) => x.id === id)!;
            return { cliente_id: id, nome: c.nome, telefone: c.telefone, devido: e.devido, vencido: e.vencido, dias_atraso: e.maisAntiga ? diasEntre(e.maisAntiga, hoje) : 0 };
          })
          .sort((a, b) => b.dias_atraso - a.dias_atraso || b.devido - a.devido),
      };
    });
  }

  // ---------- Admin
  painel(desde: string, ate: string): Promise<Painel> {
    return this.ler((db) => {
      const vs = db.vendas.filter((v) => v.status === 'concluida' && diaLocal(v.criada_em) >= desde && diaLocal(v.criada_em) <= ate);
      const por_forma = { cartao: 0, pix: 0, dinheiro: 0, fiado: 0, debito: 0 };
      vs.forEach((v) => v.pagamentos.forEach((p) => (por_forma[p.forma] += p.valor)));
      const recebido_fiado = db.recebimentos.filter((r) => !r.estornado && diaLocal(r.recebido_em) >= desde && diaLocal(r.recebido_em) <= ate).reduce((s, r) => s + r.valor, 0);
      const acrescimo_cartao = vs.reduce((s, v) => s + v.pagamentos.reduce((t, p) => t + (p.acrescimo ?? 0), 0), 0);
      return { vendas_qtd: vs.length, vendido: vs.reduce((s, v) => s + v.total, 0), por_forma, recebido_fiado, acrescimo_cartao };
    });
  }

  auditoria(limite: number) {
    return this.ler((db) => [...db.auditoria].reverse().slice(0, limite));
  }

  exportar(tabela: 'vendas' | 'venda_itens' | 'clientes' | 'parcelas' | 'produtos') {
    return this.ler((db): Record<string, unknown>[] => {
      switch (tabela) {
        case 'vendas':
          return db.vendas.map(({ itens: _i, pagamentos, ...v }) => ({ ...v, cliente: db.clientes.find((c) => c.id === v.cliente_id)?.nome, formas: pagamentos.map((p) => `${p.forma}:${p.valor}`).join(' ') }));
        case 'venda_itens':
          return db.vendas.flatMap((v) => v.itens.map((i) => ({ venda_numero: v.numero, status: v.status, ...i })));
        case 'clientes':
          return db.clientes.map((c) => ({ ...c }));
        case 'parcelas':
          return db.parcelas.map((p) => ({ ...p, cliente: db.clientes.find((c) => c.id === p.cliente_id)?.nome }));
        case 'produtos':
          return db.produtos.map((p) => ({ ...p, estoque_atual: this.estoque(db, p.id) }));
      }
    });
  }
}

