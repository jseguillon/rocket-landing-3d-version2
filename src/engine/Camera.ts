import * as THREE from 'three';
import { type PhaseName, type RocketState } from '../types.js';

/** Matches ROCKET_CENTER_OFFSET in Rocket.ts — rocket visual center above Timeline altitude */
const ROCKET_CENTER_OFFSET = 6;

export class CameraDirector {
  private _camera: THREE.PerspectiveCamera;
  private _prevPos = new THREE.Vector3(0, 10, 30);
  private _smoothFactor = 0.06;
  private _currentPhase: PhaseName = 'approach';
  private _firstFrame = true;

  constructor(camera: THREE.PerspectiveCamera) {
    this._camera = camera;
    this._camera.position.set(0, 10, 30);
  }

  /** Calculate camera distance to frame rocket at target viewport percentage. */
  private _frameDistance(targetPercent: number): number {
    const rocketHeight = 14;
    return rocketHeight / (2 * Math.tan((50 * Math.PI) / 360) * targetPercent);
  }

  update(phase: PhaseName, time: number, rocketState: RocketState): void {
    const [rx, ry, rz] = rocketState.position;
    // Visual center accounts for ROCKET_CENTER_OFFSET so camera always sees full rocket
    const visualCenterY = ry + ROCKET_CENTER_OFFSET;

    let targetPos: THREE.Vector3;
    let lookTarget: THREE.Vector3;

    switch (phase) {
      case 'approach': {
        // Rocket ~32% viewport, Earth limb visible below, camera high and offset
        const p = clamp(time / 5, 0, 1);
        const dist = this._frameDistance(lerp(0.32, 0.28, easeInOutCubic(p)));
        const heightOffRocket = lerp(34, 22, easeInOutCubic(p));
        targetPos = new THREE.Vector3(
          lerp(25, 15, p) + rx * 0.4,
          visualCenterY + heightOffRocket,
          dist,
        );
        lookTarget = new THREE.Vector3(rx * 0.4, visualCenterY - 2, rz);
        break;
      }
      case 'descent': {
        // Rocket ~36% viewport, planet/terrain context visible below
        const p = clamp((time - 5) / 7, 0, 1);
        const dist = this._frameDistance(lerp(0.36, 0.32, easeInOutCubic(p)));
        const heightOffRocket = lerp(22, 8, easeInOutCubic(p));
        targetPos = new THREE.Vector3(
          rx * 0.6 + Math.sin(time * 0.3) * 2,
          visualCenterY + heightOffRocket,
          dist,
        );
        lookTarget = new THREE.Vector3(rx * 0.5, visualCenterY - 2, rz);
        break;
      }
      case 'entry': {
        // Rocket ~42% viewport, atmospheric context with horizon
        const p = clamp((time - 12) / 8, 0, 1);
        const dist = this._frameDistance(lerp(0.42, 0.38, easeInQuad(p)));
        const heightOffRocket = lerp(8, 5, easeInQuad(p));
        targetPos = new THREE.Vector3(
          rx * 0.7 + Math.sin(time * 0.5) * 2.5,
          visualCenterY - 1 + heightOffRocket,
          dist,
        );
        lookTarget = new THREE.Vector3(rx * 0.6, visualCenterY - 2, rz);
        break;
      }
      case 'landing-burn': {
        // Full rocket ~58% viewport with plume extending below, side angle
        const p = clamp((time - 20) / 7, 0, 1);
        const dist = this._frameDistance(lerp(0.58, 0.54, easeInOutCubic(p)));
        const heightOffRocket = lerp(5, 3, easeInOutCubic(p));
        targetPos = new THREE.Vector3(
          rx * 0.8 + Math.sin(time * 0.4) * 1.5,
          visualCenterY - 2 + heightOffRocket,
          dist,
        );
        lookTarget = new THREE.Vector3(rx * 0.7, visualCenterY - 1, rz);
        break;
      }
      case 'leg-deploy': {
        // Full body + deployed legs + pad in frame, low three-quarter view ~72%
        const p = clamp((time - 27) / 4, 0, 1);
        const dist = this._frameDistance(lerp(0.72, 0.68, easeOutQuad(p)));
        const heightOffRocket = lerp(5, 3, easeOutQuad(p));
        targetPos = new THREE.Vector3(
          rx * 1.0 + Math.sin(time * 0.6) * 0.8,
          visualCenterY - 2 + heightOffRocket,
          dist,
        );
        lookTarget = new THREE.Vector3(rx * 0.8, visualCenterY - 1, rz);
        break;
      }
      case 'touchdown': {
        // Full landed rocket ~65%, low three-quarter view showing legs + pad
        const p = clamp((time - 31) / 4, 0, 1);
        const dist = this._frameDistance(lerp(0.68, 0.62, easeOutQuad(p)));
        const heightOffRocket = lerp(4, 2.5, easeOutQuad(p));
        targetPos = new THREE.Vector3(
          rx + Math.sin(time * 0.8) * 0.5,
          visualCenterY - 1 + heightOffRocket,
          dist,
        );
        lookTarget = new THREE.Vector3(rx, visualCenterY, rz);
        break;
      }
      case 'hero': {
        // Full landed rocket with pad and horizon, slow orbit ~65%
        const p = clamp((time - 35) / 5, 0, 1);
        const orbitAngle = time * 0.08;
        const dist = this._frameDistance(lerp(0.65, 0.6, easeOutQuad(p)));
        const heightOffRocket = lerp(4, 2.5, easeOutQuad(p));
        targetPos = new THREE.Vector3(
          rx + Math.cos(orbitAngle) * dist,
          visualCenterY - 1 + heightOffRocket,
          rz + Math.sin(orbitAngle) * dist,
        );
        lookTarget = new THREE.Vector3(rx, visualCenterY, rz);
        break;
      }
    }

    if (this._firstFrame || phase !== this._currentPhase) {
      this._camera.position.copy(targetPos);
      this._prevPos.copy(targetPos);
      this._firstFrame = false;
    } else {
      const smoothedPos = this._prevPos.clone().lerp(targetPos, this._smoothFactor);
      this._camera.position.copy(smoothedPos);
      this._prevPos.copy(smoothedPos);
    }

    this._camera.lookAt(lookTarget);
    this._currentPhase = phase;
  }

