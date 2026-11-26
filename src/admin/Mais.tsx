import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { backend } from '../data';
import { LocalBackend } from '../data/local';
import type { ConfigLoja, FormaPagamento } from '../domain/types';
import { NOME_FORMA } from '../domain/types';
import { brl, parseBRL, toInput } from '../lib/money';
import { dataHoraBR, hojeISO } from '../lib/dates';
import { VERSAO, errosRegistrados, mensagem } from '../lib/erros';
import { baixar, gerarCSV } from '../lib/csv';
import { useConfig } from '../terminal/dados';
import { B, Campo, Card, Erro, Linha, Ok } from './ui';

export default function Mais() {
  const qc = useQueryClient();
  return (
    <>
      <h1 className="m-0 text-[22px]">Mais</h1>
      <Configuracoes />
      <TrocarPin />
      <Exportar />
      <AuditoriaCard />
      <ErrosCard />
      <Card titulo="Sessão">
        <span className="text-[13px] text-suave">Versão do app {VERSAO} · dados: {backend.modo === 'demo' ? 'modo demonstração (navegador)' : 'Supabase'}</span>
        <B onClick={async () => { await backend.sair(); qc.invalidateQueries(); }}>Sair</B>
        {backend.modo === 'demo' && (
          <B variante="perigo" onClick={() => { if (confirm('Apagar os dados de demonstração e começar de novo?')) { LocalBackend.resetar(); location.href = '/admin'; } }}>
            Recomeçar demonstração
          </B>
        )}
      </Card>
    </>
  );
}

/** RF-61: configurações. */
function Configuracoes() {
  const qc = useQueryClient();
  const atual = useConfig();
  const [c, setC] = useState<ConfigLoja>(atual);
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState('');
  useEffect(() => setC(atual), [atual]);
  const set = (k: keyof ConfigLoja) => (e: React.ChangeEvent<HTMLInputElement>) => setC((v) => ({ ...v, [k]: e.target.value }));
  const ano = hojeISO().slice(0, 4);
  const salvar = async () => {
    setErro('');
    setOk('');
    try {
      await backend.salvarConfig(c);
      qc.invalidateQueries({ queryKey: ['config'] });
      setOk('Configurações salvas.');
    } catch (e) {
      setErro(mensagem(e));
    }
  };
  const toggleForma = (f: FormaPagamento) => setC((v) => ({ ...v, formas_ativas: v.formas_ativas.includes(f) ? v.formas_ativas.filter((x) => x !== f) : [...v.formas_ativas, f] }));
  return (
    <Card titulo="Configurações da loja">
      <Campo rotulo="Nome da loja" value={c.nome} onChange={set('nome')} />
      <div className="grid grid-cols-2 gap-2">
        <Campo rotulo="Telefone" value={c.telefone} onChange={set('telefone')} />
        <Campo rotulo="Instagram" value={c.instagram} onChange={set('instagram')} />
      </div>
      <Campo rotulo="Mensagem do rodapé do cupom" value={c.rodape_cupom} onChange={set('rodape_cupom')} />
      <span className="text-[13px] font-bold text-suave">Formas de pagamento no terminal</span>
      <div className="flex flex-wrap gap-2">
        {(['cartao', 'pix', 'dinheiro', 'fiado', 'debito'] as FormaPagamento[]).map((f) => (
          <label key={f} className="flex items-center gap-1.5 rounded-xl border-2 border-borda bg-white px-3 py-2 text-[14px]">
            <input type="checkbox" checked={c.formas_ativas.includes(f)} onChange={() => toggleForma(f)} />{NOME_FORMA[f]}
          </label>
        ))}
      </div>
      <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" checked={c.vias_fiado} onChange={(e) => setC((v) => ({ ...v, vias_fiado: e.target.checked }))} /> Imprimir via da loja no fiado (com assinatura)</label>
      <div className="grid grid-cols-2 gap-2">
        <Campo rotulo="Máx. de parcelas no fiado" inputMode="numeric" value={String(c.fiado_max_parcelas)} onChange={(e) => setC((v) => ({ ...v, fiado_max_parcelas: Math.max(1, Math.min(12, parseInt(e.target.value || '1', 10))) }))} />
        <Campo rotulo={`Teto do MEI ${ano} (R$)`} inputMode="decimal" value={c.teto_mei[ano] != null ? toInput(c.teto_mei[ano]) : ''}
          onChange={(e) => setC((v) => ({ ...v, teto_mei: { ...v.teto_mei, [ano]: parseBRL(e.target.value) } }))} />
      </div>
      <span className="text-[13px] font-bold text-suave">Taxas da maquininha (% por número de parcelas)</span>
      <div className="grid grid-cols-4 gap-2">
        <Campo rotulo="Débito" inputMode="decimal" value={(c.taxa_debito / 100).toString().replace('.', ',')} onChange={(e) => setC((v) => ({ ...v, taxa_debito: Math.round(parseFloat(e.target.value.replace(',', '.') || '0') * 100) }))} />
        {Array.from({ length: 12 }, (_, i) => String(i + 1)).map((n) => (
          <Campo key={n} rotulo={`${n}×`} inputMode="decimal" value={((c.taxas_cartao[n] ?? 0) / 100).toString().replace('.', ',')}
            onChange={(e) => setC((v) => ({ ...v, taxas_cartao: { ...v.taxas_cartao, [n]: Math.round(parseFloat(e.target.value.replace(',', '.') || '0') * 100) } }))} />
        ))}
      </div>
      <span className="text-[12px] text-suave">Exemplo: R$ 100,00 em 1× com {(c.taxas_cartao['1'] ?? 0) / 100}% → líquido {brl(10000 - Math.round(10000 * (c.taxas_cartao['1'] ?? 0) / 10000))}</span>
      <Erro>{erro}</Erro>
      <Ok>{ok}</Ok>
      <B variante="primario" onClick={salvar}>Salvar configurações</B>
    </Card>
  );
}

