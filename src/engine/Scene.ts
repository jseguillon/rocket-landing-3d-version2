import * as THREE from 'three';

export class SceneRenderer {
  private _renderer: THREE.WebGLRenderer;
  private _scene: THREE.Scene;
  private _camera: THREE.PerspectiveCamera;
  private _isWebGL2Available = false;
  private _onResize?: () => void;

  get renderer(): THREE.WebGLRenderer {
    return this._renderer;
  }
  get scene(): THREE.Scene {
    return this._scene;
  }
  get camera(): THREE.PerspectiveCamera {
    return this._camera;
  }

  constructor(container: HTMLElement) {
    try {
      const testCanvas = document.createElement('canvas');
      this._isWebGL2Available = !!testCanvas.getContext('webgl2');
    } catch {
      this._isWebGL2Available = false;
    }

    if (!this._isWebGL2Available) {
      this._showWebGLFailure(container);
      throw new Error('WebGL2 not supported');
    }

    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;

    this._renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.setSize(w, h);
    this._renderer.shadowMap.enabled = true;
    this._renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this._renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this._renderer.toneMappingExposure = 2.5;
    this._renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this._renderer.domElement);

    this._scene = new THREE.Scene();
    // Very dark blue-gray — lighter than before so scene elements are visible
    this._scene.background = new THREE.Color(0x0a1020);

    this._camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 2000);
    this._camera.position.set(0, 10, 30);
    this._camera.lookAt(0, 0, 0);

    // Resize handler with debouncing
    let resizeTimeout: ReturnType<typeof setTimeout> | null = null;
    this._onResize = () => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        const parent = container.parentElement || container;
        const pw = parent.clientWidth;
        const ph = parent.clientHeight;
        if (pw === 0 || ph === 0) return;
        this._camera.aspect = pw / ph;
        this._camera.updateProjectionMatrix();
        this._renderer.setSize(pw, ph);
      }, 100);
    };

    const resizeObserver = new ResizeObserver(this._onResize);
    resizeObserver.observe(container);
    window.addEventListener('resize', this._onResize);
  }

  private _showWebGLFailure(container: HTMLElement): void {
    const msg = document.createElement('div');
    msg.setAttribute('role', 'alert');
    msg.style.cssText = `
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      background: #1a1a2e; color: #e94560; font-family: system-ui, sans-serif; font-size: 1.2em;
      padding: 2em; text-align: center; z-index: 1000;
    `;
    msg.textContent =
      'WebGL 2 is not supported by your browser. Please use a modern browser to view this experience.';
    container.appendChild(msg);
  }

  /** Call when the post-processing target needs resizing */
  getDimensions(): { width: number; height: number } {
    const parent = this._renderer.domElement.parentElement;
    if (!parent) return { width: window.innerWidth, height: window.innerHeight };
    return { width: parent.clientWidth, height: parent.clientHeight };
  }

  render(): void {
    this._renderer.render(this._scene, this._camera);
  }
}
