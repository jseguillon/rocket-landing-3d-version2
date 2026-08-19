import * as THREE from 'three';
import { type RocketState } from '../types.js';

/** Local y-offset so the rocket visual center aligns with Timeline altitude semantics.
 *  When state.position[1] = 0 (touchdown), offset +6 puts the nose at ~y=6.5 and feet
 *  visible above the pad — no ground occlusion of lower body or deployed legs. */
const ROCKET_CENTER_OFFSET = 6;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function makeStrut(
  from: THREE.Vector3,
  to: THREE.Vector3,
  radius: number,
  mat: THREE.Material,
): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(to, from);
  const length = dir.length();
  if (length < 0.001) {
    return new THREE.Mesh(new THREE.BoxGeometry(0.001, 0.001, 0.001), mat);
  }
  const geo = new THREE.CylinderGeometry(radius, radius, length, 8);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
  mesh.position.copy(mid);
  const quat = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    dir.normalize(),
  );
  mesh.quaternion.copy(quat);
  return mesh;
}

function reorientStrut(mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3): void {
  const dir = new THREE.Vector3().subVectors(to, from);
  const length = dir.length();
  if (length < 0.001) {
    mesh.scale.set(0, 0, 0);
    return;
  }
  const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
  mesh.position.copy(mid);
  mesh.scale.y = length;
  const quat = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    dir.normalize(),
  );
  mesh.quaternion.copy(quat);
}

export class RocketBuilder {
  private _group: THREE.Group;
  private _bodyMeshes: THREE.Mesh[] = [];
  private _legMainStruts: THREE.Mesh[] = [];
  private _legBraceStruts: THREE.Mesh[] = [];
  private _legFeet: THREE.Mesh[] = [];
  private _navLights: THREE.Mesh[] = [];
  private _strobeLights: THREE.Group[] = [];

  constructor() {
    this._group = new THREE.Group();
    this._build();
  }

  get group(): THREE.Group {
    return this._group;
  }

