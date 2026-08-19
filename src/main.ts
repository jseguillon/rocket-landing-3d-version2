import * as THREE from 'three';
import { SceneRenderer } from './engine/Scene.js';
import { EnvironmentBuilder } from './engine/Environment.js';
import { RocketBuilder } from './engine/Rocket.js';
import { CameraDirector } from './engine/Camera.js';
import { ManualCameraController } from './engine/CameraMode.js';
import { PlumeSystem, DustSystem, FlameMesh } from './engine/Particles.js';
import { PostProcessor } from './engine/PostProcessing.js';
import { TimelineEngine } from './engine/Timeline.js';
import { TelemetryUI } from './ui/Telemetry.js';
import { ControlsUI } from './ui/Controls.js';
import {
  parseQAQuery,
  prefersReducedMotion,
  DEFAULT_SEED,
  TOTAL_DURATION,
  type PhaseName,
  type RocketQAPI,
} from './types.js';

import type { BlendMode } from './engine/CameraMode.js';

// ─── Audio Engine (WebAudio synthesized ambience) ────────────────────────────

class AudioEngine {
  private _ctx: AudioContext | null = null;
  private _masterGain: GainNode | null = null;
  private _engineOsc: OscillatorNode | null = null;
  private _engineGain: GainNode | null = null;
  private _noiseSource: AudioBufferSourceNode | null = null;
  private _noiseGain: GainNode | null = null;
  private _muted = false;
  private _initialized = false;

  get muted(): boolean {
    return this._muted;
  }

  init(): void {
    if (this._initialized) return;
    try {
      this._ctx = new AudioContext();
      this._masterGain = this._ctx.createGain();
      this._masterGain.connect(this._ctx.destination);
      this._updateMute();
      this._initialized = true;
    } catch {
      console.warn('WebAudio not available, audio disabled.');
      this._muted = true;
    }
  }

  startEngine(thrust: number): void {
    if (!this._ctx || !this._masterGain) return;
    if (this._engineOsc) return; // already playing

    // Low rumble oscillator for engine
    this._engineOsc = this._ctx.createOscillator();
    this._engineOsc.type = 'sawtooth';
    this._engineOsc.frequency.value = 55 + thrust * 30;
    this._engineGain = this._ctx.createGain();
    this._engineGain.gain.value = this._muted ? 0 : thrust * 0.12;
    this._engineOsc.connect(this._engineGain);
    this._engineGain.connect(this._masterGain);
    this._engineOsc.start();

    // Noise buffer for rumble texture
    const bufferSize = this._ctx.sampleRate * 2;
    const noiseBuffer = this._ctx.createBuffer(1, bufferSize, this._ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.5;
    }
    this._noiseSource = this._ctx.createBufferSource();
    this._noiseSource.buffer = noiseBuffer;
    this._noiseSource.loop = true;
    const noiseFilter = this._ctx.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.value = 200 + thrust * 100;
    this._noiseGain = this._ctx.createGain();
    this._noiseGain.gain.value = this._muted ? 0 : thrust * 0.08;
    this._noiseSource.connect(noiseFilter);
    noiseFilter.connect(this._noiseGain);
    this._noiseGain.connect(this._masterGain);
    this._noiseSource.start();
  }

  updateEngine(thrust: number): void {
    if (!this._engineOsc || !this._engineGain || !this._noiseGain) return;
    this._engineOsc.frequency.setTargetAtTime(55 + thrust * 30, this._ctx!.currentTime, 0.1);
    const vol = this._muted ? 0 : thrust * 0.12;
    this._engineGain.gain.setTargetAtTime(vol, this._ctx!.currentTime, 0.1);
    this._noiseGain.gain.setTargetAtTime(
      this._muted ? 0 : thrust * 0.08,
      this._ctx!.currentTime,
      0.1,
    );
  }

  stopEngine(): void {
    if (this._engineOsc) {
      try {
        this._engineOsc.stop();
        this._engineOsc.disconnect();
      } catch {
        // already stopped
      }
      this._engineOsc = null;
    }
    if (this._noiseSource) {
      try {
        this._noiseSource.stop();
        this._noiseSource.disconnect();
      } catch {
        // already stopped
      }
      this._noiseSource = null;
    }
    this._engineGain = null;
    this._noiseGain = null;
  }

