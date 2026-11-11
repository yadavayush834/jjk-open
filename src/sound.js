export class Sound {
  constructor() {
    this.enabled = false;
  }
  async enable() {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return false;
    try {
      this.context ??= new Audio();
      await this.context.resume();
      this.enabled = true;
      return true;
    } catch {
      return false;
    }
  }
  disable() {
    this.enabled = false;
    this.context?.suspend();
  }
  play(kind) {
    if (!this.enabled || !this.context) return;
    const c = this.context,
      start = c.currentTime;
    const osc = c.createOscillator(),
      gain = c.createGain();
    osc.type = kind === 'domain' ? 'sine' : 'triangle';
    const f = kind === 'blue' ? 180 : kind === 'red' ? 95 : kind === 'purple' ? 130 : 55;
    osc.frequency.setValueAtTime(f, start);
    osc.frequency.exponentialRampToValueAtTime(kind === 'blue' ? 55 : f * 2.5, start + 0.5);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.07, start + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.8);
    osc.connect(gain).connect(c.destination);
    osc.start(start);
    osc.stop(start + 0.85);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }
  close() {
    this.enabled = false;
    this.context?.close();
  }
}
