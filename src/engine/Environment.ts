import * as THREE from 'three';
import { createRng, DEFAULT_SEED } from '../types.js';

export class EnvironmentBuilder {
  private _rng: ReturnType<typeof createRng>;

  constructor(seed: number = DEFAULT_SEED) {
    this._rng = createRng(seed);
  }

  build(scene: THREE.Scene): void {
    this._addStarfield(scene);
    this._addEarthSphere(scene);
    this._addAtmosphereGlow(scene);
    this._addGroundAndTerrain(scene);
    this._addLandingPad(scene);
    this._addLighting(scene);
  }

  private _addStarfield(scene: THREE.Scene): void {
    const starCount = 8000;
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);
    const sizes = new Float32Array(starCount);

    for (let i = 0; i < starCount; i++) {
      const i3 = i * 3;
      const theta = this._rng() * Math.PI * 2;
      const phi = Math.acos(2 * this._rng() - 1);
      const r = 900 + this._rng() * 300;
      positions[i3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i3 + 2] = r * Math.cos(phi);

      const temp = this._rng();
      if (temp < 0.5) {
        colors[i3] = 0.9;
        colors[i3 + 1] = 0.92;
        colors[i3 + 2] = 1.0;
      } else if (temp < 0.8) {
        colors[i3] = 1.0;
        colors[i3 + 1] = 0.85;
        colors[i3 + 2] = 0.7;
      } else {
        colors[i3] = 0.7;
        colors[i3 + 1] = 0.8;
        colors[i3 + 2] = 1.0;
      }

      sizes[i] = 1.5 + this._rng() * 3.5; // Larger stars for visibility
    }

    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const starMat = new THREE.PointsMaterial({
      size: 3.0, // Larger size
      vertexColors: true,
      transparent: true,
      opacity: 0.95, // Slightly higher opacity
      sizeAttenuation: true,
      depthWrite: false, // Stars cannot occlude anything — strictly background
    });

