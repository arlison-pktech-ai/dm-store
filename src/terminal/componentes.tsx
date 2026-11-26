import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { backend } from '../data';
import type { Cliente, Produto } from '../domain/types';
import { Icone } from '../components/Icone';
import { Aviso, Botao, Janela, TecladoNumerico, TecladoTexto, aplicarTecla } from '../components/ui';
import { brl, parseBRL } from '../lib/money';
import { mensagem } from '../lib/erros';
import { somErro } from '../lib/som';

/** Campo exibido em letra grande; o teclado da tela escreve no campo ativo. */
export function CampoTela({ rotulo, valor, ativo, onToque, placeholder, grande }: { rotulo: string; valor: string; ativo: boolean; onToque: () => void; placeholder?: string; grande?: boolean }) {
  return (
    <button type="button" onClick={onToque}
      className={`flex min-h-[96px] flex-col items-start justify-center gap-1 rounded-[18px] border-4 bg-white px-6 text-left ${ativo ? 'border-azul bg-azul-claro' : 'border-borda'}`}>
      <span className="text-[22px] font-bold text-suave">{rotulo}</span>
      <span className={`${grande ? 'text-[44px]' : 'text-[34px]'} font-bold ${valor ? '' : 'text-suave/60'}`}>
        {valor || placeholder || ' '}{ativo && <span className="animate-pulse text-azul">|</span>}
      </span>
    </button>
  );
}

function mascaraTelefone(d: string) {
  const s = d.replace(/\D/g, '').slice(0, 11);
  if (s.length <= 2) return s.length ? `(${s}` : '';
  if (s.length <= 6) return `(${s.slice(0, 2)}) ${s.slice(2)}`;
  if (s.length <= 10) return `(${s.slice(0, 2)}) ${s.slice(2, 6)}-${s.slice(6)}`;
  return `(${s.slice(0, 2)}) ${s.slice(2, 7)}-${s.slice(7)}`;
}

/** Cadastro rápido de cliente (RF-30): nome e telefone; endereço só se for entrega. */
export function NovaClienteJanela({ nomeInicial = '', comEndereco, onSalva, onFechar }: { nomeInicial?: string; comEndereco?: boolean; onSalva: (c: Cliente) => void; onFechar: () => void }) {
  const digitos = nomeInicial.replace(/\D/g, '');
  const [f, setF] = useState({ nome: digitos.length >= 3 ? '' : nomeInicial, telefone: digitos.length >= 3 ? digitos : '', endereco: '', bairro: '', referencia: '' });
  const [campo, setCampo] = useState<keyof typeof f>(digitos.length >= 3 ? 'nome' : nomeInicial ? 'telefone' : 'nome');
  const [entrega, setEntrega] = useState(!!comEndereco);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const numerico = campo === 'telefone';

  const tecla = (t: string) => setF((v) => ({ ...v, [campo]: campo === 'telefone' ? aplicarTecla(v.telefone, t, { max: 11 }).replace(/\D/g, '') : aplicarTecla(v[campo], t) }));

  const salvar = async () => {
    setErro('');
    if (!f.nome.trim() || f.telefone.length < 10) {
      setErro('Preencha o nome e o telefone com DDD.');
      return;
    }
    setSalvando(true);
    try {
      const c = await backend.salvarCliente({
        nome: titulo(f.nome), telefone: mascaraTelefone(f.telefone),
        endereco: entrega ? titulo(f.endereco) || null : null, bairro: entrega ? titulo(f.bairro) || null : null, referencia: entrega ? f.referencia || null : null,
      });
      onSalva(c);
    } catch (e) {
      setErro(mensagem(e));
      setSalvando(false);
    }
  };

  return (
    <Janela titulo="Nova cliente" onFechar={onFechar} largura={1500}>
      <div className="grid grid-cols-2 gap-4">
        <CampoTela rotulo="Nome" valor={titulo(f.nome)} ativo={campo === 'nome'} onToque={() => setCampo('nome')} />
        <CampoTela rotulo="Telefone com DDD" valor={mascaraTelefone(f.telefone)} ativo={campo === 'telefone'} onToque={() => setCampo('telefone')} />
        {entrega && <>
          <CampoTela rotulo="Endereço" valor={titulo(f.endereco)} ativo={campo === 'endereco'} onToque={() => setCampo('endereco')} />
          <CampoTela rotulo="Bairro" valor={titulo(f.bairro)} ativo={campo === 'bairro'} onToque={() => setCampo('bairro')} />
          <CampoTela rotulo="Ponto de referência" valor={f.referencia} ativo={campo === 'referencia'} onToque={() => setCampo('referencia')} />
        </>}
        {!entrega && <Botao variante="contorno" icone="mais" onClick={() => { setEntrega(true); setCampo('endereco'); }}>É para entrega: pôr endereço</Botao>}
      </div>
      {numerico
        ? <TecladoNumerico semVirgula onTecla={tecla} className="h-[330px] w-[600px] self-center" />
        : <TecladoTexto onTecla={tecla} comArroba className="h-[330px]" />}
      {erro && <Aviso>{erro}</Aviso>}
      <Botao variante="concluir" grande icone="check" disabled={salvando} onClick={salvar}>Salvar e voltar</Botao>
    </Janela>
  );
}

