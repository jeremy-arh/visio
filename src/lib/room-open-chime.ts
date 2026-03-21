/**
 * Court signal sonore quand la room vidéo est prête (côté signataire).
 * Peut être bloqué par la politique autoplay du navigateur.
 */
export function playRoomOpenChime(): void {
  if (typeof window === "undefined") return;
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();

    const run = () => {
      const t0 = ctx.currentTime;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.1, t0);
      gain.gain.exponentialRampToValueAtTime(0.01, t0 + 0.45);
      gain.connect(ctx.destination);

      const tone = (freq: number, start: number, dur: number) => {
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.setValueAtTime(freq, start);
        o.connect(gain);
        o.start(start);
        o.stop(start + dur);
      };
      tone(523.25, t0, 0.18);
      tone(659.25, t0 + 0.14, 0.22);

      window.setTimeout(() => {
        try {
          if (ctx.state !== "closed") ctx.close();
        } catch {
          /* ignore */
        }
      }, 800);
    };

    if (ctx.state === "suspended") {
      void ctx.resume().then(run);
    } else {
      run();
    }
  } catch {
    /* autoplay / context */
  }
}
