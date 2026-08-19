import {
  type AppState,
  type PhaseName,
  TIMELINE_CHECKPOINTS,
  TOTAL_DURATION,
  type RocketState,
  type TelemetryData,
} from '../types.js';

// ─── Easing functions ───────────────────────────────────────────────────────

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function easeInQuad(t: number): number {
  return t * t;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

// ─── Timeline State Engine (no rendering dependencies) ──────────────────────

export class TimelineEngine {
  private _time = 0;
  private _playing = true;
  private _pausedTime: number | null = null;
  private _seed: number;

  /** Internal: QA percentage or undefined (for main.ts freeze detection) */
  _qaPercentValue?: number;

  /** Internal: whether timeline is in the finished state (for main.ts freeze detection) */
  _finishedValue = false;

  constructor(seed: number = 42, qaPercent?: number) {
    this._seed = seed;
    this._qaPercentValue = qaPercent;
    if (this._qaPercentValue !== undefined) {
      this._time = (this._qaPercentValue / 100) * TOTAL_DURATION;
      this._playing = false;
      this._finishedValue = true;
    }
  }

  get time(): number {
    return this._time;
  }
  get playing(): boolean {
    return this._playing && !this._finishedValue;
  }
  get paused(): boolean {
    return !this._playing && !this._finishedValue && this._pausedTime !== null;
  }
  get finished(): boolean {
    return this._finishedValue;
  }

  get duration(): number {
    return TOTAL_DURATION;
  }
  get progress(): number {
    return clamp(this._time / TOTAL_DURATION, 0, 1);
  }

  /** Set a deterministic QA position (0..100 percentage) */
  setQAPercent(pct: number): void {
    this._qaPercentValue = clamp(pct, 0, 100);
    this._time = (this._qaPercentValue / 100) * TOTAL_DURATION;
    this._playing = false;
    this._finishedValue = true;
    this._pausedTime = null;
  }

  /** Start/resume playing */
  play(): void {
    if (this._time >= TOTAL_DURATION) {
      this.reset();
      return;
    }
    this._playing = true;
    this._finishedValue = false;
    this._pausedTime = null;
  }

  /** Pause at current position */
  pause(): void {
    if (this._time < TOTAL_DURATION) {
      this._playing = false;
      this._pausedTime = this._time;
    }
  }

  /** Toggle play/pause */
  togglePlayPause(): void {
    if (this._playing) {
      this.pause();
    } else {
      this.play();
    }
  }

  /** Reset to beginning and start playing */
  reset(): void {
    this._time = 0;
    this._playing = true;
    this._finishedValue = false;
    this._pausedTime = null;
    if (this._qaPercentValue !== undefined) {
      this.setQAPercent(this._qaPercentValue);
    }
  }

  /** Advance by delta seconds */
  update(dt: number): void {
    if (!this._playing || this._finishedValue || this._qaPercentValue !== undefined) return;
    this._time = Math.min(this._time + dt, TOTAL_DURATION);
    if (this._time >= TOTAL_DURATION) {
      this._time = TOTAL_DURATION;
      this._playing = false;
      this._finishedValue = true;
    }
  }

  /** Get current phase name */
  getPhase(): PhaseName {
    const t = this._time;
    if (t < 5) return 'approach';
    if (t < 12) return 'descent';
    if (t < 20) return 'entry';
    if (t < 27) return 'landing-burn';
    if (t < 31) return 'leg-deploy';
    if (t < 35) return 'touchdown';
    return 'hero';
  }

  /** Get checkpoint at current time */
  getCurrentCheckpoint(): { name: string; label: string; time: number; progress: number } {
    const checkpoints = [...TIMELINE_CHECKPOINTS];
    let prev = checkpoints[0];
    for (const cp of checkpoints) {
      if (cp.time <= this._time) prev = cp;
      else break;
    }
    const next =
      checkpoints.find((c) => c.time > this._time) || checkpoints[checkpoints.length - 1];

    return {
      name: prev.name,
      label: prev.label,
      time: prev.time,
      progress:
        next.time === prev.time
          ? 1
          : clamp((this._time - prev.time) / (next.time - prev.time), 0, 1),
    };
  }

  /** Compute rocket state for current time (deterministic, no rendering) */
  getRocketState(): RocketState {
    const t = this._time;

    const maxAltitude = 800;
    const minAltitude = 0.5;

    let altitude: number;
    if (t < 5) {
      altitude = lerp(maxAltitude, maxAltitude * 0.8, easeInOutCubic(t / 5));
    } else if (t < 12) {
      const p = (t - 5) / 7;
      altitude = lerp(maxAltitude * 0.8, maxAltitude * 0.3, easeInOutCubic(p));
    } else if (t < 20) {
      const p = (t - 12) / 8;
      altitude = lerp(maxAltitude * 0.3, maxAltitude * 0.08, easeInQuad(p));
    } else if (t < 27) {
      const p = (t - 20) / 7;
      altitude = lerp(maxAltitude * 0.08, minAltitude * 3, easeInOutCubic(p));
    } else if (t < 31) {
      const p = (t - 27) / 4;
      altitude = lerp(minAltitude * 3, minAltitude, easeOutQuad(p));
    } else {
      altitude = minAltitude;
    }

    const hPhase = clamp((t - 20) / 11, 0, 1);
    const horizontalPos = Math.sin(hPhase * Math.PI * 2.5) * 3 * (1 - hPhase);
    const verticalPos = altitude;

    // Engine thrust profile
    let engineThrust = 0;
    if (t >= 20 && t < 34) {
      const burnStart = easeInQuad(clamp((t - 20) / 2, 0, 1));
      const burnPeak = 1 - easeOutQuad(clamp((t - 26) / 5, 0, 1));
      engineThrust = lerp(burnStart, burnPeak * 0.3, clamp((t - 26) / 8, 0, 1));
      engineThrust = Math.max(engineThrust, 0.15);
    } else if (t >= 34) {
      engineThrust = Math.max(0.15 - (t - 34) * 0.05, 0);
    }

    let legDeployed = false;
    let legAngle = 0;
    if (t >= 26) {
      const lp = clamp((t - 26) / 5, 0, 1);
      legAngle = (easeOutQuad(lp) * Math.PI) / 4;
      legDeployed = lp > 0.7;
    }

    const attitudeRoll = Math.sin(t * 1.2) * 0.02 * (1 - clamp((t - 20) / 15, 0, 1));
    const attitudePitch = Math.cos(t * 0.8) * 0.015 * (1 - clamp((t - 20) / 15, 0, 1));
    const rotationY = horizontalPos * 0.03;

    return {
      position: [horizontalPos, verticalPos, 0],
      rotation: [attitudeRoll + attitudePitch, rotationY, attitudeRoll * 0.5],
      scale: [1, 1, 1],
      engineActive: engineThrust > 0.01,
      engineThrust,
      legDeployed,
      legAngle,
    };
  }

  /** Compute telemetry data for current time */
  getTelemetry(): TelemetryData {
    const phase = this.getPhase();
    const rocket = this.getRocketState();
    const velocity =
      this._time < 20
        ? lerp(150, 300, easeInQuad(clamp(this._time / 12, 0, 1))) *
          (0.8 + Math.sin(this._time) * 0.2)
        : lerp(300, 0, easeOutQuad(clamp((this._time - 20) / 11, 0, 1)));

    return {
      phase,
      altitude: Math.max(rocket.position[1], 0),
      velocity: Math.abs(velocity),
      horizontalPosition: rocket.position[0],
      verticalPosition: rocket.position[1],
      progress: this.progress,
      engineThrust: rocket.engineThrust,
      legDeployed: rocket.legDeployed,
      timestamp: performance.now(),
    };
  }

  /** Full app state snapshot */
  getState(): AppState {
    return {
      phase: this.getPhase(),
      time: this._time,
      duration: TOTAL_DURATION,
      playing: this._playing && !this._finishedValue,
      muted: false,
      rocketState: this.getRocketState(),
      telemetry: this.getTelemetry(),
    };
  }

  getCheckpoints(): typeof TIMELINE_CHECKPOINTS {
    return [...TIMELINE_CHECKPOINTS];
  }
}