/** Endereço para entrega (RF-15). */
export function EnderecoJanela({ cliente, onSalva, onFechar }: { cliente: Cliente; onSalva: (c: Cliente) => void; onFechar: () => void }) {
  const [f, setF] = useState({ endereco: cliente.endereco ?? '', bairro: cliente.bairro ?? '', referencia: cliente.referencia ?? '' });
  const [campo, setCampo] = useState<keyof typeof f>('endereco');
  const [erro, setErro] = useState('');
  const salvar = async () => {
    if (!f.endereco.trim()) return setErro('Digite o endereço.');
    try {
      onSalva(await backend.salvarCliente({ ...cliente, endereco: titulo(f.endereco), bairro: titulo(f.bairro) || null, referencia: f.referencia || null }));
    } catch (e) {
      setErro(mensagem(e));
    }
  };
  return (
    <Janela titulo={`Endereço de ${cliente.nome}`} onFechar={onFechar} largura={1500}>
      <div className="grid grid-cols-3 gap-4">
        <CampoTela rotulo="Endereço" valor={titulo(f.endereco)} ativo={campo === 'endereco'} onToque={() => setCampo('endereco')} />
        <CampoTela rotulo="Bairro" valor={titulo(f.bairro)} ativo={campo === 'bairro'} onToque={() => setCampo('bairro')} />
        <CampoTela rotulo="Ponto de referência" valor={f.referencia} ativo={campo === 'referencia'} onToque={() => setCampo('referencia')} />
      </div>
      <TecladoTexto onTecla={(t) => setF((v) => ({ ...v, [campo]: aplicarTecla(v[campo], t) }))} comArroba className="h-[360px]" />
      {erro && <Aviso>{erro}</Aviso>}
      <Botao variante="concluir" grande icone="check" onClick={salvar}>Salvar endereço</Botao>
    </Janela>
  );
}

