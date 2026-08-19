// ─── Shared Types ───────────────────────────────────────────────────────────

export interface TelemetryData {
  phase: string;
  altitude: number; // meters (scaled)
  velocity: number; // m/s (downward positive)
  horizontalPosition: number;
  verticalPosition: number;
  progress: number; // 0..1
  engineThrust: number; // 0..1
  legDeployed: boolean;
  timestamp: number;
}

export type PhaseName =
  'approach' | 'descent' | 'entry' | 'landing-burn' | 'leg-deploy' | 'touchdown' | 'hero';

export interface TimelineCheckpoint {
  name: PhaseName;
  time: number; // seconds from start
  label: string;
}

export interface RocketState {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  engineActive: boolean;
  engineThrust: number;
  legDeployed: boolean;
  legAngle: number; // radians from stowed
}

export interface AppState {
  phase: PhaseName;
  time: number; // current animation time in seconds
  duration: number; // total animation duration
  playing: boolean;
  muted: boolean;
  rocketState: RocketState;
  telemetry: TelemetryData;
}

export const PHASE_ORDER: PhaseName[] = [
  'approach',
  'descent',
  'entry',
  'landing-burn',
  'leg-deploy',
  'touchdown',
  'hero',
];

// ─── Timeline Checkpoints (deterministic) ───────────────────────────────────

export const TIMELINE_CHECKPOINTS: TimelineCheckpoint[] = [
  { name: 'approach', time: 0, label: 'Orbital Approach' },
  { name: 'descent', time: 5, label: 'Controlled Descent' },
  { name: 'entry', time: 12, label: 'Atmospheric Entry' },
  { name: 'landing-burn', time: 20, label: 'Landing Burn Ignition' },
  { name: 'leg-deploy', time: 27, label: 'Leg Deployment' },
  { name: 'touchdown', time: 31, label: 'Touchdown' },
  { name: 'hero', time: 35, label: 'Hero Shot — Mission Complete' },
];

export const TOTAL_DURATION = 40; // seconds

// ─── QA API Interface ───────────────────────────────────────────────────────

export interface CameraState {
  mode: 'follow' | 'manual' | 'returning';
  weight: number;
  theta: number;
  phi: number;
  radius: number;
}

export interface RocketQAPI {
  isReady: boolean;
  getTime: () => number | null;
  setState: (timeSeconds: number) => void;
  setCheckpoint: (phase: PhaseName) => void;
  play: () => void;
  pause: () => void;
  getCameraState: () => CameraState | null;
  getState: () => AppState | null;
}

// ─── QA / Determinism API ──────────────────────────────────────────────────

export interface QAPercentage {
  qa: number; // 0..100 percentage
}

export interface SeedConfig {
  seed: number;
}

/**
 * Window API for deterministic QA:
 *   ?qa=50          → freeze at 50% through animation
 *   ?seed=42        → use seed 42 for all procedural randomness
 */
export function parseQAQuery(): { qaPercent?: number; seed?: number } {
  try {
    const params = new URLSearchParams(window.location.search);
    const qa = params.get('qa');
    const seed = params.get('seed');
    const result: { qaPercent?: number; seed?: number } = {};
    if (qa !== null) {
      const v = parseFloat(qa);
      if (!isNaN(v) && v >= 0 && v <= 100) result.qaPercent = v;
    }
    if (seed !== null) {
      const v = parseInt(seed, 10);
      if (!isNaN(v)) result.seed = v;
    }
    return result;
  } catch {
    return {};
  }
}

// ─── Pseudo-random with seed (mulberry32) ───────────────────────────────────

export function createRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEFAULT_SEED = 42;

// ─── Reduced motion preference ──────────────────────────────────────────────

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
