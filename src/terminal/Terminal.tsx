import { useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { backend } from '../data';
import { Aviso, Botao, Palco } from '../components/ui';
import { mensagem } from '../lib/erros';
import { instalarLeitor } from '../lib/useScanner';

instalarLeitor();
import Inicio from './Inicio';
import Venda from './Venda';
import Pagamento from './Pagamento';
import Concluida from './Concluida';
import ReceberFiado from './ReceberFiado';
import ChegouMercadoria from './ChegouMercadoria';
import Clientes from './Clientes';
import Estoque, { Contagem } from './Estoque';
import Precos from './Precos';

export default function Terminal() {
  const sessao = useQuery({ queryKey: ['sessao'], queryFn: () => backend.sessao() });
  if (sessao.isLoading) return null;
  return (
    <Palco>
      {!sessao.data ? <AtivarTerminal /> : (
        <Routes>
          <Route index element={<Inicio />} />
          <Route path="venda" element={<Venda />} />
          <Route path="venda/pagamento" element={<Pagamento />} />
          <Route path="venda/concluida/:id" element={<Concluida />} />
          <Route path="receber" element={<ReceberFiado />} />
          <Route path="receber/:clienteId" element={<ReceberFiado />} />
          <Route path="mercadoria" element={<ChegouMercadoria />} />
          <Route path="estoque" element={<Estoque />} />
          <Route path="estoque/contagem" element={<Contagem />} />
          <Route path="precos" element={<Precos />} />
          <Route path="clientes" element={<Clientes />} />
          <Route path="clientes/:id" element={<Clientes />} />
          <Route path="*" element={<Inicio />} />
        </Routes>
      )}
    </Palco>
  );
}

/**
 * Feito uma vez pelo administrador: login com o usuário dedicado do terminal.
 * Depois a sessão se renova sozinha e a operadora nunca vê esta tela.
 */
function AtivarTerminal() {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await backend.entrar(email, senha);
      qc.invalidateQueries();
    } catch (err) {
      setErro(mensagem(err));
    }
  };
  const campo = 'h-[96px] rounded-2xl border-4 border-borda bg-white px-6 text-[36px] outline-none focus:border-azul';
  return (
    <main className="flex flex-1 items-center justify-center">
      <form onSubmit={entrar} className="flex w-[900px] flex-col gap-6 rounded-[28px] bg-white p-12">
        <h1 className="m-0 text-[44px]">Ativar este terminal</h1>
        <p className="m-0 text-[26px] text-suave">Só o administrador faz isso, uma vez. Use o usuário do terminal.</p>
        <input className={campo} type="email" placeholder="E-mail do terminal" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
        <input className={campo} type="password" placeholder="Senha" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" />
        {erro && <Aviso>{erro}</Aviso>}
        <Botao variante="primario" grande type="submit">Ativar</Botao>
      </form>
    </main>
  );
}
