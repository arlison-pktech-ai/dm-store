/** RNF-10: erros do navegador registrados com a versão do app, para suporte remoto. */
declare const __APP_VERSION__: string;
export const VERSAO = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

const KEY = 'pdv-erros';

export function registrarErro(origem: string, erro: unknown) {
  const msg = erro instanceof Error ? erro.message : String(erro);
  const item = { quando: new Date().toISOString(), versao: VERSAO, origem, msg, url: location.pathname };
  try {
    const lista = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    lista.unshift(item);
    localStorage.setItem(KEY, JSON.stringify(lista.slice(0, 100)));
  } catch {
    /* ignora */
  }
  console.error('[PDV]', item);
}

export function errosRegistrados(): { quando: string; versao: string; origem: string; msg: string; url: string }[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function instalarCapturaDeErros() {
  window.addEventListener('error', (e) => registrarErro('window', e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => registrarErro('promise', e.reason));
}

export function mensagem(e: unknown): string {
  if (e instanceof Error) {
    if (/fetch|network|Failed to fetch/i.test(e.message)) return 'Sem internet. Tente de novo em instantes.';
    return e.message;
  }
  return 'Algo deu errado. Tente de novo.';
}
