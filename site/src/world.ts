/**
 * The 3D world behind the page: one camera flight through six stops, driven
 * by scroll. Every stop is a small diorama for one idea of Kokoro Reader.
 * Plain Three.js, no post-processing, so it stays light on laptops and phones.
 */
import * as THREE from 'three';

export interface World {
  /** 0 at the hero, 1 at the finale; stop i sits at i / (stops - 1). */
  setProgress(progress: number): void;
  /** Audio loudness 0..1, drives the orbs, rings and stars. */
  setLevel(level: number): void;
  /** Called when a voice orb is clicked. */
  onOrbClick(handler: (stop: number) => void): void;
  readonly stops: number;
}

interface Options {
  reducedMotion: boolean;
  mobile: boolean;
  asset: (path: string) => string;
}

// ------------------------------------------------------------------ noise

const SIMPLEX = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`;

/** Small deterministic value noise for the terrain (CPU side). */
function makeNoise2D(seed = 7) {
  const hash = (x: number, y: number) => {
    const s = Math.sin(x * 127.1 + y * 311.7 + seed * 17.3) * 43758.5453;
    return s - Math.floor(s);
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = smooth(x - xi);
    const yf = smooth(y - yi);
    const a = hash(xi, yi);
    const b = hash(xi + 1, yi);
    const c = hash(xi, yi + 1);
    const d = hash(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
}

// ------------------------------------------------------------------ pieces

function orbMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uLevel: { value: 0 },
      uHover: { value: 0 },
      uColorA: { value: new THREE.Color('#7c3aed') },
      uColorB: { value: new THREE.Color('#fbbf77') },
      uColorC: { value: new THREE.Color('#38bdf8') },
    },
    vertexShader: /* glsl */ `
      ${SIMPLEX}
      uniform float uTime; uniform float uLevel; uniform float uHover;
      varying vec3 vNormal; varying vec3 vView; varying float vNoise;
      void main(){
        float n = snoise(normal * 1.6 + vec3(uTime * 0.35));
        float m = snoise(normal * 4.0 - vec3(uTime * 0.6)) * 0.35;
        float amp = 0.12 + uLevel * 0.55 + uHover * 0.08;
        vNoise = n + m;
        vec3 p = position + normal * (n + m) * amp;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uLevel; uniform vec3 uColorA; uniform vec3 uColorB; uniform vec3 uColorC;
      varying vec3 vNormal; varying vec3 vView; varying float vNoise;
      void main(){
        float fres = pow(1.0 - max(dot(vNormal, vView), 0.0), 2.2);
        vec3 base = mix(uColorA, uColorC, smoothstep(-0.6, 0.8, vNoise));
        vec3 col = mix(base * 0.55, uColorB, fres * (0.75 + uLevel));
        col += uColorB * pow(fres, 4.0) * 1.4;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

function glowSprite(color: string, size: number, opacity = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity }),
  );
  sprite.scale.setScalar(size);
  return sprite;
}

function textSprite(text: string, font: string, color: string, height: number) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = font;
  const width = Math.ceil(ctx.measureText(text).width) + 40;
  canvas.width = width;
  canvas.height = 160;
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  ctx.shadowBlur = 18;
  ctx.fillText(text, 20, 84);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set((height * width) / 160, height, 1);
  return sprite;
}

let dotTexture: THREE.Texture | null = null;
/** A soft round dot, so particles are not square pixels. */
function dot(): THREE.Texture {
  if (dotTexture) return dotTexture;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.45, 'rgba(255,255,255,0.85)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  dotTexture = new THREE.CanvasTexture(canvas);
  return dotTexture;
}

function ringOfPoints(count: number, radius: number, spread: number, color: string, size: number) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = radius + (Math.random() - 0.5) * spread;
    positions[i * 3] = Math.cos(a) * r;
    positions[i * 3 + 1] = (Math.random() - 0.5) * spread * 0.35;
    positions[i * 3 + 2] = Math.sin(a) * r;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ color, size: size * 1.8, map: dot(), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }),
  );
}

