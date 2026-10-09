/**
 * Optional sound, off by default, fully synthesised (no audio files).
 *
 *   hum        two detuned sawtooths through a low-pass at 55 Hz — the
 *              cryogenic floor; ambient, encodes nothing.
 *   harmonic   a sine whose pitch tracks REAL progress: key-generation
 *              fraction in stage 2, fused Merkle level in stage 3, signature
 *              stops in stage 6. Silent when nothing is computing.
 *   collapse   a single soft tone when `draw.resolvedCount` increments —
 *              i.e. on the real outcomeResolved event, never on a timer.
 */
import type { SceneState } from '../model/types.js';
import { keygenProgress, merkleProgress } from '../model/reducer.js';

export interface SoundEngine {
  enable(): Promise<void>;
  disable(): void;
  readonly enabled: boolean;
  /** Feed the latest state; cheap, call from a store subscription or per frame. */
  update(state: SceneState): void;
  dispose(): void;
}

type AudioCtor = typeof AudioContext;

export function createSoundEngine(ctor?: AudioCtor): SoundEngine {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let hum: OscillatorNode[] = [];
  let humFilter: BiquadFilterNode | null = null;
  let harmonic: OscillatorNode | null = null;
  let harmonicGain: GainNode | null = null;
  let lastResolved = 0;
  let lastStage = 0;
  let enabled = false;

  function build(): void {
    const C = ctor ?? (typeof AudioContext !== 'undefined' ? AudioContext : undefined);
    if (!C) throw new Error('@qsd/scene sound: Web Audio is not available');
    ctx = new C();
    master = ctx.createGain();
    master.gain.value = 0.0001;
    master.connect(ctx.destination);

    humFilter = ctx.createBiquadFilter();
    humFilter.type = 'lowpass';
    humFilter.frequency.value = 160;
    humFilter.Q.value = 0.7;
    const humGain = ctx.createGain();
    humGain.gain.value = 0.12;
    humFilter.connect(humGain).connect(master);
    hum = [55, 55.6].map((f) => {
      const o = (ctx as AudioContext).createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(humFilter as BiquadFilterNode);
      o.start();
      return o;
    });

    harmonic = ctx.createOscillator();
    harmonic.type = 'sine';
    harmonic.frequency.value = 110;
    harmonicGain = ctx.createGain();
    harmonicGain.gain.value = 0;
    harmonic.connect(harmonicGain).connect(master);
    harmonic.start();
  }

  function tone(): void {
    if (!ctx || !master) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(880, t);
    o.frequency.exponentialRampToValueAtTime(440, t + 1.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 1.7);
  }

  const engine: SoundEngine = {
    get enabled() {
      return enabled;
    },
    async enable() {
      if (enabled) return;
      if (!ctx) build();
      const c = ctx as AudioContext;
      if (c.state === 'suspended') await c.resume();
      (master as GainNode).gain.setTargetAtTime(0.6, c.currentTime, 0.5);
      enabled = true;
    },
    disable() {
      if (!enabled || !ctx || !master) return;
      master.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.2);
      enabled = false;
    },
    update(state) {
      if (!enabled || !ctx || !harmonic || !harmonicGain) {
        lastResolved = state.draw.resolvedCount;
        return;
      }
      const t = ctx.currentTime;
      // progress → pitch; silent when nothing is computing
      let progress = -1;
      if (state.stage === 2) progress = keygenProgress(state);
      else if (state.stage === 3) progress = merkleProgress(state);
      else if (state.stage === 6) progress = state.signature.stopsSeen / 67;
      if (progress >= 0) {
        harmonic.frequency.setTargetAtTime(110 * Math.pow(2, progress * 2), t, 0.05);
        harmonicGain.gain.setTargetAtTime(0.08, t, 0.1);
      } else {
        harmonicGain.gain.setTargetAtTime(0, t, 0.3);
      }
      if (state.draw.resolvedCount > lastResolved) tone();
      lastResolved = state.draw.resolvedCount;
      lastStage = state.stage;
    },
    dispose() {
      enabled = false;
      for (const o of hum) o.stop();
      harmonic?.stop();
      void ctx?.close();
      ctx = null;
      hum = [];
      harmonic = null;
    },
  };
  void lastStage;
  return engine;
}
