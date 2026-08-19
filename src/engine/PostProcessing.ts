import * as THREE from 'three';

export class PostProcessor {
  private _camera: THREE.OrthographicCamera;
  private _scene: THREE.Scene;
  private _renderer: THREE.WebGLRenderer;
  private _target: THREE.WebGLRenderTarget;
  private _quadMesh: THREE.Mesh;
  private _quadMaterial: THREE.ShaderMaterial;
  private _active = true;

  constructor(renderer: THREE.WebGLRenderer, width: number, height: number) {
    this._target = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
    });

    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._scene = new THREE.Scene();

    this._quadMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this._target.texture },
        uTime: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uTime;
        varying vec2 vUv;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        void main() {
          vec2 uv = vUv;
          float dist = distance(uv, vec2(0.5));
          // Very subtle vignette — only darken edges slightly
          float vignette = smoothstep(0.75, 0.4, dist);
          float grain = hash(uv * uTime * 100.0) * 0.01;

          vec4 color = texture(tDiffuse, uv);

          // Very mild desaturation + warm tint in shadows (almost no effect)
          float luminance = dot(color.rgb, vec3(0.299, 0.587, 0.114));
          color.rgb = mix(vec3(luminance), color.rgb, 0.95);

          // Almost no contrast boost — preserve natural look
          color.rgb = (color.rgb - 0.5) * 1.02 + 0.5;

          // Subtle dark vignette at edges only — don't darken center
          vec3 vignetteColor = vec3(0.12, 0.12, 0.18);
          color.rgb = mix(vignetteColor, color.rgb, vignette);
          color.rgb += grain * (1.0 - vignette);

          gl_FragColor = color;
        }
      `,
    });

    this._quadMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._quadMaterial);
    this._scene.add(this._quadMesh);
    this._renderer = renderer;
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, time: number): void {
    if (!this._active) {
      this._renderer.setRenderTarget(null);
      this._renderer.render(scene, camera);
      return;
    }

    this._renderer.setRenderTarget(this._target);
    this._renderer.render(scene, camera);
    this._renderer.setRenderTarget(null);

    this._quadMaterial.uniforms.uTime.value = time;
    this._renderer.render(this._scene, this._camera);
  }

  resize(width: number, height: number): void {
    this._target.setSize(width, height);
  }

  dispose(): void {
    this._target.dispose();
    this._quadMaterial.dispose();
  }
}
