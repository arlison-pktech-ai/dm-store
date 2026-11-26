import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';
import type { ConfigLoja, Recibo, Venda } from '../domain/types';
import { NOME_FORMA } from '../domain/types';
import { num } from '../lib/money';
import { dataBR, dataHoraBR } from '../lib/dates';
import { numeroVenda } from '../domain/regras';

let raiz: Root | null = null;

/**
 * Imprime sem janela (RF-50): o Chrome em quiosque com --kiosk-printing manda o window.print()
 * direto para a impressora padrão. O cupom é HTML com @page 80 mm (ver index.css).
 */
export function imprimir(conteudo: ReactNode) {
  const el = document.getElementById('print-root')!;
  raiz ??= createRoot(el);
  flushSync(() => raiz!.render(conteudo));
  // Dá um quadro para o layout e as fontes antes de imprimir.
  requestAnimationFrame(() => setTimeout(() => window.print(), 50));
}

const S = {
  papel: { width: '72mm', padding: '3mm 4mm', fontFamily: "'Atkinson Hyperlegible', Arial, sans-serif", color: '#000', fontSize: '13px', lineHeight: 1.35, display: 'flex', flexDirection: 'column', gap: '10px' } as const,
  centro: { textAlign: 'center', display: 'flex', flexDirection: 'column' } as const,
  linha: { display: 'flex', justifyContent: 'space-between', gap: '8px' } as const,
  tracejado: { borderTop: '2px dashed #000' } as const,
  valor: { whiteSpace: 'nowrap' } as const,
  quebra: { breakAfter: 'page' } as const,
};

function CabecalhoLoja({ cfg }: { cfg: ConfigLoja }) {
  return (
    <div style={S.centro}>
      <span style={{ fontSize: '19px', fontWeight: 700 }}>{cfg.nome}</span>
      <span style={{ fontSize: '12px' }}>{[cfg.telefone, cfg.instagram].filter(Boolean).join(' · ')}</span>
    </div>
  );
}

export function Cupom({ venda, cfg, reimpressao }: { venda: Venda; cfg: ConfigLoja; reimpressao?: boolean }) {
  const fiado = venda.pagamentos.find((p) => p.forma === 'fiado');
  const c = venda.cliente;
  return (
    <>
      <div style={S.papel}>
        <CabecalhoLoja cfg={cfg} />
        <div style={S.tracejado} />
        <div style={S.centro}>
          <span style={{ fontSize: '15px', fontWeight: 700 }}>COMPROVANTE DE VENDA</span>
          <span style={{ fontSize: '13px', fontWeight: 700 }}>SEM VALOR FISCAL</span>
          {reimpressao && <span style={{ fontSize: '12px' }}>(2ª via)</span>}
          {venda.status === 'cancelada' && <span style={{ fontSize: '15px', fontWeight: 700 }}>*** VENDA CANCELADA ***</span>}
        </div>
        {venda.para_entrega && (
          <div style={{ border: '3px solid #000', borderRadius: '6px', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '1px' }}>ENTREGA</span>
            <span style={{ fontSize: '23px', fontWeight: 700, lineHeight: 1.15 }}>{c.nome}</span>
            <span style={{ fontSize: '18px', fontWeight: 700 }}>{c.telefone}</span>
            {c.endereco && <span style={{ fontSize: '18px' }}>{c.endereco}</span>}
            {c.bairro && <span style={{ fontSize: '18px' }}>{c.bairro}</span>}
            {c.referencia && <span style={{ fontSize: '14px' }}>Ref.: {c.referencia}</span>}
          </div>
        )}
        <div style={{ ...S.linha, fontSize: '12px' }}><span>Venda nº {numeroVenda(venda.numero)}</span><span>{dataHoraBR(venda.criada_em)}</span></div>
        {!venda.para_entrega && <span style={{ fontSize: '12px' }}>Cliente: {c.nome}</span>}
        <div style={S.tracejado} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          {venda.itens.map((i, k) => (
            <div key={k} style={S.linha}>
              <span>{i.quantidade} × {i.descricao}{i.quantidade > 1 && <><br />({num(i.preco_unitario)} cada)</>}</span>
              <span style={S.valor}>{num(i.preco_unitario * i.quantidade)}</span>
            </div>
          ))}
        </div>
        <div style={S.tracejado} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {venda.desconto > 0 && <>
            <div style={S.linha}><span>Subtotal</span><span>{num(venda.subtotal)}</span></div>
            <div style={S.linha}><span>Desconto</span><span>− {num(venda.desconto)}</span></div>
          </>}
          <div style={{ ...S.linha, fontSize: '19px', fontWeight: 700 }}><span>TOTAL</span><span>R$ {num(venda.total)}</span></div>
        </div>
        <div style={S.tracejado} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span style={{ fontSize: '12px', fontWeight: 700 }}>PAGAMENTO</span>
          {venda.pagamentos.map((p, k) => (
            <div key={k}>
              <div style={S.linha}><span>{NOME_FORMA[p.forma]}{p.forma === 'cartao' && p.parcelas_cartao && p.parcelas_cartao > 1 ? ` ${p.parcelas_cartao}×` : ''}</span><span>{num(p.valor)}</span></div>
              {p.forma === 'dinheiro' && p.troco > 0 && <span style={{ fontSize: '12px' }}>recebido {num(p.valor_recebido ?? p.valor)} · troco {num(p.troco)}</span>}
            </div>
          ))}
        </div>
        {fiado && venda.parcelas.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontSize: '12px', fontWeight: 700 }}>FIADO · PARCELAS</span>
            {venda.parcelas.map((p) => (
              <div key={p.numero} style={S.linha}><span>{p.numero}/{venda.parcelas.length} · vence {dataBR(p.vencimento)}</span><span>{num(p.valor)}</span></div>
            ))}
            <div style={{ ...S.linha, marginTop: '4px', padding: '5px 7px', border: '2px solid #000', fontWeight: 700 }}>
              <span>Saldo devedor total</span><span>R$ {num(venda.saldo_cliente)}</span>
            </div>
          </div>
        )}
        <div style={S.tracejado} />
        {cfg.rodape_cupom && <span style={{ textAlign: 'center', fontSize: '14px' }}>{cfg.rodape_cupom}</span>}
      </div>
      {fiado && cfg.vias_fiado && venda.status === 'concluida' && (
        <div style={{ ...S.papel, breakBefore: 'page' }}>
          <span style={{ fontSize: '13px', fontWeight: 700, textAlign: 'center' }}>VIA DA LOJA · FIADO</span>
          <span>Venda nº {numeroVenda(venda.numero)} · {dataBR(venda.criada_em.slice(0, 10))}</span>
          <span>Cliente: {c.nome} · {c.telefone}</span>
          <span>Fiado: R$ {num(fiado.valor)} em {venda.parcelas.length} parcela{venda.parcelas.length > 1 ? 's' : ''} ({venda.parcelas.map((p) => `${num(p.valor)} em ${dataBR(p.vencimento)}`).join('; ')})</span>
          <span>Reconheço o débito acima.</span>
          <div style={{ height: '44px' }} />
          <div style={{ borderTop: '1.5px solid #000' }} />
          <span style={{ textAlign: 'center', fontSize: '13px' }}>Assinatura da cliente</span>
        </div>
      )}
    </>
  );
}

