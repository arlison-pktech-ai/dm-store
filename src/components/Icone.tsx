/** Ícones do design (traço). Sempre usados junto de texto — nunca sozinhos. */
const P: Record<string, React.ReactNode> = {
  sacola: <><path d="M6 7h12l1 13H5L6 7z" /><path d="M9 7a3 3 0 0 1 6 0" /></>,
  carteira: <><path d="M3 8h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H3z" /><path d="M3 8l13-4v4" /><circle cx="16.5" cy="14" r="1.6" /></>,
  caixa: <><path d="M3 7l9-4 9 4-9 4-9-4z" /><path d="M3 7v10l9 4 9-4V7" /><path d="M12 11v10" /></>,
  pessoas: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><circle cx="17" cy="9" r="2.5" /><path d="M16 14.6a5 5 0 0 1 5.5 5.4" /></>,
  voltar: <path d="M15 5l-7 7 7 7" />,
  avancar: <path d="M5 12h14M13 6l6 6-6 6" />,
  busca: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5L21 21" /></>,
  mais: <path d="M12 5v14M5 12h14" />,
  barras: <path d="M4 6v12M7 6v12M10 6v12M14 6v12M17 6v12M20 6v12" />,
  lixo: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
  alerta: <><path d="M12 3l10 18H2L12 3z" /><path d="M12 10v5M12 18v.5" /></>,
  check: <path d="M4 12.5l5 5L20 6.5" />,
  cartao: <><rect x="3" y="5.5" width="18" height="13" rx="2" /><path d="M3 10h18M7 15h4" /></>,
  pix: <><path d="M12 2.5l9.5 9.5-9.5 9.5L2.5 12z" /><path d="M8.5 12h7M12 8.5v7" /></>,
  dinheiro: <><rect x="2.5" y="6" width="19" height="12" rx="2" /><circle cx="12" cy="12" r="2.8" /><path d="M6 9.5v5M18 9.5v5" /></>,
  fiado: <><path d="M5 3h10l4 4v14H5z" /><path d="M9 11h6M9 15h6M9 7h3" /></>,
  impressora: <><path d="M6 9V3h12v6" /><rect x="3" y="9" width="18" height="8" rx="2" /><path d="M6 14h12v7H6z" /></>,
  desfazer: <><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></>,
  cadeado: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  casa: <><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /></>,
  grafico: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  recibo: <><path d="M6 2h12v20l-3-2-3 2-3-2-3 2z" /><path d="M9 7h6M9 11h6M9 15h4" /></>,
  engrenagem: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  whatsapp: <><path d="M3 21l1.7-5A8.5 8.5 0 1 1 8 19.3z" /><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 .8a4 4 0 0 1-2-2l.8-1-1-2z" /></>,
};

export type NomeIcone = keyof typeof P;

export function Icone({ nome, tamanho = 28, traco = 2, className }: { nome: NomeIcone; tamanho?: number; traco?: number; className?: string }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={traco}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} style={{ flexShrink: 0 }}>
      {P[nome]}
    </svg>
  );
}
