(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const screens = ['join', 'ready', 'play', 'over'].reduce((o, n) => ((o[n] = $(`#screen-${n}`)), o), {});
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const REVEAL_MS = 1400;          // how long the right answer is shown before the next question
  const BLUR = { flag: 10, photo: 22 }; // pictures start blurred and sharpen as the clock runs

  let state = null;
  let locked = false;
  let flipping = false;
  let timerRaf = 0;
  let expiryTimeout = 0;
  let resetAt = 0;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const api = async (path, body) => {
    const res = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return res.json();
  };
  const preload = (src) => (!src ? Promise.resolve() : new Promise((resolve) => {
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.onload = img.onerror = () => resolve();
    img.src = src;
    setTimeout(resolve, 4000);
  }));

  let toastTimer = 0;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg; el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('on'), 3500);
  }

  function show(name) {
    for (const [k, el] of Object.entries(screens)) { el.hidden = k !== name; el.classList.remove('leaving'); }
    document.body.classList.toggle('is-play', name === 'play');
    name === 'play' ? FFBg.pause() : FFBg.resume();
    window.scrollTo(0, 0);
  }

  // ---------- countdown to the next set ----------
  const fmt = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':');
  };
  setInterval(() => {
    if (!resetAt) return;
    const left = resetAt - Date.now();
    document.querySelectorAll('.countdown').forEach((el) => (el.textContent = fmt(left)));
    if (left <= 0 && !flipping && screens.play.hidden) { resetAt = 0; load(); } // midnight: pull the new day
  }, 500);

  // ---------- leaderboard ----------
  async function renderBoard(slot) {
    const b = await api('/api/leaderboard');
    const rows = b.entries.map((e) =>
      `<li class="${e.you ? 'you' : ''}"><span class="rank">${e.rank}</span><span>${esc(e.name)}${e.live ? '<span class="live">playing</span>' : ''}</span><span class="score">${e.streak}</span></li>`).join('');
    slot.innerHTML = `<div class="board"><h3>Today's leaderboard</h3>${rows ? `<ol>${rows}</ol>` : '<p class="empty">No one has played yet. Be the first on the board.</p>'}</div>`;
  }

  // ---------- screens ----------
  function renderReady() {
    $('#ready-lede').textContent = `Welcome back, ${state.player.name}. Today's questions are up. One miss ends your run.`;
    show('ready');
    renderBoard($('#screen-ready .board-slot'));
  }

  function renderOver() {
    const n = state.run.streak;
    $('#result-num').textContent = n;
    $('#result-text').textContent =
      state.run.status === 'perfect' ? 'Perfect run. You cleared every question today.'
      : n === 0 ? 'Out on the first question. A new chain starts tomorrow.'
      : `${n} in a row today. A new chain starts tomorrow.`;
    show('over');
    renderBoard($('#screen-over .board-slot'));
  }

  // Fills the play screen and starts the clock. Does not change which screen is visible.
  function renderQuestion(q) {
    locked = false;
    cancelAnimationFrame(timerRaf);
    clearTimeout(expiryTimeout);
    $('#streak-num').textContent = state.run.streak;
    $('#qno').textContent = `Question ${q.number}`;
    $('#question').textContent = q.text;

    const pic = $('#pic'), img = $('#pic-img');
    img.getAnimations().forEach((a) => a.cancel());
    if (q.image) {
      img.src = q.image;
      $('#pic-credit').textContent = q.credit || '';
      pic.hidden = false;
    } else {
      pic.hidden = true;
      img.removeAttribute('src');
    }

    const choices = $('#choices');
    choices.classList.remove('revealed');
    choices.classList.toggle('long', q.options.some((o) => o.length > 38));
    choices.querySelectorAll('.choice').forEach((btn, i) => {
      btn.className = `choice c${i}`;
      btn.disabled = false;
      $('.label', btn).textContent = q.options[i];
      $('.mark', btn).textContent = '';
    });
    runTimer(q);
  }

  function runTimer(q) {
    const bar = $('#timer-bar');
    bar.classList.remove('low');
    const secs = Math.min(q.secondsLeft, state.timeLimit);       // server clock may include a little lead time
    const total = state.timeLimit * 1000;
    const end = performance.now() + secs * 1000;
    const tick = () => {
      const left = end - performance.now();
      bar.style.transform = `scaleX(${Math.max(0, left / total)})`;
      bar.classList.toggle('low', left < 5000);
      if (left > 0) timerRaf = requestAnimationFrame(tick);
    };
    tick();

    if (q.image && !reduce) {
      $('#pic-img').animate([{ filter: `blur(${BLUR[q.type] ?? 18}px)` }, { filter: 'blur(0px)' }], { duration: secs * 1000, easing: 'linear', fill: 'forwards' });
    }
    // If time runs out, ask the server for the verdict once its grace period has passed.
    expiryTimeout = setTimeout(onExpired, q.secondsLeft * 1000 + 1900);
  }

  async function onExpired() {
    if (locked) return;
    locked = true;
    const s = await api('/api/state');
    state = s;
    if (s.reveal) reveal(s.reveal.correctIndex, null, false, renderOver);
    else if (s.question) { locked = false; renderQuestion(s.question); } // clock hadn't actually run out
    else renderOver();
  }

  function reveal(correctIndex, pickedIndex, wasCorrect, done) {
    $('#pic-img').getAnimations().forEach((a) => a.cancel());   // snap the picture into focus
    const choices = $('#choices');
    choices.classList.add('revealed');
    choices.querySelectorAll('.choice').forEach((btn, i) => {
      btn.disabled = true;
      btn.classList.add(i === correctIndex ? 'right' : 'wrong');
      if (i === pickedIndex && !wasCorrect) btn.classList.add('picked-wrong');
    });
    setTimeout(done, REVEAL_MS);
  }

  async function onPick(i) {
    if (locked) return;
    locked = true;
    cancelAnimationFrame(timerRaf);
    clearTimeout(expiryTimeout);
    const r = await api('/api/answer', { choice: i });
    if (r.error) { locked = false; return load(); }
    state.run.streak = r.streak;
    if (r.correct) {
      const b = $('#streak-num');
      b.textContent = r.streak; b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump');
    }
    if (r.next) preload(r.next.image); // warm the cache during the reveal
    reveal(r.correctIndex, i, r.correct, () => {
      if (r.over) {
        state.run.status = r.perfect ? 'perfect' : 'out';
        renderOver();
      } else {
        renderQuestion(r.next);
      }
    });
  }

  // ---------- the coin toss into the first question ----------
  const currentHome = () => [screens.join, screens.ready].find((el) => !el.hidden);

  /** `begin()` returns the /api/start state. The coin is in the air while it runs, then the question screen opens out of the landed coin. */
  async function flipIntoGame(begin) {
    if (flipping) return;
    flipping = true;
    const from = currentHome();
    from?.classList.add('leaving');

    let s;
    try {
      await FF.toss();                                  // thumb flicks, coin tumbles, coin lands
      const slow = setTimeout(() => FF.setNote("Shuffling today's questions…"), 1500);
      s = await begin();                                // runs in parallel with the landing halo
      clearTimeout(slow);
      if (!s?.question) throw new Error('No question returned');
      await preload(s.question.image);
    } catch (err) {
      console.error(err);
      FF.abort();
      from?.classList.remove('leaving');
      toast("Couldn't start today's game. Try again in a moment.");
      flipping = false;
      return;
    }

    state = s;
    resetAt = Date.now() + s.resetsInMs;
    renderQuestion(s.question);                         // content is ready underneath; the clock starts as the screen opens

    const play = screens.play;
    const radius = Math.hypot(innerWidth, innerHeight) / 2 + 30;   // just past the screen corners
    const duration = reduce ? 1 : 850;
    document.body.classList.add('is-play');
    play.classList.add('opening');
    play.hidden = false;
    play.style.clipPath = 'circle(0px at 50% 50%)';
    const open = play.animate(
      [{ clipPath: 'circle(0px at 50% 50%)' }, { clipPath: `circle(${radius}px at 50% 50%)` }],
      { duration, easing: 'cubic-bezier(.55,0,.2,1)' },
    );
    FF.dismiss({ radius, duration });
    await open.finished;
    FF.finish();
    play.style.clipPath = '';
    show('play');
    play.classList.remove('opening');
    flipping = false;
  }

  // ---------- boot ----------
  async function load() {
    state = await api('/api/state');
    resetAt = Date.now() + state.resetsInMs;
    if (!state.player) return show('join');
    if (state.question) { renderQuestion(state.question); return show('play'); }
    if (state.run) return renderOver();
    renderReady();
  }

  $('#join-btn').addEventListener('click', async () => {
    const name = $('#name').value.trim();
    if (!name) return $('#name').focus();
    flipIntoGame(async () => {
      await api('/api/join', { name });
      return api('/api/start', {});
    });
  });
  $('#name').addEventListener('keydown', (e) => e.key === 'Enter' && $('#join-btn').click());

  $('#flip-btn').addEventListener('click', () => flipIntoGame(() => api('/api/start', {})));

  document.querySelectorAll('.choice').forEach((btn) => btn.addEventListener('click', () => onPick(Number(btn.dataset.i))));

  $('#share-btn').addEventListener('click', async (e) => {
    const n = state.run.streak;
    const text = `Fifty Fifty ${state.date}\n${n} in a row${state.run.status === 'perfect' ? ' (perfect!)' : ''}\n${location.origin}`;
    try { await navigator.clipboard.writeText(text); e.target.textContent = 'Copied'; } catch { e.target.textContent = 'Copy failed'; }
    setTimeout(() => (e.target.textContent = 'Copy result'), 1800);
  });

  load();
})();
