import { Navigate, Route, Routes } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { backend } from './data';
import Terminal from './terminal/Terminal';
import Admin from './admin/Admin';

/** /terminal (operadora, tela touch) e /admin (administrador, celular). O papel define qual abre. */
export default function App() {
  const sessao = useQuery({ queryKey: ['sessao'], queryFn: () => backend.sessao() });
  return (
    <Routes>
      <Route path="/terminal/*" element={<Terminal />} />
      <Route path="/admin/*" element={<Admin />} />
      <Route path="*" element={sessao.isLoading ? null : <Navigate to={sessao.data?.papel === 'admin' ? '/admin' : '/terminal'} replace />} />
    </Routes>
  );
}
