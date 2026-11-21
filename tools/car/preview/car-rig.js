/* global document */
// Reference implementation of the car asset contract in docs/car-asset.md: loading, liveries,
// markings, tyre compounds and the animated nodes. Plain ES module over three.js; the game's
// renderer can port it.
import * as THREE from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const CORNERS = ['FL', 'FR', 'RL', 'RR'];
export const TYRE_RADIUS = 0.36;

/**
 * Loads one or more levels of detail with one shared Draco decoder, which is disposed when the
 * loads finish or fail (the decoder holds a worker pool). Returns [{ root, rig }] in url order.
 */
export async function loadCars(urls, { dracoPath }) {
  const draco = new DRACOLoader().setDecoderPath(dracoPath);
  const loader = new GLTFLoader().setDRACOLoader(draco);
  try {
    const gltfs = await Promise.all(urls.map((u) => loader.loadAsync(u)));
    return gltfs.map((gltf) => {
      const root = gltf.scene.getObjectByName('car');
      root.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      return { root, rig: new CarRig(root) };
    });
  } finally {
    draco.dispose();
  }
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
roughnessFactor = mix( roughnessFactor, 0.5, liveryCarbon );`,
      );
  };
  m.customProgramCacheKey = () => 'car-livery';
  m.userData.livery = uniforms;
  return m;
}

/**
 * The markings canvas for the decal carriers: the race number in the left part (u 0..0.4), the
 * driver code in the right part (u 0.4..1), both on a transparent background.
 */
export function markingsTexture({ number, code, fill, outline, font, canvas = [2048, 512] }) {
  const [w, h] = canvas;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.clearRect(0, 0, w, h);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  const draw = (text, x0, x1, size) => {
    g.font = `700 ${Math.round(size)}px ${font}`;
    g.lineWidth = h * 0.06;
    g.strokeStyle = outline;
    g.strokeText(text, (x0 + x1) / 2, h * 0.54);
    g.fillStyle = fill;
    g.fillText(text, (x0 + x1) / 2, h * 0.54);
  };
  draw(String(number), 0, w * 0.4, h * 0.86);
  draw(code, w * 0.4, w, h * 0.78);
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
    // suspension links: one node, morph targets per corner (GLTFLoader may split it into one
    // mesh per material under a group; every part carries the same targets)
    const links = this.node('suspension_links');
    this.linkMeshes = [];
    this.linkRef = { bump: 0.03, steer: 0.35 };
    if (links) {
      const morph = links.userData.morph ?? {};
      this.linkRef = { bump: morph.bump_ref_m ?? 0.03, steer: morph.steer_ref_rad ?? 0.35 };
      links.traverse((m) => {
        if (m.isMesh && m.morphTargetDictionary) this.linkMeshes.push(m);
      });
    }
    // brake glow: the disc material lives on each upright; one copy per corner
    this.discMats = {};
    for (const c of CORNERS) {
      const up = this.node(`upright_${c}`);
      if (!up) continue;
      up.traverse((m) => {
        if (m.isMesh && m.material.name === 'brake_disc') {
          m.material = m.material.clone();
          m.material.emissiveIntensity = 0;
          this.discMats[c] = m.material;
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

  /** Race number and driver code on the decal carriers (one mesh, one canvas). */
  setMarkings(opts) {
    const decals = this.node('decals');
    if (!decals) return;
    const info = decals.userData.decal ?? {};
    const tex = markingsTexture({ ...opts, canvas: info.canvas ?? [2048, 512] });
    decals.traverse((m) => {
      if (!m.isMesh) return;
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

  /**
   * Tyre compound, from design/compounds.json: the sidewall ticks in the slots the compound
   * lists take its colour; unlisted slots are left as rubber; the maker's mark stays neutral.
   */
  setCompound(compound, marking) {
    const col = new THREE.Color(compound.colour);
    const lit = [-1, 0, 1].map((s) => (compound.slots.includes(s) ? 1 : 0));
    const groups = marking.groupsPerSidewall;
    const slot = marking.slotSpacingU;
    const done = new Map();
    this.root.traverse((m) => {
      if (!m.isMesh || m.material.name !== 'tyre') return;
      if (!done.has(m.material)) {
        const mat = m.material.clone();
        const uniforms = {
          uCompound: { value: col },
          uLit: { value: new THREE.Vector3(...lit) },
          uGroups: { value: groups },
          uSlot: { value: slot },
        };
        mat.onBeforeCompile = (shader) => {
          Object.assign(shader.uniforms, uniforms);
          shader.fragmentShader = shader.fragmentShader
            .replace(
              '#include <common>',
              `#include <common>
uniform vec3 uCompound;
uniform vec3 uLit;
uniform float uGroups;
uniform float uSlot;`,
            )
            .replace(
              '#include <map_fragment>',
              `#include <map_fragment>
#ifdef USE_MAP
{
  float marking = smoothstep( 0.05, 0.35, diffuseColor.r );
  float f = fract( vMapUv.x * uGroups ) - 0.5;
  float slotIndex = f / ( uSlot * uGroups );
  float isTick = step( abs( f ), 1.6 * uSlot * uGroups );
  float k = clamp( floor( slotIndex + 0.5 ), -1.0, 1.0 );
  float lit = k < -0.5 ? uLit.x : ( k > 0.5 ? uLit.z : uLit.y );
  vec3 rubber = vec3( 0.016 );
  vec3 tickCol = mix( rubber, uCompound * 0.85, lit );
  vec3 letterCol = vec3( 0.55 );
  diffuseColor.rgb = mix( rubber, mix( letterCol, tickCol, isTick ), marking );
}
#endif`,
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
    for (const m of this.linkMeshes) {
      const d = m.morphTargetDictionary;
      for (const c of CORNERS) {
        if (d[`bump_${c}`] !== undefined)
          m.morphTargetInfluences[d[`bump_${c}`]] = (p.travel?.[c] ?? 0) / this.linkRef.bump;
      }
      for (const c of ['FL', 'FR']) {
        if (d[`steer_${c}`] !== undefined)
          m.morphTargetInfluences[d[`steer_${c}`]] = (p.steer ?? 0) / this.linkRef.steer;
      }
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
    for (const c of CORNERS) {
      const mat = this.discMats[c];
      const heat = p.glow?.[c] ?? 0;
      if (mat) mat.emissiveIntensity = 4 * heat * heat;
    }
    if (this.rainLight) {
      this.rainLight.traverse((m) => {
        if (m.isMesh) m.material.emissiveIntensity = 6 * (p.rain ?? 0);
      });
    }
    this.root.updateMatrixWorld(true);
  }
}