/** RF-07: código não cadastrado → cadastro rápido sem sair da venda. */
export function CadastroRapidoProduto({ codigo, titulo: tit = 'Produto não encontrado', onSalvo, onFechar }: { codigo?: string; titulo?: string; onSalvo: (p: Produto) => void; onFechar: () => void }) {
  const [nome, setNome] = useState('');
  const [preco, setPreco] = useState('');
  const [campo, setCampo] = useState<'nome' | 'preco'>('nome');
  const [erro, setErro] = useState('');
  const salvar = async () => {
    setErro('');
    if (!nome.trim() || parseBRL(preco) <= 0) return setErro('Digite o nome e o preço.');
    try {
      onSalvo(await backend.salvarProduto({ nome: titulo(nome), preco_venda: parseBRL(preco), codigo_barras: codigo || null }));
    } catch (e) {
      setErro(mensagem(e));
    }
  };
  return (
    <Janela titulo={tit} onFechar={onFechar} largura={1500}>
      {codigo && <span className="text-[28px]">Código lido: <strong>{codigo}</strong>. Cadastrar agora?</span>}
      <div className="grid grid-cols-[1fr_420px] gap-4">
        <CampoTela rotulo="Nome do produto" valor={titulo(nome)} ativo={campo === 'nome'} onToque={() => setCampo('nome')} />
        <CampoTela rotulo="Preço de venda" valor={preco ? 'R$ ' + preco : ''} placeholder="R$ 0,00" ativo={campo === 'preco'} onToque={() => setCampo('preco')} grande />
      </div>
      {campo === 'nome'
        ? <TecladoTexto onTecla={(t) => setNome((v) => aplicarTecla(v, t))} comArroba className="h-[360px]" />
        : <TecladoNumerico onTecla={(t) => setPreco((v) => aplicarTecla(v, t, { numerico: true, max: 9 }))} className="h-[360px] w-[600px] self-center" />}
      {erro && <Aviso>{erro}</Aviso>}
      <Botao variante="concluir" grande icone="check" onClick={salvar}>Salvar e pôr na venda</Botao>
    </Janela>
  );
}

/** PIN de 4 dígitos para ações sensíveis no terminal. */
export function PinJanela({ titulo: tit, descricao, pedirMotivo, motivos, onConfirmar, onFechar }: {
  titulo: string; descricao?: string; pedirMotivo?: boolean; motivos?: string[];
  onConfirmar: (pin: string, motivo: string) => Promise<void>; onFechar: () => void;
}) {
  const [pin, setPin] = useState('');
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const confirmar = async () => {
    setErro('');
    if (pedirMotivo && !motivo) return setErro('Escolha o motivo.');
    if (pin.length !== 4) return setErro('Digite os 4 números do PIN.');
    setEnviando(true);
    try {
      await onConfirmar(pin, motivo);
    } catch (e) {
      somErro();
      setErro(mensagem(e));
      setPin('');
      setEnviando(false);
    }
  };
  return (
    <Janela titulo={tit} onFechar={onFechar} largura={1200}>
      {descricao && <span className="text-[28px]">{descricao}</span>}
      <div className="grid grid-cols-2 gap-8">
        <div className="flex flex-col gap-4">
          {pedirMotivo && <>
            <span className="text-[26px] font-bold">Motivo</span>
            <div className="grid grid-cols-2 gap-3">
              {(motivos ?? []).map((m) => (
                <button key={m} type="button" onClick={() => setMotivo(m)}
                  className={`min-h-[80px] rounded-2xl border-[3px] text-[26px] font-bold ${motivo === m ? 'border-azul bg-azul-claro' : 'border-borda bg-white'}`}>{m}</button>
              ))}
            </div>
          </>}
          <span className="mt-2 text-[26px] font-bold">PIN do administrador</span>
          <div className="flex gap-4" aria-label="PIN digitado">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="flex size-[88px] items-center justify-center rounded-2xl border-4 border-borda bg-white text-[56px] font-bold">{pin[i] ? '•' : ''}</span>
            ))}
          </div>
          {erro && <Aviso>{erro}</Aviso>}
        </div>
        <TecladoNumerico semVirgula onTecla={(t) => setPin((v) => aplicarTecla(v, t, { max: 4 }))} className="h-[400px]" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Botao variante="neutro" grande onClick={onFechar}>Voltar sem fazer nada</Botao>
        <Botao variante="perigo" grande icone="cadeado" disabled={enviando} onClick={confirmar} className="!border-vermelho !bg-vermelho !text-white">Confirmar</Botao>
      </div>
    </Janela>
  );
}

