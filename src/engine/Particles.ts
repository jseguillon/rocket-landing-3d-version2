import * as THREE from 'three';
import { createRng, DEFAULT_SEED } from '../types.js';

// Shared procedural glow texture (canvas-based) — created once at module load
let _glowTexture: THREE.Texture | null = null;

function getGlowTexture(): THREE.Texture {
  if (_glowTexture) return _glowTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.2, 'rgba(255,255,255,0.8)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.3)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  _glowTexture = new THREE.CanvasTexture(canvas);
  return _glowTexture;
}

// ── Shared particle pool using typed arrays ────────────────────────────────

interface ParticleData {
  positions: Float32Array;
  colors: Uint8Array;
  sizes: Float32Array; // current rendered size (grows over life)
  baseSizes: Float32Array; // immutable base size at birth
  alphas: Float32Array;
  velocities: Float32Array; // [vx, vy, vz] per particle = 3 entries per particle
  lifetimes: Float32Array;
  maxLifetimes: Float32Array;
  count: number;
  capacity: number;
}

function createParticlePool(capacity: number): ParticleData {
  return {
    positions: new Float32Array(capacity * 3),
    colors: new Uint8Array(capacity * 3),
    sizes: new Float32Array(capacity),
    baseSizes: new Float32Array(capacity),
    alphas: new Float32Array(capacity),
    velocities: new Float32Array(capacity * 3),
    lifetimes: new Float32Array(capacity),
    maxLifetimes: new Float32Array(capacity),
    count: 0,
    capacity,
  };
}

function addParticle(
  pool: ParticleData,
  pos: [number, number, number],
  vel: [number, number, number],
  color: [number, number, number],
  maxLife: number,
  size: number,
): void {
  if (pool.count >= pool.capacity) return;
  const i3 = pool.count * 3;
  pool.positions[i3] = pos[0];
  pool.positions[i3 + 1] = pos[1];
  pool.positions[i3 + 2] = pos[2];
  pool.velocities[i3] = vel[0];
  pool.velocities[i3 + 1] = vel[1];
  pool.velocities[i3 + 2] = vel[2];
  pool.colors[i3] = Math.min(255, Math.max(0, Math.round(color[0] * 255)));
  pool.colors[i3 + 1] = Math.min(255, Math.max(0, Math.round(color[1] * 255)));
  pool.colors[i3 + 2] = Math.min(255, Math.max(0, Math.round(color[2] * 255)));
  pool.maxLifetimes[pool.count] = maxLife;
  pool.lifetimes[pool.count] = 0;
  pool.sizes[pool.count] = size;
  pool.baseSizes[pool.count] = size; // store immutable base
  pool.alphas[pool.count] = 1.0;
  pool.count++;
}

