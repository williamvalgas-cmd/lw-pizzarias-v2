/**
 * LW Pizzarias - cena 3D cinematográfica da primeira seção (Three.js).
 * Tudo é gerado por código (sem arquivos de imagem/modelo): pizza fatiada, mesa de madeira,
 * ingredientes caindo, vapor, poeira de farinha na luz e câmera em movimento de cinema.
 * Compilado com:  npm run build:hero   ->  public/vendor/hero3d.js
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const easeOutBack = x => { const c1 = 1.4, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };

function rng(seed) { // mulberry32 (determinístico: a pizza é sempre a mesma)
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function tex(c, srgb = true, repeat) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

/* ---------- texturas procedurais ---------- */
function woodTexture(base, seed) {
  const R = rng(seed), [c, g] = canvas(1024, 1024);
  g.fillStyle = base; g.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 520; i++) { // veios
    const y = R() * 1024, amp = 2 + R() * 6, f = 0.004 + R() * 0.01, ph = R() * 6;
    g.strokeStyle = `rgba(${20 + R() * 30},${8 + R() * 14},4,${0.05 + R() * 0.14})`;
    g.lineWidth = 0.6 + R() * 2.2; g.beginPath();
    for (let x = 0; x <= 1024; x += 16) { const yy = y + Math.sin(x * f + ph) * amp; x ? g.lineTo(x, yy) : g.moveTo(x, yy); }
    g.stroke();
  }
  for (let p = 1; p < 5; p++) { g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, p * 205 - 2, 1024, 4); } // juntas das tábuas
  return c;
}
function cheeseTexture(seed) {
  const R = rng(seed), S = 1024, [c, g] = canvas(S, S), [b, gb] = canvas(S, S);
  const rad = S * 0.5;
  const grd = g.createRadialGradient(rad, rad, 0, rad, rad, rad);
  grd.addColorStop(0, '#b52a1b'); grd.addColorStop(1, '#8e1c12');
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  gb.fillStyle = '#555'; gb.fillRect(0, 0, S, S);
  const pal = ['#f7dc86', '#f3cd63', '#fbe9a8', '#efc14a', '#f5d47a'];
  for (let i = 0; i < 1100; i++) {
    const a = R() * TAU, d = Math.sqrt(R()) * rad * 0.9, x = rad + Math.cos(a) * d, y = rad + Math.sin(a) * d, r = 16 + R() * 54;
    g.globalAlpha = 0.9; g.fillStyle = pal[(R() * pal.length) | 0];
    g.beginPath(); g.ellipse(x, y, r, r * (0.55 + R() * 0.45), R() * 3, 0, TAU); g.fill();
    gb.globalAlpha = 0.5; gb.fillStyle = R() > 0.5 ? '#9a9a9a' : '#303030';
    gb.beginPath(); gb.arc(x, y, r * 0.8, 0, TAU); gb.fill();
  }
  for (let i = 0; i < 230; i++) { // manchas douradas do forno
    const a = R() * TAU, d = Math.sqrt(R()) * rad * 0.9, x = rad + Math.cos(a) * d, y = rad + Math.sin(a) * d, r = 5 + R() * 22;
    g.globalAlpha = 0.35 + R() * 0.3; g.fillStyle = R() > 0.3 ? '#c9782c' : '#a85a1f';
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  }
  for (let i = 0; i < 70; i++) { // molho aparecendo
    const a = R() * TAU, d = (0.55 + R() * 0.4) * rad * 0.9, x = rad + Math.cos(a) * d, y = rad + Math.sin(a) * d, r = 8 + R() * 18;
    g.globalAlpha = 0.65; g.fillStyle = '#b3261a';
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  }
  g.globalAlpha = 1; gb.globalAlpha = 1;
  return [c, b];
}
function crustTexture(seed) {
  const R = rng(seed), [c, g] = canvas(256, 256);
  g.fillStyle = '#c98a3e'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 260; i++) {
    g.globalAlpha = 0.15 + R() * 0.35; g.fillStyle = R() > 0.55 ? '#7a3f14' : (R() > 0.5 ? '#e3a85a' : '#a8631f');
    g.beginPath(); g.arc(R() * 256, R() * 256, 3 + R() * 16, 0, TAU); g.fill();
  }
  g.globalAlpha = 1; return c;
}
function pepperoniTexture(seed) {
  const R = rng(seed), [c, g] = canvas(256, 256);
  const grd = g.createRadialGradient(128, 128, 10, 128, 128, 128);
  grd.addColorStop(0, '#b8321f'); grd.addColorStop(0.75, '#9a2415'); grd.addColorStop(1, '#5e1209');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 46; i++) { g.globalAlpha = 0.3 + R() * 0.3; g.fillStyle = R() > 0.4 ? '#4a0e08' : '#d4543a'; g.beginPath(); g.arc(30 + R() * 196, 30 + R() * 196, 2 + R() * 7, 0, TAU); g.fill(); }
  g.globalAlpha = 1; return c;
}
function spriteTexture() {
  const [c, g] = canvas(128, 128), grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.4, 'rgba(255,255,255,.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/* ---------- geometrias dos ingredientes ---------- */
function leafGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0, -0.5); s.bezierCurveTo(0.42, -0.35, 0.46, 0.2, 0, 0.55); s.bezierCurveTo(-0.46, 0.2, -0.42, -0.35, 0, -0.5);
  const g = new THREE.ShapeGeometry(s, 10), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i); p.setZ(i, Math.abs(x) * 0.55 - y * y * 0.18); } // dobra no meio
  g.rotateX(-Math.PI / 2); g.computeVertexNormals(); return g;
}