/** Busca grande de cliente (RF-01, RF-31), com as últimas atendidas e o botão Nova cliente. */
export function BuscaCliente({ titulo: tit, onEscolher, piscar, mostrarDivida, extraTopo }: {
  titulo: string; onEscolher: (c: Cliente) => void; piscar?: number; mostrarDivida?: boolean; extraTopo?: React.ReactNode;
}) {
  const [q, setQ] = useState('');
  const [nova, setNova] = useState(false);
  const ultimas = useQuery({ queryKey: ['ultimasClientes'], queryFn: () => backend.ultimasClientes(6) });
  const busca = useQuery({ queryKey: ['buscaCliente', q], queryFn: () => backend.buscarClientes(q), enabled: q.trim().length >= 2 });
  const resumo = useQuery({ queryKey: ['resumoReceber'], queryFn: () => backend.resumoReceber() });
  const atraso = new Map((resumo.data?.clientes ?? []).map((c) => [c.cliente_id, c]));
  const lista = q.trim().length >= 2 ? busca.data ?? [] : ultimas.data ?? [];
  const [animar, setAnimar] = useState(false);
  useEffect(() => {
    if (!piscar) return;
    setAnimar(false);
    requestAnimationFrame(() => setAnimar(true));
  }, [piscar]);

  return (
    <main className="flex min-h-0 flex-1 flex-col px-12 py-9">
      <label className="mb-4 text-[40px] font-bold">{tit}</label>
      {extraTopo}
      <div className="mb-6 flex gap-6">
        <div className={`flex h-[112px] flex-1 items-center gap-5 rounded-[20px] border-4 border-azul bg-white px-8 ${animar ? 'pisca-alerta' : ''}`}>
          <Icone nome="busca" tamanho={44} traco={2.2} className="text-azul" />
          <input aria-label="Buscar cliente" value={q} onChange={(e) => setQ(e.target.value)} inputMode="none" autoFocus
            placeholder="Digite o nome ou o telefone da cliente"
            className="flex-1 border-none bg-transparent text-[40px] text-tinta outline-none placeholder:text-[#6B6B75]" />
          {q && <Botao variante="neutro" icone="x" onClick={() => setQ('')}>Limpar</Botao>}
        </div>
        <Botao variante="contorno" icone="mais" className="h-[112px] !px-10 !text-[32px]" onClick={() => setNova(true)}>Nova cliente</Botao>
      </div>
      <span className="mb-3 text-[26px] text-suave">
        {q.trim().length >= 2 ? (busca.isFetching ? 'Procurando…' : lista.length ? 'Clientes encontradas' : 'Nenhuma cliente com esse nome. Toque em Nova cliente.') : 'Últimas clientes atendidas'}
      </span>
      <div className="mb-6 grid grid-cols-3 gap-4">
        {lista.slice(0, 6).map((c) => {
          const a = atraso.get(c.id);
          return (
            <button key={c.id} type="button" onClick={() => onEscolher(c)}
              className="flex h-[108px] items-center justify-between gap-4 rounded-[18px] border-[3px] border-borda bg-white px-7 text-left text-tinta">
              <span className="flex min-w-0 flex-col gap-1">
                <span className="truncate text-[32px] font-bold">{c.nome}</span>
                <span className="text-[22px] text-suave">{c.telefone}</span>
              </span>
              {a && a.vencido > 0 && <span className="shrink-0 rounded-full bg-vermelho-claro px-4 py-2 text-[20px] font-bold text-vermelho">Parcela atrasada</span>}
              {mostrarDivida && a && a.vencido === 0 && <span className="shrink-0 rounded-full bg-cinza px-4 py-2 text-[20px] font-bold text-suave">Deve {brl(a.devido)}</span>}
            </button>
          );
        })}
      </div>
      <TecladoTexto onTecla={(t) => setQ((v) => aplicarTecla(v, t))} className="min-h-0 flex-1" />
      {nova && <NovaClienteJanela nomeInicial={q} onFechar={() => setNova(false)} onSalva={(c) => { setNova(false); onEscolher(c); }} />}
    </main>
  );
}

/** Põe a primeira letra de cada palavra em maiúscula ("ROSA ALMEIDA" → "Rosa Almeida"). */
export function titulo(s: string) {
  return s.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
}