  reset(initialRocketY: number): void {
    this._firstFrame = true;
    this._prevPos.set(20, initialRocketY + 35, 60);
    this._camera.position.copy(this._prevPos);
    this._camera.lookAt(0, initialRocketY, 0);
  }

  snapToRocket(phase: PhaseName, time: number, rocketState: RocketState): void {
    const [rx, ry, rz] = rocketState.position;
    const visualCenterY = ry + ROCKET_CENTER_OFFSET;

    let targetPos: THREE.Vector3;
    let lookTarget: THREE.Vector3;

    switch (phase) {
      case 'approach': {
        const p = clamp(time / 5, 0, 1);
        const dist = this._frameDistance(lerp(0.32, 0.28, easeInOutCubic(p)));
        const heightOffRocket = lerp(34, 22, easeInOutCubic(p));
        targetPos = new THREE.Vector3(
          lerp(25, 15, p) + rx * 0.4,
          visualCenterY + heightOffRocket,
          dist,
        );
        lookTarget = new THREE.Vector3(rx * 0.4, visualCenterY - 2, rz);
        break;
      }
      case 'descent': {
        const p = clamp((time - 5) / 7, 0, 1);
        const dist = this._frameDistance(lerp(0.36, 0.32, easeInOutCubic(p)));
        const heightOffRocket = lerp(22, 8, easeInOutCubic(p));
        targetPos = new THREE.Vector3(
          rx * 0.6 + Math.sin(time * 0.3) * 2,
          visualCenterY + heightOffRocket,
          dist,
        );
        lookTarget = new THREE.Vector3(rx * 0.5, visualCenterY - 2, rz);
        break;
      }
      case 'entry': {
        const p = clamp((time - 12) / 8, 0, 1);
        const dist = this._frameDistance(lerp(0.42, 0.38, easeInQuad(p)));
        const heightOffRocket = lerp(8, 5, easeInQuad(p));
        targetPos = new THREE.Vector3(
          rx * 0.7 + Math.sin(time * 0.5) * 2.5,
          visualCenterY - 1 + heightOffRocket,
          dist,
        );
        lookTarget = new THREE.Vector3(rx * 0.6, visualCenterY - 2, rz);
        break;
      }
      case 'landing-burn': {
        const p = clamp((time - 20) / 7, 0, 1);
        const dist = this._frameDistance(lerp(0.58, 0.54, easeInOutCubic(p)));
        const heightOffRocket = lerp(5, 3, easeInOutCubic(p));
        targetPos = new THREE.Vector3(
          rx * 0.8 + Math.sin(time * 0.4) * 1.5,
          visualCenterY - 2 + heightOffRocket,
          dist,
        );
        lookTarget = new THREE.Vector3(rx * 0.7, visualCenterY - 1, rz);
        break;
      }
      case 'leg-deploy': {
        const p = clamp((time - 27) / 4, 0, 1);
        const dist = this._frameDistance(lerp(0.72, 0.68, easeOutQuad(p)));
        const heightOffRocket = lerp(5, 3, easeOutQuad(p));
        targetPos = new THREE.Vector3(
          rx * 1.0 + Math.sin(time * 0.6) * 0.8,
          visualCenterY - 2 + heightOffRocket,
          dist,
        );
        lookTarget = new THREE.Vector3(rx * 0.8, visualCenterY - 1, rz);
        break;
      }
      case 'touchdown': {
        const p = clamp((time - 31) / 4, 0, 1);
        const dist = this._frameDistance(lerp(0.68, 0.62, easeOutQuad(p)));
        const heightOffRocket = lerp(4, 2.5, easeOutQuad(p));
        targetPos = new THREE.Vector3(
          rx + Math.sin(time * 0.8) * 0.5,
          visualCenterY - 1 + heightOffRocket,
          dist,
        );
        lookTarget = new THREE.Vector3(rx, visualCenterY, rz);
        break;
      }
      case 'hero': {
        const p = clamp((time - 35) / 5, 0, 1);
        const orbitAngle = time * 0.08;
        const dist = this._frameDistance(lerp(0.65, 0.6, easeOutQuad(p)));
        const heightOffRocket = lerp(4, 2.5, easeOutQuad(p));
        targetPos = new THREE.Vector3(
          rx + Math.cos(orbitAngle) * dist,
          visualCenterY - 1 + heightOffRocket,
          rz + Math.sin(orbitAngle) * dist,
        );
        lookTarget = new THREE.Vector3(rx, visualCenterY, rz);
        break;
      }
    }

    this._camera.position.copy(targetPos);
    this._prevPos.copy(targetPos);
    this._camera.lookAt(lookTarget);
    this._currentPhase = phase;
    this._firstFrame = false;
  }