  setMuted(muted: boolean): void {
    this._muted = muted;
    this._updateMute();
  }

  private _updateMute(): void {
    if (!this._masterGain) return;
    this._masterGain.gain.setTargetAtTime(this._muted ? 0 : 1, this._ctx!.currentTime, 0.05);
  }

  toggle(): boolean {
    this._muted = !this._muted;
    this._updateMute();
    return this._muted;
  }

  async ensureStarted(): Promise<void> {
    if (!this._initialized) this.init();
    if (this._ctx && this._ctx.state === 'suspended') {
      await this._ctx.resume();
    }
  }

  destroy(): void {
    this.stopEngine();
    if (this._ctx) {
      try {
        this._ctx.close();
      } catch {
        // ignore
      }
    }
    this._initialized = false;
  }
}

// ─── Main Application ───────────────────────────────────────────────────────

class App {
  private _timeline!: TimelineEngine;
  private _scene!: SceneRenderer;
  private _rocket!: RocketBuilder;
  private _cameraDir!: CameraDirector;
  private _manualCamera!: ManualCameraController;
  private _modeIndicator!: HTMLElement;
  private _plume!: PlumeSystem;
  private _dust!: DustSystem;
  private _flame!: FlameMesh;
  private _postProcessor!: PostProcessor;
  private _telemetry!: TelemetryUI;
  private _controls!: ControlsUI;
  private _engineLight!: THREE.PointLight;
  private _lastTime = 0;
  private _frameId = 0;
  private _reducedMotion = false;
  private _isReady = false;
  private _audio = new AudioEngine();
  private _engineActive = false;
  private _autoRestartTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const qa = parseQAQuery();
    this._reducedMotion = prefersReducedMotion();
    const seed = qa.seed ?? DEFAULT_SEED;

    // Timeline engine (state, no rendering)
    this._timeline = new TimelineEngine(seed, qa.qaPercent);

