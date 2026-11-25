// The coin toss. A thumb rises, flicks a coin into the air, the coin tumbles, lands, and waits for the
// app to open the question screen out of it.
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const stage = document.getElementById('stage');
  const thumb = document.getElementById('thumb');
  const halo = document.getElementById('halo');
  const coinwrap = document.getElementById('coinwrap');
  const note = document.getElementById('stage-note');
  const ring = document.getElementById('ring');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Fills `host` with a 3D coin (gold front, silver back, a stack of rims so the edge is visible). */
  function buildCoin(host) {
    const rims = [-3, -2, -1, 0, 1, 2, 3].map((i) => `<i class="rim" style="--i:${i}"></i>`).join('');
    host.innerHTML = `<div class="coin">${rims}<div class="face front"><b>50</b></div><div class="face back"><b>50</b></div></div>`;
    return host.firstElementChild;
  }

  document.querySelectorAll('.mini-coin').forEach(buildCoin);
  const coin = buildCoin(coinwrap);

  const BASE = 'translate(-50%,-50%)';
  const cancelAll = () => [thumb, coinwrap, coin, halo, ring].forEach((e) => e.getAnimations().forEach((a) => a.cancel()));

  /** Resolves when the coin has landed. The stage stays up until dismiss(). */
  async function toss() {
    cancelAll();
    stage.hidden = false;
    halo.style.opacity = 0;
    note.textContent = '';

    if (reduce) {
      coinwrap.style.opacity = 1;
      coinwrap.style.transform = BASE;
      await sleep(350);
      return;
    }

    const vh = innerHeight;
    const coinSize = coinwrap.offsetWidth;
    const thumbH = thumb.getBoundingClientRect().height;
    const restY = vh / 2 - thumbH - coinSize * 0.12;   // coin resting on the thumb tip, measured from screen centre
    const peakY = -vh * 0.36;
    const T = 'translateX(-50%)';

    coin.style.transform = 'rotateX(74deg)';            // lying nearly flat on the thumb
    coinwrap.style.opacity = 1;

    // 1. Thumb rises carrying the coin
    const RISE = 520, ease = 'cubic-bezier(.2,.9,.3,1.05)';
    thumb.animate([{ transform: `${T} translateY(118%)` }, { transform: `${T} translateY(0)` }], { duration: RISE, easing: ease, fill: 'forwards' });
    const carry = coinwrap.animate([
      { transform: `${BASE} translateY(${restY + thumbH * 1.18}px) scale(.85)` },
      { transform: `${BASE} translateY(${restY}px) scale(.9)` },
    ], { duration: RISE, easing: ease, fill: 'forwards' });
    await carry.finished;
    await sleep(140);

    // 2. Flick: thumb snaps up and away, coin tumbles up, hangs, drops, bounces once
    const FLY = 2300;
    thumb.animate([
      { transform: `${T} translateY(0)` },
      { transform: `${T} translateY(-9vh)`, offset: 0.14, easing: 'ease-in' },
      { transform: `${T} translateY(0)`, offset: 0.3 },
      { transform: `${T} translateY(120%)` },
    ], { duration: 1000, easing: 'ease-out', fill: 'forwards' });

    coin.animate([{ transform: 'rotateX(74deg)' }, { transform: 'rotateX(3600deg)' }],
      { duration: FLY, easing: 'cubic-bezier(.22,.55,.3,1)', fill: 'forwards' });

    const fly = coinwrap.animate([
      { transform: `${BASE} translateY(${restY}px) scale(.9)`, offset: 0, easing: 'cubic-bezier(.15,.7,.3,1)' },
      { transform: `${BASE} translateY(${peakY}px) scale(1.55)`, offset: 0.46, easing: 'cubic-bezier(.55,0,.9,.6)' },
      { transform: `${BASE} translateY(0px) scale(1)`, offset: 0.86, easing: 'ease-out' },
      { transform: `${BASE} translateY(-${Math.round(coinSize * 0.22)}px) scale(1.04)`, offset: 0.93, easing: 'ease-in' },
      { transform: `${BASE} translateY(0px) scale(1)`, offset: 1 },
    ], { duration: FLY, fill: 'forwards' });
    await fly.finished;
    halo.style.opacity = 1;
  }

  /** Optional status line under the coin (shown if the server is slow, e.g. building the day's questions). */
  function setNote(text) { note.textContent = text || ''; }

  /**
   * Coin swells and fades while a gold ring expands to radius `radius` (px) in step with the
   * clip-path circle that opens the question screen, so the ring rides the edge of the reveal.
   */
  function dismiss({ radius = 800, duration = 850, easing = 'cubic-bezier(.55,0,.2,1)' } = {}) {
    halo.style.opacity = 0;
    note.textContent = '';
    if (reduce) { stage.hidden = true; cancelAll(); coinwrap.style.opacity = 0; return Promise.resolve(); }
    ring.animate([
      { transform: 'scale(.3)', opacity: 1 },
      { transform: `scale(${(radius * 2) / 100})`, opacity: 1, offset: 0.92 },
      { transform: `scale(${(radius * 2) / 100})`, opacity: 0 },
    ], { duration, easing, fill: 'forwards' });
    const a = coinwrap.animate([
      { transform: `${BASE} scale(1)`, opacity: 1 },
      { transform: `${BASE} scale(1.7)`, opacity: 0 },
    ], { duration: 520, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
    return a.finished.then(() => { coinwrap.style.opacity = 0; });
  }

  /** Remove the stage once the question screen is fully open. */
  function finish() { stage.hidden = true; cancelAll(); coinwrap.style.opacity = 0; }

  /** Abort without the swell (used when something goes wrong). */
  function abort() {
    stage.hidden = true; cancelAll(); coinwrap.style.opacity = 0; halo.style.opacity = 0; note.textContent = '';
  }

  window.FF = { toss, dismiss, finish, abort, setNote, buildCoin };
})();