function TrocarPin() {
  const [pin, setPin] = useState('');
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState('');
  const trocar = async () => {
    setErro('');
    setOk('');
    try {
      await backend.trocarPin(pin);
      setPin('');
      setOk('PIN do terminal trocado.');
    } catch (e) {
      setErro(mensagem(e));
    }
  };
  return (
    <Card titulo="PIN do terminal">
      <span className="text-[13px] text-suave">Pedido no terminal para cancelar venda, ajustar estoque, mudar preço e estornar recebimento.{backend.modo === 'demo' ? ' No modo demonstração, o PIN inicial é 1234.' : ''}</span>
      <div className="flex gap-2">
        <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" placeholder="Novo PIN (4 números)" type="password"
          className="min-h-11 flex-1 rounded-xl border-2 border-borda px-3 text-[16px]" />
        <B variante="primario" disabled={pin.length !== 4} onClick={trocar}>Trocar</B>
      </div>
      <Erro>{erro}</Erro>
      <Ok>{ok}</Ok>
    </Card>
  );
}

/** RF-63: exportação em CSV. */
function Exportar() {
  const [erro, setErro] = useState('');
  const tabelas = [['vendas', 'Vendas'], ['venda_itens', 'Itens vendidos'], ['clientes', 'Clientes'], ['parcelas', 'Parcelas'], ['produtos', 'Estoque']] as const;
  return (
    <Card titulo="Exportar CSV">
      <div className="grid grid-cols-2 gap-2">
        {tabelas.map(([t, n]) => (
          <B key={t} onClick={async () => {
            try {
              baixar(`${t}-${hojeISO()}.csv`, gerarCSV(await backend.exportar(t)));
            } catch (e) {
              setErro(mensagem(e));
            }
          }}>{n}</B>
        ))}
      </div>
      <Erro>{erro}</Erro>
    </Card>
  );
}

/** RF-64: auditoria. */
function AuditoriaCard() {
  const q = useQuery({ queryKey: ['auditoria'], queryFn: () => backend.auditoria(50) });
  return (
    <Card titulo="Auditoria (últimas 50)">
      {q.data?.length === 0 && <span className="text-[14px] text-suave">Nada registrado ainda.</span>}
      {q.data?.map((a) => (
        <Linha key={a.id} esq={`${a.acao.replace(/_/g, ' ')} · ${a.ator}`} sub={dataHoraBR(a.criado_em)}
          dir={<span className="max-w-[180px] truncate text-[12px] text-suave">{a.dados ? JSON.stringify(a.dados) : ''}</span>} />
      ))}
    </Card>
  );
}

/** RNF-10: erros registrados neste aparelho, com a versão. */
function ErrosCard() {
  const erros = errosRegistrados();
  return (
    <Card titulo="Erros registrados neste aparelho">
      {erros.length === 0 && <span className="text-[14px] text-suave">Nenhum erro.</span>}
      {erros.slice(0, 10).map((e, i) => <Linha key={i} esq={e.msg} sub={`${dataHoraBR(e.quando)} · v${e.versao} · ${e.origem} · ${e.url}`} />)}
    </Card>
  );
}