/* ---------- cena ---------- */
export function startHero(container, opts = {}) {
  const mobile = matchMedia('(max-width: 768px)').matches;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: !mobile, alpha: false, powerPreference: 'high-performance' });
  } catch (e) { return null; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  renderer.domElement.className = 'lw-hero-canvas';
  container.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0604);
  scene.fog = new THREE.FogExp2(0x0b0604, 0.055);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.12;

  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 60);

  /* luzes */
  const key = new THREE.SpotLight(0xffcf94, 300, 24, 0.42, 0.85, 1.6);
  key.position.set(-3.2, 6.2, 3.4); key.target.position.set(0, 0, 0);
  key.castShadow = true; key.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; key.shadow.radius = 5;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(0x6fa8ff, 1.6); rim.position.set(4, 3, -5); scene.add(rim);
  const oven = new THREE.PointLight(0xff7a2a, 14, 7, 1.8); oven.position.set(2.4, 1.1, -1.2); scene.add(oven);
  scene.add(new THREE.HemisphereLight(0x2a1d18, 0x0c0604, 0.3));

  /* mesa + tábua */
  const woodMap = tex(woodTexture('#3a2110', 11), true, [3, 3]);
  const table = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ map: woodMap, roughness: 0.78, metalness: 0 }));
  table.rotation.x = -Math.PI / 2; table.position.y = -0.09; table.receiveShadow = true; scene.add(table);
  const boardMap = tex(woodTexture('#8f5e2e', 23), true, [1, 1]);
  const board = new THREE.Mesh(new THREE.CylinderGeometry(2.15, 2.15, 0.09, 72), new THREE.MeshStandardMaterial({ map: boardMap, roughness: 0.6 }));
  board.position.y = -0.045; board.castShadow = true; board.receiveShadow = true; scene.add(board);

  /* pizza em fatias */
  const SLICES = 8, L = TAU / SLICES, GAP = 0.016;
  const [cheeseC, bumpC] = cheeseTexture(5);
  const cheeseMap = tex(cheeseC), cheeseBump = tex(bumpC, false);
  const crustMap = tex(crustTexture(9), true, [1, 1]);
  const doughSide = new THREE.MeshStandardMaterial({ color: 0xdca85f, roughness: 0.85 });
  const doughBottom = new THREE.MeshStandardMaterial({ color: 0xb98642, roughness: 0.9 });
  const cheeseTopMat = new THREE.MeshStandardMaterial({ map: cheeseMap, bumpMap: cheeseBump, bumpScale: 3.2, roughness: 0.42, metalness: 0 });
  const cheeseSideMat = new THREE.MeshStandardMaterial({ color: 0xf0c562, roughness: 0.5 });
  const crustMat = new THREE.MeshStandardMaterial({ map: crustMap, bumpMap: crustMap, bumpScale: 1.4, roughness: 0.78 });

  const pizza = new THREE.Group(); scene.add(pizza);
  const slices = [];
  for (let k = 0; k < SLICES; k++) {
    const mid = k * L, a0 = mid - L / 2 + GAP / 2, len = L - GAP;
    const pivot = new THREE.Group(); pivot.userData = { mid }; pizza.add(pivot);
    const dough = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 1.55, 0.14, 28, 1, false, a0, len), [doughSide, doughBottom, doughBottom]);
    dough.position.y = 0.07;
    const cheese = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.05, 28, 1, false, a0, len), [cheeseSideMat, cheeseTopMat, doughBottom]);
    cheese.position.y = 0.165;
    const tg = new THREE.TorusGeometry(1.55, 0.17, 14, 14, len); tg.rotateX(-Math.PI / 2); tg.rotateY(a0 - Math.PI / 2);
    const crust = new THREE.Mesh(tg, crustMat); crust.position.y = 0.115;
    [dough, cheese, crust].forEach(m => { m.castShadow = true; m.receiveShadow = true; pivot.add(m); });
    slices.push(pivot);
  }

  /* ingredientes (caem na primeira vez) */
  const R = rng(77);
  const pepMat = new THREE.MeshStandardMaterial({ map: tex(pepperoniTexture(3)), roughness: 0.4 });
  const pepGeo = new THREE.SphereGeometry(1, 28, 10, 0, TAU, 0, Math.PI / 2); pepGeo.scale(1, 0.16, 1);
  const leafGeo = leafGeometry();
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x24621f, roughness: 0.55, side: THREE.DoubleSide });
  const oliveGeo = new THREE.TorusGeometry(0.075, 0.032, 8, 18); oliveGeo.rotateX(-Math.PI / 2);
  const oliveMat = new THREE.MeshStandardMaterial({ color: 0x1b1a16, roughness: 0.35 });
  const toppings = [];
  function place(kind, count, minR, maxR, clear) {
    let tries = 0;
    while (count > 0 && tries++ < 600) {
      const a = R() * TAU, r = minR + Math.sqrt(R()) * (maxR - minR);
      const d = Math.abs(((a % L) + L) % L - L / 2); // distância ao centro da fatia
      const edge = (L / 2 - d) * r; if (edge < clear) continue; // não cruza o corte
      const k = Math.round(a / L) % SLICES, kk = (k + SLICES) % SLICES;
      let m;
      if (kind === 'pep') { const s = 0.23 + R() * 0.04; m = new THREE.Mesh(pepGeo, pepMat); m.scale.set(s, s, s); m.position.set(Math.sin(a) * r, 0.19, Math.cos(a) * r); m.rotation.y = R() * TAU; }
      else if (kind === 'leaf') { const s = 0.3 + R() * 0.12; m = new THREE.Mesh(leafGeo, leafMat); m.scale.set(s, s, s); m.position.set(Math.sin(a) * r, 0.2 + R() * 0.02, Math.cos(a) * r); m.rotation.y = R() * TAU; }
      else { m = new THREE.Mesh(oliveGeo, oliveMat); m.position.set(Math.sin(a) * r, 0.2, Math.cos(a) * r); m.rotation.y = R() * TAU; }
      m.castShadow = true; m.receiveShadow = true;
      m.userData = { fin: m.position.clone(), finScale: m.scale.x, delay: 0.15 + R() * 2.2, drop: 3.5 + R() * 3, spin: (R() - 0.5) * 8 };
      m.scale.setScalar(0.0001); slices[kk].add(m); toppings.push(m); count--;
    }
  }
  place('pep', 13, 0.35, 1.12, 0.3); place('leaf', 9, 0.3, 1.2, 0.2); place('olive', 16, 0.3, 1.25, 0.1);

  /* adereços na mesa */
  const props = [];
  for (let i = 0; i < 4; i++) { // tomates-cereja
    const t = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 16), new THREE.MeshStandardMaterial({ color: 0xc4251a, roughness: 0.28 }));
    const a = 0.7 + i * 1.45 + R() * 0.5, r = 2.7 + R() * 0.9; t.position.set(Math.sin(a) * r, 0.08, Math.cos(a) * r); t.castShadow = t.receiveShadow = true; scene.add(t); props.push(t);
    const st = new THREE.Mesh(leafGeo, leafMat); st.scale.setScalar(0.09); st.position.set(t.position.x, 0.245, t.position.z); scene.add(st);
  }
  for (let i = 0; i < 7; i++) { // folhas de manjericão soltas
    const l = new THREE.Mesh(leafGeo, leafMat); const a = R() * TAU, r = 2.5 + R() * 1.6, s = 0.34 + R() * 0.12;
    l.scale.setScalar(s); l.position.set(Math.sin(a) * r, -0.07, Math.cos(a) * r); l.rotation.y = R() * TAU; l.castShadow = l.receiveShadow = true; scene.add(l);
  }

  /* partículas: vapor + poeira de farinha na luz */
  const sprite = spriteTexture();
  const STEAM = mobile ? 40 : 70, steam = { p: new Float32Array(STEAM * 3), c: new Float32Array(STEAM * 4), a: new Float32Array(STEAM), v: new Float32Array(STEAM * 3) };
  const steamGeo = new THREE.BufferGeometry();
  steamGeo.setAttribute('position', new THREE.BufferAttribute(steam.p, 3)); steamGeo.setAttribute('color', new THREE.BufferAttribute(steam.c, 4));
  const steamPts = new THREE.Points(steamGeo, new THREE.PointsMaterial({ size: 0.9, map: sprite, transparent: true, depthWrite: false, vertexColors: true, sizeAttenuation: true }));
  steamPts.frustumCulled = false; scene.add(steamPts);
  const respawn = i => {
    const a = R() * TAU, r = Math.sqrt(R()) * 1.1; steam.p[i * 3] = Math.sin(a) * r; steam.p[i * 3 + 1] = 0.25 + R() * 0.1; steam.p[i * 3 + 2] = Math.cos(a) * r;
    steam.v[i * 3] = (R() - 0.5) * 0.12; steam.v[i * 3 + 1] = 0.22 + R() * 0.2; steam.v[i * 3 + 2] = (R() - 0.5) * 0.12; steam.a[i] = 0;
  };
  for (let i = 0; i < STEAM; i++) { respawn(i); steam.p[i * 3 + 1] += R() * 2.4; steam.a[i] = R(); }

  const DUST = mobile ? 60 : 130, dust = new Float32Array(DUST * 3), dustSeed = new Float32Array(DUST);
  for (let i = 0; i < DUST; i++) { dust[i * 3] = (R() - 0.5) * 9; dust[i * 3 + 1] = R() * 5; dust[i * 3 + 2] = (R() - 0.5) * 9; dustSeed[i] = R() * 10; }
  const dustGeo = new THREE.BufferGeometry(); dustGeo.setAttribute('position', new THREE.BufferAttribute(dust, 3));
  const dustPts = new THREE.Points(dustGeo, new THREE.PointsMaterial({ size: 0.07, map: sprite, color: 0xffd9a8, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
  dustPts.frustumCulled = false; scene.add(dustPts);

  /* câmera e linha do tempo */
  const T = 20, aim = new THREE.Vector3();
  const azAt = ph => 0.2 + 0.95 * Math.sin(ph);
  const liftPhase = 0.62, liftSlot = ((Math.round(azAt(liftPhase * TAU) / L) % SLICES) + SLICES) % SLICES;
  const axis = new THREE.Vector3(), dir = new THREE.Vector3(), pv = new THREE.Vector3(), tmp = new THREE.Vector3();

  function frame(t) {
    const loop = (t % T) / T, ph = loop * TAU;
    const intro = smooth(t / 5.2);

    // câmera: órbita suave + zoom lento + leve tremor de câmera na mão
    const az = azAt(ph);
    const el = (0.2 + 0.5 * intro) + 0.12 * Math.sin(ph * 2 + 0.6);
    const aspect = camera.aspect, fovNow = 34 - 4 * smooth(t / 8) + (aspect < 1 ? 6 : 0);
    const fit = aspect < 1.5 ? 4.9 / (2 * Math.tan(fovNow * Math.PI / 360) * Math.min(aspect, 1.5)) : 0; // telas estreitas: afasta para a pizza caber
    const rad = Math.max(7.4, fit) + 0.9 * Math.cos(ph) + (1 - intro) * 4.2;
    camera.position.set(Math.sin(az) * Math.cos(el) * rad, 0.35 + Math.sin(el) * rad, Math.cos(az) * Math.cos(el) * rad);
    camera.position.x += Math.sin(t * 1.3) * 0.012; camera.position.y += Math.sin(t * 1.9 + 1) * 0.012;
    aim.set(0, 0.12 + 0.12 * intro, 0); camera.lookAt(aim);
    camera.fov = fovNow; camera.updateProjectionMatrix();

    // ingredientes caindo
    for (const m of toppings) {
      const u = m.userData, p = clamp((t - u.delay) / 1.1, 0, 1);
      const e = easeOutBack(p);
      m.position.set(u.fin.x, u.fin.y + (1 - Math.min(1, e)) * u.drop, u.fin.z);
      m.scale.setScalar(Math.max(0.0001, u.finScale * smooth(p * 3)));
      m.rotation.x = (1 - p) * u.spin * 0.3; m.rotation.z = (1 - p) * u.spin * 0.2;
    }

    // uma fatia levanta e vira para a câmera
    const w = smooth((loop - 0.5) / 0.1) * (1 - smooth((loop - 0.74) / 0.1));
    slices.forEach((s, k) => {
      if (k !== liftSlot) { s.position.set(0, 0, 0); s.quaternion.identity(); return; }
      const mid = s.userData.mid; dir.set(Math.sin(mid), 0, Math.cos(mid)); axis.set(Math.cos(mid), 0, -Math.sin(mid));
      // levanta pela ponta (o recheio vira para a câmera), girando em torno da borda externa
      s.quaternion.setFromAxisAngle(axis, 0.52 * w);
      pv.copy(dir).multiplyScalar(1.6); pv.y = 0.1; tmp.copy(pv).applyQuaternion(s.quaternion);
      s.position.copy(pv).sub(tmp); s.position.addScaledVector(dir, 0.22 * w);
    });

    // luz do forno tremulando
    oven.intensity = 14 + Math.sin(t * 9) * 1.6 + Math.sin(t * 23) * 1.1;

    // vapor
    const dt = frame.dt || 0.016;
    for (let i = 0; i < STEAM; i++) {
      steam.a[i] += dt * 0.28;
      if (steam.a[i] >= 1) respawn(i);
      steam.p[i * 3] += steam.v[i * 3] * dt + Math.sin(t * 0.8 + i) * 0.0015; steam.p[i * 3 + 1] += steam.v[i * 3 + 1] * dt; steam.p[i * 3 + 2] += steam.v[i * 3 + 2] * dt;
      const a = steam.a[i], alpha = Math.sin(a * Math.PI) * 0.16 * smooth((t - 1.5) / 2);
      steam.c[i * 4] = steam.c[i * 4 + 1] = steam.c[i * 4 + 2] = 1; steam.c[i * 4 + 3] = alpha;
    }
    steamGeo.attributes.position.needsUpdate = true; steamGeo.attributes.color.needsUpdate = true;
    // poeira
    for (let i = 0; i < DUST; i++) { dust[i * 3 + 1] += dt * 0.05; if (dust[i * 3 + 1] > 5) dust[i * 3 + 1] = 0; dust[i * 3] += Math.sin(t * 0.3 + dustSeed[i]) * dt * 0.04; }
    dustGeo.attributes.position.needsUpdate = true;
  }

  /* execução */
  let raf = 0, last = 0, clock = 0, running = false, visible = true;
  const size = () => {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    if (w / h > 1.25) camera.setViewOffset(w, h, -w * 0.14, 0, w, h);          // texto à esquerda, pizza à direita
    else if (w / h < 0.9) camera.setViewOffset(w, h, 0, h * 0.13, w, h);       // celular: pizza no alto, texto embaixo
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  };
  size(); const ro = new ResizeObserver(size); ro.observe(container);

  function tick(now) {
    raf = requestAnimationFrame(tick);
    if (!last) last = now; const dt = Math.min(0.05, (now - last) / 1000); last = now;
    clock += dt; frame.dt = dt; frame(clock); renderer.render(scene, camera);
    if (!tick.shown) { tick.shown = true; container.classList.add('lw-hero-ready'); }
  }
  function play() { if (running || !visible || document.hidden) return; running = true; last = 0; raf = requestAnimationFrame(tick); }
  function pause() { running = false; cancelAnimationFrame(raf); }
  const io = new IntersectionObserver(es => { visible = es[0].isIntersecting; (visible && opts.userPlaying() ? play : pause)(); }, { threshold: 0.05 });
  io.observe(container);
  document.addEventListener('visibilitychange', () => { (!document.hidden && visible && opts.userPlaying()) ? play() : pause(); });

  // primeiro quadro estático (útil com "reduzir movimento": mostra a pizza já montada)
  const still = (t = 7.4) => { clock = t; frame.dt = 0.016; frame(clock); renderer.render(scene, camera); container.classList.add('lw-hero-ready'); };
  return { play, pause, still, isRunning: () => running, setTime: t => { clock = t; } };
}