export function ReciboPagamento({ recibo, cfg }: { recibo: Recibo; cfg: ConfigLoja }) {
  return (
    <div style={S.papel}>
      <CabecalhoLoja cfg={cfg} />
      <div style={S.tracejado} />
      <div style={S.centro}>
        <span style={{ fontSize: '15px', fontWeight: 700 }}>RECIBO DE PAGAMENTO</span>
        <span style={{ fontSize: '13px', fontWeight: 700 }}>SEM VALOR FISCAL</span>
      </div>
      <span>{dataHoraBR(recibo.recebido_em)}</span>
      <span style={{ fontSize: '17px', fontWeight: 700 }}>{recibo.cliente.nome}</span>
      <span>{recibo.cliente.telefone}</span>
      <div style={S.tracejado} />
      <span style={{ fontSize: '12px', fontWeight: 700 }}>VALOR PAGO</span>
      {recibo.pagamentos.map((p, k) => <div key={k} style={S.linha}><span>{NOME_FORMA[p.forma]}</span><span>{num(p.valor)}</span></div>)}
      <div style={{ ...S.linha, fontSize: '19px', fontWeight: 700 }}><span>TOTAL PAGO</span><span>R$ {num(recibo.total)}</span></div>
      <div style={S.tracejado} />
      <span style={{ fontSize: '12px', fontWeight: 700 }}>PARCELAS ABATIDAS</span>
      {recibo.abatimentos.map((a, k) => (
        <div key={k} style={S.linha}>
          <span>Venda {numeroVenda(a.venda_numero)} · {a.numero}/{a.total_parcelas}<br />venc. {dataBR(a.vencimento)}{a.quitada ? ' · quitada' : ''}</span>
          <span style={S.valor}>{num(a.valor)}</span>
        </div>
      ))}
      <div style={{ ...S.linha, marginTop: '4px', padding: '5px 7px', border: '2px solid #000', fontWeight: 700 }}>
        <span>Saldo restante</span><span>R$ {num(recibo.saldo_restante)}</span>
      </div>
      <div style={S.tracejado} />
      {cfg.rodape_cupom && <span style={{ textAlign: 'center', fontSize: '14px' }}>{cfg.rodape_cupom}</span>}
    </div>
  );
}
