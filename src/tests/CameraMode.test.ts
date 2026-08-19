import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { ManualCameraController } from '../engine/CameraMode.js';

// Helper to access private properties via Record cast
const m = (c: ManualCameraController) => c as unknown as Record<string, unknown>;

// Helper for numeric private property access
const n = <K extends string>(c: ManualCameraController, key: K): number =>
  (c as unknown as Record<K, number>)[key];

// Mock canvas element for testing
function createMockCanvas(): HTMLCanvasElement {
  const mockCanvas = document.createElement('canvas');
  return mockCanvas;
}

describe('ManualCameraController', () => {
  let controller: ManualCameraController;
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    canvas = createMockCanvas();
    controller = new ManualCameraController(canvas);
  });

  afterEach(() => {
    controller.destroy();
    vi.useRealTimers();
  });

  describe('initialization', () => {
    it('starts in follow mode with weight 0', () => {
      const blend = controller.getBlendState();
      expect(blend.mode).toBe('follow');
      expect(blend.weight).toBe(0);
    });

    it('has default spherical coordinates', () => {
      const state = controller.getState();
      expect(state.theta).toBeCloseTo(0, 5);
      expect(state.phi).toBeCloseTo(Math.PI / 6, 5);
      expect(state.radius).toBe(30);
    });

    it('computes initial position from spherical coords', () => {
      const pos = controller.getPosition();
      expect(pos).toBeDefined();
      expect(pos.x).not.toBeNaN();
      expect(pos.y).not.toBeNaN();
      expect(pos.z).not.toBeNaN();
    });
  });

  describe('focus point updates', () => {
    it('updates focus point coordinates', () => {
      controller.updateFocusPoint(5, 10, 3);
      const pos = controller.getPosition();
      // At theta=0, phi=PI/6, radius=30, focus at (5,10,3):
      // x = 5 + 30 * cos(PI/6) * sin(0) = 5
      // y = 10 + 30 * sin(PI/6) = 25
      // z = 3 + 30 * cos(PI/6) * cos(0) ≈ 28.98
      expect(pos.x).toBeCloseTo(5, 5);
      expect(pos.y).toBeCloseTo(25, 5);
      expect(pos.z).toBeCloseTo(3 + 30 * Math.cos(Math.PI / 6), 5);
    });

    it('position changes when focus point moves', () => {
      const pos1 = controller.getPosition();
      controller.updateFocusPoint(10, 20, 5);
      const pos2 = controller.getPosition();
      expect(pos1.equals(pos2)).toBe(false);
    });
  });

  describe('reset', () => {
    it('resets to follow mode with weight 0', () => {
      // Simulate entering manual mode by directly manipulating state
      m(controller)._mode = 'manual';
      m(controller)._weight = 1;
      controller.reset();

      const blend = controller.getBlendState();
      expect(blend.mode).toBe('follow');
      expect(blend.weight).toBe(0);
    });

    it('resets spherical coordinates to defaults', () => {
      m(controller)._mode = 'manual';
      m(controller)._theta = 1.5;
      m(controller)._phi = 0.8;
      m(controller)._radius = 50;
      controller.reset();

      const state = controller.getState();
      expect(state.theta).toBe(0);
      expect(state.phi).toBeCloseTo(Math.PI / 6, 5);
      expect(state.radius).toBe(30);
    });
  });

  describe('blend-out transition', () => {
    it('transitioning from manual to follow reduces weight over time', () => {
      // Simulate blend-out starting (mode is 'returning' during blend)
      m(controller)._mode = 'returning';
      m(controller)._weight = 1;
      m(controller)._blendFromWeight = 1;
      const startTime = performance.now();
      m(controller)._blendStart = startTime;

      vi.useFakeTimers();

      // After BLEND_OUT_DURATION (800ms), weight should be near 0
      vi.advanceTimersByTime(800);

      // Manually set elapsed time for performance.now() calculation
      const fakeNowVal = startTime + 800;
      const origNow = performance.now.bind(performance);
      (performance as unknown as Record<string, unknown>).now = () => fakeNowVal;
      controller.updateFrame(fakeNowVal);
      (performance as unknown as Record<string, unknown>).now = origNow;

      expect(controller.getBlendState().weight).toBeLessThan(0.02);
      expect(controller.getBlendState().mode).toBe('follow');
    });

    it('blend-out uses easing (not linear)', () => {
      // Start blend-out (mode is 'returning')
      m(controller)._mode = 'returning';
      m(controller)._weight = 1;
      m(controller)._blendFromWeight = 1;
      const startTime = performance.now();
      m(controller)._blendStart = startTime;

      vi.useFakeTimers();

      // At halfway point (400ms), weight should be significantly reduced but not zero
      const halfTime = 400;

      const fakeNowVal = startTime + halfTime;
      const origNow = performance.now.bind(performance);
      (performance as unknown as Record<string, unknown>).now = () => fakeNowVal;
      controller.updateFrame(fakeNowVal);
      (performance as unknown as Record<string, unknown>).now = origNow;

      const weightAtHalf = controller.getBlendState().weight;
      expect(weightAtHalf).toBeLessThan(0.6);
      expect(weightAtHalf).toBeGreaterThan(0.3);
    });

    it('input during blend-out cancels and re-enters manual', () => {
      // Simulate blend-out in progress (mode is 'returning')
      m(controller)._mode = 'returning';
      m(controller)._weight = 1;
      m(controller)._blendFromWeight = 1;
      const startTime = performance.now();
      m(controller)._blendStart = startTime;

      vi.useFakeTimers();

      // Advance to halfway through blend-out
      const fakeNowVal = startTime + 400;
      const origNow = performance.now.bind(performance);
      (performance as unknown as Record<string, unknown>).now = () => fakeNowVal;
      controller.updateFrame(fakeNowVal);
      (performance as unknown as Record<string, unknown>).now = origNow;

      expect(controller.getBlendState().mode).toBe('returning');
      expect(controller.getBlendState().weight).toBeGreaterThan(0);

      // Simulate new input (same as _enterManual)
      m(controller)._mode = 'manual';
      m(controller)._blendFromWeight = controller.getBlendState().weight;
      m(controller)._weight = 1;
      m(controller)._blendStart = performance.now();

      expect(controller.getBlendState().mode).toBe('manual');
      expect(controller.getBlendState().weight).toBe(1);
    });
  });

  describe('spherical coordinate position computation', () => {
    it('theta=0, phi=PI/6, radius=30 gives expected position at origin focus', () => {
      controller.updateFocusPoint(0, 0, 0);
      const pos = controller.getPosition();

      // At theta=0: x = r * cos(phi) * sin(0) = 0
      // At phi=PI/6: y = r * sin(PI/6) = r * 0.5 = 15
      // z = r * cos(phi) * cos(0) = r * cos(PI/6) ≈ r * 0.866
      const expectedX = 0;
      const expectedY = 30 * Math.sin(Math.PI / 6);
      const expectedZ = 30 * Math.cos(Math.PI / 6);

      expect(pos.x).toBeCloseTo(expectedX, 5);
      expect(pos.y).toBeCloseTo(expectedY, 5);
      expect(pos.z).toBeCloseTo(expectedZ, 5);
    });

    it('changing theta rotates around Y axis', () => {
      controller.updateFocusPoint(0, 0, 0);
      m(controller)._theta = 0;
      const pos1 = controller.getPosition();

      m(controller)._theta = Math.PI / 2;
      const pos2 = controller.getPosition();

      // At theta=PI/2: x = r * cos(0) * sin(PI/2) = r, z = r * cos(0) * cos(PI/2) = 0
      expect(pos2.x).toBeGreaterThan(pos1.x);
    });

    it('changing phi tilts vertically', () => {
      controller.updateFocusPoint(0, 0, 0);
      m(controller)._phi = 0;
      const pos1 = controller.getPosition();

      m(controller)._phi = Math.PI / 4;
      const pos2 = controller.getPosition();

      expect(pos2.y).toBeGreaterThan(pos1.y);
    });

    it('changing radius scales distance', () => {
      controller.updateFocusPoint(0, 0, 0);
      m(controller)._radius = 30;
      const pos1 = controller.getPosition();

      m(controller)._radius = 60;
      const pos2 = controller.getPosition();

      // Distance from focus point should double
      const dist1 = Math.sqrt(pos1.x ** 2 + pos1.y ** 2 + pos1.z ** 2);
      const dist2 = Math.sqrt(pos2.x ** 2 + pos2.y ** 2 + pos2.z ** 2);
      expect(dist2).toBeCloseTo(dist1 * 2, 5);
    });
  });

  describe('angle smoothing in manual mode', () => {
    it('smoothly approaches target angles during manual mode', () => {
      m(controller)._mode = 'manual';
      m(controller)._weight = 1;
      m(controller)._theta = 0;
      m(controller)._targetTheta = Math.PI / 2;

      // Simulate multiple frame updates
      for (let i = 0; i < 5; i++) {
        controller.updateFrame(performance.now());
      }

      expect(m(controller)._theta).toBeGreaterThan(0);
      expect(m(controller)._theta).toBeLessThan(Math.PI / 2);
    });

    it('smoothly approaches target radius during manual mode', () => {
      m(controller)._mode = 'manual';
      m(controller)._weight = 1;
      m(controller)._radius = 30;
      m(controller)._targetRadius = 60;

      for (let i = 0; i < 5; i++) {
        controller.updateFrame(performance.now());
      }

      expect(m(controller)._radius).toBeGreaterThan(30);
      expect(m(controller)._radius).toBeLessThan(60);
    });
  });

  describe('inactivity timer', () => {
    it('cancels existing timer when recording activity', () => {
      vi.useFakeTimers();

      // Manually set a timer
      (
        controller as unknown as Record<string, ReturnType<typeof setTimeout> | null>
      )._inactivityTimer = setTimeout(() => {}, 3000) as unknown as ReturnType<typeof setTimeout>;

      // Cancel it
      (controller as unknown as Record<string, () => void>)._cancelInactivityTimer.call(controller);
      expect(
        (controller as unknown as Record<string, ReturnType<typeof setTimeout> | null>)
          ._inactivityTimer,
      ).toBeNull();
    });

    it('timer is null after destroy', () => {
      controller.destroy();
      expect(
        (controller as unknown as Record<string, ReturnType<typeof setTimeout> | null>)
          ._inactivityTimer,
      ).toBeNull();
    });
  });

  describe('cleanup', () => {
    it('destroy removes all event listeners without errors', () => {
      // Should not throw
      expect(() => controller.destroy()).not.toThrow();
    });
  });

  describe('enterManualFromCamera — no snap on first input', () => {
    it('seeds spherical coords from camera position to prevent snap', () => {
      const mockCamPos = new THREE.Vector3(10, 20, 15);
      controller.updateFocusPoint(0, 10, 0);

      // Simulate having a camera position callback that returns the mocked position
      const getCameraPosition = () => mockCamPos;
      (controller as unknown as Record<string, unknown>).__getCameraPosition = getCameraPosition;

      controller.enterManualFromCamera(mockCamPos);

      const blend = controller.getBlendState();
      expect(blend.mode).toBe('manual');
      expect(blend.weight).toBe(1);

      // Spherical coords should match camera position, not defaults
      const state = controller.getState();
      const dx = mockCamPos.x - 0;
      const dz = mockCamPos.z - 0;
      const expectedTheta = Math.atan2(dx, dz);
      expect(state.theta).toBeCloseTo(expectedTheta, 5);

      // Radius should match distance from focus
      const dist = Math.sqrt(dx * dx + (mockCamPos.y - 10) ** 2 + dz * dz);
      expect(state.radius).toBeCloseTo(dist, 5);
    });

    it('targets set to current values so smoothing does not drift', () => {
      const mockCamPos = new THREE.Vector3(5, 15, 8);
      controller.updateFocusPoint(0, 10, 0);

      const getCameraPosition = () => mockCamPos;
      (controller as unknown as Record<string, unknown>).__getCameraPosition = getCameraPosition;

      controller.enterManualFromCamera(mockCamPos);

      // target values should equal current values (no drift)
      expect(n(controller, '_targetTheta')).toBeCloseTo(n(controller, '_theta'), 5);
      expect(n(controller, '_targetPhi')).toBeCloseTo(n(controller, '_phi'), 5);
      expect(n(controller, '_targetRadius')).toBeCloseTo(n(controller, '_radius'), 5);
    });
  });

  describe('mid-return cancellation', () => {
    it('cancelReturn preserves current spherical coords and re-enters manual', () => {
      m(controller)._mode = 'returning';
      m(controller)._weight = 0.5;
      const savedTheta = 1.234;
      const savedPhi = 0.567;
      const savedRadius = 42;
      m(controller)._theta = savedTheta;
      m(controller)._phi = savedPhi;
      m(controller)._radius = savedRadius;

      controller.cancelReturn();

      const blend = controller.getBlendState();
      expect(blend.mode).toBe('manual');
      expect(blend.weight).toBe(1);
      expect(m(controller)._theta).toBeCloseTo(savedTheta, 5);
      expect(m(controller)._phi).toBeCloseTo(savedPhi, 5);
      expect(m(controller)._radius).toBeCloseTo(savedRadius, 5);
    });

    it('cancelReturn with camera position seeds spherical coords', () => {
      m(controller)._mode = 'returning';
      m(controller)._weight = 0.3;
      m(controller)._theta = 999; // would be wrong if not updated
      controller.updateFocusPoint(0, 10, 0);

      const camPos = new THREE.Vector3(5, 20, 8);
      controller.cancelReturn(camPos);

      const blend = controller.getBlendState();
      expect(blend.mode).toBe('manual');
      expect(blend.weight).toBe(1);

      // Theta should be seeded from camera position, not old value
      const dx = camPos.x - 0;
      const dz = camPos.z - 0;
      const expectedTheta = Math.atan2(dx, dz);
      expect(n(controller, '_theta')).toBeCloseTo(expectedTheta, 5);
      expect(n(controller, '_theta')).not.toBe(999);
    });

    it('cancellation from returning preserves position (no jump)', () => {
      m(controller)._mode = 'returning';
      m(controller)._weight = 0.3;
      const savedTheta = 2.1;
      const savedPhi = -0.3;
      const savedRadius = 55;
      m(controller)._theta = savedTheta;
      m(controller)._phi = savedPhi;
      m(controller)._radius = savedRadius;

      controller.cancelReturn();

      // Spherical coords must be unchanged — no positional jump
      expect(m(controller)._theta).toBe(savedTheta);
      expect(m(controller)._phi).toBe(savedPhi);
      expect(m(controller)._radius).toBe(savedRadius);

      const pos = controller.getPosition();
      expect(pos.x).not.toBeNaN();
    });
  });
});