    try {
      const container = document.getElementById('app')!;
      this._scene = new SceneRenderer(container);

      const envBuilder = new EnvironmentBuilder(seed);
      envBuilder.build(this._scene.scene);

      // Find engine light for dynamic positioning
      const engineLight = this._scene.scene.children.find((c) => c instanceof THREE.PointLight) as
        THREE.PointLight | undefined;
      if (!engineLight) throw new Error('Engine light not found');
      this._engineLight = engineLight;

      // Rocket model
      this._rocket = new RocketBuilder();
      this._scene.scene.add(this._rocket.group);

      // Particle systems (persistent geometry, no create/dispose per frame)
      this._plume = new PlumeSystem(seed + 2);
      this._scene.scene.add(this._plume.group);

      this._dust = new DustSystem(seed + 3);
      this._scene.scene.add(this._dust.group);

      // Persistent layered flame mesh (guaranteed visible during burn)
      this._flame = new FlameMesh();
      this._scene.scene.add(this._flame.group);

      // Camera director
      this._cameraDir = new CameraDirector(this._scene.camera);

      // Manual camera controller (mouse/touch drag orbit + auto-return)
      this._manualCamera = new ManualCameraController(this._scene.renderer.domElement, () =>
        this._cameraDir.getCameraPosition(),
      );

      // Mode indicator element
      const modeDiv = document.createElement('div');
      this._modeIndicator = container.appendChild(modeDiv);
      this._modeIndicator.className = 'camera-mode';
      this._modeIndicator.setAttribute('role', 'status');
      this._modeIndicator.setAttribute('aria-live', 'polite');
      this._modeIndicator.setAttribute('aria-label', 'Camera mode: cinematic follow');

      // Get initial dimensions for post-processing
      const dims = this._scene.getDimensions();
      this._postProcessor = new PostProcessor(this._scene.renderer, dims.width, dims.height);

      // UI overlays
      this._telemetry = new TelemetryUI(container);
      this._controls = new ControlsUI(container, {
        onPlay: () => this._onPlay(),
        onPause: () => this._onPause(),
        onReplay: () => this._onReplay(),
        onMute: (muted: boolean) => this._audio.setMuted(muted),
      });

      // Keyboard controls already handled by ControlsUI

      // Hide loading screen properly (display: none, not just hidden class)
      this._hideLoadingScreen();

      // Expose typed QA API on window
      this._exposeQA();

      this._isReady = true;

      // Apply reduced motion → set hero camera position immediately
      if (this._reducedMotion) {
        // First set timeline to final hero time so rocket state is correct
        this._timeline.setQAPercent(100);
        const heroRocketState = this._timeline.getRocketState();

        // Update rocket visual to landed position
        this._rocket.update(heroRocketState, TOTAL_DURATION);

        // Visual center offset for camera placement
        const visY = heroRocketState.position[1] + 6;

        // Set camera to a good hero angle (above ground, three-quarter view)
        this._cameraDir.setFixed(
          new THREE.Vector3(heroRocketState.position[0] + 8, visY - 1 + 3, 10),
          new THREE.Vector3(heroRocketState.position[0], visY, 0),
        );

        // Hide particles in reduced motion mode (no animation)
        this._plume.group.visible = false;
        this._dust.group.visible = false;
        this._flame.group.visible = false;

        // Update telemetry to hero state
        this._telemetry.update(this._timeline.getTelemetry());
        this._controls.setPlaying(false);
      }

      // Start render loop (paused initially for user gesture audio)
      this._lastTime = performance.now();
      this._loop(performance.now());

      // Auto-start audio on first interaction
      const startAudio = async () => {
        await this._audio.ensureStarted();
        document.removeEventListener('click', startAudio);
        document.removeEventListener('keydown', startAudio);
        document.removeEventListener('touchstart', startAudio);
      };
      document.addEventListener('click', startAudio);
      document.addEventListener('keydown', startAudio);
      document.addEventListener('touchstart', startAudio);
    } catch (err) {
      console.error('Failed to initialize experience:', err);
      const container = document.getElementById('app')!;
      const msg = document.createElement('div');
      msg.setAttribute('role', 'alert');
      msg.style.cssText = `
        position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
        background: #0a0a1a; color: #e94560; font-family: system-ui, sans-serif;
        padding: 2em; text-align: center; z-index: 1000;
      `;
      msg.textContent =
        "Failed to initialize the 3D experience. Please check your browser's WebGL support.";
      container.appendChild(msg);

      // Expose minimal QA API even on failure
      (window as unknown as Record<string, RocketQAPI>).__rocketQA = {
        getTime: () => null,
        setState: () => {},
        setCheckpoint: () => {},
        play: () => {},
        pause: () => {},
        getCameraState: () => null,
        isReady: false,
      };
    }
  }

  private _hideLoadingScreen(): void {
    const loading = document.getElementById('loading-screen');
    if (loading) {
      loading.classList.add('hidden');
      // Use requestAnimationFrame to ensure DOM has settled before hiding
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          loading.style.display = 'none';
        });
      });
    }
  }

  private _onPlay(): void {
    this._timeline.play();
  }
  private _onPause(): void {
    this._timeline.pause();
  }
  private _onReplay(): void {
    this._timeline.reset();
    // Clear any auto-restart timeout
    if (this._autoRestartTimeout) {
      clearTimeout(this._autoRestartTimeout);
      this._autoRestartTimeout = null;
    }
    // Reset particle warm-up so QA seeding re-runs on next freeze
    this._plume.reset();
    this._dust.reset();
    // Reset manual camera to follow mode
    this._manualCamera.reset();
  }

  private _exposeQA(): void {
    const api: RocketQAPI = {
      isReady: false, // will be set below
      getTime: () => (this._isReady ? this._timeline.time : null),
      setState: (timeSeconds: number) => {
        if (!this._isReady) return;
        const clampedTime = Math.max(0, Math.min(TOTAL_DURATION, timeSeconds));
        const pct = (clampedTime / TOTAL_DURATION) * 100;
        this._timeline.setQAPercent(pct);
      },
      setCheckpoint: (phase: PhaseName) => {
        if (!this._isReady) return;
        const cpMap: Record<PhaseName, number> = {
          approach: 0,
          descent: 5,
          entry: 12,
          'landing-burn': 20,
          'leg-deploy': 27,
          touchdown: 31,
          hero: 35,
        };
        const time = cpMap[phase] ?? 0;
        this._timeline.setQAPercent((time / TOTAL_DURATION) * 100);
      },
      play: () => {
        if (!this._isReady) return;
        this._timeline.play();
      },
      pause: () => {
        if (!this._isReady) return;
        this._timeline.pause();
      },
      getCameraState: () => this._getCameraState(),
    };
    // Update isReady after assignment so it reflects initialization status
    api.isReady = true;
    (window as unknown as Record<string, RocketQAPI>).__rocketQA = api;
  }

  private _getCameraState(): {
    mode: BlendMode;
    weight: number;
    theta: number;
    phi: number;
    radius: number;
  } | null {
    if (!this._isReady) return null;
    const blend = this._manualCamera.getBlendState();
    const state = this._manualCamera.getState();
    return {
      mode: blend.mode,
      weight: blend.weight,
      theta: state.theta,
      phi: state.phi,
      radius: state.radius,
    };
  }

  private _loop = (now: number): void => {
    this._frameId = requestAnimationFrame(this._loop);

    const dt = Math.min((now - this._lastTime) / 1000, 0.1);
    this._lastTime = now;

    // Determine if we're in QA freeze mode (no animation updates)
    const qaFrozen = this._timeline._qaPercentValue !== undefined && this._timeline._finishedValue;

    // Update timeline (does nothing during QA freeze)
    this._timeline.update(dt);

    const state = this._timeline.getState();
    const rocketState = state.rocketState;

    // Visual rocket position: altitude + offset so the full model sits above ground
    const visualRocketPosition: [number, number, number] = [
      rocketState.position[0],
      rocketState.position[1] + 6,
      rocketState.position[2],
    ];

    // Deterministic QA particle warm-up: seed plume/dust once at initialization
    if (qaFrozen && !this._plume.warmupDone && rocketState.engineActive) {
      this._plume.warmUp(rocketState.engineThrust, visualRocketPosition, state.time);
      if (rocketState.position[1] < 15) {
        this._dust.warmUp(rocketState.engineThrust, [0, 0.3, 0], state.time);
      }
    }

    // Update rocket visual
    this._rocket.update(rocketState, state.time);

    // Determine if engine is active for flame/particles/audio
    if (rocketState.engineActive && !this._engineActive) {
      this._audio.startEngine(rocketState.engineThrust);
      this._engineActive = true;
    } else if (!rocketState.engineActive && this._engineActive) {
      this._audio.stopEngine();
      this._engineActive = false;
    }

    // Emit and update particles — frozen during QA for determinism
    if (rocketState.engineActive && !qaFrozen) {
      this._plume.emit(rocketState.engineThrust, visualRocketPosition, dt);
      if (rocketState.position[1] < 15) {
        this._dust.emit(rocketState.engineThrust, [0, 0.3, 0]);
      }
    }
    this._plume.update(dt, qaFrozen);
    this._dust.update(dt, qaFrozen);

    // Update flame mesh (always visible during burn, not frozen)
    if (rocketState.engineActive) {
      this._flame.update(rocketState.engineThrust, visualRocketPosition);
    } else {
      this._flame.group.visible = false;
    }

    // Engine audio update
    if (this._engineActive) {
      this._audio.updateEngine(rocketState.engineThrust);
    }

    // Update engine light position — nozzle at visualRocketPosition.y - 6
    this._engineLight.position.set(
      visualRocketPosition[0],
      visualRocketPosition[1] - 6,
      visualRocketPosition[2],
    );
    this._engineLight.intensity =
      rocketState.engineThrust > 0.01
        ? rocketState.engineThrust * 8
        : this._engineLight.intensity * 0.95;

    // Camera choreography — blend between cinematic follow and manual orbit
    if (!this._reducedMotion) {
      const qaFrozen = this._timeline._qaPercentValue !== undefined;

      // Always update manual camera state so inactivity timer and blend-out progress normally
      const [rx, ry, rz] = rocketState.position;
      const visualCenterY = ry + 6;
      this._manualCamera.updateFocusPoint(rx, visualCenterY, rz);
      this._manualCamera.updateFrame(now);

      if (qaFrozen) {
        // In QA freeze mode, use pure cinematic camera path only (preserve manual state)
        this._cameraDir.update(state.phase, state.time, rocketState);
      } else {
        const blend = this._manualCamera.getBlendState();
        const manualPos = this._manualCamera.getPosition();

        if (blend.weight >= 0.99) {
          // Fully in manual mode — set position directly, look at focus point
          this._cameraDir.getCameraPosition() && this._scene.camera.position.copy(manualPos);
          this._scene.camera.lookAt(rx, visualCenterY, rz);
        } else if (blend.weight > 0.01) {
          // Blending — interpolate between cinematic and manual positions
          const cinematicTarget = this._cameraDir.getCinematicTarget(
            state.phase,
            state.time,
            rocketState,
          );
          if (cinematicTarget) {
            const smoothWeight = blend.weight;
            const blendedX = cinematicTarget.x + (manualPos.x - cinematicTarget.x) * smoothWeight;
            const blendedY = cinematicTarget.y + (manualPos.y - cinematicTarget.y) * smoothWeight;
            const blendedZ = cinematicTarget.z + (manualPos.z - cinematicTarget.z) * smoothWeight;
            this._scene.camera.position.set(blendedX, blendedY, blendedZ);
          } else {
            this._scene.camera.position.copy(manualPos);
          }
          this._scene.camera.lookAt(rx, visualCenterY, rz);

          // Keep prevPos in sync for cinematic smoothing on return
          this._cameraDir.syncPrevPosition(this._scene.camera.position);
        } else {
          // Fully cinematic — use normal update path
          this._cameraDir.update(state.phase, state.time, rocketState);
        }
      }

      // Update mode indicator
      const blend2 = this._manualCamera.getBlendState();
      if (blend2.mode === 'manual' && blend2.weight >= 0.99) {
        this._modeIndicator.className = 'camera-mode active';
        this._modeIndicator.textContent = 'MANUAL';
        this._modeIndicator.setAttribute(
          'aria-label',
          'Camera mode: manual orbit — returns after 3 seconds of inactivity',
        );
      } else if (blend2.mode === 'returning') {
        this._modeIndicator.className = 'camera-mode returning';
        this._modeIndicator.textContent = 'RETURNING';
        this._modeIndicator.setAttribute(
          'aria-label',
          'Camera mode: returning to cinematic follow',
        );
      } else {
        this._modeIndicator.className = 'camera-mode';
        this._modeIndicator.textContent = '';
        this._modeIndicator.setAttribute('aria-label', 'Camera mode: cinematic follow');
      }
    }

    // Resize post-processing if viewport changed
    const dims = this._scene.getDimensions();
    this._postProcessor.resize(dims.width, dims.height);

    // Render with post-processing
    this._postProcessor.render(this._scene.scene, this._scene.camera, state.time);

    // Update UI
    this._telemetry.update(state.telemetry);
    this._controls.setPlaying(state.playing);

    // Auto-restart on completion (loop) — only if not in QA mode
    if (!state.playing && state.time >= state.duration && !this._timeline.paused) {
      if (this._autoRestartTimeout) clearTimeout(this._autoRestartTimeout);
      this._autoRestartTimeout = setTimeout(() => {
        if (!this._timeline.playing) {
          this._timeline.reset();
        }
      }, 2000);
    }
  };

  destroy(): void {
    cancelAnimationFrame(this._frameId);
    if (this._autoRestartTimeout) clearTimeout(this._autoRestartTimeout);
    this._postProcessor.dispose();
    this._plume.dispose();
    this._dust.dispose();
    this._flame.dispose();
    this._scene.renderer.dispose();
    this._audio.destroy();
    this._manualCamera.destroy();
  }
}

// ─── Bootstrap ──────────────────────────────────────────────────────────────

const app = new App();
window.addEventListener('beforeunload', () => app.destroy());