    scene.add(new THREE.Points(starGeo, starMat));
  }

  private _addEarthSphere(scene: THREE.Scene): void {
    const earthRadius = 345;
    const earthY = -earthRadius + 0.1; // Just below ground level

    // Opaque Earth surface with procedural color variation
    const earthGeo = new THREE.SphereGeometry(earthRadius, 64, 32);
    const earthMat = new THREE.ShaderMaterial({
      side: THREE.FrontSide,
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        void main() {
          vUv = uv;
          vNormal = normalize(normalMatrix * normal);
          vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vWorldPos;

        // Simple hash-based noise for procedural variation
        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
            mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
            f.y
          );
        }

        void main() {
          // Normal points toward center of Earth (away from camera at surface)
          vec3 n = normalize(vNormal);

          // Latitude-based coloring: darker oceans near equator, lighter near poles
          float lat = abs(vWorldPos.y) / 345.0;

          // Procedural continent/ocean pattern
          float n1 = noise(vUv * 8.0);
          float n2 = noise(vUv * 16.0 + 100.0);
          float land = smoothstep(0.45, 0.55, n1 * 0.7 + n2 * 0.3);

          // Ocean color (deep blue)
          vec3 oceanColor = mix(vec3(0.08, 0.15, 0.35), vec3(0.12, 0.22, 0.45), lat);
          // Land color (dark green/brown)
          vec3 landColor = mix(vec3(0.15, 0.28, 0.12), vec3(0.25, 0.22, 0.15), lat);

          vec3 baseColor = mix(oceanColor, landColor, land * 0.6);

          // Fresnel-like rim darkening for atmosphere blend
          float fresnel = 1.0 - abs(dot(n, vec3(0.0, 0.0, 1.0)));
          baseColor = mix(baseColor, oceanColor * 1.2, fresnel * 0.3);

          // Subtle shading based on view angle
          float shade = 0.7 + 0.3 * max(n.y, 0.0);
          baseColor *= shade;

          gl_FragColor = vec4(baseColor, 1.0);
        }
      `,
    });

    const earth = new THREE.Mesh(earthGeo, earthMat);
    earth.position.y = earthY;
    // Place behind the ground plane so it doesn't interfere with pad/terrain
    earth.renderOrder = -1;
    scene.add(earth);
  }

  private _addAtmosphereGlow(scene: THREE.Scene): void {
    const atmosGeo = new THREE.SphereGeometry(348, 64, 32);
    const atmosMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      uniforms: {
        uColor1: { value: new THREE.Color(0x335577) },
        uColor2: { value: new THREE.Color(0x6699bb) },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vec4 worldPos = modelViewMatrix * vec4(position, 1.0);
          vViewDir = normalize(-worldPos.xyz);
          gl_Position = projectionMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor1, uColor2;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          float fresnel = 1.0 - max(dot(vNormal, vViewDir), 0.0);
          fresnel = pow(fresnel, 2.5);
          vec3 col = mix(uColor1, uColor2, smoothstep(-0.5, 0.5, vNormal.y));
          gl_FragColor = vec4(col, fresnel * 0.6);
        }
      `,
    });

    const atmosphere = new THREE.Mesh(atmosGeo, atmosMat);
    atmosphere.position.y = -345 + 0.1;
    scene.add(atmosphere);

    // Secondary atmospheric rim glow (inner layer)
    const rimGeo = new THREE.SphereGeometry(346, 64, 32);
    const rimMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      uniforms: {
        uColor: { value: new THREE.Color(0xaaddff) },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vec4 worldPos = modelViewMatrix * vec4(position, 1.0);
          vViewDir = normalize(-worldPos.xyz);
          gl_Position = projectionMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          float rim = 1.0 - max(dot(vNormal, vViewDir), 0.0);
          rim = pow(rim, 1.5) * 1.2;
          gl_FragColor = vec4(uColor, rim * 0.4);
        }
      `,
    });

    const rimMesh = new THREE.Mesh(rimGeo, rimMat);
    rimMesh.position.y = -345 + 0.1;
    scene.add(rimMesh);
  }

  private _addGroundAndTerrain(scene: THREE.Scene): void {
    const groundGeo = new THREE.PlaneGeometry(500, 500, 100, 100);
    const posAttr = groundGeo.getAttribute('position');

    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const y = posAttr.getY(i);
      const dist = Math.sqrt(x * x + y * y);
      if (dist > 20) {
        posAttr.setZ(i, (this._rng() - 0.5) * 2.0 * Math.log(dist / 15));
      }
    }
    posAttr.needsUpdate = true;
    groundGeo.computeVertexNormals();

    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x3a4a3a,
      roughness: 0.85,
      metalness: 0.15,
    });

    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.1;
    ground.receiveShadow = true;
    scene.add(ground);
  }

  private _addLandingPad(scene: THREE.Scene): void {
    const padGroup = new THREE.Group();

    // Main pad disc
    const padGeo = new THREE.CylinderGeometry(7, 7.5, 0.25, 48);
    const padMat = new THREE.MeshStandardMaterial({
      color: 0x666666,
      roughness: 0.5,
      metalness: 0.5,
    });
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.position.y = 0.125;
    pad.receiveShadow = true;
    pad.castShadow = true;
    padGroup.add(pad);

    // Pad ring marker with emissive glow
    const ringGeo = new THREE.TorusGeometry(7.3, 0.1, 8, 48);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0xffaa00,
      roughness: 0.3,
      metalness: 0.7,
      emissive: 0xffaa00,
      emissiveIntensity: 0.4,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.26;
    padGroup.add(ring);

    // Center star marker
    const starMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.4,
      metalness: 0.3,
    });
    for (let i = 0; i < 4; i++) {
      const armGeo = new THREE.BoxGeometry(0.2, 0.06, 5);
      const arm = new THREE.Mesh(armGeo, starMat);
      arm.position.y = 0.27;
      arm.rotation.y = (Math.PI / 4) * i;
      padGroup.add(arm);
    }

    scene.add(padGroup);
  }

  private _addLighting(scene: THREE.Scene): void {
    // Bright ambient for visibility in dark space scenes
    const ambient = new THREE.AmbientLight(0x445566, 3.0);
    scene.add(ambient);

    // Main directional light (sun) — strong key light with soft shadows and wider frustum
    const sun = new THREE.DirectionalLight(0xffeedd, 8.0);
    sun.position.set(25, 50, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 200;
    sun.shadow.camera.left = -40;
    sun.shadow.camera.right = 40;
    sun.shadow.camera.top = 40;
    sun.shadow.camera.bottom = -40;
    sun.shadow.bias = -0.0008;
    scene.add(sun);

    // Fill light from opposite side, cool tone — adds shadow detail on dark side
    const fill = new THREE.DirectionalLight(0x8899cc, 3.5);
    fill.position.set(-20, 15, -15);
    scene.add(fill);

    // Engine glow point light (repositioned dynamically in main loop)
    const engineLight = new THREE.PointLight(0xff8833, 0, 30);
    engineLight.castShadow = false;
    scene.add(engineLight);

    // Hemisphere light for sky/ground color blending — stronger for space scenes
    const hemi = new THREE.HemisphereLight(0x6699cc, 0x334433, 2.5);
    scene.add(hemi);

    // Rim/back light for rocket silhouette against dark background
    const rim = new THREE.DirectionalLight(0xaabbdd, 2.5);
    rim.position.set(-10, 5, -20);
    scene.add(rim);
  }
}
