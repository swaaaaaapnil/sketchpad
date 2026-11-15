import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import rough from 'roughjs';

// Floating "paper cards" with hand-drawn doodles, drifting in 3D. Pure decoration.
const DOODLES = [
  (rc, w, h, c) => rc.rectangle(40, 50, w - 80, h - 100, { stroke: c, roughness: 1.6, strokeWidth: 3 }),
  (rc, w, h, c) => rc.ellipse(w / 2, h / 2, w - 70, h - 90, { stroke: c, roughness: 1.4, strokeWidth: 3, fill: c, fillStyle: 'hachure', hachureGap: 14 }),
  (rc, w, h, c) => {
    rc.line(40, h / 2, w - 60, h / 2, { stroke: c, strokeWidth: 3, roughness: 1.4 });
    rc.line(w - 60, h / 2, w - 95, h / 2 - 28, { stroke: c, strokeWidth: 3 });
    rc.line(w - 60, h / 2, w - 95, h / 2 + 28, { stroke: c, strokeWidth: 3 });
  },
  (rc, w, h, c) => rc.polygon([[w / 2, 40], [w - 40, h / 2], [w / 2, h - 40], [40, h / 2]], { stroke: c, strokeWidth: 3, roughness: 1.5 }),
  (rc, w, h, c) => {
    rc.rectangle(40, 40, 80, 60, { stroke: c, strokeWidth: 2.5 });
    rc.rectangle(w - 120, h - 100, 80, 60, { stroke: c, strokeWidth: 2.5 });
    rc.curve([[120, 70], [w / 2, 60], [w / 2, h - 70], [w - 120, h - 70]], { stroke: c, strokeWidth: 2.5 });
  },
];

function makeTexture(i, dark) {
  const w = 320;
  const h = 240;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = dark ? '#221d18' : '#fffdf8';
  ctx.fillRect(0, 0, w, h);
  // faint dot grid
  ctx.fillStyle = dark ? 'rgba(255,240,220,0.07)' : 'rgba(60,40,20,0.08)';
  for (let x = 16; x < w; x += 20) for (let y = 16; y < h; y += 20) ctx.fillRect(x, y, 2, 2);
  const rc = rough.canvas(cv);
  const colors = dark ? ['#fb923c', '#f5f0e8', '#93c5fd', '#86efac'] : ['#c2410c', '#1c1917', '#1d4ed8', '#15803d'];
  DOODLES[i % DOODLES.length](rc, w, h, colors[i % colors.length]);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export default function Hero3D({ dark }) {
  const mountRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      return; // no WebGL: the hero just stays flat
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    camera.position.set(0, 0, 14);

    scene.add(new THREE.AmbientLight(0xffffff, dark ? 1.6 : 2.2));
    const key = new THREE.DirectionalLight(0xffffff, dark ? 1.2 : 1.4);
    key.position.set(4, 6, 8);
    scene.add(key);

    const geo = new THREE.PlaneGeometry(3.2, 2.4, 8, 6);
    // a slight curl, like paper
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      pos.setZ(i, Math.sin((x / 3.2) * Math.PI) * 0.12);
    }
    geo.computeVertexNormals();

    const cards = [];
    const textures = [];
    const COUNT = 9;
    for (let i = 0; i < COUNT; i++) {
      const tex = makeTexture(i, dark);
      textures.push(tex);
      const mat = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.9, metalness: 0 });
      const m = new THREE.Mesh(geo, mat);
      const angle = (i / COUNT) * Math.PI * 2;
      const radius = 4.4 + (i % 3) * 1.1;
      m.userData = {
        base: new THREE.Vector3(Math.cos(angle) * radius * 1.35, Math.sin(angle) * radius * 0.62, -2 - (i % 4) * 1.4),
        phase: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 0.4,
        tilt: new THREE.Euler((Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.5),
      };
      m.position.copy(m.userData.base);
      m.rotation.copy(m.userData.tilt);
      m.scale.setScalar(0.001);
      scene.add(m);
      cards.push(m);
    }

    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    const onMove = (e) => {
      pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener('pointermove', onMove);

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = mount;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // pull back on narrow screens so cards stay in frame
      camera.position.z = w / h < 1 ? 20 : 14;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(mount);
    resize();

    const clock = new THREE.Clock();
    let raf = 0;
    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(mount);

    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!visible) return;
      const t = clock.getElapsedTime();
      pointer.x += (pointer.tx - pointer.x) * 0.05;
      pointer.y += (pointer.ty - pointer.y) * 0.05;
      cards.forEach((m, i) => {
        const u = m.userData;
        const intro = Math.min(1, Math.max(0, (t - i * 0.08) / 0.9));
        const ease = 1 - Math.pow(1 - intro, 3);
        m.scale.setScalar(Math.max(0.001, ease));
        if (reduce) return;
        m.position.x = u.base.x + Math.sin(t * 0.4 + u.phase) * 0.25;
        m.position.y = u.base.y + Math.cos(t * 0.5 + u.phase) * 0.3 + (1 - ease) * -2;
        m.rotation.x = u.tilt.x + Math.sin(t * 0.3 + u.phase) * 0.08;
        m.rotation.y = u.tilt.y + t * u.spin * 0.15;
      });
      camera.position.x = pointer.x * 0.8;
      camera.position.y = -pointer.y * 0.5;
      camera.lookAt(0, 0, -2);
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener('pointermove', onMove);
      cards.forEach((m) => m.material.dispose());
      textures.forEach((t) => t.dispose());
      geo.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [dark]);

  return <div className="hero-3d" ref={mountRef} aria-hidden="true" />;
}
