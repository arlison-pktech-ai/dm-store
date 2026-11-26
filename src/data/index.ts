import type { Backend } from './backend';
import { LocalBackend } from './local';
import { SupabaseBackend } from './supabase';

declare global {
  interface Window {
    __PDV_CONFIG__?: { SUPABASE_URL?: string; SUPABASE_ANON_KEY?: string; APP_ENV?: string };
  }
}

function criarBackend(): Backend {
  const cfg = window.__PDV_CONFIG__ ?? {};
  const url = cfg.SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
  const key = cfg.SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (url && key) return new SupabaseBackend(url, key);
  return new LocalBackend();
}

export const backend: Backend = criarBackend();
export { ErroNegocio } from './backend';
export type { Backend } from './backend';
