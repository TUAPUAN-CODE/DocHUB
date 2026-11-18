// @ts-nocheck — a direct port of the supplied Three.js cat (r128 API): kept as close to the original as possible
import { useEffect, useRef } from 'react';
import * as THREE from 'three';

export type CatEmotion = 'happy' | 'talking' | 'thinking' | 'excited' | 'love' | 'playful' | 'surprised' | 'sleepy' | 'sleeping' | 'sad' | 'angry' | 'furious';

/** The 3D cat (pastel clay robot). `emotion` drives the face, ears, tail and arms; the cat looks toward the mouse. */
export default function CatScene({ emotion }: { emotion: CatEmotion }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const emotionRef = useRef<CatEmotion>(emotion);
  emotionRef.current = emotion;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const box = canvas.parentElement!;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    camera.position.set(0, 0.25, 5.5);
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.98;
    renderer.outputEncoding = THREE.sRGBEncoding;
    const resize = () => {
      const w = box.clientWidth || 200, h = box.clientHeight || 240;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(box);

    // pastel studio environment (sky blue top, lavender / peach sides, soft white panels): gives the glossy parts real reflections
    const envScene = new THREE.Scene();
    const envGeo = new THREE.SphereGeometry(20, 32, 16);
    const envCols = [], envPos = envGeo.attributes.position;
    const cTop = new THREE.Color(0xcfe8ff), cMid = new THREE.Color(0xe9defe), cLow = new THREE.Color(0xffd9e8);
    for (let i = 0; i < envPos.count; i++) { const y = envPos.getY(i) / 20; const c = y > 0 ? cMid.clone().lerp(cTop, y) : cMid.clone().lerp(cLow, -y); envCols.push(c.r, c.g, c.b); }
    envGeo.setAttribute('color', new THREE.Float32BufferAttribute(envCols, 3));
    envScene.add(new THREE.Mesh(envGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    [[0, 9, 6, 8, 3, 0xffffff, 6], [-12, 3, 4, 3, 7, 0xd8ccff, 3], [12, 1, 4, 3, 7, 0xffe2c8, 3]].forEach(([x, y, z, w, h, col, k]) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(k), side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); envScene.add(m);
    });
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envRT = pmrem.fromScene(envScene, 0.04);
    scene.environment = envRT.texture;
    envGeo.dispose(); pmrem.dispose();

    scene.add(new THREE.AmbientLight(0xffffff, 0.38));
    const dirLight = new THREE.DirectionalLight(0xfff4ec, 0.9); dirLight.position.set(4, 7, 6); scene.add(dirLight);
    const lavender = new THREE.DirectionalLight(0xa78bfa, 0.9); lavender.position.set(-5, 3, 2); scene.add(lavender);
    const mint = new THREE.DirectionalLight(0x7fe6ff, 0.55); mint.position.set(5, -2, 3); scene.add(mint);
    const back = new THREE.DirectionalLight(0xffc1e3, 0.8); back.position.set(0, 4, -6); scene.add(back);

    const robotGroup = new THREE.Group();
    robotGroup.position.y = -0.15;
    scene.add(robotGroup);

    // soft floor shadow
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = 128; shadowCanvas.height = 128;
    const sctx = shadowCanvas.getContext('2d')!;
    const grad = sctx.createRadialGradient(64, 64, 8, 64, 64, 60);
    grad.addColorStop(0, 'rgba(124, 58, 237, 0.22)'); grad.addColorStop(0.6, 'rgba(139, 127, 245, 0.08)'); grad.addColorStop(1, 'rgba(139, 127, 245, 0)');
    sctx.fillStyle = grad; sctx.fillRect(0, 0, 128, 128);
    const floorShadow = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 1.1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false }));
    floorShadow.rotation.x = -Math.PI / 2; floorShadow.position.set(0, -1.75, 0);
    scene.add(floorShadow);

    let headGroup, leftArm, rightArm, leftEarPivot, rightEarPivot, tailPivot, leftEye, rightEye, leftBrow, rightBrow, mouthLeftArc, mouthRightArc, mouthOpen, leftBlush, antennaMat, earInnerMat, eyeMat, mouthMat;

    // ----- model -----
    // soft plush-porcelain: a little sheen at the edges, glossy coat, gentle reflections from the pastel environment
    const whiteMat = new THREE.MeshPhysicalMaterial({ color: 0xf6f2ff, roughness: 0.38, metalness: 0.0, clearcoat: 0.7, clearcoatRoughness: 0.25, sheen: new THREE.Color(0xd9ccff), envMapIntensity: 0.55 });
    const lavenderMat = new THREE.MeshPhysicalMaterial({ color: 0x9a8cff, roughness: 0.18, metalness: 0.15, clearcoat: 0.9, clearcoatRoughness: 0.1 });
    const bellGoldMat = new THREE.MeshPhysicalMaterial({ color: 0xfcd34d, emissive: 0xf59e0b, emissiveIntensity: 0.15, roughness: 0.2, metalness: 0.45, clearcoat: 0.7 });
    earInnerMat = new THREE.MeshPhysicalMaterial({ color: 0xff9ebb, emissive: 0xff7eb3, emissiveIntensity: 0.15, roughness: 0.28 });
    antennaMat = new THREE.MeshPhysicalMaterial({ color: 0xff7eb3, emissive: 0xff7eb3, emissiveIntensity: 0.28, roughness: 0.2, metalness: 0.05, clearcoat: 0.6 });
    const screenMat = new THREE.MeshPhysicalMaterial({ color: 0x0b0f33, roughness: 0.12, metalness: 0.15, clearcoat: 0.7, clearcoatRoughness: 0.08, envMapIntensity: 0.45 });
    eyeMat = new THREE.MeshBasicMaterial({ color: 0x67e8f9 });
    mouthMat = new THREE.MeshBasicMaterial({ color: 0x67e8f9 });
    const noseMat = new THREE.MeshBasicMaterial({ color: 0xf472b6 });
    const blushMat = new THREE.MeshBasicMaterial({ color: 0xf472b6, transparent: true, opacity: 0.6 });

    headGroup = new THREE.Group();
    headGroup.position.y = 0.72;
    const smoothHeadGeo = new THREE.SphereGeometry(0.95, 36, 36); smoothHeadGeo.scale(1.18, 0.86, 0.82);
    headGroup.add(new THREE.Mesh(smoothHeadGeo, whiteMat));
    const visorGeo = new THREE.SphereGeometry(0.83, 36, 36); visorGeo.scale(1.14, 0.79, 0.36);
    const visorMesh = new THREE.Mesh(visorGeo, screenMat); visorMesh.position.set(0, 0, 0.57); headGroup.add(visorMesh);
    const highlightGeo = new THREE.SphereGeometry(0.14, 16, 16); highlightGeo.scale(1.8, 0.45, 0.2);
    const visorHighlight = new THREE.Mesh(highlightGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.14 }));
    visorHighlight.position.set(-0.48, 0.38, 0.81); visorHighlight.rotation.z = 0.42; headGroup.add(visorHighlight);

    const eyeGeo = new THREE.TorusGeometry(0.145, 0.048, 16, 32, Math.PI);
    leftEye = new THREE.Mesh(eyeGeo, eyeMat); leftEye.position.set(-0.34, 0.08, 0.86);
    rightEye = new THREE.Mesh(eyeGeo, eyeMat); rightEye.position.set(0.34, 0.08, 0.86);
    headGroup.add(leftEye); headGroup.add(rightEye);

    function createCapsuleMesh(radius, length, material) {
      const group = new THREE.Group();
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 12), material);
      const capGeo = new THREE.SphereGeometry(radius, 12, 12);
      const topCap = new THREE.Mesh(capGeo, material); topCap.position.y = length / 2;
      const botCap = new THREE.Mesh(capGeo, material); botCap.position.y = -length / 2;
      group.add(cyl, topCap, botCap);
      return group;
    }
    leftBrow = createCapsuleMesh(0.025, 0.16, mouthMat); leftBrow.position.set(-0.34, 0.25, 0.85); leftBrow.rotation.z = Math.PI / 2; leftBrow.scale.set(0.01, 0.01, 0.01);
    rightBrow = createCapsuleMesh(0.025, 0.16, mouthMat); rightBrow.position.set(0.34, 0.25, 0.85); rightBrow.rotation.z = Math.PI / 2; rightBrow.scale.set(0.01, 0.01, 0.01);
    headGroup.add(leftBrow); headGroup.add(rightBrow);

    const noseGeo = new THREE.SphereGeometry(0.042, 16, 16); noseGeo.scale(1.3, 0.85, 0.4);
    const catNose = new THREE.Mesh(noseGeo, noseMat); catNose.position.set(0, -0.07, 0.88); headGroup.add(catNose);

    const arcGeo = new THREE.TorusGeometry(0.068, 0.028, 16, 24, Math.PI);
    mouthLeftArc = new THREE.Mesh(arcGeo, mouthMat); mouthLeftArc.position.set(-0.066, -0.14, 0.875); mouthLeftArc.rotation.z = Math.PI;
    mouthRightArc = new THREE.Mesh(arcGeo, mouthMat); mouthRightArc.position.set(0.066, -0.14, 0.875); mouthRightArc.rotation.z = Math.PI;
    headGroup.add(mouthLeftArc); headGroup.add(mouthRightArc);
    const mouthOpenGeo = new THREE.SphereGeometry(0.085, 24, 24); mouthOpenGeo.scale(1.15, 0.95, 0.35);
    mouthOpen = new THREE.Mesh(mouthOpenGeo, mouthMat); mouthOpen.position.set(0, -0.18, 0.865); mouthOpen.scale.set(0.01, 0.01, 0.01); headGroup.add(mouthOpen);

    [{ x: -0.62, y: -0.05, rz: 1.45 }, { x: -0.60, y: -0.14, rz: 1.70 }, { x: 0.62, y: -0.05, rz: -1.45 }, { x: 0.60, y: -0.14, rz: -1.70 }].forEach((w) => {
      const whisker = createCapsuleMesh(0.014, 0.14, mouthMat);
      whisker.position.set(w.x, w.y, 0.78); whisker.rotation.z = w.rz; whisker.rotation.y = w.x < 0 ? -0.35 : 0.35;
      headGroup.add(whisker);
    });

    const blushGeo = new THREE.SphereGeometry(0.11, 20, 20); blushGeo.scale(1.3, 0.75, 0.25);
    leftBlush = new THREE.Mesh(blushGeo, blushMat); leftBlush.position.set(-0.48, -0.11, 0.81);
    const rightBlush = new THREE.Mesh(blushGeo, blushMat); rightBlush.position.set(0.48, -0.11, 0.81);
    headGroup.add(leftBlush, rightBlush);

    function createCatEar(isLeft) {
      const earPivot = new THREE.Group();
      const sign = isLeft ? -1 : 1;
      earPivot.position.set(sign * 0.68, 0.60, 0.02);
      earPivot.rotation.z = sign * -0.32;
      const outerEarGeo = new THREE.SphereGeometry(0.28, 32, 32); outerEarGeo.scale(1.05, 1.25, 0.56);
      const outerEar = new THREE.Mesh(outerEarGeo, whiteMat); outerEar.position.set(0, 0.16, -0.01);
      const outerRimGeo = new THREE.TorusGeometry(0.21, 0.048, 16, 32); outerRimGeo.scale(0.95, 1.18, 0.65);
      const outerRim = new THREE.Mesh(outerRimGeo, whiteMat); outerRim.position.set(0, 0.16, 0.085);
      const foldGeo = new THREE.SphereGeometry(0.065, 16, 16); foldGeo.scale(0.75, 1.4, 0.7);
      const earFold = new THREE.Mesh(foldGeo, whiteMat); earFold.position.set(sign * 0.13, 0.08, 0.11); earFold.rotation.z = sign * 0.25;
      const earRingGeo = new THREE.TorusGeometry(0.25, 0.045, 16, 32); earRingGeo.rotateX(Math.PI / 2); earRingGeo.scale(1.05, 1.0, 0.65);
      const earRing = new THREE.Mesh(earRingGeo, lavenderMat); earRing.position.set(0, 0.02, 0);
      const innerEarGeo = new THREE.SphereGeometry(0.165, 24, 24); innerEarGeo.scale(0.92, 1.14, 0.32);
      const innerEar = new THREE.Mesh(innerEarGeo, earInnerMat); innerEar.position.set(0, 0.155, 0.095);
      earPivot.add(outerEar, outerRim, earFold, earRing, innerEar);
      return earPivot;
    }
    leftEarPivot = createCatEar(true); rightEarPivot = createCatEar(false);
    headGroup.add(leftEarPivot); headGroup.add(rightEarPivot);

    const stemMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.038, 0.18, 16), lavenderMat); stemMesh.position.set(0, 0.84, 0);
    const antennaTip = new THREE.Mesh(new THREE.SphereGeometry(0.085, 20, 20), antennaMat); antennaTip.position.set(0, 0.96, 0);
    headGroup.add(stemMesh); headGroup.add(antennaTip);
    robotGroup.add(headGroup);

    const bodyGeo = new THREE.SphereGeometry(0.74, 36, 36); bodyGeo.scale(0.95, 1.12, 0.82);
    const bodyMesh = new THREE.Mesh(bodyGeo, whiteMat); bodyMesh.position.set(0, -0.65, 0); robotGroup.add(bodyMesh);
    const collarGeo = new THREE.TorusGeometry(0.56, 0.045, 16, 36); collarGeo.rotateX(Math.PI / 2.15); collarGeo.scale(0.96, 1.0, 0.85);
    const collarMesh = new THREE.Mesh(collarGeo, lavenderMat); collarMesh.position.set(0, -0.12, 0.02); robotGroup.add(collarMesh);
    const bellGroup = new THREE.Group(); bellGroup.position.set(0, -0.19, 0.52);
    const bellMesh = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 20), bellGoldMat);
    const bellGroove = new THREE.Mesh(new THREE.TorusGeometry(0.088, 0.015, 8, 20), lavenderMat); bellGroove.position.set(0, -0.02, 0.05);
    bellGroup.add(bellMesh, bellGroove); robotGroup.add(bellGroup);

    tailPivot = new THREE.Group(); tailPivot.position.set(0, -1.02, -0.35);
    const tailCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.22, 0.05, -0.35), new THREE.Vector3(0.55, 0.32, -0.42), new THREE.Vector3(0.75, 0.72, -0.22), new THREE.Vector3(0.62, 1.02, -0.05)]);
    const tailMesh = new THREE.Mesh(new THREE.TubeGeometry(tailCurve, 32, 0.095, 16, false), whiteMat);
    const tailTipMesh = new THREE.Mesh(new THREE.SphereGeometry(0.115, 20, 20), lavenderMat); tailTipMesh.position.set(0.62, 1.02, -0.05);
    tailPivot.add(tailMesh); tailPivot.add(tailTipMesh); robotGroup.add(tailPivot);

    function addPawPads(armMesh) {
      const padGroup = new THREE.Group(); padGroup.position.set(0, -0.24, 0.16);
      const mainPadGeo = new THREE.SphereGeometry(0.075, 16, 16); mainPadGeo.scale(1.2, 0.9, 0.35);
      padGroup.add(new THREE.Mesh(mainPadGeo, earInnerMat));
      [{ x: -0.065, y: 0.085 }, { x: 0, y: 0.11 }, { x: 0.065, y: 0.085 }].forEach((t) => {
        const toeGeo = new THREE.SphereGeometry(0.032, 12, 12); toeGeo.scale(1, 1.15, 0.4);
        const toe = new THREE.Mesh(toeGeo, earInnerMat); toe.position.set(t.x, t.y, 0.01); padGroup.add(toe);
      });
      armMesh.add(padGroup);
    }
    const armGeo = new THREE.SphereGeometry(0.23, 24, 24); armGeo.scale(0.85, 1.75, 0.85);
    const leftArmPivot = new THREE.Group(); leftArmPivot.position.set(0.84, -0.35, 0);
    const leftArmMesh = new THREE.Mesh(armGeo, whiteMat); leftArmMesh.position.set(0.12, -0.25, 0); leftArmMesh.rotation.z = -0.22;
    addPawPads(leftArmMesh); leftArmPivot.add(leftArmMesh); robotGroup.add(leftArmPivot); leftArm = leftArmPivot;
    const rightArmPivot = new THREE.Group(); rightArmPivot.position.set(-0.84, -0.35, 0);
    const rightArmMesh = new THREE.Mesh(armGeo, whiteMat); rightArmMesh.position.set(-0.18, -0.15, 0.08); rightArmMesh.rotation.z = 0.25;
    addPawPads(rightArmMesh); rightArmPivot.add(rightArmMesh); robotGroup.add(rightArmPivot); rightArm = rightArmPivot;

    // soft glow behind the face in the face colour (fake bloom)
    const mk = (draw: (c: CanvasRenderingContext2D, n: number) => void, n = 64) => { const cv = document.createElement('canvas'); cv.width = cv.height = n; draw(cv.getContext('2d')!, n); const t = new THREE.CanvasTexture(cv); return t; };
    const glowTex = mk((c, n) => { const g = c.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2); g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(.35, 'rgba(255,255,255,.28)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, n, n); }, 128);
    const glowMat = new THREE.SpriteMaterial({ map: glowTex, color: 0x67e8f9, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending });
    const glow = new THREE.Sprite(glowMat); glow.scale.set(3.6, 2.5, 1); glow.position.set(0, 0.0, -0.7); headGroup.add(glow);

    // floating symbols: hearts, sparkles, Zz, ?, !, anger marks …
    const symTex = {
      heart: mk((c, n) => { c.fillStyle = '#ff6fa8'; c.beginPath(); c.moveTo(n / 2, n * .85); c.bezierCurveTo(n * .05, n * .52, n * .12, n * .12, n / 2, n * .34); c.bezierCurveTo(n * .88, n * .12, n * .95, n * .52, n / 2, n * .85); c.fill(); }),
      spark: mk((c, n) => { c.fillStyle = '#ffd34d'; c.beginPath(); for (let i = 0; i < 8; i++) { const r = i % 2 ? n * .14 : n * .46, a = (i * Math.PI) / 4 - Math.PI / 2; c.lineTo(n / 2 + Math.cos(a) * r, n / 2 + Math.sin(a) * r); } c.closePath(); c.fill(); }),
      z: mk((c, n) => { c.fillStyle = '#7c6cf0'; c.font = `bold ${n * .8}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('Z', n / 2, n / 2 + 3); }),
      q: mk((c, n) => { c.fillStyle = '#f59e0b'; c.font = `bold ${n * .85}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('?', n / 2, n / 2 + 3); }),
      ex: mk((c, n) => { c.fillStyle = '#ef4444'; c.font = `bold ${n * .85}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('!', n / 2, n / 2 + 3); }),
      anger: mk((c, n) => { c.strokeStyle = '#ef4444'; c.lineWidth = n * .1; c.lineCap = 'round'; [[.2, .5, .5, .2], [.8, .5, .5, .2], [.2, .5, .5, .8], [.8, .5, .5, .8]].forEach(([x1, y1, x2, y2]) => { c.beginPath(); c.moveTo(n * x1, n * y1); c.quadraticCurveTo(n * .5, n * .5, n * x2, n * y2); c.stroke(); }); }),
      drop: mk((c, n) => { c.fillStyle = '#7dd3fc'; c.beginPath(); c.moveTo(n / 2, n * .1); c.bezierCurveTo(n * .9, n * .55, n * .75, n * .9, n / 2, n * .9); c.bezierCurveTo(n * .25, n * .9, n * .1, n * .55, n / 2, n * .1); c.fill(); }),
    };
    type Sym = { sprite: THREE.Sprite; vy: number; vx: number; life: number; max: number; size: number };
    const syms: Sym[] = [];
    let nextSym = 0;
    const emitSymbol = (kind: keyof typeof symTex, x: number, y: number, size = 0.34, vy = 0.55, max = 2.2) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: symTex[kind], transparent: true, depthWrite: false, opacity: 0 }));
      sp.scale.set(size, size, 1); sp.position.set(x, y, 0.9); robotGroup.add(sp);
      syms.push({ sprite: sp, vy, vx: (Math.random() - 0.5) * 0.25, life: 0, max, size });
    };
    const SYM_FOR: Record<string, [keyof typeof symTex, number]> = { love: ['heart', 0.55], excited: ['spark', 0.28], sleeping: ['z', 0.9], sleepy: ['z', 1.4], thinking: ['q', 1.2], surprised: ['ex', 0.9], furious: ['anger', 0.5], angry: ['anger', 0.9], sad: ['drop', 0.9], playful: ['spark', 0.7] };

    // blinking
    let blinkT = 0, nextBlink = 2 + Math.random() * 3;

    // ----- the cat looks toward the mouse -----
    let targetRotY = 0, targetRotX = 0;
    const onMove = (e: PointerEvent) => {
      targetRotY = ((e.clientX / window.innerWidth) * 2 - 1) * 0.35;
      targetRotX = ((e.clientY / window.innerHeight) * 2 - 1) * 0.2;
    };
    window.addEventListener('pointermove', onMove);

    // ----- animation (12 emotions) -----
    const clock = new THREE.Clock();
    const targetColor = new THREE.Color(), targetAntennaColor = new THREE.Color();
    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      if (document.hidden) return;
      const elapsed = clock.getElapsedTime();
      const lerpSpeed = 0.12;
      let floatSpeed = 2.2, floatAmp = 0.12, shakeX = 0, bodyRollZ = 0, bodyPitchX = 0, headTiltZ = 0, headTiltX = 0, headTiltY = 0;
      let leftEarZ = 0.32 + Math.sin(elapsed * 3) * 0.04, rightEarZ = -0.32 - Math.sin(elapsed * 3) * 0.04, leftEarX = 0, rightEarX = 0, tailSpeed = 3.5, tailAmp = 0.28;
      let eyeScaleX = 1, eyeScaleY = 1, eyeRotZ = 0, eyePosY = 0.08, browScale = 0.01, browAngle = 0, browPosY = 0.25;
      let mouthArcScaleX = 1, mouthArcScaleY = 1, mouthArcRotZ = Math.PI, mouthArcPosY = -0.14, mouthOpenScaleX = 0.01, mouthOpenScaleY = 0.01, blushOpacity = 0.6;
      let rightArmZ = -0.85 + Math.sin(elapsed * 5) * 0.28, rightArmX = -0.2, leftArmZ = Math.sin(elapsed * 2) * 0.08, leftArmX = 0;
      let faceHex = 0x67e8f9, antennaHex = 0xff7eb3;
      const emotion = emotionRef.current;

      switch (emotion) {
        case 'happy':
          eyeScaleX = 1.05; mouthArcScaleX = 1.05; mouthArcScaleY = 0.95;
          rightArmZ = -0.95 + Math.sin(elapsed * 5.5) * 0.3; headTiltZ = Math.sin(elapsed * 2) * 0.06; break;
        case 'talking': {
          eyeScaleY = 0.92; mouthArcScaleX = 0.01; mouthArcScaleY = 0.01;
          const talkWave = Math.abs(Math.sin(elapsed * 12));
          mouthOpenScaleX = 0.9 + talkWave * 0.45; mouthOpenScaleY = 0.35 + talkWave * 1.1;
          rightArmZ = -0.45 + Math.sin(elapsed * 6) * 0.22; rightArmX = -0.35; leftArmZ = 0.35 - Math.cos(elapsed * 5) * 0.15;
          headTiltZ = Math.sin(elapsed * 3) * 0.05; leftEarZ = 0.35 + Math.sin(elapsed * 8) * 0.08; faceHex = 0x7dd3fc; antennaHex = 0x8b7ff5; break;
        }
        case 'thinking':
          floatSpeed = 1.4; floatAmp = 0.08; headTiltZ = 0.18; headTiltX = -0.14; headTiltY = 0.15;
          eyeScaleX = 0.95; eyeScaleY = 0.85; eyePosY = 0.14; mouthArcScaleX = 0.65; mouthArcScaleY = 0.55; mouthArcPosY = -0.16;
          rightArmZ = -1.15; rightArmX = -0.65; leftArmZ = 0.1; leftEarZ = 0.25 + Math.sin(elapsed * 6) * 0.12;
          tailSpeed = 1.5; tailAmp = 0.15; blushOpacity = 0.3; faceHex = 0xc4b5fd; antennaHex = 0xfbbf24; break;
        case 'excited':
          floatSpeed = 7.0; floatAmp = 0.22; eyeScaleX = 1.25; eyeScaleY = 1.25; mouthArcScaleX = 0.01; mouthOpenScaleX = 1.35; mouthOpenScaleY = 1.25;
          rightArmZ = -1.35 + Math.sin(elapsed * 10) * 0.2; leftArmZ = 1.35 - Math.sin(elapsed * 10) * 0.2; tailSpeed = 12.0; tailAmp = 0.55;
          blushOpacity = 0.9; faceHex = 0x6ee7b7; antennaHex = 0xff7eb3; break;
        case 'love':
          floatSpeed = 2.0; floatAmp = 0.1; headTiltZ = -0.16; eyeScaleX = 1.15; eyeScaleY = 1.15; mouthArcScaleX = 1.1; mouthArcScaleY = 1.1;
          rightArmZ = -1.1; rightArmX = -0.55; leftArmZ = 1.1; leftArmX = -0.55; leftEarZ = 0.45; rightEarZ = -0.45; tailSpeed = 2.5; tailAmp = 0.35;
          blushOpacity = 1.0; faceHex = 0xf472b6; antennaHex = 0xf43f5e; break;
        case 'playful':
          floatSpeed = 3.2; floatAmp = 0.14; headTiltZ = 0.14; headTiltY = -0.12; mouthArcScaleX = 0.95; mouthArcScaleY = 0.85; mouthOpenScaleX = 0.65; mouthOpenScaleY = 0.85;
          rightArmZ = -1.2 + Math.sin(elapsed * 7) * 0.25; leftArmZ = -0.25; tailSpeed = 7.0; tailAmp = 0.45; faceHex = 0x38bdf8; antennaHex = 0xa855f7; break;
        case 'surprised':
          floatSpeed = 1.8; floatAmp = 0.09; headTiltX = -0.15; eyeScaleX = 1.2; eyeScaleY = 1.5; mouthArcScaleX = 0.01; mouthOpenScaleX = 0.85; mouthOpenScaleY = 1.25;
          rightArmZ = -0.65; leftArmZ = 0.65; leftEarZ = 0.12; rightEarZ = -0.12; tailSpeed = 0.5; tailAmp = 0.05; blushOpacity = 0.4; faceHex = 0xfde047; antennaHex = 0xf97316; break;
        case 'sleepy': {
          floatSpeed = 0.9; floatAmp = 0.06; headTiltX = 0.18 + Math.sin(elapsed * 1.5) * 0.08; headTiltZ = Math.sin(elapsed * 1.1) * 0.1;
          eyeScaleX = 1.05; eyeScaleY = 0.22; eyePosY = 0.04;
          const yawn = Math.max(0, Math.sin(elapsed * 1.4));
          mouthArcScaleX = yawn > 0.4 ? 0.01 : 0.7; mouthOpenScaleX = yawn > 0.4 ? 0.85 : 0.01; mouthOpenScaleY = yawn > 0.4 ? 1.1 : 0.01;
          rightArmZ = 0.15; leftArmZ = -0.15; leftEarZ = 0.58; rightEarZ = -0.58; tailSpeed = 0.8; tailAmp = 0.1; blushOpacity = 0.35; faceHex = 0xa5b4fc; antennaHex = 0x818cf8; break;
        }
        case 'sleeping': {
          floatSpeed = 1.1; floatAmp = 0.07; bodyRollZ = 0.68; bodyPitchX = 0.12; headTiltZ = 0.22 + Math.sin(elapsed * 1.6) * 0.03; headTiltX = 0.14;
          eyeScaleX = 1.05; eyeScaleY = 0.14; eyePosY = 0.03;
          const breath = Math.sin(elapsed * 1.6);
          mouthArcScaleX = 0.65 + breath * 0.08; mouthArcScaleY = 0.55 + breath * 0.08; mouthArcPosY = -0.15;
          rightArmZ = -0.35; rightArmX = -0.35; leftArmZ = 0.55; leftArmX = -0.25; leftEarZ = 0.45 + breath * 0.03; rightEarZ = -0.45 - breath * 0.03;
          tailSpeed = 0.9; tailAmp = 0.14; blushOpacity = 0.55; faceHex = 0xc4b5fd; antennaHex = 0xa78bfa; break;
        }
        case 'sad':
          floatSpeed = 1.1; floatAmp = 0.05; headTiltX = 0.22; headTiltZ = -0.06; eyeScaleX = 0.95; eyeScaleY = 0.7; eyeRotZ = -0.25; eyePosY = 0.02;
          browScale = 0.85; browAngle = 0.32; browPosY = 0.22; mouthArcScaleX = 0.95; mouthArcScaleY = 0.85; mouthArcRotZ = 0; mouthArcPosY = -0.2;
          rightArmZ = 0.2; leftArmZ = -0.2; leftEarZ = 0.72; rightEarZ = -0.72; tailSpeed = 0.6; tailAmp = 0.06; blushOpacity = 0.15; faceHex = 0x93c5fd; antennaHex = 0x94a3b8; break;
        case 'angry':
          floatSpeed = 3.0; floatAmp = 0.08; headTiltX = 0.12; eyeScaleX = 1.05; eyeScaleY = 0.85; eyeRotZ = 0.28; browScale = 1.1; browAngle = -0.42; browPosY = 0.22;
          mouthArcScaleX = 1.05; mouthArcScaleY = 0.9; mouthArcRotZ = 0; mouthArcPosY = -0.19; rightArmZ = -0.35; rightArmX = -0.3; leftArmZ = 0.35; leftArmX = -0.3;
          leftEarZ = 0.65; rightEarZ = -0.65; leftEarX = -0.35; rightEarX = -0.35; tailSpeed = 8.0; tailAmp = 0.45; blushOpacity = 0.2; faceHex = 0xfb923c; antennaHex = 0xf97316; break;
        case 'furious':
          floatSpeed = 14.0; floatAmp = 0.14; shakeX = Math.sin(elapsed * 45) * 0.045; headTiltX = 0.15; eyeScaleX = 1.15; eyeScaleY = 0.9; eyeRotZ = 0.38;
          browScale = 1.25; browAngle = -0.55; browPosY = 0.21; mouthArcScaleX = 0.01; mouthOpenScaleX = 1.45; mouthOpenScaleY = 1.15 + Math.sin(elapsed * 25) * 0.2;
          rightArmZ = -1.25 + Math.sin(elapsed * 22) * 0.25; leftArmZ = 1.25 - Math.sin(elapsed * 22) * 0.25; leftEarZ = 0.82; rightEarZ = -0.82; leftEarX = -0.45; rightEarX = -0.45;
          tailSpeed = 16.0; tailAmp = 0.65; blushOpacity = 0.95; faceHex = 0xef4444; antennaHex = 0xdc2626; break;
      }

      // blink (eyes shut for ~0.14 s every few seconds, not while sleepy / sleeping)
      const dt = Math.min(0.05, clock.getDelta ? 0.016 : 0.016);
      let blink = 1;
      if (elapsed > nextBlink) { blinkT = elapsed; nextBlink = elapsed + 2.5 + Math.random() * 3.5; }
      const bp = elapsed - blinkT; if (bp < 0.16 && emotion !== 'sleepy' && emotion !== 'sleeping') blink = 1 - Math.sin((bp / 0.16) * Math.PI) * 0.92;
      eyeScaleY *= blink;
      // symbols
      const sym = SYM_FOR[emotion];
      if (sym && elapsed > nextSym) { nextSym = elapsed + sym[1]; const side = Math.random() < 0.5 ? -1 : 1; emitSymbol(sym[0], emotion === 'sleeping' || emotion === 'sleepy' ? 0.85 + Math.random() * 0.2 : side * (0.55 + Math.random() * 0.5), 1.05 + Math.random() * 0.2, sym[0] === 'z' ? 0.3 : 0.34, 0.5 + Math.random() * 0.3, 2.2); }
      for (let i = syms.length - 1; i >= 0; i--) {
        const y = syms[i]; y.life += 0.016; const k = y.life / y.max;
        y.sprite.position.y += y.vy * 0.016; y.sprite.position.x += y.vx * 0.016;
        const sc = y.size * (0.6 + Math.min(1, k * 4) * 0.5); y.sprite.scale.set(sc, sc, 1);
        y.sprite.material.opacity = Math.min(1, k * 6) * (1 - Math.max(0, (k - 0.6) / 0.4));
        if (k >= 1) { robotGroup.remove(y.sprite); y.sprite.material.dispose(); syms.splice(i, 1); }
      }
      // breathing + glow
      const breathe = 1 + Math.sin(elapsed * 1.9) * 0.012; bodyMesh.scale.set(1, breathe, 1);
      glowMat.opacity += ((emotion === 'sleeping' ? 0.12 : emotion === 'furious' || emotion === 'excited' ? 0.5 : 0.32) - glowMat.opacity) * 0.1;

      const floatY = Math.sin(elapsed * floatSpeed) * floatAmp;
      robotGroup.position.y = -0.15 + floatY; robotGroup.position.x = shakeX;
      const shadowScale = 1.0 - floatY * 0.8; floorShadow.scale.set(shadowScale, shadowScale, 1); floorShadow.position.x = shakeX;
      robotGroup.rotation.y += (targetRotY - robotGroup.rotation.y) * 0.08;
      robotGroup.rotation.x += ((targetRotX + bodyPitchX) - robotGroup.rotation.x) * 0.08;
      robotGroup.rotation.z += (bodyRollZ - robotGroup.rotation.z) * 0.08;

      headGroup.rotation.z += (headTiltZ - headGroup.rotation.z) * lerpSpeed;
      headGroup.rotation.x += (headTiltX - headGroup.rotation.x) * lerpSpeed;
      headGroup.rotation.y += (headTiltY - headGroup.rotation.y) * lerpSpeed;
      leftEarPivot.rotation.z += (leftEarZ - leftEarPivot.rotation.z) * lerpSpeed; rightEarPivot.rotation.z += (rightEarZ - rightEarPivot.rotation.z) * lerpSpeed;
      leftEarPivot.rotation.x += (leftEarX - leftEarPivot.rotation.x) * lerpSpeed; rightEarPivot.rotation.x += (rightEarX - rightEarPivot.rotation.x) * lerpSpeed;
      tailPivot.rotation.y = Math.sin(elapsed * tailSpeed) * tailAmp; tailPivot.rotation.z = Math.cos(elapsed * tailSpeed * 0.5) * (tailAmp * 0.4);

      const rightEyeTargetY = emotion === 'playful' ? 0.2 : eyeScaleY;
      leftEye.scale.x += (eyeScaleX - leftEye.scale.x) * lerpSpeed; leftEye.scale.y += (eyeScaleY - leftEye.scale.y) * lerpSpeed;
      leftEye.rotation.z += ((eyeRotZ + 0.05) - leftEye.rotation.z) * lerpSpeed; leftEye.position.y += (eyePosY - leftEye.position.y) * lerpSpeed;
      rightEye.scale.x += (eyeScaleX - rightEye.scale.x) * lerpSpeed; rightEye.scale.y += (rightEyeTargetY - rightEye.scale.y) * lerpSpeed;
      rightEye.rotation.z += ((-eyeRotZ - 0.05) - rightEye.rotation.z) * lerpSpeed; rightEye.position.y += (eyePosY - rightEye.position.y) * lerpSpeed;

      leftBrow.scale.setScalar(leftBrow.scale.x + (browScale - leftBrow.scale.x) * lerpSpeed); rightBrow.scale.setScalar(rightBrow.scale.x + (browScale - rightBrow.scale.x) * lerpSpeed);
      leftBrow.rotation.z += ((Math.PI / 2 + browAngle) - leftBrow.rotation.z) * lerpSpeed; rightBrow.rotation.z += ((Math.PI / 2 - browAngle) - rightBrow.rotation.z) * lerpSpeed;
      leftBrow.position.y += (browPosY - leftBrow.position.y) * lerpSpeed; rightBrow.position.y += (browPosY - rightBrow.position.y) * lerpSpeed;

      [mouthLeftArc, mouthRightArc].forEach((arc) => {
        arc.scale.x += (mouthArcScaleX - arc.scale.x) * 0.18; arc.scale.y += (mouthArcScaleY - arc.scale.y) * 0.18;
        arc.rotation.z += (mouthArcRotZ - arc.rotation.z) * 0.18; arc.position.y += (mouthArcPosY - arc.position.y) * 0.18;
      });
      mouthOpen.scale.x += (mouthOpenScaleX - mouthOpen.scale.x) * 0.25; mouthOpen.scale.y += (mouthOpenScaleY - mouthOpen.scale.y) * 0.25;
      mouthOpen.scale.z += ((mouthOpenScaleX > 0.1 ? 1 : 0.01) - mouthOpen.scale.z) * 0.25;
      leftBlush.material.opacity += (blushOpacity - leftBlush.material.opacity) * lerpSpeed;

      rightArm.rotation.z += (rightArmZ - rightArm.rotation.z) * lerpSpeed; rightArm.rotation.x += (rightArmX - rightArm.rotation.x) * lerpSpeed;
      leftArm.rotation.z += (leftArmZ - leftArm.rotation.z) * lerpSpeed; leftArm.rotation.x += (leftArmX - leftArm.rotation.x) * lerpSpeed;

      targetColor.setHex(faceHex); glowMat.color.lerp(targetColor, lerpSpeed); eyeMat.color.lerp(targetColor, lerpSpeed); mouthMat.color.lerp(targetColor, lerpSpeed);
      targetAntennaColor.setHex(antennaHex); antennaMat.color.lerp(targetAntennaColor, lerpSpeed); antennaMat.emissive.lerp(targetAntennaColor, lerpSpeed);
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('pointermove', onMove);
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose()); });
      Object.values(symTex).forEach((t) => t.dispose()); glowTex.dispose(); envRT.dispose();
      renderer.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} className="block h-full w-full" />;
}
