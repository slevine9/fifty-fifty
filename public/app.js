(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const screens = ['join', 'ready', 'play', 'over'].reduce((o, n) => ((o[n] = $(`#screen-${n}`)), o), {});
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const REVEAL_MS = 1400;               // how long the right answer is shown before the next question
  const BLUR = { flag: 10, photo: 22 }; // pictures start blurred and sharpen as the clock runs

  // Always default to the Daily mode when first loading the site.
  let mode = 'daily';
  let state = null;
  let dailySummary = null;
  let arcadeSummary = null;
  let statsTab = 'daily';
  let authTab = 'login';
  let locked = false;
  let flipping = false;
  let timerRaf = 0;
  let expiryTimeout = 0;
  let revealTimeout = 0;
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

  function clearPlayTimers() {
    cancelAnimationFrame(timerRaf);
    clearTimeout(expiryTimeout);
    clearTimeout(revealTimeout);
  }

  function show(name) {
    for (const [k, el] of Object.entries(screens)) { el.hidden = k !== name; el.classList.remove('leaving'); }
    document.body.classList.toggle('is-play', name === 'play');
    if (name !== 'play') clearPlayTimers();
    name === 'play' ? FFBg.pause() : FFBg.resume();
    window.scrollTo(0, 0);
  }

  // ---------- countdown to the next daily set ----------
  const fmt = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':');
  };
  setInterval(() => {
    if (!resetAt) return;
    const left = resetAt - Date.now();
    document.querySelectorAll('.countdown').forEach((el) => (el.textContent = fmt(left)));
    if (left <= 0 && !flipping && screens.play.hidden && mode === 'daily') { resetAt = 0; load(); }
  }, 500);

  // ---------- topbar & left menu drawer ----------
  function openDrawer() {
    $('#drawer-backdrop').hidden = false;
    $('#drawer').classList.add('open');
    $('#drawer').setAttribute('aria-hidden', 'false');
    $('#menu-btn').setAttribute('aria-expanded', 'true');
  }

  function closeDrawer() {
    $('#drawer').classList.remove('open');
    $('#drawer').setAttribute('aria-hidden', 'true');
    $('#menu-btn').setAttribute('aria-expanded', 'false');
    $('#drawer-backdrop').hidden = true;
  }

  function openModal(id) {
    closeDrawer();
    $(`#${id}`).hidden = false;
  }

  function closeModal(id) {
    $(`#${id}`).hidden = true;
  }

  function avatarHtml(player) {
    if (player?.avatarUrl) return `<img src="${esc(player.avatarUrl)}" alt="">`;
    const letter = (player?.name || '?').trim().charAt(0).toUpperCase() || '?';
    return esc(letter);
  }

  function renderChrome() {
    const p = state?.player;
    const isArcade = mode === 'arcade';

    const pill = $('#mode-indicator');
    pill.hidden = false;
    pill.textContent = isArcade ? 'Arcade' : 'Daily';
    pill.classList.toggle('arcade', isArcade);

    const hudMode = $('#hud-mode');
    hudMode.textContent = isArcade ? 'Arcade' : 'Daily';
    hudMode.classList.toggle('arcade', isArcade);

    $('#top-avatar').innerHTML = p ? avatarHtml(p) : '?';
    $('#top-account-label').textContent = p ? p.name : 'Sign in';

    $('#nav-daily').classList.toggle('active', !isArcade);
    $('#nav-arcade').classList.toggle('active', isArcade);

    // Drawer badges
    const dBadge = $('#nav-daily-badge');
    if (dailySummary?.run) {
      dBadge.textContent = dailySummary.run.status === 'in_progress' ? 'Live' : `Score ${dailySummary.run.streak}`;
    } else {
      dBadge.textContent = 'Today';
    }
    const aBadge = $('#nav-arcade-badge');
    const best = state?.stats?.arcade?.bestStreak ?? arcadeSummary?.personalBest ?? 0;
    aBadge.textContent = best > 0 ? `Best ${best}` : 'Endless';

    $('#nav-rename').hidden = !p;
    if (p) $('#nav-rename-sub').textContent = `Current: ${p.name}`;

    // Account card inside drawer
    const card = $('#drawer-account');
    if (!p) {
      card.innerHTML = `
        <div class="drawer-user">
          <span class="avatar-dot">?</span>
          <div class="drawer-user-meta"><strong>Not signed in</strong><small>Save stats across devices</small></div>
        </div>
        <button class="primary compact" type="button" id="drawer-signin-btn">Sign in with Google / Email</button>
      `;
    } else if (p.isGuest) {
      card.innerHTML = `
        <div class="drawer-user">
          <span class="avatar-dot">${avatarHtml(p)}</span>
          <div class="drawer-user-meta"><strong>${esc(p.name)}</strong><small>Guest session (this browser)</small></div>
        </div>
        <button class="primary compact" type="button" id="drawer-signin-btn">Sign in to save stats</button>
      `;
    } else {
      const providerLabel = p.authProvider === 'google' ? 'Google account' : 'Email account';
      card.innerHTML = `
        <div class="drawer-user">
          <span class="avatar-dot">${avatarHtml(p)}</span>
          <div class="drawer-user-meta"><strong>${esc(p.name)}</strong><small>${esc(p.email || providerLabel)}</small></div>
        </div>
        <button class="secondary compact" type="button" id="drawer-logout-btn">Sign out</button>
      `;
    }

    const signBtn = $('#drawer-signin-btn');
    if (signBtn) signBtn.addEventListener('click', () => openAuthModal());
    const outBtn = $('#drawer-logout-btn');
    if (outBtn) outBtn.addEventListener('click', handleLogout);
  }

  // ---------- Wordle-style statistics ----------
  function buildStatsHtml(stats, activeTab, { highlightLatest = false } = {}) {
    const s = stats?.[activeTab] || {
      played: 0, bestStreak: 0, avgStreak: 0, totalCorrect: 0,
      perfects: 0, currentDayStreak: 0, maxDayStreak: 0,
      distribution: {}, lastBucket: null,
    };
    const buckets = stats?.buckets || ['0', '1-4', '5-9', '10-14', '15-19', '20-29', '30+'];
    const maxVal = Math.max(1, ...buckets.map((b) => s.distribution?.[b] || 0));

    const kpis = activeTab === 'daily'
      ? [
          [s.played, 'Played'],
          [s.bestStreak, 'Best'],
          [s.avgStreak, 'Avg'],
          [s.currentDayStreak, 'Day Streak'],
        ]
      : [
          [s.played, 'Played'],
          [s.bestStreak, 'Best'],
          [s.avgStreak, 'Avg'],
          [s.totalCorrect, 'Total Right'],
        ];

    const subNote = activeTab === 'daily'
      ? `Max Day Streak: ${s.maxDayStreak} &middot; Perfect Runs: ${s.perfects}`
      : (s.played ? `Last run: ${s.lastScore ?? 0} in a row` : 'Complete an Arcade run to build your streak stats');

    const bars = buckets.map((b) => {
      const count = s.distribution?.[b] || 0;
      const pct = count ? Math.max(12, Math.round((count / maxVal) * 100)) : 0;
      const isLatest = highlightLatest && s.lastBucket === b && count > 0;
      return `
        <div class="dist-row">
          <span class="dist-label">${esc(b)}</span>
          <div class="dist-track">
            <div class="dist-bar ${isLatest ? 'latest' : ''}" style="width:${pct}%">${count}</div>
          </div>
        </div>
      `;
    }).join('');

    const guestCta = !state?.player || state.player.isGuest
      ? `<div class="stats-cta"><span>Sign in with Google or Email to keep your stats forever.</span><button class="secondary compact" type="button" data-open-auth="1">Sign in</button></div>`
      : '';

    return `
      <div class="stats-box">
        <div class="tabs" role="tablist">
          <button class="tab ${activeTab === 'daily' ? 'active' : ''}" type="button" data-stats-tab="daily">Daily</button>
          <button class="tab ${activeTab === 'arcade' ? 'active' : ''}" type="button" data-stats-tab="arcade">Arcade</button>
        </div>
        <div class="kpi-grid">
          ${kpis.map(([val, lbl]) => `<div class="kpi"><strong>${val}</strong><span>${lbl}</span></div>`).join('')}
        </div>
        <p class="stats-sub">${subNote}</p>
        <p class="dist-title">Streak Distribution</p>
        <div class="dist">${bars}</div>
        ${guestCta}
      </div>
    `;
  }

  function wireStatsContainer(container, { highlightLatest = false } = {}) {
    container.querySelectorAll('[data-stats-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        statsTab = btn.dataset.statsTab;
        container.innerHTML = buildStatsHtml(state?.stats, statsTab, { highlightLatest: highlightLatest && statsTab === mode });
        wireStatsContainer(container, { highlightLatest });
      });
    });
    const openAuth = container.querySelector('[data-open-auth]');
    if (openAuth) openAuth.addEventListener('click', () => { closeModal('stats-modal'); openAuthModal(); });
  }

  async function openStatsModal(preferredTab = mode) {
    statsTab = preferredTab;
    if (state?.player) {
      const r = await api('/api/stats');
      if (r.stats) state.stats = r.stats;
    }
    const body = $('#stats-modal-body');
    body.innerHTML = buildStatsHtml(state?.stats, statsTab, { highlightLatest: true });
    wireStatsContainer(body, { highlightLatest: true });
    openModal('stats-modal');
  }

  // ---------- leaderboard ----------
  async function renderBoard(slot) {
    const endpoint = mode === 'arcade' ? '/api/arcade/leaderboard' : '/api/leaderboard';
    const b = await api(endpoint);
    const title = mode === 'arcade' ? 'Arcade all-time bests' : "Today's leaderboard";
    const rows = (b.entries || []).map((e) =>
      `<li class="${e.you ? 'you' : ''}"><span class="rank">${e.rank}</span><span>${esc(e.name)}${e.live ? '<span class="live">playing</span>' : ''}</span><span class="score">${e.streak}</span></li>`).join('');
    slot.innerHTML = `<div class="board"><h3>${title}</h3>${rows ? `<ol>${rows}</ol>` : '<p class="empty">No one has finished a run yet. Be the first on the board.</p>'}</div>`;
  }

  // ---------- screens ----------
  function renderJoin() {
    const isArcade = mode === 'arcade';
    const tag = $('#join-mode-tag');
    tag.textContent = isArcade ? 'Arcade Mode' : 'Daily Mode';
    tag.classList.toggle('arcade', isArcade);
    $('#join-lede').textContent = isArcade
      ? 'Play as many times as you want. Two answers, one is right, and one miss ends your streak.'
      : 'Two answers, one is right. Everyone gets the same questions today, and one miss ends your run.';
    show('join');
  }

  function renderReady() {
    const isArcade = mode === 'arcade';
    const tag = $('#ready-mode-tag');
    tag.textContent = isArcade ? 'Arcade Mode' : 'Daily Mode';
    tag.classList.toggle('arcade', isArcade);

    const bestEl = $('#ready-best');
    const best = state.personalBest ?? state.stats?.arcade?.bestStreak ?? 0;
    bestEl.hidden = !isArcade || !best;
    if (isArcade && best) bestEl.textContent = `Best: ${best}`;

    $('#ready-lede').textContent = isArcade
      ? `Ready for Arcade, ${state.player.name}? Play as many runs as you want — one miss ends your streak.`
      : `Welcome back, ${state.player.name}. Today's questions are up. One miss ends your run.`;

    $('#ready-fine').hidden = isArcade;
    show('ready');
    renderBoard($('#screen-ready .board-slot'));
  }

  function renderOver({ newBest = false } = {}) {
    const isArcade = mode === 'arcade';
    const n = state.run.streak;
    const tag = $('#over-mode-tag');
    tag.textContent = isArcade ? 'Arcade Mode' : 'Daily Mode';
    tag.classList.toggle('arcade', isArcade);

    $('#over-new-best').hidden = !(isArcade && newBest);
    $('#result-num').textContent = n;
    if (isArcade) {
      $('#result-text').textContent = n === 0
        ? 'Out on the first question. Flip again for another run!'
        : `${n} in a row in Arcade!`;
    } else {
      $('#result-text').textContent =
        state.run.status === 'perfect' ? 'Perfect run. You cleared every question today.'
        : n === 0 ? 'Out on the first question. A new chain starts tomorrow.'
        : `${n} in a row today. A new chain starts tomorrow.`;
    }

    $('#play-again-btn').hidden = !isArcade;
    $('#switch-arcade-btn').hidden = isArcade;
    $('#over-fine').hidden = isArcade;
    $('#share-btn').className = isArcade ? 'secondary' : 'primary';

    statsTab = mode;
    const statsSlot = $('#over-stats-slot');
    statsSlot.innerHTML = buildStatsHtml(state.stats, statsTab, { highlightLatest: true });
    wireStatsContainer(statsSlot, { highlightLatest: true });

    show('over');
    renderBoard($('#screen-over .board-slot'));
  }

  // Fills the play screen and starts the clock. Does not change which screen is visible.
  function renderQuestion(q) {
    locked = false;
    clearPlayTimers();
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
    expiryTimeout = setTimeout(onExpired, q.secondsLeft * 1000 + 1900);
  }

  async function onExpired() {
    if (locked) return;
    locked = true;
    const endpoint = mode === 'arcade' ? '/api/arcade/state' : '/api/state';
    const s = await api(endpoint);
    state = s;
    renderChrome();
    if (s.reveal) reveal(s.reveal.correctIndex, null, false, () => renderOver());
    else if (s.question) { locked = false; renderQuestion(s.question); }
    else renderOver();
  }

  function reveal(correctIndex, pickedIndex, wasCorrect, done) {
    $('#pic-img').getAnimations().forEach((a) => a.cancel());
    const choices = $('#choices');
    choices.classList.add('revealed');
    choices.querySelectorAll('.choice').forEach((btn, i) => {
      btn.disabled = true;
      btn.classList.add(i === correctIndex ? 'right' : 'wrong');
      if (i === pickedIndex && !wasCorrect) btn.classList.add('picked-wrong');
    });
    revealTimeout = setTimeout(done, REVEAL_MS);
  }

  async function onPick(i) {
    if (locked) return;
    locked = true;
    clearPlayTimers();
    const endpoint = mode === 'arcade' ? '/api/arcade/answer' : '/api/answer';
    const r = await api(endpoint, { choice: i });
    if (r.error) { locked = false; return load(); }
    state.run.streak = r.streak;
    if (r.stats) state.stats = r.stats;
    if (typeof r.personalBest === 'number') state.personalBest = r.personalBest;
    if (r.correct) {
      const b = $('#streak-num');
      b.textContent = r.streak; b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump');
    }
    if (r.next) preload(r.next.image);
    reveal(r.correctIndex, i, r.correct, () => {
      if (r.over) {
        state.run.status = r.perfect ? 'perfect' : 'out';
        if (mode === 'daily') dailySummary = state;
        else arcadeSummary = state;
        renderChrome();
        renderOver({ newBest: Boolean(r.newBest) });
      } else {
        renderQuestion(r.next);
      }
    });
  }

  // ---------- the coin toss into the first question ----------
  const currentHome = () => [screens.join, screens.ready, screens.over].find((el) => !el.hidden);

  async function flipIntoGame(begin) {
    if (flipping) return;
    flipping = true;
    document.body.classList.add('is-flipping');
    const from = currentHome();
    from?.classList.add('leaving');

    let s;
    try {
      await FF.toss();
      const slow = setTimeout(() => FF.setNote(mode === 'arcade' ? 'Shuffling arcade questions…' : "Shuffling today's questions…"), 1500);
      s = await begin();
      clearTimeout(slow);
      if (!s?.question) throw new Error('No question returned');
      await preload(s.question.image);
    } catch (err) {
      console.error(err);
      FF.abort();
      from?.classList.remove('leaving');
      document.body.classList.remove('is-flipping');
      toast("Couldn't start the game. Try again in a moment.");
      flipping = false;
      return;
    }

    state = s;
    if (mode === 'daily') dailySummary = s;
    else arcadeSummary = s;
    if (s.resetsInMs) resetAt = Date.now() + s.resetsInMs;
    renderChrome();
    renderQuestion(s.question);

    const play = screens.play;
    const radius = Math.hypot(innerWidth, innerHeight) / 2 + 30;
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
    document.body.classList.remove('is-flipping');
    flipping = false;
  }

  // ---------- auth modal & account actions ----------
  function setAuthTab(next) {
    authTab = next;
    document.querySelectorAll('[data-auth-tab]').forEach((b) => b.classList.toggle('active', b.dataset.authTab === next));
    $('#auth-name-wrap').hidden = next !== 'register';
    $('#auth-password').autocomplete = next === 'register' ? 'new-password' : 'current-password';
    $('#auth-submit').textContent = next === 'register' ? 'Create account' : 'Sign in';
    $('#auth-error').hidden = true;
  }

  function openAuthModal() {
    setAuthTab('login');
    $('#google-note').hidden = true;
    $('#auth-error').hidden = true;
    openModal('auth-modal');
  }

  async function handleLogout() {
    await api('/api/auth/logout', {});
    closeDrawer();
    dailySummary = null;
    arcadeSummary = null;
    mode = 'daily';
    toast('Signed out');
    await load();
  }

  // ---------- boot & mode switching ----------
  async function load(targetMode = mode) {
    mode = targetMode;
    clearPlayTimers();
    const endpoint = mode === 'arcade' ? '/api/arcade/state' : '/api/state';
    state = await api(endpoint);
    if (mode === 'daily') dailySummary = state;
    else arcadeSummary = state;

    if (state.resetsInMs) resetAt = Date.now() + state.resetsInMs;
    renderChrome();

    if (!state.player) return renderJoin();
    if (state.question) { renderQuestion(state.question); return show('play'); }
    if (state.run && (mode === 'daily' || state.reveal)) return renderOver();
    renderReady();
  }

  function switchMode(nextMode) {
    closeDrawer();
    if (nextMode === mode && !screens.play.hidden) return;
    load(nextMode);
  }

  // ---------- event wiring ----------
  $('#menu-btn').addEventListener('click', openDrawer);
  $('#drawer-close').addEventListener('click', closeDrawer);
  $('#drawer-backdrop').addEventListener('click', closeDrawer);
  $('#nav-daily').addEventListener('click', () => switchMode('daily'));
  $('#nav-arcade').addEventListener('click', () => switchMode('arcade'));
  $('#nav-stats').addEventListener('click', () => openStatsModal(mode));
  $('#top-stats-btn').addEventListener('click', () => openStatsModal(mode));
  $('#top-account-btn').addEventListener('click', () => {
    if (state?.player && !state.player.isGuest) openStatsModal(mode);
    else openAuthModal();
  });

  $('#nav-rename').addEventListener('click', () => {
    closeDrawer();
    $('#rename-input').value = state?.player?.name || '';
    openModal('rename-modal');
    $('#rename-input').focus();
  });
  $('#rename-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#rename-input').value.trim();
    if (!name) return;
    await api('/api/join', { name });
    closeModal('rename-modal');
    toast('Name updated');
    load();
  });

  document.querySelectorAll('[data-close]').forEach((el) => {
    el.addEventListener('click', () => closeModal(el.dataset.close));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeDrawer();
      closeModal('stats-modal');
      closeModal('auth-modal');
      closeModal('rename-modal');
    }
  });

  $('#join-signin-btn').addEventListener('click', openAuthModal);
  document.querySelectorAll('[data-auth-tab]').forEach((b) => {
    b.addEventListener('click', () => setAuthTab(b.dataset.authTab));
  });

  $('#google-auth-btn').addEventListener('click', () => {
    if (state?.googleEnabled) {
      location.href = '/auth/google';
      return;
    }
    const note = $('#google-note');
    note.textContent = 'Google OAuth is not configured on this server yet (add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env). You can create an account with your Gmail address below.';
    note.hidden = false;
  });

  $('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = $('#auth-error');
    errEl.hidden = true;
    const email = $('#auth-email').value.trim();
    const password = $('#auth-password').value;
    const name = $('#auth-name').value.trim();
    const endpoint = authTab === 'register' ? '/api/auth/register' : '/api/auth/login';
    const res = await api(endpoint, authTab === 'register' ? { email, password, name } : { email, password });
    if (res.error) {
      errEl.textContent = res.error;
      errEl.hidden = false;
      return;
    }
    closeModal('auth-modal');
    $('#auth-password').value = '';
    toast(authTab === 'register' ? 'Account created & stats linked!' : `Welcome back, ${res.player.name}!`);
    await load();
  });

  $('#join-btn').addEventListener('click', async () => {
    const name = $('#name').value.trim();
    if (!name) return $('#name').focus();
    const startPath = mode === 'arcade' ? '/api/arcade/start' : '/api/start';
    flipIntoGame(async () => {
      await api('/api/join', { name });
      return api(startPath, {});
    });
  });
  $('#name').addEventListener('keydown', (e) => e.key === 'Enter' && $('#join-btn').click());

  $('#flip-btn').addEventListener('click', () => {
    const startPath = mode === 'arcade' ? '/api/arcade/start' : '/api/start';
    flipIntoGame(() => api(startPath, {}));
  });

  $('#play-again-btn').addEventListener('click', () => {
    flipIntoGame(() => api('/api/arcade/start', {}));
  });
  $('#switch-arcade-btn').addEventListener('click', () => switchMode('arcade'));

  document.querySelectorAll('.choice').forEach((btn) => btn.addEventListener('click', () => onPick(Number(btn.dataset.i))));

  $('#share-btn').addEventListener('click', async (e) => {
    const n = state.run.streak;
    const text = mode === 'arcade'
      ? `Fifty Fifty Arcade\n${n} in a row\n${location.origin}`
      : `Fifty Fifty ${state.date}\n${n} in a row${state.run.status === 'perfect' ? ' (perfect!)' : ''}\n${location.origin}`;
    try { await navigator.clipboard.writeText(text); e.target.textContent = 'Copied'; } catch { e.target.textContent = 'Copy failed'; }
    setTimeout(() => (e.target.textContent = 'Copy result'), 1800);
  });

  // Check OAuth callback query flags
  const params = new URLSearchParams(location.search);
  if (params.get('auth') === 'google') {
    toast('Signed in with Google!');
    history.replaceState({}, '', '/');
  } else if (params.get('auth_error')) {
    const reason = params.get('auth_error');
    const msg = reason === 'cancelled'
      ? 'Google sign-in was cancelled.'
      : reason === 'google_not_configured'
        ? 'Google OAuth is not configured on this server.'
        : 'Could not complete Google sign-in. Try again.';
    toast(msg);
    history.replaceState({}, '', '/');
  }

  load('daily');
})();
