/* ── JARVIS — 3D-Weltkugel für Nachrichten (Three.js) ──────────────────────
   Wird bei Nachrichten-Meldungen anstelle des Orbs angezeigt und fliegt zur
   jeweils passenden Stelle auf der Erde. */

window.JarvisGlobe = (function () {
  let renderer, scene, camera, globeMesh, marker, markerRing;
  let ready = false;
  let visible = false;
  let camPos = { x: 0, y: 0, z: 4.2 };
  let camTarget = { x: 0, y: 0, z: 4.2 };
  let lookTarget = new_vec3();
  let lookCurrent = new_vec3();
  let cycleTimer = null;
  let idleRotate = true;
  let manualMode = false;
  let orbitYaw = 0, orbitPitch = 0.15, orbitDist = 4.2;

  function new_vec3() { return { x: 0, y: 0, z: 0 }; }

  const RADIUS = 1.5;

  function latLonToVec3(lat, lon, r) {
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lon + 180) * (Math.PI / 180);
    return {
      x: -r * Math.sin(phi) * Math.cos(theta),
      y: r * Math.cos(phi),
      z: r * Math.sin(phi) * Math.sin(theta),
    };
  }

  function init() {
    const canvas = document.getElementById("globe-canvas");
    if (!canvas || typeof THREE === "undefined") return;

    const width = canvas.clientWidth || 400;
    const height = canvas.clientHeight || 400;

    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
    camera.position.set(0, 0, 4.2);

    scene.add(new THREE.AmbientLight(0x8fefff, 0.55));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(3, 2, 4);
    scene.add(sun);

    const geo = new THREE.SphereGeometry(RADIUS, 48, 48);
    const loader = new THREE.TextureLoader();
    const texture = loader.load("https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg");
    const mat = new THREE.MeshPhongMaterial({ map: texture, shininess: 6 });
    globeMesh = new THREE.Mesh(geo, mat);
    scene.add(globeMesh);

    // Dünner glühender Atmosphären-Ring
    const atmGeo = new THREE.SphereGeometry(RADIUS * 1.04, 48, 48);
    const atmMat = new THREE.MeshBasicMaterial({
      color: 0x46e1ff, transparent: true, opacity: 0.08, side: THREE.BackSide,
    });
    scene.add(new THREE.Mesh(atmGeo, atmMat));

    // Marker (Ziel-Pin) — anfangs unsichtbar
    const markerGeo = new THREE.SphereGeometry(0.035, 16, 16);
    const markerMat = new THREE.MeshBasicMaterial({ color: 0xe8b24c });
    marker = new THREE.Mesh(markerGeo, markerMat);
    marker.visible = false;
    scene.add(marker);

    const ringGeo = new THREE.RingGeometry(0.05, 0.075, 24);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xe8b24c, transparent: true, opacity: 0.8, side: THREE.DoubleSide,
    });
    markerRing = new THREE.Mesh(ringGeo, ringMat);
    markerRing.visible = false;
    scene.add(markerRing);

    window.addEventListener("resize", onResize);
    ready = true;
    animate();
  }

  function onResize() {
    const canvas = document.getElementById("globe-canvas");
    if (!canvas || !renderer) return;
    const width = canvas.clientWidth, height = canvas.clientHeight;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function flyTo(lat, lon, label) {
    idleRotate = false;
    const surface = latLonToVec3(lat, lon, RADIUS);
    const dir = { x: surface.x, y: surface.y, z: surface.z };
    const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const camDist = RADIUS + 0.9;
    camTarget = { x: (dir.x / len) * camDist, y: (dir.y / len) * camDist, z: (dir.z / len) * camDist };
    lookTarget = surface;

    marker.position.set(surface.x * 1.01, surface.y * 1.01, surface.z * 1.01);
    markerRing.position.copy(marker.position);
    markerRing.lookAt(0, 0, 0);
    marker.visible = true;
    markerRing.visible = true;

    const labelEl = document.getElementById("globe-label");
    if (labelEl) labelEl.textContent = label || "";
  }

  let ringPulse = 0;
  function animate() {
    requestAnimationFrame(animate);
    if (!ready) return;

    if (manualMode) {
      orbitPitch = Math.max(-1.3, Math.min(1.3, orbitPitch));
      orbitDist = Math.max(2.1, Math.min(7, orbitDist));
      const x = orbitDist * Math.cos(orbitPitch) * Math.sin(orbitYaw);
      const y = orbitDist * Math.sin(orbitPitch);
      const z = orbitDist * Math.cos(orbitPitch) * Math.cos(orbitYaw);
      camera.position.set(x, y, z);
      camera.lookAt(0, 0, 0);
    } else {
      camPos.x += (camTarget.x - camPos.x) * 0.045;
      camPos.y += (camTarget.y - camPos.y) * 0.045;
      camPos.z += (camTarget.z - camPos.z) * 0.045;
      camera.position.set(camPos.x, camPos.y, camPos.z);

      lookCurrent.x += (lookTarget.x - lookCurrent.x) * 0.06;
      lookCurrent.y += (lookTarget.y - lookCurrent.y) * 0.06;
      lookCurrent.z += (lookTarget.z - lookCurrent.z) * 0.06;
      camera.lookAt(lookCurrent.x, lookCurrent.y, lookCurrent.z);
    }

    if (idleRotate && !manualMode && globeMesh) globeMesh.rotation.y += 0.0018;

    if (markerRing.visible) {
      ringPulse += 0.05;
      const s = 1 + Math.sin(ringPulse) * 0.25;
      markerRing.scale.set(s, s, s);
    }

    if (renderer) renderer.render(scene, camera);
  }

  function resetView() {
    idleRotate = true;
    camTarget = { x: 0, y: 0, z: 4.2 };
    lookTarget = { x: 0, y: 0, z: 0 };
    marker.visible = false;
    markerRing.visible = false;
  }

  function show(items) {
    if (!ready) return;
    const canvas = document.getElementById("globe-canvas");
    const orb = document.getElementById("orb");
    const label = document.getElementById("globe-label");
    if (!canvas) return;

    visible = true;
    canvas.classList.add("visible");
    if (label) label.classList.add("visible");
    if (orb) orb.classList.add("hidden-by-globe");

    if (cycleTimer) clearTimeout(cycleTimer);
    const withLoc = (items || []).filter((i) => typeof i.lat === "number");
    if (withLoc.length === 0) {
      resetView();
      return;
    }
    let i = 0;
    function step() {
      const item = withLoc[i];
      flyTo(item.lat, item.lon, item.ort || item.titel);
      i++;
      if (i < withLoc.length) {
        cycleTimer = setTimeout(step, 4500);
      }
    }
    step();
  }

  function hide() {
    if (!ready || !visible) return;
    visible = false;
    manualMode = false;
    if (cycleTimer) clearTimeout(cycleTimer);
    const canvas = document.getElementById("globe-canvas");
    const orb = document.getElementById("orb");
    const label = document.getElementById("globe-label");
    if (canvas) canvas.classList.remove("visible");
    if (label) label.classList.remove("visible");
    if (orb) orb.classList.remove("hidden-by-globe");
    setTimeout(resetView, 500);
  }

  // ── Für Handgesten-Steuerung: Weltkugel manuell öffnen und per Hand drehen/zoomen ──
  function showIdle() {
    if (!ready) return;
    const canvas = document.getElementById("globe-canvas");
    const orb = document.getElementById("orb");
    if (!canvas) return;
    if (cycleTimer) clearTimeout(cycleTimer);
    visible = true;
    manualMode = true;
    orbitYaw = 0; orbitPitch = 0.15; orbitDist = 4.2;
    marker.visible = false;
    markerRing.visible = false;
    canvas.classList.add("visible");
    if (orb) orb.classList.add("hidden-by-globe");
  }

  function rotateBy(dYaw, dPitch) {
    if (!manualMode) return;
    orbitYaw -= dYaw;
    orbitPitch += dPitch;
  }

  function zoomBy(delta) {
    if (!manualMode) return;
    orbitDist -= delta;
  }

  document.addEventListener("DOMContentLoaded", init);

  // Für "Zeigen"-Geste: welcher Punkt auf der Erde ist gerade in Kamerarichtung?
  function getCurrentViewLatLon() {
    if (!manualMode) return null;
    const dirX = Math.cos(orbitPitch) * Math.sin(orbitYaw);
    const dirY = Math.sin(orbitPitch);
    const dirZ = Math.cos(orbitPitch) * Math.cos(orbitYaw);
    const lat = 90 - Math.acos(Math.max(-1, Math.min(1, dirY))) * 180 / Math.PI;
    let lon = Math.atan2(dirZ, -dirX) * 180 / Math.PI - 180;
    if (lon < -180) lon += 360;
    return { lat, lon };
  }

  return { show, hide, showIdle, rotateBy, zoomBy, getCurrentViewLatLon, isVisible: () => visible };
})();
