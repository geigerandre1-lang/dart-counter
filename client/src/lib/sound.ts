let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

export function playClick(enabled: boolean): void {
  if (!enabled) return;
  const audio = context();
  if (!audio) return;
  void audio.resume();
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = "triangle";
  osc.frequency.value = 420;
  gain.gain.value = 0.05;
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start();
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.06);
  osc.stop(audio.currentTime + 0.07);
}

export function playBust(enabled: boolean): void {
  if (!enabled) return;
  const audio = context();
  if (!audio) return;
  void audio.resume();
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = "sawtooth";
  osc.frequency.value = 140;
  gain.gain.value = 0.06;
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start();
  osc.frequency.exponentialRampToValueAtTime(70, audio.currentTime + 0.18);
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.2);
  osc.stop(audio.currentTime + 0.22);
}
