import { useState } from 'react';
import { NavLink, Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { backend } from '../data';
import { Icone, type NomeIcone } from '../components/Icone';
import { mensagem } from '../lib/erros';
import { B, Campo, Erro } from './ui';
import Painel from './Painel';
import Vendas from './Vendas';
import ClientesAdmin from './ClientesAdmin';
import Estoque from './Estoque';
import Mais from './Mais';

/** RF-60: área do administrador com login, pensada para o celular. */
export default function Admin() {
  const sessao = useQuery({ queryKey: ['sessao'], queryFn: () => backend.sessao() });
  if (sessao.isLoading) return null;
  if (sessao.data?.papel !== 'admin') return <Login />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Painel />} />
        <Route path="vendas" element={<Vendas />} />
        <Route path="clientes" element={<ClientesAdmin />} />
        <Route path="estoque" element={<Estoque />} />
        <Route path="mais/*" element={<Mais />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Route>
    </Routes>
  );
}

function Login() {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro('');
    try {
      const s = await backend.entrar(email, senha);
      if (s.papel !== 'admin') {
        await backend.sair();
        setErro('Este usuário é do terminal. Use o login do administrador.');
        return;
      }
      qc.invalidateQueries();
    } catch (err) {
      setErro(mensagem(err));
    }
  };
  return (
    <div className="mx-auto flex min-h-full max-w-[420px] flex-col justify-center gap-4 p-6">
      <h1 className="m-0 text-[26px]">PDV · Administrador</h1>
      {backend.modo === 'demo' && <p className="m-0 text-[14px] text-suave">Modo demonstração: qualquer e-mail, senha <strong>demo</strong>.</p>}
      <form onSubmit={entrar} className="flex flex-col gap-3">
        <Campo rotulo="E-mail" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Campo rotulo="Senha" type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
        <Erro>{erro}</Erro>
        <B variante="primario" type="submit" className="min-h-12 text-[16px]">Entrar</B>
      </form>
    </div>
  );
}

const MENU: { para: string; nome: string; icone: NomeIcone }[] = [
  { para: '/admin', nome: 'Painel', icone: 'grafico' },
  { para: '/admin/vendas', nome: 'Vendas', icone: 'recibo' },
  { para: '/admin/clientes', nome: 'Clientes', icone: 'pessoas' },
  { para: '/admin/estoque', nome: 'Estoque', icone: 'caixa' },
  { para: '/admin/mais', nome: 'Mais', icone: 'menu' },
];

function Layout() {
  const nav = useNavigate();
  return (
    <div className="mx-auto flex min-h-full max-w-[640px] flex-col bg-fundo">
      <main className="flex flex-1 flex-col gap-3 p-4 pb-24">
        {backend.modo === 'demo' && (
          <div className="flex items-center justify-between rounded-xl bg-azul-claro px-3 py-2 text-[13px] font-bold text-azul-escuro">
            Modo demonstração (dados no navegador)
            <button type="button" className="border-none bg-transparent font-bold text-azul underline" onClick={() => nav('/terminal')}>Abrir terminal</button>
          </div>
        )}
        <Outlet />
      </main>
      <nav aria-label="Menu" className="fixed inset-x-0 bottom-0 mx-auto grid h-[72px] max-w-[640px] grid-cols-5 border-t border-borda bg-white px-2">
        {MENU.map((m) => (
          <NavLink key={m.para} to={m.para} end={m.para === '/admin'}
            className={({ isActive }) => `flex flex-col items-center justify-center gap-1 text-[12px] no-underline ${isActive ? 'font-bold text-azul' : 'text-suave'}`}>
            <Icone nome={m.icone} tamanho={24} traco={1.9} />{m.nome}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