// ------------------------------------------------------------------ world

export function createWorld(canvas: HTMLCanvasElement, options: Options): World | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: !options.mobile, powerPreference: 'high-performance' });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, options.mobile ? 1.5 : 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0b0920');
  scene.fog = new THREE.FogExp2('#0b0920', 0.018);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);

  scene.add(new THREE.HemisphereLight('#c4b5fd', '#1e1b4b', 1.1));
  const sun = new THREE.DirectionalLight('#ffd7a8', 2.4);
  sun.position.set(-20, 18, -20);
  scene.add(sun);

  const clock = new THREE.Clock();
  const animated: ((t: number, dt: number) => void)[] = [];
  const orbMaterials: THREE.ShaderMaterial[] = [];
  const clickable: { mesh: THREE.Object3D; stop: number }[] = [];

  // Stops: where each diorama sits, and where the camera aims so the object
  // sits beside the text card (left card → object right) or above it on phones.
  const STOPS = [
    { at: new THREE.Vector3(0, 0, 0), side: -1 },
    { at: new THREE.Vector3(16, -2, -26), side: 1 },
    { at: new THREE.Vector3(-14, -3, -54), side: -1 },
    { at: new THREE.Vector3(14, 0, -82), side: 1 },
    { at: new THREE.Vector3(-12, -2, -110), side: -1 },
    { at: new THREE.Vector3(0, 2, -138), side: 0 },
  ];

  // ---- stars
  {
    const count = options.mobile ? 1600 : 3200;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 160;
      positions[i * 3 + 1] = (Math.random() - 0.3) * 90;
      positions[i * 3 + 2] = 30 - Math.random() * 210;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: '#e9e4ff', size: 0.3, map: dot(), transparent: true, opacity: 0.8, depthWrite: false });
    const stars = new THREE.Points(geometry, material);
    scene.add(stars);
    animated.push((t) => {
      material.opacity = 0.65 + Math.sin(t * 0.8) * 0.1 + level * 0.35;
      stars.rotation.z = Math.sin(t * 0.03) * 0.04;
    });
  }

  // ---- 0: the voice orb
  const hero = new THREE.Group();
  hero.position.copy(STOPS[0]!.at);
  scene.add(hero);
  {
    const material = orbMaterial();
    orbMaterials.push(material);
    const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5, options.mobile ? 24 : 48), material);
    hero.add(orb, glowSprite('rgba(167,139,250,0.55)', 9));
    clickable.push({ mesh: orb, stop: 0 });
    const rings = [ringOfPoints(900, 2.7, 0.5, '#c4b5fd', 0.05), ringOfPoints(700, 3.6, 0.8, '#fbbf77', 0.045), ringOfPoints(500, 4.6, 1.2, '#7dd3fc', 0.04)];
    rings.forEach((ring, i) => {
      ring.rotation.x = 0.35 + i * 0.35;
      ring.rotation.z = i * 0.6;
      hero.add(ring);
    });
    animated.push((t) => {
      orb.rotation.y = t * 0.15;
      rings.forEach((ring, i) => {
        ring.rotation.y = t * (0.12 + i * 0.05) * (i % 2 ? -1 : 1);
        ring.scale.setScalar(1 + level * (0.25 + i * 0.1));
      });
      hero.position.y = STOPS[0]!.at.y + Math.sin(t * 0.8) * 0.15;
    });
  }

  // ---- 1: the page being read
  {
    const group = new THREE.Group();
    group.position.copy(STOPS[1]!.at);
    group.rotation.y = -0.35;
    scene.add(group);
    const texture = new THREE.TextureLoader().load(options.asset('img/player.png'));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const page = new THREE.Mesh(new THREE.PlaneGeometry(8, 5), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
    const halo = glowSprite('rgba(167,139,250,0.5)', 13, 0.8);
    halo.position.z = -0.4;
    group.add(halo, page);
    // A speaker bubble with sound waves.
    const material = orbMaterial();
    material.uniforms.uColorA!.value = new THREE.Color('#6366f1');
    orbMaterials.push(material);
    const speaker = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 16), material);
    speaker.position.set(3.6, -2.3, 0.8);
    group.add(speaker);
    clickable.push({ mesh: speaker, stop: 1 });
    const waves: THREE.Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const wave = new THREE.Mesh(
        new THREE.TorusGeometry(0.7, 0.03, 8, 48, Math.PI * 0.7),
        new THREE.MeshBasicMaterial({ color: '#fbbf77', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      wave.position.copy(speaker.position);
      wave.rotation.z = -Math.PI * 0.35;
      group.add(wave);
      waves.push(wave);
    }
    animated.push((t) => {
      group.position.y = STOPS[1]!.at.y + Math.sin(t * 0.7) * 0.2;
      group.rotation.x = Math.sin(t * 0.5) * 0.04;
      speaker.position.y = -2.3 + Math.sin(t * 2.2) * 0.12;
      waves.forEach((wave, i) => {
        const phase = (t * 0.6 + i / 3) % 1;
        wave.scale.setScalar(0.6 + phase * 2.4);
        wave.position.y = speaker.position.y;
        (wave.material as THREE.MeshBasicMaterial).opacity = (1 - phase) * (0.7 + level);
      });
    });
  }

  // ---- 2: the Himalaya at sunrise
  const himalaya = new THREE.Group();
  himalaya.position.copy(STOPS[2]!.at);
  scene.add(himalaya);
  {
    const noise = makeNoise2D(11);
    const width = 56;
    const depth = 28;
    const segX = options.mobile ? 90 : 140;
    const segZ = options.mobile ? 45 : 70;
    const geometry = new THREE.PlaneGeometry(width, depth, segX, segZ);
    geometry.rotateX(-Math.PI / 2);
    const position = geometry.attributes.position!;
    const colors = new Float32Array(position.count * 3);
    const low = new THREE.Color('#1e1b4b');
    const mid = new THREE.Color('#5b4b8a');
    const rock = new THREE.Color('#8e7bb8');
    const snow = new THREE.Color('#fff1f2');
    const pink = new THREE.Color('#fbcfe8');
    const color = new THREE.Color();
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const z = position.getZ(i);
      // Ridged multi-octave noise, tallest towards the back, a range rather than a field.
      let h = 0;
      let amp = 1;
      let freq = 0.09;
      for (let o = 0; o < 5; o++) {
        const n = 1 - Math.abs(noise(x * freq + 3, z * freq + 7) * 2 - 1);
        h += n * n * amp;
        amp *= 0.5;
        freq *= 2.05;
      }
      const back = THREE.MathUtils.smoothstep(-z, -6, 12);
      const edge = 1 - Math.pow(Math.abs(x) / (width / 2), 3);
      const height = h * (2.5 + back * 9) * edge - 1.5;
      position.setY(i, height);
      const k = THREE.MathUtils.clamp((height + 1) / 9, 0, 1);
      if (k > 0.62) color.copy(snow).lerp(pink, Math.random() * 0.35);
      else if (k > 0.38) color.copy(rock).lerp(snow, (k - 0.38) * 1.2);
      else color.copy(low).lerp(mid, k / 0.38);
      colors.set([color.r, color.g, color.b], i * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const terrain = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 }));
    terrain.position.set(0, -2.5, -6);
    himalaya.add(terrain);

    const sunDisc = glowSprite('rgba(251,191,119,0.95)', 10);
    sunDisc.position.set(6, 6, -22);
    const sunHalo = glowSprite('rgba(251,146,60,0.35)', 34);
    sunHalo.position.copy(sunDisc.position);
    himalaya.add(sunHalo, sunDisc);

    // Prayer flags: blue, white, red, green, yellow.
    const flagColors = ['#2563eb', '#f8fafc', '#dc2626', '#16a34a', '#facc15'];
    const flags: THREE.Mesh[] = [];
    const span = 16;
    const flagCount = 25;
    for (let i = 0; i < flagCount; i++) {
      const u = i / (flagCount - 1);
      const flag = new THREE.Mesh(
        new THREE.PlaneGeometry(0.42, 0.55, 4, 4),
        new THREE.MeshStandardMaterial({ color: flagColors[i % 5], side: THREE.DoubleSide, roughness: 0.8 }),
      );
      flag.position.set(-span / 2 + u * span, 1.6 - Math.sin(u * Math.PI) * 1.1, 4);
      flag.userData.base = flag.position.clone();
      himalaya.add(flag);
      flags.push(flag);
    }
    const ropePoints = flags.map((flag) => (flag.userData.base as THREE.Vector3).clone().add(new THREE.Vector3(0, 0.28, 0)));
    const rope = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ropePoints), new THREE.LineBasicMaterial({ color: '#c4b5fd', transparent: true, opacity: 0.5 }));
    himalaya.add(rope);

    const words: THREE.Sprite[] = [];
    const place = () => {
      ['नमस्ते', 'समाचार', 'कथा', 'सुन्नुहोस्', 'नेपाली'].forEach((word, i) => {
        const sprite = textSprite(word, '700 92px "Noto Sans Devanagari", sans-serif', i % 2 ? '#fbbf77' : '#e9d5ff', 1.1);
        sprite.position.set(-7 + i * 3.4, 3 + (i % 3) * 1.2, 1 - (i % 2) * 3);
        sprite.userData.base = sprite.position.clone();
        sprite.userData.phase = i * 1.3;
        himalaya.add(sprite);
        words.push(sprite);
      });
    };
    // Draw the Devanagari words once the font is ready (or after a short wait).
    Promise.race([document.fonts.load('700 92px "Noto Sans Devanagari"'), new Promise((resolve) => setTimeout(resolve, 2500))]).then(place, place);

    animated.push((t) => {
      flags.forEach((flag, i) => {
        const base = flag.userData.base as THREE.Vector3;
        flag.rotation.y = Math.sin(t * 2.4 + i * 0.6) * 0.5;
        flag.rotation.z = Math.sin(t * 1.7 + i) * 0.08;
        flag.position.y = base.y + Math.sin(t * 1.3 + i * 0.4) * 0.05;
      });
      words.forEach((sprite) => {
        const base = sprite.userData.base as THREE.Vector3;
        sprite.position.y = base.y + Math.sin(t * 0.7 + (sprite.userData.phase as number)) * 0.35;
        (sprite.material as THREE.SpriteMaterial).opacity = 0.75 + Math.sin(t + (sprite.userData.phase as number)) * 0.2 + level * 0.3;
      });
      sunDisc.scale.setScalar(10 + Math.sin(t * 0.5) * 0.4 + level * 3);
    });
  }

  // ---- 3: the vault (nothing leaves)
  {
    const group = new THREE.Group();
    group.position.copy(STOPS[3]!.at);
    scene.add(group);
    const size = 4.2;
    const box = new THREE.BoxGeometry(size, size, size);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: '#c4b5fd' }));
    const glass = new THREE.Mesh(
      box,
      new THREE.MeshPhysicalMaterial({ color: '#a78bfa', transparent: true, opacity: 0.12, roughness: 0.1, metalness: 0.1, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false }),
    );
    group.add(glass, edges, glowSprite('rgba(99,102,241,0.45)', 12));
    const material = orbMaterial();
    material.uniforms.uColorC!.value = new THREE.Color('#22d3ee');
    orbMaterials.push(material);
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7, 24), material);
    group.add(core);
    clickable.push({ mesh: core, stop: 3 });
    // Particles bounce inside the walls: they never get out.
    const count = 420;
    const positions = new Float32Array(count * 3);
    const velocity = new Float32Array(count * 3);
    const half = size / 2 - 0.12;
    for (let i = 0; i < count * 3; i++) {
      positions[i] = (Math.random() - 0.5) * 2 * half;
      velocity[i] = (Math.random() - 0.5) * 1.6;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const dots = new THREE.Points(geometry, new THREE.PointsMaterial({ color: '#fbbf77', size: 0.14, map: dot(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    group.add(dots);
    // A padlock on top.
    const lock = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1, 0.8, 0.4), new THREE.MeshStandardMaterial({ color: '#fbbf77', emissive: '#f59e0b', emissiveIntensity: 0.55, metalness: 0.3, roughness: 0.35 }));
    const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.08, 12, 32, Math.PI), new THREE.MeshStandardMaterial({ color: '#e9e4ff', emissive: '#c4b5fd', emissiveIntensity: 0.4, metalness: 0.5, roughness: 0.25 }));
    shackle.position.y = 0.4;
    lock.add(body, shackle);
    lock.position.y = size / 2 + 0.8;
    group.add(lock);
    animated.push((t, dt) => {
      group.rotation.y = t * 0.25;
      group.rotation.x = Math.sin(t * 0.3) * 0.12;
      lock.position.y = size / 2 + 0.8 + Math.sin(t * 1.5) * 0.08;
      const speed = 1 + level * 3;
      for (let i = 0; i < count * 3; i++) {
        positions[i]! += velocity[i]! * dt * speed;
        if (positions[i]! > half || positions[i]! < -half) {
          velocity[i] = -velocity[i]!;
          positions[i] = THREE.MathUtils.clamp(positions[i]!, -half, half);
        }
      }
      geometry.attributes.position!.needsUpdate = true;
    });
  }

  // ---- 4: the circuit city (on-device compute)
  {
    const group = new THREE.Group();
    group.position.copy(STOPS[4]!.at);
    group.rotation.x = 0.15;
    scene.add(group);
    const n = options.mobile ? 14 : 20;
    const gap = 0.62;
    const blocks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.46, 1, 0.46), new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.3 }), n * n);
    const heights: number[] = [];
    const matrix = new THREE.Matrix4();
    const noise = makeNoise2D(3);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const h = 0.2 + Math.pow(noise(i * 0.35, j * 0.35), 2) * 2.4;
        heights.push(h);
        matrix.compose(new THREE.Vector3((i - n / 2) * gap, h / 2 - 2, (j - n / 2) * gap), new THREE.Quaternion(), new THREE.Vector3(1, h, 1));
        blocks.setMatrixAt(i * n + j, matrix);
        blocks.setColorAt(i * n + j, new THREE.Color('#312e81'));
      }
    }
    group.add(blocks);
    const chipCanvas = document.createElement('canvas');
    chipCanvas.width = chipCanvas.height = 256;
    {
      const ctx = chipCanvas.getContext('2d')!;
      ctx.fillStyle = '#1e1b4b';
      ctx.fillRect(0, 0, 256, 256);
      ctx.strokeStyle = '#fbbf77';
      ctx.lineWidth = 3;
      ctx.strokeRect(40, 40, 176, 176);
      for (let i = 0; i < 9; i++) {
        const p = 52 + i * 19;
        for (const [x1, y1, x2, y2] of [[p, 0, p, 40], [p, 216, p, 256], [0, p, 40, p], [216, p, 256, p]] as const) {
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
      }
      ctx.fillStyle = '#a78bfa';
      ctx.font = '700 64px "Space Grotesk", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('82M', 128, 132);
    }
    const chipTexture = new THREE.CanvasTexture(chipCanvas);
    chipTexture.colorSpace = THREE.SRGBColorSpace;
    const chipSide = new THREE.MeshStandardMaterial({ color: '#1e1b4b', emissive: '#7c3aed', emissiveIntensity: 0.5, metalness: 0.7, roughness: 0.3 });
    const chipTop = new THREE.MeshStandardMaterial({ map: chipTexture, emissive: '#ffffff', emissiveMap: chipTexture, emissiveIntensity: 0.6, roughness: 0.4 });
    const chip = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.35, 2.2), [chipSide, chipSide, chipTop, chipSide, chipSide, chipSide]);
    chip.position.y = 1.2;
    group.add(chip, glowSprite('rgba(124,58,237,0.6)', 7));
    const label = textSprite('WASM · WebGPU', '700 64px "Space Grotesk", sans-serif', '#e9e4ff', 0.6);
    label.position.y = 2.2;
    group.add(label);
    const cool = new THREE.Color('#312e81');
    const hot = new THREE.Color('#fbbf77');
    const violet = new THREE.Color('#a78bfa');
    const c = new THREE.Color();
    animated.push((t) => {
      group.rotation.y = t * 0.12;
      chip.position.y = 1.2 + Math.sin(t * 1.4) * 0.1;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const d = Math.hypot(i - n / 2, j - n / 2);
          const pulse = Math.max(0, Math.sin(d * 0.9 - t * 3.2)) ** 6;
          c.copy(cool).lerp(d % 2 < 1 ? hot : violet, Math.min(1, pulse * (0.9 + level)));
          blocks.setColorAt(i * n + j, c);
        }
      }
      blocks.instanceColor!.needsUpdate = true;
    });
  }

  // ---- 5: finale orb
  {
    const group = new THREE.Group();
    group.position.copy(STOPS[5]!.at);
    scene.add(group);
    const material = orbMaterial();
    orbMaterials.push(material);
    const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(1.8, options.mobile ? 24 : 48), material);
    group.add(glowSprite('rgba(251,191,119,0.4)', 16), orb);
    clickable.push({ mesh: orb, stop: 5 });
    const burst = ringOfPoints(1600, 4.5, 3, '#c4b5fd', 0.06);
    group.add(burst);
    animated.push((t) => {
      orb.rotation.y = -t * 0.2;
      burst.rotation.y = t * 0.1;
      burst.rotation.x = Math.sin(t * 0.2) * 0.4;
      burst.scale.setScalar(1 + Math.sin(t * 0.9) * 0.05 + level * 0.4);
    });
  }

  // ------------------------------------------------------------ camera path

  const camPoints: THREE.Vector3[] = [];
  const aimPoints: THREE.Vector3[] = [];
  const buildPath = () => {
    camPoints.length = 0;
    aimPoints.length = 0;
    const portrait = window.innerWidth < 760;
    for (const stop of STOPS) {
      // Landscape: shift sideways so the object sits beside the card.
      // Portrait: cards sit at the bottom, so put the object in the upper half.
      const last = stop === STOPS[STOPS.length - 1];
      const first = stop === STOPS[0];
      // The finale card is centred, so its orb floats above it; on phones the cards sit low.
      const shift = portrait
        ? new THREE.Vector3(0, first || last ? -3.6 : -2.6, 0)
        : new THREE.Vector3(stop.side * 3.2, last ? -2.1 : 0, 0);
      const distance = portrait ? 12 : 9.5;
      const aim = stop.at.clone().add(shift);
      if (stop === STOPS[2]) aim.y += 1.5;
      aimPoints.push(aim);
      camPoints.push(aim.clone().add(new THREE.Vector3(0, 1.4, distance)));
    }
  };
  buildPath();
  let camCurve = new THREE.CatmullRomCurve3(camPoints, false, 'centripetal');
  let aimCurve = new THREE.CatmullRomCurve3(aimPoints, false, 'centripetal');

  // ------------------------------------------------------------ input

  let target = 0;
  let progress = 0;
  let level = 0;
  let levelTarget = 0;
  const pointer = new THREE.Vector2();
  const pointerSmooth = new THREE.Vector2();
  let dragYaw = 0;
  let dragPitch = 0;
  let dragging: { x: number; y: number; yaw: number; pitch: number } | null = null;
  let clickHandler: ((stop: number) => void) | null = null;
  const raycaster = new THREE.Raycaster();
  let hovered: { mesh: THREE.Object3D; stop: number } | null = null;

  const pick = (x: number, y: number) => {
    raycaster.setFromCamera(new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1), camera);
    const hits = raycaster.intersectObjects(clickable.map((item) => item.mesh), false);
    return hits.length ? clickable.find((item) => item.mesh === hits[0]!.object) ?? null : null;
  };

  window.addEventListener('pointermove', (event) => {
    pointer.set((event.clientX / window.innerWidth) * 2 - 1, (event.clientY / window.innerHeight) * 2 - 1);
    if (dragging) {
      dragYaw = THREE.MathUtils.clamp(dragging.yaw - (event.clientX - dragging.x) * 0.005, -0.9, 0.9);
      dragPitch = THREE.MathUtils.clamp(dragging.pitch + (event.clientY - dragging.y) * 0.003, -0.35, 0.45);
    }
    if (event.target === canvas) {
      hovered = pick(event.clientX, event.clientY);
      canvas.classList.toggle('hovering', Boolean(hovered));
    } else if (hovered) {
      hovered = null;
      canvas.classList.remove('hovering');
    }
  });
  canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse') dragging = { x: event.clientX, y: event.clientY, yaw: dragYaw, pitch: dragPitch };
  });
  window.addEventListener('pointerup', () => {
    dragging = null;
  });
  canvas.addEventListener('click', (event) => {
    const hit = pick(event.clientX, event.clientY);
    if (hit) clickHandler?.(hit.stop);
  });

  const resize = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.fov = width < 760 ? 68 : 55;
    camera.updateProjectionMatrix();
    buildPath();
    camCurve = new THREE.CatmullRomCurve3(camPoints, false, 'centripetal');
    aimCurve = new THREE.CatmullRomCurve3(aimPoints, false, 'centripetal');
  };
  window.addEventListener('resize', resize);
  resize();

  // ------------------------------------------------------------ loop

  const camPos = new THREE.Vector3();
  const aim = new THREE.Vector3();
  const offset = new THREE.Vector3();
  let visible = true;
  document.addEventListener('visibilitychange', () => {
    visible = document.visibilityState === 'visible';
  });

  renderer.setAnimationLoop(() => {
    if (!visible) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = options.reducedMotion ? 0 : clock.elapsedTime;
    // Ease towards the scroll position: smooth flight, no jumps.
    progress += (target - progress) * (options.reducedMotion ? 1 : 1 - Math.pow(0.0015, dt));
    level += (levelTarget - level) * (1 - Math.pow(0.0001, dt));
    pointerSmooth.lerp(pointer, 1 - Math.pow(0.02, dt));
    if (!dragging) {
      dragYaw *= Math.pow(0.25, dt);
      dragPitch *= Math.pow(0.25, dt);
    }

    camCurve.getPoint(progress, camPos);
    aimCurve.getPoint(progress, aim);
    // Orbit around the aim point by the drag angles, plus a little pointer parallax.
    offset.copy(camPos).sub(aim);
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), dragYaw + (options.reducedMotion ? 0 : pointerSmooth.x * -0.08));
    const right = new THREE.Vector3().crossVectors(offset, new THREE.Vector3(0, 1, 0)).normalize();
    offset.applyAxisAngle(right, dragPitch + (options.reducedMotion ? 0 : pointerSmooth.y * 0.05));
    camera.position.copy(aim).add(offset);
    camera.lookAt(aim);

    for (const material of orbMaterials) {
      material.uniforms.uTime!.value = t;
      material.uniforms.uLevel!.value = level;
      const isHovered = hovered && clickable.some((item) => item === hovered && (item.mesh as THREE.Mesh).material === material);
      material.uniforms.uHover!.value += ((isHovered ? 1 : 0) - material.uniforms.uHover!.value) * 0.15;
    }
    for (const step of animated) step(t, options.reducedMotion ? 0 : dt);
    renderer.render(scene, camera);
  });

  return {
    stops: STOPS.length,
    setProgress(value) {
      target = THREE.MathUtils.clamp(value, 0, 1);
    },
    setLevel(value) {
      levelTarget = THREE.MathUtils.clamp(value, 0, 1);
    },
    onOrbClick(handler) {
      clickHandler = handler;
    },
  };
}
