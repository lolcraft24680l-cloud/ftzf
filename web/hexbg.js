/* ── JARVIS — Wabenmuster-Hintergrund (ambient, dezent, auf allen Seiten) ── */
(function drawHexBackground() {
  const canvas = document.getElementById("hexbg");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener("resize", resize);

  const hexSize = 38;
  const hexW = Math.sqrt(3) * hexSize;
  const hexH = hexSize * 2;

  function drawHex(cx, cy, r) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 6;
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }

  let t = 0;
  function draw() {
    t += 0.0022;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 1;

    const cols = Math.ceil(canvas.width / hexW) + 2;
    const rows = Math.ceil(canvas.height / (hexH * 0.75)) + 2;

    for (let row = -1; row < rows; row++) {
      for (let col = -1; col < cols; col++) {
        const x = col * hexW + (row % 2 === 0 ? 0 : hexW / 2);
        const y = row * hexH * 0.75;
        const dist = Math.hypot(x - canvas.width / 2, y - canvas.height / 2);
        const glow = Math.max(0, Math.sin(t * 2 - dist * 0.0035));
        ctx.strokeStyle = `rgba(70, 225, 255, ${0.065 + glow * 0.09})`;
        drawHex(x, y, hexSize * 0.98);
      }
    }
    requestAnimationFrame(draw);
  }
  draw();
})();
