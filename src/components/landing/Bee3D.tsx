import { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * 🐝 WABEES — Subtle floating 3D bee, ported from the legacy /download page.
 * Pure geometry (no external model). Disabled when prefers-reduced-motion.
 */
export function Bee3D({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const w = () => container.clientWidth;
    const h = () => container.clientHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, w() / h(), 0.1, 100);
    camera.position.set(0, 0, 9);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w(), h());
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    container.appendChild(renderer.domElement);

    // Lights
    scene.add(new THREE.AmbientLight(0x334466, 0.55));
    const key = new THREE.DirectionalLight(0xffeedd, 1.1);
    key.position.set(3, 5, 4);
    scene.add(key);
    const rim = new THREE.PointLight(0x25d366, 0.9, 20);
    rim.position.set(-3, 2, -2);
    scene.add(rim);
    const warm = new THREE.PointLight(0xffaa00, 0.5, 15);
    warm.position.set(2, -1, 3);
    scene.add(warm);

    // Materials
    const yellow = new THREE.MeshStandardMaterial({ color: 0xdaa520, emissive: 0x6b4c00, emissiveIntensity: 0.12, roughness: 0.6, metalness: 0.15 });
    const black = new THREE.MeshStandardMaterial({ color: 0x2c1810, roughness: 0.7 });
    const brown = new THREE.MeshStandardMaterial({ color: 0x8b4513, emissive: 0x3d1f00, emissiveIntensity: 0.08, roughness: 0.6 });
    const wingMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: 0.9, opacity: 0.35, transparent: true, roughness: 0.05, thickness: 0.2 });

    const bee = new THREE.Group();

    // Abdomen
    const abd = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18), yellow);
    abd.scale.set(0.5, 0.32, 0.55);
    abd.position.z = -0.35;
    bee.add(abd);
    // Stripes
    [-0.15, 0, 0.15].forEach((z) => {
      const s = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.035, 8, 32), black);
      s.scale.set(0.95, 0.75, 0.35);
      s.position.set(0, 0, z - 0.35);
      s.rotation.y = Math.PI / 2;
      bee.add(s);
    });
    // Thorax
    const thorax = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 16), brown);
    thorax.scale.set(0.35, 0.32, 0.32);
    thorax.position.set(0, 0.02, 0.25);
    bee.add(thorax);
    // Head
    const head = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 16), brown);
    head.scale.set(0.22, 0.2, 0.22);
    head.position.set(0, 0.04, 0.52);
    bee.add(head);
    // Eyes
    [-1, 1].forEach((x) => {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 10), black);
      e.position.set(0.1 * x, 0.06, 0.6);
      bee.add(e);
    });

    // Wings
    const wingGeo = new THREE.SphereGeometry(1, 16, 12);
    wingGeo.scale(0.45, 0.04, 0.25);
    const wL = new THREE.Mesh(wingGeo, wingMat);
    wL.position.set(-0.35, 0.22, 0.18);
    wL.rotation.z = 0.3;
    const wR = new THREE.Mesh(wingGeo, wingMat);
    wR.position.set(0.35, 0.22, 0.18);
    wR.rotation.z = -0.3;
    bee.add(wL, wR);

    bee.scale.setScalar(2.2);
    scene.add(bee);

    let frame = 0;
    let raf = 0;
    const animate = () => {
      frame += 0.016;
      bee.position.y = Math.sin(frame * 1.5) * 0.4;
      bee.position.x = Math.sin(frame * 0.7) * 0.6;
      bee.rotation.y = Math.sin(frame * 0.4) * 0.5;
      const flap = Math.sin(frame * 35) * 0.6;
      wL.rotation.z = 0.3 + flap;
      wR.rotation.z = -0.3 - flap;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    animate();

    const onResize = () => {
      camera.aspect = w() / h();
      camera.updateProjectionMatrix();
      renderer.setSize(w(), h());
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(container);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={ref} className={className} aria-hidden="true" />;
}