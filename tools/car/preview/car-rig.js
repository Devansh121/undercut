/* global document */
// Reference implementation of the car asset contract in docs/car-asset.md: loading, liveries,
// decals and the animated nodes. Plain ES module over three.js; the game's renderer can port it.
import * as THREE from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const CORNERS = ['FL', 'FR', 'RL', 'RR'];
export const TYRE_RADIUS = 0.36;
export const COMPOUND_COLOURS = { soft: '#d8322a', medium: '#e6c229', hard: '#eeeeea' };

/** Loads one level of detail. Returns { root, rig }. */
export async function loadCar(url, { dracoPath }) {
  const draco = new DRACOLoader().setDecoderPath(dracoPath);
  const loader = new GLTFLoader().setDRACOLoader(draco);
  const gltf = await loader.loadAsync(url);
  const root = gltf.scene.getObjectByName('car');
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return { root, rig: new CarRig(root) };
}

/** Recolours the painted bodywork from a livery mask (R secondary, G accent, B bare carbon). */
export function liveryMaterial(base, mask, colours) {
  const m = base.clone();
  m.map = mask; // UV0, the livery atlas; the shader reads it as weights, not colour
  m.color.set(0xffffff);
  const uniforms = {
    uPrimary: { value: new THREE.Color(colours.primary) },
    uSecondary: { value: new THREE.Color(colours.secondary) },
    uAccent: { value: new THREE.Color(colours.accent) },
    uCarbon: { value: new THREE.Color('#141518') },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uPrimary;
uniform vec3 uSecondary;
uniform vec3 uAccent;
uniform vec3 uCarbon;`,
      )
      .replace(
        '#include <map_fragment>',
        `float liveryCarbon = 0.0;
#ifdef USE_MAP
  vec3 liv = texture2D( map, vMapUv ).rgb;
  liveryCarbon = liv.b;
  vec3 paint = uPrimary * max( 0.0, 1.0 - liv.r - liv.g ) + uSecondary * liv.r + uAccent * liv.g;
  diffuseColor.rgb = mix( paint, uCarbon, liveryCarbon );
#endif`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = mix( roughnessFactor, 0.42, liveryCarbon );`,
      );
  };
  m.customProgramCacheKey = () => 'car-livery';
  m.userData.livery = uniforms;
  return m;
}