function updatePool(pool: ParticleData, dt: number): void {
  let writeIdx = 0;
  for (let i = 0; i < pool.count; i++) {
    const i3 = i * 3;
    pool.lifetimes[i] += dt;
    const lifeRatio = pool.lifetimes[i] / pool.maxLifetimes[i];

    if (lifeRatio >= 1.0) continue; // Dead particle, skip

    // Gravity and drag
    pool.velocities[i3 + 1] -= dt * 2.0;
    pool.velocities[i3] *= 0.98;
    pool.velocities[i3 + 2] *= 0.98;

    // Update positions using correct i3 indexing
    pool.positions[i3] += pool.velocities[i3] * dt;
    pool.positions[i3 + 1] += pool.velocities[i3 + 1] * dt;
    pool.positions[i3 + 2] += pool.velocities[i3 + 2] * dt;

    // Size grows linearly with life from immutable baseSize
    const baseSize = pool.baseSizes[i];
    const newSize = baseSize * (1.0 + lifeRatio * 1.5);
    pool.sizes[writeIdx] = newSize;

    // Alpha fades out in last 40% of life
    pool.alphas[writeIdx] = lifeRatio > 0.6 ? 1.0 - smoothstep(0.6, 1.0, lifeRatio) : 1.0;

    // Copy active particle to write position
    if (writeIdx !== i) {
      const w3 = writeIdx * 3;
      pool.positions[w3] = pool.positions[i3];
      pool.positions[w3 + 1] = pool.positions[i3 + 1];
      pool.positions[w3 + 2] = pool.positions[i3 + 2];
      pool.velocities[w3] = pool.velocities[i3];
      pool.velocities[w3 + 1] = pool.velocities[i3 + 1];
      pool.velocities[w3 + 2] = pool.velocities[i3 + 2];
      pool.colors[w3] = pool.colors[i3];
      pool.colors[w3 + 1] = pool.colors[i3 + 1];
      pool.colors[w3 + 2] = pool.colors[i3 + 2];
      pool.sizes[writeIdx] = pool.sizes[i];
      pool.baseSizes[writeIdx] = pool.baseSizes[i]; // copy baseSize too
      pool.alphas[writeIdx] = pool.alphas[i];
      pool.maxLifetimes[writeIdx] = pool.maxLifetimes[i];
      pool.lifetimes[writeIdx] = pool.lifetimes[i];
    }
    writeIdx++;
  }
  pool.count = writeIdx;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function easeInQuad(t: number): number {
  return t * t;
}

function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

// ── Engine plume particle system ───────────────────────────────────────────

export class PlumeSystem {
  private _pool: ParticleData;
  private _rng: ReturnType<typeof createRng>;
  private _group: THREE.Group;
  private _points: THREE.Points;
  private _geo: THREE.BufferGeometry;
  private _active = false;
  private _frozenCount = 0; // for QA freeze
  private _warmupDone = false;

  get group(): THREE.Group {
    return this._group;
  }
  get active(): boolean {
    return this._active;
  }
  get warmupDone(): boolean {
    return this._warmupDone;
  }

  constructor(seed: number = DEFAULT_SEED) {
    this._rng = createRng(seed);
    this._pool = createParticlePool(800);

    this._group = new THREE.Group();
    this._geo = new THREE.BufferGeometry();

    this._geo.setAttribute('position', new THREE.BufferAttribute(this._pool.positions, 3));
    this._geo.setAttribute('color', new THREE.BufferAttribute(this._pool.colors, 3, true));
    this._geo.setAttribute('size', new THREE.BufferAttribute(this._pool.sizes, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTexture: { value: getGlowTexture() },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      },
      vertexShader: `
        attribute float size;
        attribute vec3 color;
        varying vec3 vColor;
        uniform float uPixelRatio;

        void main() {
          vColor = color;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = max(size * uPixelRatio * (200.0 / -mvPos.z), 1.0);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        uniform sampler2D uTexture;
        varying vec3 vColor;

        void main() {
          vec4 tex = texture2D(uTexture, gl_PointCoord);
          gl_FragColor = vec4(vColor, tex.a * 0.75);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this._points = new THREE.Points(this._geo, mat);
    this._group.add(this._points);
    this._group.visible = false;
  }

  /** Warm-up: deterministically emit particles for QA freeze positions. */
  warmUp(thrust: number, worldPos: [number, number, number], duration: number): void {
    if (this._warmupDone) return;
    this._warmupDone = true;

    const burnStart = Math.max(duration - 4, 0);
    const steps = Math.max(Math.floor(duration * 2), 10);
    for (let s = 0; s < steps; s++) {
      const t = burnStart + (s / steps) * (duration - burnStart);
      let simThrust = 0;
      if (t >= 20 && t < 34) {
        const bs = easeInQuad(clamp((t - 20) / 2, 0, 1));
        const bp = 1 - easeOutQuad(clamp((t - 26) / 5, 0, 1));
        simThrust = clamp(bs + bp * 0.3 * clamp((t - 26) / 8, 0, 1), 0.15, 1);
      } else if (t >= 34) {
        simThrust = Math.max(0.15 - (t - 34) * 0.05, 0);
      }

      if (simThrust < 0.05) continue;

      const emitCount = Math.floor(simThrust * 8);
      for (let i = 0; i < emitCount && this._pool.count < this._pool.capacity; i++) {
        const spread = simThrust * 0.6;
        const speed = 2 + simThrust * 4 + this._rng() * 3;

        const tt = this._rng();
        let color: [number, number, number];
        if (tt < 0.25) {
          color = [1.0, 0.95, 0.8];
        } else if (tt < 0.6) {
          color = [1.0, 0.45 + simThrust * 0.3, 0.05];
        } else if (tt < 0.85) {
          color = [1.0, 0.2, 0.02];
        } else {
          color = [0.3, 0.4, 1.0];
        }

        addParticle(
          this._pool,
          [
            worldPos[0] + (this._rng() - 0.5) * 0.3,
            worldPos[1] - 6,
            worldPos[2] + (this._rng() - 0.5) * 0.3,
          ],
          [(this._rng() - 0.5) * spread, -speed, (this._rng() - 0.5) * spread],
          color,
          0.5 + this._rng() * 0.7,
          0.2 + this._rng() * 0.6 * simThrust,
        );
      }
    }

    // Compact pool
    let writeIdx = 0;
    for (let i = 0; i < this._pool.count; i++) {
      const lifeRatio = this._pool.lifetimes[i] / this._pool.maxLifetimes[i];
      if (lifeRatio >= 1.0) continue;

      const baseSize = this._pool.baseSizes[i];
      this._pool.sizes[writeIdx] = baseSize * (1.0 + lifeRatio * 1.5);
      this._pool.alphas[writeIdx] = lifeRatio > 0.6 ? 1.0 - smoothstep(0.6, 1.0, lifeRatio) : 1.0;

      if (writeIdx !== i) {
        const w3 = writeIdx * 3;
        const i3 = i * 3;
        this._pool.positions[w3] = this._pool.positions[i3];
        this._pool.positions[w3 + 1] = this._pool.positions[i3 + 1];
        this._pool.positions[w3 + 2] = this._pool.positions[i3 + 2];
        this._pool.velocities[w3] = this._pool.velocities[i3];
        this._pool.velocities[w3 + 1] = this._pool.velocities[i3 + 1];
        this._pool.velocities[w3 + 2] = this._pool.velocities[i3 + 2];
        this._pool.colors[w3] = this._pool.colors[i3];
        this._pool.colors[w3 + 1] = this._pool.colors[i3 + 1];
        this._pool.colors[w3 + 2] = this._pool.colors[i3 + 2];
        this._pool.baseSizes[writeIdx] = this._pool.baseSizes[i];
        this._pool.maxLifetimes[writeIdx] = this._pool.maxLifetimes[i];
        this._pool.lifetimes[writeIdx] = this._pool.lifetimes[i];
      }
      writeIdx++;
    }
    this._pool.count = writeIdx;

    if (this._pool.count > 0) {
      this._active = true;
      this._group.visible = true;
    }

    this._geo.attributes.position.needsUpdate = true;
    this._geo.attributes.color.needsUpdate = true;
    this._geo.attributes.size.needsUpdate = true;
    this._geo.setDrawRange(0, this._pool.count);
  }

  reset(): void {
    this._warmupDone = false;
    this._active = false;
    this._pool.count = 0;
    this._group.visible = false;
  }

  /** Emit particles based on engine thrust — frozen during QA */
  emit(thrust: number, worldPos: [number, number, number], _dt: number): void {
    if (thrust < 0.05) {
      this._active = false;
      return;
    }

    this._active = true;
    // Emit rate proportional to thrust, capped per-frame
    const emitCount = Math.floor(thrust * 12);
    for (let i = 0; i < emitCount; i++) {
      const spread = thrust * 0.6;
      const speed = 2 + thrust * 4 + this._rng() * 3;

      // Color zones: core white, inner orange, outer red, edge blue
      const t = this._rng();
      let color: [number, number, number];
      if (t < 0.25) {
        color = [1.0, 0.95, 0.8]; // White-hot core
      } else if (t < 0.6) {
        color = [1.0, 0.45 + thrust * 0.3, 0.05]; // Yellow-orange
      } else if (t < 0.85) {
        color = [1.0, 0.2, 0.02]; // Red outer
      } else {
        color = [0.3, 0.4, 1.0]; // Blue ionization edge
      }

      addParticle(
        this._pool,
        [
          worldPos[0] + (this._rng() - 0.5) * 0.3,
          worldPos[1] - 6,
          worldPos[2] + (this._rng() - 0.5) * 0.3,
        ],
        [(this._rng() - 0.5) * spread, -speed, (this._rng() - 0.5) * spread],
        color,
        0.5 + this._rng() * 0.7,
        0.2 + this._rng() * 0.6 * thrust,
      );
    }
  }

  /** Update particles — skip update during QA freeze for determinism */
  update(dt: number, qaFrozen = false): void {
    if (this._active && !qaFrozen) {
      updatePool(this._pool, dt);
    } else if (this._active && qaFrozen) {
      // During QA freeze: keep particles at their current positions but
      // recompute sizes based on pre-stored lifetimes for visual presence
      let writeIdx = 0;
      for (let i = 0; i < this._pool.count; i++) {
        const lifeRatio = this._pool.lifetimes[i] / this._pool.maxLifetimes[i];
        if (lifeRatio >= 1.0) continue;

        const baseSize = this._pool.baseSizes[i];
        this._pool.sizes[writeIdx] = baseSize * (1.0 + lifeRatio * 1.5);
        this._pool.alphas[writeIdx] = lifeRatio > 0.6 ? 1.0 - smoothstep(0.6, 1.0, lifeRatio) : 1.0;

        if (writeIdx !== i) {
          const w3 = writeIdx * 3;
          const i3 = i * 3;
          this._pool.positions[w3] = this._pool.positions[i3];
          this._pool.positions[w3 + 1] = this._pool.positions[i3 + 1];
          this._pool.positions[w3 + 2] = this._pool.positions[i3 + 2];
          this._pool.velocities[w3] = this._pool.velocities[i3];
          this._pool.velocities[w3 + 1] = this._pool.velocities[i3 + 1];
          this._pool.velocities[w3 + 2] = this._pool.velocities[i3 + 2];
          this._pool.colors[w3] = this._pool.colors[i3];
          this._pool.colors[w3 + 1] = this._pool.colors[i3 + 1];
          this._pool.colors[w3 + 2] = this._pool.colors[i3 + 2];
        }
        writeIdx++;
      }
      this._pool.count = writeIdx;
    }

    this._geo.attributes.position.needsUpdate = true;
    this._geo.attributes.color.needsUpdate = true;
    this._geo.attributes.size.needsUpdate = true;
    this._geo.setDrawRange(0, this._pool.count);
    this._group.visible = this._active && this._pool.count > 0;
  }

  dispose(): void {
    this._geo.dispose();
    (this._points.material as THREE.ShaderMaterial).dispose();
  }
}

// ── Dust/vapor particle system (ground interaction) ────────────────────────

export class DustSystem {
  private _pool: ParticleData;
  private _rng: ReturnType<typeof createRng>;
  private _group: THREE.Group;
  private _points: THREE.Points;
  private _geo: THREE.BufferGeometry;
  private _active = false;
  private _warmupDone = false;

  get group(): THREE.Group {
    return this._group;
  }
  get warmupDone(): boolean {
    return this._warmupDone;
  }

  constructor(seed: number = DEFAULT_SEED + 1) {
    this._rng = createRng(seed);
    this._pool = createParticlePool(400);

    this._group = new THREE.Group();
    this._geo = new THREE.BufferGeometry();
    this._geo.setAttribute('position', new THREE.BufferAttribute(this._pool.positions, 3));
    this._geo.setAttribute('color', new THREE.BufferAttribute(this._pool.colors, 3, true));
    this._geo.setAttribute('size', new THREE.BufferAttribute(this._pool.sizes, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTexture: { value: getGlowTexture() },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      },
      vertexShader: `
        attribute float size;
        attribute vec3 color;
        varying vec3 vColor;
        uniform float uPixelRatio;

        void main() {
          vColor = color;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = max(size * uPixelRatio * (200.0 / -mvPos.z), 1.0);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        uniform sampler2D uTexture;
        varying vec3 vColor;

        void main() {
          vec4 tex = texture2D(uTexture, gl_PointCoord);
          gl_FragColor = vec4(vColor, tex.a * 0.45);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    this._points = new THREE.Points(this._geo, mat);
    this._group.add(this._points);
    this._group.visible = false;
  }

  /** Warm-up: deterministically seed dust particles for QA freeze. */
  warmUp(thrust: number, padCenter: [number, number, number], duration: number): void {
    if (this._warmupDone) return;
    this._warmupDone = true;

    // Dust only active near touchdown, emit a restrained radial cloud
    const dustStart = Math.max(duration - 6, 0);
    const steps = Math.max(Math.floor(duration * 2), 10);
    for (let s = 0; s < steps; s++) {
      const t = dustStart + (s / steps) * (duration - dustStart);
      let simThrust = 0;
      if (t >= 20 && t < 34) {
        const bs = easeInQuad(clamp((t - 20) / 2, 0, 1));
        const bp = 1 - easeOutQuad(clamp((t - 26) / 5, 0, 1));
        simThrust = clamp(bs + bp * 0.3 * clamp((t - 26) / 8, 0, 1), 0.15, 1);
      } else if (t >= 34) {
        simThrust = Math.max(0.15 - (t - 34) * 0.05, 0);
      }

      if (simThrust < 0.15 || padCenter[1] > 15) continue;

      const count = Math.min(Math.floor(simThrust * 3), 4);
      for (let i = 0; i < count && this._pool.count < this._pool.capacity; i++) {
        const angle = this._rng() * Math.PI * 2;
        const dist = 1 + this._rng() * 5 * simThrust;
        const speed = 1 + this._rng() * 3 * simThrust;

        addParticle(
          this._pool,
          [
            padCenter[0] + Math.cos(angle) * dist,
            padCenter[1] + 0.2 + this._rng() * 0.5,
            padCenter[2] + Math.sin(angle) * dist,
          ],
          [
            Math.cos(angle) * speed * 0.4,
            0.8 + this._rng() * speed * 0.4,
            Math.sin(angle) * speed * 0.4,
          ],
          [0.65, 0.55, 0.42],
          1.5 + this._rng() * 2,
          0.5 + this._rng() * 1.2,
        );
      }
    }

    // Compact pool
    let writeIdx = 0;
    for (let i = 0; i < this._pool.count; i++) {
      const lifeRatio = this._pool.lifetimes[i] / this._pool.maxLifetimes[i];
      if (lifeRatio >= 1.0) continue;

      const baseSize = this._pool.baseSizes[i];
      this._pool.sizes[writeIdx] = baseSize * (1.0 + lifeRatio * 1.5);
      this._pool.alphas[writeIdx] = lifeRatio > 0.6 ? 1.0 - smoothstep(0.6, 1.0, lifeRatio) : 1.0;

      if (this._pool.positions[i * 3 + 1] < -2) continue;

      const w3 = writeIdx * 3;
      const i3 = i * 3;
      this._pool.positions[w3] = this._pool.positions[i3];
      this._pool.positions[w3 + 1] = this._pool.positions[i3 + 1];
      this._pool.positions[w3 + 2] = this._pool.positions[i3 + 2];
      this._pool.velocities[w3] = this._pool.velocities[i3];
      this._pool.velocities[w3 + 1] = this._pool.velocities[i3 + 1];
      this._pool.velocities[w3 + 2] = this._pool.velocities[i3 + 2];
      this._pool.colors[w3] = this._pool.colors[i3];
      this._pool.colors[w3 + 1] = this._pool.colors[i3 + 1];
      this._pool.colors[w3 + 2] = this._pool.colors[i3 + 2];

      if (writeIdx !== i) {
        this._pool.baseSizes[writeIdx] = this._pool.baseSizes[i];
        this._pool.maxLifetimes[writeIdx] = this._pool.maxLifetimes[i];
        this._pool.lifetimes[writeIdx] = this._pool.lifetimes[i];
      }
      writeIdx++;
    }
    this._pool.count = writeIdx;

    if (this._pool.count > 0) {
      this._active = true;
      this._group.visible = true;
    }

    this._geo.attributes.position.needsUpdate = true;
    this._geo.attributes.color.needsUpdate = true;
    this._geo.attributes.size.needsUpdate = true;
    this._geo.setDrawRange(0, this._pool.count);
  }

  reset(): void {
    this._warmupDone = false;
    this._active = false;
    this._pool.count = 0;
    this._group.visible = false;
  }

  emit(thrust: number, padCenter: [number, number, number]): void {
    if (thrust < 0.15) return;

    const count = Math.min(Math.floor(thrust * 5), 8);
    for (let i = 0; i < count; i++) {
      const angle = this._rng() * Math.PI * 2;
      const dist = 1 + this._rng() * 5 * thrust;
      const speed = 1 + this._rng() * 3 * thrust;

      addParticle(
        this._pool,
        [
          padCenter[0] + Math.cos(angle) * dist,
          padCenter[1] + 0.2 + this._rng() * 0.5,
          padCenter[2] + Math.sin(angle) * dist,
        ],
        [
          Math.cos(angle) * speed * 0.4,
          0.8 + this._rng() * speed * 0.4,
          Math.sin(angle) * speed * 0.4,
        ],
        [0.65, 0.55, 0.42],
        1.5 + this._rng() * 2,
        0.5 + this._rng() * 1.2,
      );
    }
  }

  update(_dt: number, qaFrozen = false): void {
    if (!qaFrozen) {
      updatePool(this._pool, _dt);
    } else {
      // During QA freeze: compact without advancing lifetimes
      let writeIdx = 0;
      for (let i = 0; i < this._pool.count; i++) {
        const lifeRatio = this._pool.lifetimes[i] / this._pool.maxLifetimes[i];
        if (lifeRatio >= 1.0) continue;

        const baseSize = this._pool.baseSizes[i];
        this._pool.sizes[writeIdx] = baseSize * (1.0 + lifeRatio * 1.5);
        this._pool.alphas[writeIdx] = lifeRatio > 0.6 ? 1.0 - smoothstep(0.6, 1.0, lifeRatio) : 1.0;

        if (this._pool.positions[i * 3 + 1] < -2) continue;

        const w3 = writeIdx * 3;
        const i3 = i * 3;
        this._pool.positions[w3] = this._pool.positions[i3];
        this._pool.positions[w3 + 1] = this._pool.positions[i3 + 1];
        this._pool.positions[w3 + 2] = this._pool.positions[i3 + 2];
        this._pool.velocities[w3] = this._pool.velocities[i3];
        this._pool.velocities[w3 + 1] = this._pool.velocities[i3 + 1];
        this._pool.velocities[w3 + 2] = this._pool.velocities[i3 + 2];
        this._pool.colors[w3] = this._pool.colors[i3];
        this._pool.colors[w3 + 1] = this._pool.colors[i3 + 1];
        this._pool.colors[w3 + 2] = this._pool.colors[i3 + 2];

        if (writeIdx !== i) {
          this._pool.baseSizes[writeIdx] = this._pool.baseSizes[i];
        }
        writeIdx++;
      }
      this._pool.count = writeIdx;
    }

    this._geo.attributes.position.needsUpdate = true;
    this._geo.attributes.color.needsUpdate = true;
    this._geo.attributes.size.needsUpdate = true;
    this._geo.setDrawRange(0, this._pool.count);
    this._group.visible = this._pool.count > 0;
  }

  dispose(): void {
    this._geo.dispose();
    (this._points.material as THREE.ShaderMaterial).dispose();
  }
}

// ── Persistent layered flame mesh for landing burn ─────────────────────────

export class FlameMesh {
  private _group: THREE.Group;
  private _outerFlame: THREE.Mesh;
  private _innerFlame: THREE.Mesh;
  private _coreFlame: THREE.Mesh;

  get group(): THREE.Group {
    return this._group;
  }

  constructor() {
    this._group = new THREE.Group();
    this._group.visible = false;

    // Outer flame — elongated cone with additive blending
    const outerGeo = new THREE.ConeGeometry(1.2, 5, 16);
    const outerMat = new THREE.MeshBasicMaterial({
      color: 0xff4400,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this._outerFlame = new THREE.Mesh(outerGeo, outerMat);

    // Inner flame — elongated cone, yellow-white
    const innerGeo = new THREE.ConeGeometry(0.7, 3.5, 16);
    const innerMat = new THREE.MeshBasicMaterial({
      color: 0xffcc33,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this._innerFlame = new THREE.Mesh(innerGeo, innerMat);

    // Core flame — small white cone at nozzle
    const coreGeo = new THREE.ConeGeometry(0.35, 2, 16);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this._coreFlame = new THREE.Mesh(coreGeo, coreMat);

    // All flames point downward (rotate cone 180°)
    this._outerFlame.rotation.x = Math.PI;
    this._innerFlame.rotation.x = Math.PI;
    this._coreFlame.rotation.x = Math.PI;

    this._group.add(this._outerFlame);
    this._group.add(this._innerFlame);
    this._group.add(this._coreFlame);
  }

  /** Update scale/position based on thrust level */
  update(thrust: number, worldPos: [number, number, number]): void {
    if (thrust < 0.05) {
      this._group.visible = false;
      return;
    }

    this._group.visible = true;
    const scale = thrust;
    this._outerFlame.scale.set(scale, scale * (1 + thrust), scale);
    this._innerFlame.scale.set(scale * 0.8, scale * (0.7 + thrust * 0.5), scale * 0.8);
    this._coreFlame.scale.set(scale * 0.4, scale * (0.3 + thrust * 0.3), scale * 0.4);

    // Position at nozzle tip (rocket base - 6)
    this._group.position.set(worldPos[0], worldPos[1] - 7.2, worldPos[2]);
  }

  dispose(): void {
    this._outerFlame.geometry.dispose();
    (this._outerFlame.material as THREE.Material).dispose();
    this._innerFlame.geometry.dispose();
    (this._innerFlame.material as THREE.Material).dispose();
    this._coreFlame.geometry.dispose();
    (this._coreFlame.material as THREE.Material).dispose();
  }
}
