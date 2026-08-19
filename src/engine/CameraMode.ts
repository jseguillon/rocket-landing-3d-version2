import * as THREE from 'three';

// ─── Easing helpers ────────────────────────────────────────────────────────

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ─── Constants ─────────────────────────────────────────────────────────────

const INACTIVITY_TIMEOUT = 3000; // ms — seconds of no input before auto-return
const BLEND_OUT_DURATION = 800; // ms — smooth return to cinematic follow
const LERP_FACTOR = 0.2; // manual angle smoothing factor

// ─── Camera state exposed by ManualCamera for spherical coordinates ────────

export interface ManualCameraState {
  /** Spherical angle around focus point (radians, Y-up rotation) */
  theta: number;
  /** Vertical tilt from horizon plane (radians, positive = looking up) */
  phi: number;
  /** Camera distance from focus point */
  radius: number;
}

// ─── Blend mode returned by getBlendState() ────────────────────────────────

export type BlendMode = 'follow' | 'manual';

export interface BlendState {
  mode: BlendMode;
  /** 0.0 = fully cinematic, 1.0 = fully manual. Smoothly interpolated. */
  weight: number;
}

// ─── ManualCameraController ────────────────────────────────────────────────
/**
 * Manages user-controlled camera movement alongside the cinematic follow system.
 * Handles event capture (mouse drag, wheel, touch), inactivity timeout, and
 * smooth blending transitions back to cinematic follow.
 *
 * State machine:
 *   FOLLOW → MANUAL → (3s inactivity) → BLEND_OUT → FOLLOW
 *
 * Any input during BLEND_OUT cancels the return and re-enters MANUAL.
 */
export class ManualCameraController {
  private _canvas: HTMLCanvasElement;

  // Current manual camera angles/radius (spherical coords around focus)
  private _theta = 0;
  private _phi = Math.PI / 6;
  private _radius = 30;

  // Target values for smooth transitions
  private _targetTheta = 0;
  private _targetPhi = Math.PI / 6;
  private _targetRadius = 30;

  // Blend state
  private _mode: BlendMode = 'follow';
  private _weight = 0;
  private _blendStart = 0;
  private _blendFromWeight = 0;

  // Inactivity tracking
  private _inactivityTimer: ReturnType<typeof setTimeout> | null = null;

  // Drag state
  private _isDragging = false;
  private _dragStartX = 0;
  private _dragStartY = 0;
  private _dragStartTheta = 0;
  private _dragStartPhi = 0;

  // Focus point (rocket position) — updated each frame by main.ts
  private _focusX = 0;
  private _focusY = 6;
  private _focusZ = 0;

  // Touch state
  private _touchStartDist = 0;
  private _touchStartRadius = 0;