/** A canvas texture with a race number or a driver code, for the decal carriers. */
export function markingTexture(text, { fill, outline, font, aspect }) {
  const h = 256;
  const w = Math.round(h * aspect);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.clearRect(0, 0, w, h);
  g.font = `700 ${Math.round(h * 0.86)}px ${font}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = h * 0.07;
  g.strokeStyle = outline;
  g.strokeText(text, w / 2, h * 0.54);
  g.fillStyle = fill;
  g.fillText(text, w / 2, h * 0.54);
  const t = new THREE.CanvasTexture(c);
  t.flipY = false; // glTF UV convention: v runs down the image
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export class CarRig {
  constructor(root) {
    this.root = root;
    this.node = (n) => root.getObjectByName(n);
    this.wheels = CORNERS.map((c) => this.node(`wheel_${c}`));
    this.steer = { FL: this.node('steer_FL'), FR: this.node('steer_FR') };
    this.susp = Object.fromEntries(CORNERS.map((c) => [c, this.node(`suspension_${c}`)]));
    this.restY = Object.fromEntries(CORNERS.map((c) => [c, this.susp[c]?.position.y ?? 0]));
    this.drs = this.node('drs_flap');
    this.steeringWheel = this.node('steering_wheel');
    this.helmet = this.node('helmet');
    this.discs = CORNERS.map((c) => this.node(`brake_disc_${c}`)).filter(Boolean);
    // links: rotate so the rest direction to the outboard joint follows the joint
    root.updateMatrixWorld(true);
    this.links = [];
    root.traverse((o) => {
      const ud = o.userData;
      if (!ud.outboard || !ud.follows) return;
      const follower = this.node(ud.follows);
      if (!follower) return;
      const out = new THREE.Vector3().fromArray(ud.outboard); // car frame
      const attach = follower.worldToLocal(root.localToWorld(out.clone()));
      const rest = out.clone().sub(o.position);
      this.links.push({ o, follower, attach, rest: rest.normalize() });
    });
    // per-car material copies for brake glow and rain light
    for (const d of this.discs) {
      d.traverse((m) => {
        if (m.isMesh) {
          m.material = m.material.clone();
          m.material.emissiveIntensity = 0;
        }
      });
    }
    this.rainLight = this.node('rain_light');
    if (this.rainLight) {
      this.rainLight.traverse((m) => {
        if (m.isMesh) {
          m.material = m.material.clone();
          m.material.emissive.set('#ff2010');
          m.material.emissiveIntensity = 0;
        }
      });
    }
  }

  /** Paint every painted part from the mask and the three team colours. */
  setLivery(mask, colours) {
    const done = new Map();
    this.root.traverse((m) => {
      if (!m.isMesh || m.material.name !== 'paint') return;
      if (!done.has(m.material)) done.set(m.material, liveryMaterial(m.material, mask, colours));
      m.material = done.get(m.material);
    });
  }

  /** Race number and driver code on the decal carriers. */
  setMarkings({ number, code, fill, outline, font }) {
    this.root.traverse((m) => {
      if (!m.isMesh || !m.userData.decal) return;
      const isNumber = m.userData.decal === 'number';
      const tex = markingTexture(isNumber ? String(number) : code, {
        fill,
        outline,
        font,
        aspect: isNumber ? 1.6 : 3.4,
      });
      m.material = new THREE.MeshPhysicalMaterial({
        map: tex,
        transparent: true,
        roughness: 0.3,
        clearcoat: 1,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        depthWrite: false,
      });
      m.castShadow = false;
    });
  }

  /** Compound colour on the sidewall markings only (the markings are the bright texels). */
  setCompound(name) {
    const col = new THREE.Color(COMPOUND_COLOURS[name] ?? COMPOUND_COLOURS.medium);
    const done = new Map();
    this.root.traverse((m) => {
      if (!m.isMesh || m.material.name !== 'tyre') return;
      if (!done.has(m.material)) {
        const mat = m.material.clone();
        const uniforms = { uCompound: { value: col } };
        mat.onBeforeCompile = (shader) => {
          Object.assign(shader.uniforms, uniforms);
          shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\nuniform vec3 uCompound;')
            .replace(
              '#include <map_fragment>',
              `#include <map_fragment>
float marking = smoothstep( 0.05, 0.4, diffuseColor.r );
diffuseColor.rgb = mix( vec3( 0.018 ), uCompound * 0.8, marking );`,
            );
        };
        mat.customProgramCacheKey = () => 'car-tyre';
        mat.userData.compound = uniforms;
        done.set(m.material, mat);
      }
      m.material = done.get(m.material);
    });
  }

  /**
   * pose: spin (rad, wheel rotation, forward rolling is negative about +Z), steer (rad, road
   * wheel angle, positive left), travel {FL..RR} (m, positive = bump), drs (0 closed .. 1 open),
   * wheelTurn (rad, steering-wheel rotation, positive left), headYaw (rad), glow {FL..RR}
   * (0..1 brake disc heat), rain (0..1).
   */
  setPose(p) {
    for (const w of this.wheels) if (w) w.rotation.z = p.spin ?? 0;
    for (const c of ['FL', 'FR']) if (this.steer[c]) this.steer[c].rotation.y = p.steer ?? 0;
    for (const c of CORNERS) {
      const s = this.susp[c];
      if (s) s.position.y = this.restY[c] + (p.travel?.[c] ?? 0);
    }
    if (this.drs) {
      const open = THREE.MathUtils.degToRad(this.drs.userData.open_deg ?? 22);
      this.drs.rotation.z = open * (p.drs ?? 0);
    }
    if (this.steeringWheel) {
      const axis = new THREE.Vector3().fromArray(this.steeringWheel.userData.axis).normalize();
      this.steeringWheel.quaternion.setFromAxisAngle(axis, p.wheelTurn ?? 0);
    }
    if (this.helmet) this.helmet.rotation.y = p.headYaw ?? 0;
    this.discs.forEach((d, i) => {
      const heat = p.glow?.[CORNERS[i]] ?? 0;
      d.traverse((m) => {
        if (m.isMesh) m.material.emissiveIntensity = 4 * heat * heat;
      });
    });
    if (this.rainLight) {
      this.rainLight.traverse((m) => {
        if (m.isMesh) m.material.emissiveIntensity = 6 * (p.rain ?? 0);
      });
    }
    this.root.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    const q = new THREE.Quaternion();
    for (const L of this.links) {
      v.copy(L.attach);
      L.follower.localToWorld(v);
      this.root.worldToLocal(v);
      v.sub(L.o.position).normalize();
      q.setFromUnitVectors(L.rest, v);
      L.o.quaternion.copy(q);
    }
    this.root.updateMatrixWorld(true);
  }
}
