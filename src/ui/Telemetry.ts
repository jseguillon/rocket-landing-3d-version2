import type { TelemetryData } from '../types.js';

export class TelemetryUI {
  private _container: HTMLElement;
  private _phaseEl!: HTMLElement;
  private _altitudeEl!: HTMLElement;
  private _velocityEl!: HTMLElement;
  private _progressEl!: HTMLElement;
  private _thrustEl!: HTMLElement;
  private _legEl!: HTMLElement;

  constructor(container: HTMLElement) {
    this._container = container;

    // Create DOM structure
    const el = document.createElement('div');
    el.className = 'telemetry';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-label', 'Mission telemetry data');
    el.innerHTML = `
      <div class="telemetry__phase">
        <span class="telemetry__label">PHASE</span>
        <span class="telemetry__value" id="phase-value">ORBITAL APPROACH</span>
      </div>
      <div class="telemetry__row">
        <div class="telemetry__item">
          <span class="telemetry__label">ALTITUDE</span>
          <span class="telemetry__value" id="altitude-value">800.0 m</span>
        </div>
        <div class="telemetry__item">
          <span class="telemetry__label">VELOCITY</span>
          <span class="telemetry__value" id="velocity-value">150.0 m/s</span>
        </div>
      </div>
      <div class="telemetry__row">
        <div class="telemetry__item">
          <span class="telemetry__label">THRUST</span>
          <span class="telemetry__value" id="thrust-value">0%</span>
        </div>
        <div class="telemetry__item">
          <span class="telemetry__label">LANDING LEGS</span>
          <span class="telemetry__value" id="leg-value">STOWED</span>
        </div>
      </div>
      <div class="telemetry__progress">
        <div class="telemetry__progress-bar" id="progress-bar" style="width: 0%"></div>
      </div>
    `;

    this._container.appendChild(el);

    this._phaseEl = el.querySelector('#phase-value')!;
    this._altitudeEl = el.querySelector('#altitude-value')!;
    this._velocityEl = el.querySelector('#velocity-value')!;
    this._thrustEl = el.querySelector('#thrust-value')!;
    this._legEl = el.querySelector('#leg-value')!;
  }

  update(data: TelemetryData): void {
    this._phaseEl.textContent = data.phase.toUpperCase().replace(/-/g, ' ');
    this._altitudeEl.textContent = `${data.altitude.toFixed(1)} m`;
    this._velocityEl.textContent = `${data.velocity.toFixed(1)} m/s`;
    this._thrustEl.textContent = `${Math.round(data.engineThrust * 100)}%`;
    this._legEl.textContent = data.legDeployed ? 'DEPLOYED' : 'STOWED';

    const progress = document.getElementById('progress-bar');
    if (progress) {
      progress.style.width = `${data.progress * 100}%`;
    }
  }

  show(): void {
    this._container.style.visibility = 'visible';
  }

  hide(): void {
    this._container.style.visibility = 'hidden';
  }
}
