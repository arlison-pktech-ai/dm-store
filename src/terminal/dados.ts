import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { backend } from '../data';
import { CONFIG_PADRAO } from '../data/local';
import type { Produto } from '../domain/types';

/** RNF-01: lista de produtos ativos em memória para o item aparecer em < 300 ms. */
export function useProdutos() {
  const q = useQuery({ queryKey: ['produtos'], queryFn: () => backend.produtos(), staleTime: 60_000, refetchInterval: 5 * 60_000 });
  const porCodigo = useMemo(() => {
    const m = new Map<string, Produto>();
    (q.data ?? []).forEach((p) => {
      if (p.codigo_barras) m.set(p.codigo_barras, p);
      m.set(p.codigo_interno, p);
    });
    return m;
  }, [q.data]);
  return { produtos: q.data ?? [], porCodigo, carregando: q.isLoading };
}

export function useConfig() {
  const q = useQuery({ queryKey: ['config'], queryFn: () => backend.config(), staleTime: 5 * 60_000 });
  return q.data ?? CONFIG_PADRAO;
}

export function useInvalidar() {
  const qc = useQueryClient();
  return (...chaves: string[]) => chaves.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}
