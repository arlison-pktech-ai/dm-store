/** Retorno sonoro do leitor: bipe curto no acerto, som grave duplo no erro. */
let ctx: AudioContext | null = null;

function tocar(freq: number, ms: number, atraso = 0) {
  try {
    ctx ??= new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = freq;
    g.gain.value = 0.08;
    o.connect(g).connect(ctx.destination);
    const t = ctx.currentTime + atraso / 1000;
    o.start(t);
    o.stop(t + ms / 1000);
  } catch {
    /* sem áudio */
  }
}

export const somOk = () => tocar(1800, 70);
export const somErro = () => {
  tocar(220, 160);
  tocar(180, 220, 200);
};
