// Landing background: a slow drift of tumbling gold and silver coins, parallaxed by size.
(() => {
  const canvas = document.getElementById('bg');
  const ctx = canvas.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let w = 0, h = 0, coins = [], last = 0, raf = 0, paused = false;

  const rand = (a, b) => a + Math.random() * (b - a);

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    w = innerWidth; h = innerHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.round(Math.min(46, Math.max(18, (w * h) / 32000)));
    coins = Array.from({ length: n }, () => spawn(true));
    if (reduce) draw(0);
  }

  function spawn(anywhere) {
    const depth = Math.random() ** 1.4;              // 0 far / small, 1 near / big
    return {
      x: rand(0, w), y: anywhere ? rand(0, h) : h + 60, depth,
      r: 7 + depth * 34, vy: -(10 + depth * 34), sway: rand(0, 6.28), swaySpeed: rand(.2, .6),
      a: rand(0, 6.28), va: rand(1.1, 3.2) * (Math.random() < .5 ? -1 : 1),
      tilt: rand(-.7, .7),
    };
  }

  function drawCoin(c) {
    const cos = Math.cos(c.a);
    const face = cos >= 0;                            // gold side / silver side
    const sx = Math.abs(cos);
    const alpha = 0.16 + c.depth * 0.5;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.tilt);
    ctx.globalAlpha = alpha;
    // edge thickness shows as the coin turns edge-on
    ctx.fillStyle = face ? '#8f6a17' : '#7d868c';
    ctx.beginPath(); ctx.ellipse(0, c.r * 0.06, c.r, Math.max(c.r * sx, 1.2), 0, 0, 6.283); ctx.fill();
    ctx.fillStyle = face ? '#e9b949' : '#d3d9dd';
    ctx.beginPath(); ctx.ellipse(0, 0, c.r, Math.max(c.r * sx, 1.2), 0, 0, 6.283); ctx.fill();
    if (sx > 0.25) {
      ctx.strokeStyle = face ? 'rgba(120,80,10,.55)' : 'rgba(70,80,88,.5)';
      ctx.lineWidth = Math.max(1, c.r * 0.07);
      ctx.beginPath(); ctx.ellipse(0, 0, c.r * 0.74, c.r * 0.74 * sx, 0, 0, 6.283); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.35)';       // highlight crescent
      ctx.beginPath(); ctx.ellipse(-c.r * .28, -c.r * .3 * sx, c.r * .3, c.r * .14 * sx, -.6, 0, 6.283); ctx.fill();
    }
    ctx.restore();
  }

  function draw(dt) {
    ctx.clearRect(0, 0, w, h);
    coins.sort((a, b) => a.depth - b.depth);
    for (const c of coins) {
      if (dt) {
        c.a += c.va * dt;
        c.sway += c.swaySpeed * dt;
        c.y += c.vy * dt;
        c.x += Math.sin(c.sway) * 8 * dt * (0.4 + c.depth);
        if (c.y < -80) Object.assign(c, spawn(false), { x: rand(0, w) });
      }
      drawCoin(c);
    }
  }

  function frame(t) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (t - last) / 1000 || 0);
    last = t;
    draw(dt);
  }

  function start() { if (reduce || paused || raf) return; last = performance.now(); raf = requestAnimationFrame(frame); }
  function stop() { cancelAnimationFrame(raf); raf = 0; }

  addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  resize();
  start();

  // The game screen hides the canvas, so stop animating while it's covered.
  window.FFBg = {
    pause() { paused = true; stop(); },
    resume() { paused = false; start(); },
  };
})();
