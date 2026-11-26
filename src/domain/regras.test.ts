import { describe, expect, it } from 'vitest';
import { alocarRecebimento, aplicarValor, dividirParcelas, novoCustoMedio, taxaCartao, validarVenda } from './regras';
import { addMeses } from '../lib/dates';
import { brl, parseBRL } from '../lib/money';

describe('dinheiro', () => {
  it('formata e lê valores em centavos', () => {
    expect(brl(50000)).toBe('R$ 500,00');
    expect(brl(123456)).toBe('R$ 1.234,56');
    expect(parseBRL('129,9')).toBe(12990);
    expect(parseBRL('20')).toBe(2000);
    expect(parseBRL('')).toBe(0);
  });
});

describe('dividirParcelas (RF-14)', () => {
  it('divide em partes iguais e joga os centavos na última', () => {
    const p = dividirParcelas(10000, 3, '2026-12-26');
    expect(p.map((x) => x.valor)).toEqual([3333, 3333, 3334]);
    expect(p.map((x) => x.vencimento)).toEqual(['2026-12-26', '2027-01-26', '2027-02-26']);
  });
  it('ajusta o fim do mês', () => {
    expect(addMeses('2027-01-31', 1)).toBe('2027-02-28');
  });
});

describe('aplicarValor (RF-12)', () => {
  it('limita ao que falta, exceto dinheiro que gera troco', () => {
    expect(aplicarValor('pix', 20000, 15000)).toEqual({ aplicado: 15000, troco: 0 });
    expect(aplicarValor('dinheiro', 20000, 15000)).toEqual({ aplicado: 15000, troco: 5000 });
  });
});

describe('taxaCartao (RF-13)', () => {
  it('aplica a taxa por parcelas', () => {
    expect(taxaCartao(10000, 1, { '1': 349 })).toBe(349);
    expect(taxaCartao(10000, 2, { '1': 349 })).toBe(0);
  });
});

describe('alocarRecebimento (RF-41)', () => {
  const parcelas = [
    { id: 'b', numero: 1, valor: 10000, valor_pago: 0, vencimento: '2026-12-26', status: 'aberta' as const },
    { id: 'a', numero: 2, valor: 6000, valor_pago: 0, vencimento: '2026-11-10', status: 'aberta' as const },
    { id: 'c', numero: 2, valor: 10000, valor_pago: 0, vencimento: '2027-01-26', status: 'aberta' as const },
  ];
  it('abate da mais antiga para a mais nova', () => {
    expect(alocarRecebimento(parcelas, 10000)).toEqual([
      { parcela_id: 'a', valor: 6000, quitada: true },
      { parcela_id: 'b', valor: 4000, quitada: false },
    ]);
  });
  it('recusa valor acima do devido', () => {
    expect(() => alocarRecebimento(parcelas, 26001)).toThrow();
  });
});

describe('custo médio (RF-21)', () => {
  it('pondera pelo estoque', () => {
    expect(novoCustoMedio(2, 5000, 2, 7000)).toBe(6000);
    expect(novoCustoMedio(-1, 5000, 3, 7000)).toBe(7000);
  });
});

describe('validarVenda (RF-16)', () => {
  const base = {
    idempotency_key: 'k',
    cliente_id: 'c1',
    itens: [{ produto_id: 'p', descricao: 'X', quantidade: 2, preco_unitario: 25000 }],
    desconto: 0,
    para_entrega: false,
  };
  it('exige cliente e soma igual ao total', () => {
    expect(validarVenda({ ...base, cliente_id: '', pagamentos: [{ forma: 'pix', valor: 50000 }] })).toMatch(/cliente/);
    expect(validarVenda({ ...base, pagamentos: [{ forma: 'pix', valor: 40000 }] })).toMatch(/soma/);
    expect(
      validarVenda({
        ...base,
        pagamentos: [
          { forma: 'pix', valor: 15000 },
          { forma: 'dinheiro', valor: 15000, valor_recebido: 20000 },
          { forma: 'fiado', valor: 20000, parcelas: 2, primeiro_vencimento: '2026-12-26' },
        ],
      }),
    ).toBeNull();
  });
});

import { lerCSV } from '../lib/csv';
describe('lerCSV', () => {
  it('lê ponto e vírgula, aspas e acentos no cabeçalho', () => {
    expect(lerCSV('Nome;Preço;Código de barras\n"Âmbar; 100 ml";189,90;789\n')).toEqual([{ nome: 'Âmbar; 100 ml', preco: '189,90', codigo_de_barras: '789' }]);
  });
});