  // Event listener refs for cleanup (assigned in _setupEventListeners)
  private _mouseDownHandler: ((e: MouseEvent) => void) | null = null;
  private _mouseMoveHandler: ((e: MouseEvent) => void) | null = null;
  private _mouseUpHandler: (() => void) | null = null;
  private _wheelHandler: ((e: WheelEvent) => void) | null = null;
  private _touchStartHandler: ((e: TouchEvent) => void) | null = null;
  private _touchMoveHandler: ((e: TouchEvent) => void) | null = null;
  private _touchEndHandler: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this._canvas = canvas;
    this._setupEventListeners();
  }

  /** Called each frame by main.ts with current rocket visual center */
  updateFocusPoint(x: number, y: number, z: number): void {
    // Only update focus point when NOT actively dragging in manual mode
    if (this._mode === 'manual' && this._weight >= 0.99 && this._isDragging) {
      return; // Don't shift manual camera focus during active dragging
    }
    this._focusX = x;
    this._focusY = y;
    this._focusZ = z;
  }

  /** Returns current blend state for the render loop */
  getBlendState(): BlendState {
    return { mode: this._mode, weight: this._weight };
  }

  /** Get current manual spherical camera parameters */
  getState(): ManualCameraState {
    return { theta: this._theta, phi: this._phi, radius: this._radius };
  }

  /** Compute world position for the current manual spherical coordinates */
  getPosition(): THREE.Vector3 {
    const sinPhi = Math.sin(this._phi);
    const cosPhi = Math.cos(this._phi);
    const sinTheta = Math.sin(this._theta);
    const cosTheta = Math.cos(this._theta);

    return new THREE.Vector3(
      this._focusX + this._radius * cosPhi * sinTheta,
      this._focusY + this._radius * sinPhi,
      this._focusZ + this._radius * cosPhi * cosTheta,
    );
  }

  /** Reset to initial state (called on replay) */
  reset(): void {
    this._mode = 'follow';
    this._weight = 0;
    this._blendStart = 0;
    this._blendFromWeight = 0;
    this._isDragging = false;
    this._cancelInactivityTimer();
    // Reset angles to defaults — will be overridden by first frame focus update
    this._theta = 0;
    this._phi = Math.PI / 6;
    this._radius = 30;
    this._targetTheta = 0;
    this._targetPhi = Math.PI / 6;
    this._targetRadius = 30;
  }

  // ─── Event Setup ──────────────────────────────────────────────────────

  private _setupEventListeners(): void {
    this._mouseDownHandler = (e: MouseEvent) => {
      if (e.button !== 0) return; // Only left mouse button
      this._onMouseDown(e);
    };
    this._mouseMoveHandler = (e: MouseEvent) => {
      this._onMouseMove(e);
    };
    this._mouseUpHandler = () => {
      this._onMouseUp();
    };
    this._wheelHandler = (e: WheelEvent) => {
      e.preventDefault();
      this._onWheel(e);
    };
    this._touchStartHandler = (e: TouchEvent) => {
      this._onTouchStart(e);
    };
    this._touchMoveHandler = (e: TouchEvent) => {
      this._onTouchMove(e);
    };
    this._touchEndHandler = () => {
      this._onTouchEnd();
    };

    if (this._mouseDownHandler) this._canvas.addEventListener('mousedown', this._mouseDownHandler);
    if (this._wheelHandler)
      this._canvas.addEventListener('wheel', this._wheelHandler, { passive: false });
    if (this._touchStartHandler)
      this._canvas.addEventListener('touchstart', this._touchStartHandler, { passive: false });
    if (this._touchMoveHandler)
      this._canvas.addEventListener('touchmove', this._touchMoveHandler, { passive: false });
  }

  private _registerGlobalMouseUp(): void {
    if (this._mouseUpHandler) {
      document.addEventListener('mouseup', this._mouseUpHandler);
    }
  }

  private _unregisterGlobalMouseUp(): void {
    if (this._mouseUpHandler) {
      document.removeEventListener('mouseup', this._mouseUpHandler);
    }
  }

  private _cleanupTouchListeners(): void {
    if (this._touchEndHandler) {
      this._canvas.removeEventListener('touchend', this._touchEndHandler);
      this._canvas.removeEventListener('touchcancel', this._touchEndHandler);
    }
  }

  // ─── Mouse Events ─────────────────────────────────────────────────────

  private _onMouseDown(e: MouseEvent): void {
    if (this._isDragging) return;

    this._isDragging = true;
    this._dragStartX = e.clientX;
    this._dragStartY = e.clientY;
    this._dragStartTheta = this._theta;
    this._dragStartPhi = this._phi;

    this._enterManual();
    this._registerGlobalMouseUp();

    // Prevent text selection during drag
    e.preventDefault();
  }

  private _onMouseMove(e: MouseEvent): void {
    if (!this._isDragging) return;

    const dx = e.clientX - this._dragStartX;
    const dy = e.clientY - this._dragStartY;

    // Sensitivity: full rotation in ~600px drag
    const sensitivity = 0.005;

    this._targetTheta = this._dragStartTheta + dx * sensitivity;
    this._targetPhi = clamp(this._dragStartPhi - dy * sensitivity, -Math.PI / 2.5, Math.PI / 2.5);

    // Apply immediately for responsive feel
    this._theta = this._targetTheta;
    this._phi = this._targetPhi;

    this._recordActivity();
  }

  private _onMouseUp(): void {
    if (!this._isDragging) return;
    this._isDragging = false;
    this._unregisterGlobalMouseUp();
    this._cancelInactivityTimer();
    this._startInactivityTimer();
  }

  // ─── Wheel Event ──────────────────────────────────────────────────────

  private _onWheel(e: WheelEvent): void {
    e.preventDefault();

    if (this._mode !== 'follow' || this._weight > 0.1) {
      // Already in manual mode — zoom
      const zoomFactor = e.deltaY > 0 ? 1.08 : 1 / 1.08;
      this._targetRadius = clamp(this._radius * zoomFactor, 5, 100);
      this._radius = this._targetRadius;
    } else {
      // Just starting manual from follow — capture angles first
      this._enterManual();
      const zoomFactor = e.deltaY > 0 ? 1.08 : 1 / 1.08;
      this._targetRadius = clamp(this._radius * zoomFactor, 5, 100);
      this._radius = this._targetRadius;
    }

    this._recordActivity();
  }

  // ─── Touch Events ─────────────────────────────────────────────────────

  private _onTouchStart(e: TouchEvent): void {
    if (e.touches.length === 1) {
      // Single touch — orbit
      const touch = e.touches[0];
      this._isDragging = true;
      this._dragStartX = touch.clientX;
      this._dragStartY = touch.clientY;
      this._dragStartTheta = this._theta;
      this._dragStartPhi = this._phi;

      this._enterManual();
    } else if (e.touches.length === 2) {
      // Two fingers — pinch zoom
      this._isDragging = false;
      this._touchStartDist = this._getTouchDistance(e);
      this._touchStartRadius = this._radius;

      if (this._mode !== 'follow' || this._weight > 0.1) {
        // Already in manual — use pinch for zoom
      } else {
        this._enterManual();
      }
    }

    e.preventDefault();
    if (this._touchEndHandler) {
      this._canvas.addEventListener('touchend', this._touchEndHandler);
      this._canvas.addEventListener('touchcancel', this._touchEndHandler);
    }
  }

  private _onTouchMove(e: TouchEvent): void {
    if (e.touches.length === 1 && this._isDragging) {
      // Orbit with single touch
      const touch = e.touches[0];
      const dx = touch.clientX - this._dragStartX;
      const dy = touch.clientY - this._dragStartY;

      const sensitivity = 0.005;
      this._targetTheta = this._dragStartTheta + dx * sensitivity;
      this._targetPhi = clamp(this._dragStartPhi - dy * sensitivity, -Math.PI / 2.5, Math.PI / 2.5);

      this._theta = this._targetTheta;
      this._phi = this._targetPhi;
    } else if (e.touches.length === 2) {
      // Pinch zoom
      const dist = this._getTouchDistance(e);
      const scale = dist / this._touchStartDist;
      this._targetRadius = clamp(this._touchStartRadius * scale, 5, 100);
      this._radius = this._targetRadius;
    }

    e.preventDefault();
    this._recordActivity();
  }

  private _onTouchEnd(): void {
    this._isDragging = false;
    this._cleanupTouchListeners();
    this._cancelInactivityTimer();
    this._startInactivityTimer();
  }

  private _getTouchDistance(e: TouchEvent): number {
    const t1 = e.touches[0];
    const t2 = e.touches[1];
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // ─── State Transitions ────────────────────────────────────────────────

  private _enterManual(): void {
    this._mode = 'manual';
    this._blendFromWeight = this._weight;
    this._weight = 1;
    this._blendStart = performance.now();
    this._cancelInactivityTimer();
    this._startInactivityTimer();
  }

  private _startBlendOut(): void {
    this._mode = 'follow';
    this._blendFromWeight = this._weight;
    this._weight = 1;
    this._blendStart = performance.now();
    this._cancelInactivityTimer();
  }

  // ─── Inactivity Timer ─────────────────────────────────────────────────

  private _recordActivity(): void {
    this._cancelInactivityTimer();
    this._startInactivityTimer();
  }

  private _startInactivityTimer(): void {
    this._cancelInactivityTimer();
    this._inactivityTimer = setTimeout(() => {
      if (this._mode === 'manual' || this._weight > 0.5) {
        this._startBlendOut();
      }
    }, INACTIVITY_TIMEOUT);
  }

  private _cancelInactivityTimer(): void {
    if (this._inactivityTimer !== null) {
      clearTimeout(this._inactivityTimer);
      this._inactivityTimer = null;
    }
  }

  // ─── Frame Update ─────────────────────────────────────────────────────

  /** Call every frame to handle blend-out progress and angle smoothing */
  updateFrame(now: number): void {
    if (this._mode === 'follow' && this._weight >= 0.99) {
      // Blend-out in progress — ease back toward follow
      const elapsed = now - this._blendStart;
      const t = easeInOutCubic(clamp(elapsed / BLEND_OUT_DURATION, 0, 1));
      this._weight = this._blendFromWeight * (1 - t);

      // Smoothly interpolate manual angles back toward targets during blend-out
      if (this._weight < 0.5) {
        const angleBlend = (0.5 - this._weight) / 0.5;
        this._theta += (this._targetTheta - this._theta) * angleBlend * 0.1;
        this._phi += (this._targetPhi - this._phi) * angleBlend * 0.1;
        this._radius += (this._targetRadius - this._radius) * angleBlend * 0.1;
      }

      if (this._weight < 0.01) {
        this._weight = 0;
        this._mode = 'follow';
      }
    } else if (this._mode === 'manual') {
      // Smoothly approach target angles/radius
      this._theta += (this._targetTheta - this._theta) * LERP_FACTOR;
      this._phi += (this._targetPhi - this._phi) * LERP_FACTOR;
      this._radius += (this._targetRadius - this._radius) * LERP_FACTOR;
    }
  }

  /** Destroy and clean up event listeners */
  destroy(): void {
    this._cancelInactivityTimer();
    this._unregisterGlobalMouseUp();
    this._cleanupTouchListeners();

    if (this._mouseDownHandler) {
      this._canvas.removeEventListener('mousedown', this._mouseDownHandler);
    }
    if (this._wheelHandler) {
      this._canvas.removeEventListener('wheel', this._wheelHandler);
    }
    if (this._touchStartHandler) {
      this._canvas.removeEventListener('touchstart', this._touchStartHandler);
    }
    if (this._touchMoveHandler) {
      this._canvas.removeEventListener('touchmove', this._touchMoveHandler);
    }
  }
}
