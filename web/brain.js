/* ── JARVIS — Gehirn-Ansicht: zwei klare Spalten statt frei schwebender
   3D-Punkte. Links: was JARVIS kann. Rechts: was JARVIS über den Nutzer
   weiß. Echtes DOM-Layout — Überlappung ist dadurch technisch unmöglich,
   nicht nur unwahrscheinlich. ─────────────────────────────────────────── */

window.JarvisBrain = (function () {
  let visible = false;
  let hideTimer = null;

  function escapeHtmlSafe(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function buildNode(label, colorClass, delayMs) {
    const div = document.createElement("div");
    div.className = `brain-node ${colorClass}`;
    div.style.transitionDelay = `${delayMs}ms`;
    div.innerHTML = `<span class="brain-node-dot"></span><span class="brain-node-text">${escapeHtmlSafe(label)}</span>`;
    return div;
  }

  function fillColumn(el, items, colorClass) {
    el.innerHTML = "";
    items.forEach((label, i) => {
      const node = buildNode(label, colorClass, 80 + i * 90);
      el.appendChild(node);
      // Doppelter rAF, damit der Browser den Startzustand (opacity 0) erst
      // rendert, bevor die Übergangs-Klasse gesetzt wird -> echte Animation
      requestAnimationFrame(() => requestAnimationFrame(() => node.classList.add("in")));
    });
  }

  function show(skills, knowledge) {
    const overlay = document.getElementById("brain-overlay");
    const leftCol = document.getElementById("brain-col-left");
    const rightCol = document.getElementById("brain-col-right");
    const orb = document.getElementById("orb");
    if (!overlay || !leftCol || !rightCol) return;

    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }

    fillColumn(leftCol, skills || [], "cyan");
    const kLabels = (knowledge || []).map((k) => `${k.kategorie}: ${k.text}`);
    if (kLabels.length === 0) kLabels.push("Noch nichts Gespeichertes — erzähl mir was über dich!");
    fillColumn(rightCol, kLabels, "gold");

    visible = true;
    overlay.classList.add("visible");
    if (orb) orb.classList.add("hidden-by-globe");
  }

  function hide() {
    if (!visible) return;
    visible = false;
    const overlay = document.getElementById("brain-overlay");
    const orb = document.getElementById("orb");
    if (overlay) overlay.classList.remove("visible");
    if (orb) orb.classList.remove("hidden-by-globe");
    hideTimer = setTimeout(() => {
      const left = document.getElementById("brain-col-left");
      const right = document.getElementById("brain-col-right");
      if (left) left.innerHTML = "";
      if (right) right.innerHTML = "";
    }, 500);
  }

  return { show, hide, isVisible: () => visible };
})();