  setFixed(pos: THREE.Vector3, lookAt: THREE.Vector3): void {
    this._camera.position.copy(pos);
    this._camera.lookAt(lookAt);
    this._prevPos.copy(pos);
    this._firstFrame = false;
  }

  /** Get current camera position (for manual mode sync). */
  getCameraPosition(): THREE.Vector3 | null {
    return this._camera.position.clone();
  }

  /** Compute the cinematic target position for a given phase/time/rocket state, without applying it. */
  getCinematicTarget(
    phase: PhaseName,
    time: number,
    rocketState: RocketState,
  ): THREE.Vector3 | null {
    const [rx, ry, rz] = rocketState.position;
    const visualCenterY = ry + ROCKET_CENTER_OFFSET;

    let targetPos: THREE.Vector3;

    switch (phase) {
      case 'approach': {
        const p = clamp(time / 5, 0, 1);
        const dist = this._frameDistance(lerp(0.32, 0.28, easeInOutCubic(p)));
        const heightOffRocket = lerp(34, 22, easeInOutCubic(p));
        targetPos = new THREE.Vector3(
          lerp(25, 15, p) + rx * 0.4,
          visualCenterY + heightOffRocket,
          dist,
        );
        break;
      }
      case 'descent': {
        const p = clamp((time - 5) / 7, 0, 1);
        const dist = this._frameDistance(lerp(0.36, 0.32, easeInOutCubic(p)));
        const heightOffRocket = lerp(22, 8, easeInOutCubic(p));
        targetPos = new THREE.Vector3(
          rx * 0.6 + Math.sin(time * 0.3) * 2,
          visualCenterY + heightOffRocket,
          dist,
        );
        break;
      }
      case 'entry': {
        const p = clamp((time - 12) / 8, 0, 1);
        const dist = this._frameDistance(lerp(0.42, 0.38, easeInQuad(p)));
        const heightOffRocket = lerp(8, 5, easeInQuad(p));
        targetPos = new THREE.Vector3(
          rx * 0.7 + Math.sin(time * 0.5) * 2.5,
          visualCenterY - 1 + heightOffRocket,
          dist,
        );
        break;
      }
      case 'landing-burn': {
        const p = clamp((time - 20) / 7, 0, 1);
        const dist = this._frameDistance(lerp(0.58, 0.54, easeInOutCubic(p)));
        const heightOffRocket = lerp(5, 3, easeInOutCubic(p));
        targetPos = new THREE.Vector3(
          rx * 0.8 + Math.sin(time * 0.4) * 1.5,
          visualCenterY - 2 + heightOffRocket,
          dist,
        );
        break;
      }
      case 'leg-deploy': {
        const p = clamp((time - 27) / 4, 0, 1);
        const dist = this._frameDistance(lerp(0.72, 0.68, easeOutQuad(p)));
        const heightOffRocket = lerp(5, 3, easeOutQuad(p));
        targetPos = new THREE.Vector3(
          rx * 1.0 + Math.sin(time * 0.6) * 0.8,
          visualCenterY - 2 + heightOffRocket,
          dist,
        );
        break;
      }
      case 'touchdown': {
        const p = clamp((time - 31) / 4, 0, 1);
        const dist = this._frameDistance(lerp(0.68, 0.62, easeOutQuad(p)));
        const heightOffRocket = lerp(4, 2.5, easeOutQuad(p));
        targetPos = new THREE.Vector3(
          rx + Math.sin(time * 0.8) * 0.5,
          visualCenterY - 1 + heightOffRocket,
          dist,
        );
        break;
      }
      case 'hero': {
        const p = clamp((time - 35) / 5, 0, 1);
        const orbitAngle = time * 0.08;
        const dist = this._frameDistance(lerp(0.65, 0.6, easeOutQuad(p)));
        const heightOffRocket = lerp(4, 2.5, easeOutQuad(p));
        targetPos = new THREE.Vector3(
          rx + Math.cos(orbitAngle) * dist,
          visualCenterY - 1 + heightOffRocket,
          rz + Math.sin(orbitAngle) * dist,
        );
        break;
      }
    }

    return targetPos;
  }

  /** Sync previous position for smooth cinematic re-entry after manual mode. */
  syncPrevPosition(pos: THREE.Vector3): void {
    this._prevPos.copy(pos);
  }
}

function easeInOutCubic(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

function easeInQuad(x: number): number {
  return x * x;
}

function easeOutQuad(x: number): number {
  return 1 - (1 - x) * (1 - x);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