  private _build(): void {
    // ── Materials ────────────────────────────────────────────────────
    const whiteBodyMat = new THREE.MeshStandardMaterial({
      color: 0xf2f2f2,
      roughness: 0.45,
      metalness: 0.2,
    });

    const darkMetalMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a1a,
      roughness: 0.35,
      metalness: 0.95,
    });

    const interstageMat = new THREE.MeshStandardMaterial({
      color: 0xe0e0e0,
      roughness: 0.4,
      metalness: 0.25,
    });

    const thermalMat = new THREE.MeshStandardMaterial({
      color: 0x3a3a3a,
      roughness: 0.6,
      metalness: 0.3,
    });

    const engineMat = new THREE.MeshStandardMaterial({
      color: 0x2a2a2a,
      roughness: 0.45,
      metalness: 0.95,
    });

    const legMetalMat = new THREE.MeshStandardMaterial({
      color: 0x4a4a4a,
      roughness: 0.5,
      metalness: 0.5,
    });

    // ── Nose cone (tapered) ──────────────────────────────────────────
    const noseGeo = new THREE.ConeGeometry(0.6, 2.0, 24);
    const nose = new THREE.Mesh(noseGeo, whiteBodyMat);
    nose.position.y = 5.0;
    nose.castShadow = true;
    this._group.add(nose);

    // Nose tip cap (rounded)
    const noseCapGeo = new THREE.SphereGeometry(0.6, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    const noseCap = new THREE.Mesh(noseCapGeo, whiteBodyMat);
    noseCap.position.y = 6.0;
    this._group.add(noseCap);

    // ── Upper body section (thinner) ─────────────────────────────────
    const upperBodyGeo = new THREE.CylinderGeometry(0.6, 0.85, 3.5, 24);
    const upperBody = new THREE.Mesh(upperBodyGeo, whiteBodyMat);
    upperBody.position.y = 2.75;
    upperBody.castShadow = true;
    this._group.add(upperBody);
    this._bodyMeshes.push(upperBody);

    // ── Main body section (wider) ────────────────────────────────────
    const mainBodyGeo = new THREE.CylinderGeometry(0.85, 1.0, 4.0, 24);
    const mainBody = new THREE.Mesh(mainBodyGeo, whiteBodyMat);
    mainBody.position.y = -0.5;
    mainBody.castShadow = true;
    this._group.add(mainBody);
    this._bodyMeshes.push(mainBody);

    // ── Interstage section (tapered transition) ──────────────────────
    const interstageGeo = new THREE.CylinderGeometry(1.0, 1.2, 1.0, 24);
    const interstage = new THREE.Mesh(interstageGeo, interstageMat);
    interstage.position.y = -3.0;
    interstage.castShadow = true;
    this._group.add(interstage);
    this._bodyMeshes.push(interstage);

    // ── Thermal accent band (dark interstage) ────────────────────────
    const thermalBandGeo = new THREE.CylinderGeometry(1.05, 1.2, 0.6, 24);
    const thermalBand = new THREE.Mesh(thermalBandGeo, thermalMat);
    thermalBand.position.y = -3.5;
    thermalBand.castShadow = true;
    this._group.add(thermalBand);

    // ── Engine skirt (bell shape) ────────────────────────────────────
    const skirtGeo = new THREE.CylinderGeometry(1.2, 1.5, 1.2, 24, 1, true);
    const skirt = new THREE.Mesh(skirtGeo, engineMat);
    skirt.position.y = -4.1;
    skirt.castShadow = true;
    this._group.add(skirt);

    // ── Engine nozzle (bell) ─────────────────────────────────────────
    const nozzleGeo = new THREE.CylinderGeometry(0.5, 1.2, 1.0, 24, 1, true);
    const nozzle = new THREE.Mesh(nozzleGeo, engineMat);
    nozzle.position.y = -5.2;
    this._group.add(nozzle);

    // Nozzle lip ring
    const nozzleLipGeo = new THREE.TorusGeometry(1.2, 0.06, 8, 24);
    const nozzleLip = new THREE.Mesh(nozzleLipGeo, engineMat);
    nozzleLip.position.y = -5.7;
    nozzleLip.rotation.x = Math.PI / 2;
    this._group.add(nozzleLip);

    // ── Panel lines (horizontal seams) ───────────────────────────────
    const seamMat = new THREE.MeshStandardMaterial({
      color: 0xaaaaaa,
      roughness: 0.5,
      metalness: 0.1,
    });
    for (const y of [4.3, 1.0, -2.5]) {
      const seamGeo = new THREE.TorusGeometry(0.86, 0.015, 6, 32);
      const seam = new THREE.Mesh(seamGeo, seamMat);
      seam.position.y = y;
      seam.rotation.x = Math.PI / 2;
      this._group.add(seam);
    }

    // ── Dark accent band (intentional paint detail) ──────────────────
    const bandGeo = new THREE.CylinderGeometry(0.87, 0.87, 0.15, 24, 1, true);
    const bandMat = new THREE.MeshStandardMaterial({
      color: 0x2a2a3e,
      roughness: 0.4,
      metalness: 0.15,
      side: THREE.DoubleSide,
    });
    const band = new THREE.Mesh(bandGeo, bandMat);
    band.position.y = 1.5;
    this._group.add(band);

    // ── Landing legs (4 continuous radial struts with kinematic interpolation) ──
    const strutMat = legMetalMat;
    const footMat = new THREE.MeshStandardMaterial({
      color: 0x5a5a5a,
      roughness: 0.45,
      metalness: 0.35,
    });

    for (let i = 0; i < 4; i++) {
      const angle = (Math.PI / 2) * i;
      const ux = Math.cos(angle);
      const uz = Math.sin(angle);

      // Stowed local endpoints — legs tucked against the skirt
      const stowedUpper = new THREE.Vector3(ux * 1.05, -2.7, uz * 1.05);
      const stowedLower = new THREE.Vector3(ux * 1.08, -3.9, uz * 1.08);
      const stowedFoot = new THREE.Vector3(ux * 1.15, -4.9, uz * 1.15);

      // Deployed local endpoints — full outward spread
      const deployedFoot = new THREE.Vector3(ux * 3.0, -6.15, uz * 3.0);

      // Main strut: upper attach → foot
      const mainStrut = makeStrut(stowedUpper, stowedFoot, 0.07, strutMat);

      // Brace strut: lower attach → foot
      const braceStrut = makeStrut(stowedLower, stowedFoot, 0.05, strutMat);

      // Flat circular foot pad at the deployed/stowed foot position
      const footGeo = new THREE.CylinderGeometry(0.4, 0.45, 0.2, 16);
      const foot = new THREE.Mesh(footGeo, footMat);
      foot.position.copy(stowedFoot);
      foot.castShadow = true;

      this._group.add(mainStrut);
      this._group.add(braceStrut);
      this._group.add(foot);

      // Store references for update() kinematic interpolation
      mainStrut.userData.stowedEnds = [stowedUpper.clone(), stowedFoot.clone()] as [
        THREE.Vector3,
        THREE.Vector3,
      ];

      braceStrut.userData.stowedEnds = [stowedLower.clone(), stowedFoot.clone()] as [
        THREE.Vector3,
        THREE.Vector3,
      ];

      foot.userData.stowedPos = stowedFoot.clone();
      foot.userData.deployedPos = deployedFoot.clone();

      this._legMainStruts.push(mainStrut);
      this._legBraceStruts.push(braceStrut);
      this._legFeet.push(foot);
    }

    // ── Nav lights (green top, red sides) ────────────────────────────
    const navGreenMat = new THREE.MeshStandardMaterial({
      color: 0x00ff44,
      emissive: 0x00ff44,
      emissiveIntensity: 2,
    });

    const topNavGeo = new THREE.SphereGeometry(0.06, 8, 8);
    const topNav = new THREE.Mesh(topNavGeo, navGreenMat);
    topNav.position.y = 6.1;
    this._group.add(topNav);
    this._navLights.push(topNav);

    for (let i = 0; i < 2; i++) {
      const a = Math.PI / 2 + i * Math.PI;
      const redMat = new THREE.MeshStandardMaterial({
        color: 0xff3333,
        emissive: 0xff3333,
        emissiveIntensity: 2,
      });
      const sideNav = new THREE.Mesh(topNavGeo.clone(), redMat);
      sideNav.position.set(Math.cos(a) * 0.95, -1.0, Math.sin(a) * 0.95);
      this._group.add(sideNav);
      this._navLights.push(sideNav);
    }

    // ── Strobe lights (white, fast blink) ────────────────────────────
    const strobeMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 4,
    });

    for (let i = 0; i < 2; i++) {
      const angle = i * Math.PI;
      const strobeGroup = new THREE.Group();

      const strobeGeo = new THREE.SphereGeometry(0.05, 8, 8);
      const strobe = new THREE.Mesh(strobeGeo, strobeMat);
      strobeGroup.add(strobe);

      // Small housing
      const housingGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.04, 8);
      const housing = new THREE.Mesh(housingGeo, darkMetalMat);
      housing.rotation.x = Math.PI / 2;
      strobeGroup.add(housing);

      strobeGroup.position.set(Math.cos(angle) * 0.95, -2.0, Math.sin(angle) * 0.95);
      this._group.add(strobeGroup);
      this._strobeLights.push(strobeGroup);
    }

    // ── Window/viewport on nose cone ─────────────────────────────────
    const windowMat = new THREE.MeshStandardMaterial({
      color: 0x88bbdd,
      roughness: 0.1,
      metalness: 0.9,
      emissive: 0x3366aa,
      emissiveIntensity: 0.2,
    });

    for (let i = 0; i < 3; i++) {
      const a = -0.25 + i * 0.25;
      const winGeo = new THREE.CircleGeometry(0.12, 16);
      const win = new THREE.Mesh(winGeo, windowMat);
      win.position.set(Math.sin(a) * 0.62, 4.8, Math.cos(a) * 0.62);
      win.lookAt(0, 4.8, 0);
      this._group.add(win);
    }
  }

  update(state: RocketState, time: number): void {
    // Position — offset so visual center aligns with Timeline altitude semantics
    this._group.position.set(
      state.position[0],
      state.position[1] + ROCKET_CENTER_OFFSET,
      state.position[2],
    );

    // Rotation (attitude corrections)
    this._group.rotation.set(state.rotation[0], state.rotation[1], state.rotation[2]);

    // Leg deployment animation — kinematic interpolation
    const deployment = clamp(state.legAngle / (Math.PI / 4), 0, 1);

    for (let i = 0; i < this._legMainStruts.length; i++) {
      const main = this._legMainStruts[i];
      const brace = this._legBraceStruts[i];
      const foot = this._legFeet[i];

      const stowedEnds = main.userData.stowedEnds as [THREE.Vector3, THREE.Vector3];
      const stowedFootPos = foot.userData.stowedPos as THREE.Vector3;
      const deployedFootPos = foot.userData.deployedPos as THREE.Vector3;

      // Interpolated endpoints
      const upperAttach = stowedEnds[0]; // fixed body mount (stowed === deployed)
      const lowerAttach = brace.userData.stowedEnds![0]; // fixed body mount (stowed === deployed)

      const footPos = new THREE.Vector3().lerpVectors(stowedFootPos, deployedFootPos, deployment);

      // Main strut: upper attach → foot
      reorientStrut(main, upperAttach, footPos);

      // Brace strut: lower attach → foot
      reorientStrut(brace, lowerAttach, footPos);

      // Foot pad position
      foot.position.copy(footPos);
    }

    // Nav light pulsing
    for (const light of this._navLights) {
      const pulse = 0.7 + 0.3 * Math.sin(time * 2);
      (light.material as THREE.MeshStandardMaterial).emissiveIntensity = 2 * pulse;
    }

    // Strobe lights (faster blink, toggle visibility)
    const strobeOn = Math.sin(time * 8) > 0.5;
    for (const strobe of this._strobeLights) {
      strobe.visible = strobeOn;
    }
  }
}
