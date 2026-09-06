/* ── JARVIS — Handgesten-Steuerung per Webcam (MediaPipe Hands) ────────────
   Pinch (Daumen + Zeigefinger zusammen) + Hand bewegen = Weltkugel drehen.
   Beide Hände auseinanderziehen (Zeigefinger-Abstand vergrößern) = zoomen.
   Läuft komplett lokal im Browser, kein Server/Upload der Webcam-Bilder. */

window.JarvisGestures = (function () {
  let hands = null;
  let camera = null;
  let active = false;
  let pinching = false;
  let lastPinch = null;
  let lastSpread = null;
  let pointHoldStart = null;
  let pointTriggered = false;
  let onPointCallback = null;
  const POINT_HOLD_MS = 700; // so lange muss die Zeigegeste gehalten werden

  function dist2D(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  // Ein Finger gilt als "gestreckt", wenn seine Spitze deutlich weiter vom
  // Handgelenk entfernt ist als sein Grundgelenk.
  function isExtended(landmarks, tipIdx, baseIdx, wristIdx = 0) {
    const wrist = landmarks[wristIdx];
    const tip = landmarks[tipIdx];
    const base = landmarks[baseIdx];
    return dist2D(tip, wrist) > dist2D(base, wrist) * 1.25;
  }

  function isPointingGesture(landmarks) {
    const indexOut = isExtended(landmarks, 8, 5);
    const middleIn = !isExtended(landmarks, 12, 9);
    const ringIn = !isExtended(landmarks, 16, 13);
    const pinkyIn = !isExtended(landmarks, 20, 17);
    return indexOut && middleIn && ringIn && pinkyIn;
  }

  let hasLoggedDetection = false;

  function onResults(results) {
    const handsData = results.multiHandLandmarks || [];

    if (handsData.length > 0 && !hasLoggedDetection) {
      hasLoggedDetection = true;
      console.log("[JARVIS Gesten] Hand erkannt ✅ — Steuerung sollte funktionieren.");
    }

    if (handsData.length === 0) {
      pinching = false;
      lastPinch = null;
      lastSpread = null;
      pointHoldStart = null;
      pointTriggered = false;
      return;
    }

    const hand = handsData[0];

    // ── Eine Hand: Pinch = Drehen (wird ZUERST geprüft, damit die Zeigen-Geste
    //    ein Pinch nicht versehentlich blockiert) ──
    const thumb = hand[4], index = hand[8];
    const pinchDist = dist2D(thumb, index);
    const isPinching = handsData.length === 1 && pinchDist < 0.09;

    if (isPinching) {
      pointHoldStart = null;
      pointTriggered = false;
      const cx = (thumb.x + index.x) / 2;
      const cy = (thumb.y + index.y) / 2;
      if (pinching && lastPinch) {
        const dx = cx - lastPinch.x;
        const dy = cy - lastPinch.y;
        if (window.JarvisGlobe) window.JarvisGlobe.rotateBy(dx * 8, dy * 8);
      }
      lastPinch = { x: cx, y: cy };
      pinching = true;
      return; // während des Pinchens keine Zeigen-Erkennung
    }
    pinching = false;
    lastPinch = null;

    // ── Zeigen-Geste: Index gestreckt, Rest eingezogen, kurz gehalten ──
    // (nur relevant, wenn gerade NICHT gepincht wird — siehe oben)
    if (handsData.length === 1 && isPointingGesture(hand)) {
      const now = performance.now();
      if (pointHoldStart === null) pointHoldStart = now;
      if (!pointTriggered && now - pointHoldStart >= POINT_HOLD_MS) {
        pointTriggered = true;
        if (onPointCallback) onPointCallback();
      }
      return;
    } else {
      pointHoldStart = null;
      pointTriggered = false;
    }

    // ── Zwei Hände: Abstand = Zoom ("auseinanderziehen") ──
    if (handsData.length === 2) {
      const p1 = handsData[0][8], p2 = handsData[1][8];
      const spread = dist2D(p1, p2);
      if (lastSpread !== null && window.JarvisGlobe) {
        window.JarvisGlobe.zoomBy((spread - lastSpread) * 6);
      }
      lastSpread = spread;
    } else {
      lastSpread = null;
    }
  }

  async function start() {
    if (active) return true;
    if (typeof Hands === "undefined" || typeof Camera === "undefined") {
      return false; // MediaPipe-Skripte noch nicht geladen
    }
    const videoEl = document.getElementById("gesture-video");
    if (!videoEl) return false;

    try {
      hands = new Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
      });
      hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.6,
        minTrackingConfidence: 0.6,
      });
      hands.onResults(onResults);

      camera = new Camera(videoEl, {
        onFrame: async () => {
          try { await hands.send({ image: videoEl }); } catch (_) {}
        },
        width: 320,
        height: 240,
      });
      await camera.start();
      active = true;
      if (window.JarvisGlobe) window.JarvisGlobe.showIdle();
      return true;
    } catch (e) {
      console.error("Gesten-Steuerung: Webcam-Zugriff fehlgeschlagen:", e);
      active = false;
      return false;
    }
  }

  function stop() {
    if (camera) {
      try { camera.stop(); } catch (_) {}
    }
    const videoEl = document.getElementById("gesture-video");
    if (videoEl && videoEl.srcObject) {
      videoEl.srcObject.getTracks().forEach((t) => t.stop());
      videoEl.srcObject = null;
    }
    active = false;
    pinching = false;
    lastPinch = null;
    lastSpread = null;
    pointHoldStart = null;
    pointTriggered = false;
    if (window.JarvisGlobe) window.JarvisGlobe.hide();
  }

  function isActive() {
    return active;
  }

  function setPointCallback(fn) {
    onPointCallback = fn;
  }

  return { start, stop, isActive, setPointCallback };
})();
