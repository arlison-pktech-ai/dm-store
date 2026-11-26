export const TZ = 'America/Manaus';

/** Data de hoje no fuso da loja, no formato YYYY-MM-DD. */
export function hojeISO(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
}

/** Soma meses a uma data YYYY-MM-DD, ajustando para o último dia do mês quando preciso. */
export function addMeses(iso: string, meses: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const alvo = new Date(Date.UTC(y, m - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return alvo.toISOString().slice(0, 10);
}

export function addDias(iso: string, dias: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + dias));
  return t.toISOString().slice(0, 10);
}

function utc(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Diferença em dias entre duas datas YYYY-MM-DD (b − a). */
export function diasEntre(a: string, b: string): number {
  return Math.round((utc(b) - utc(a)) / 86400000);
}

/** "2026-12-26" → "26/12/2026" */
export function dataBR(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** "2026-12-26" → "26/12" */
export function diaMes(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}`;
}

/** Timestamp → "26/11/2026 14:34" no fuso da loja. */
export function dataHoraBR(ts: string | Date): string {
  const dt = typeof ts === 'string' ? new Date(ts) : ts;
  return new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    .format(dt).replace(',', '');
}

export function horaBR(dt: Date = new Date()): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(dt);
}

/** "quinta, 26 de novembro" */
export function diaExtenso(dt: Date = new Date()): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' })
    .format(dt).replace('-feira', '');
}

export function saudacao(dt: Date = new Date()): string {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(dt));
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}
