// hud.js — DOM HUD for HELIOS RELAY. main.js pushes numbers in, reads callbacks out.
// No simulation logic here; every setter is change-guarded to avoid redundant writes.
export function createHud(callbacks = {}) {
  const $ = (id) => document.getElementById(id);
  const el = {
    game: $('game'), hud: $('hud'), crosshair: $('crosshair'), hitmarker: $('hitmarker'),
    ammo: $('ammo'), ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'), weaponName: $('weapon-name'),
    healthWrap: $('health-wrap'), healthNum: $('health-num'), healthBar: $('health-bar'),
    healthFill: $('health-fill'), armorPips: $('armor-pips'), money: $('money'),
    topbar: $('topbar'), timer: $('timer'), score: $('score'), scoreVan: $('score-van'),
    scoreSen: $('score-sen'), roundNum: $('round-num'), alive: $('alive'),
    aliveVan: $('alive-van'), aliveSen: $('alive-sen'), killfeed: $('killfeed'),
    spikeStatus: $('spike-status'), spikeTimer: $('spike-timer'), spikeBar: $('spike-bar'),
    spikeFill: document.querySelector('#spike-bar .fill'),
    plantRing: $('plant-ring'), hint: $('hint'), banner: $('banner'),
    bannerTitle: $('banner-title'), bannerSub: $('banner-sub'), vignette: $('vignette'),
    scopeOverlay: $('scope-overlay'), buyMenu: $('buy-menu'), buyGrid: $('buy-grid'),
    buyMoney: $('buy-money'), overlay: $('overlay'), overlayTitle: $('overlay-title'),
    overlayCopy: $('overlay-copy'), play: $('play'),
  };
  const last = { hp: -1, armor: -1, mag: -1, reserve: -1, name: '', money: -1, timer: '', planted: null,
    van: -1, sen: -1, round: -1, va: -1, sa: -1, vt: -1, st: -1, spike: '', fuse: -1, prog: -1,
    buyMoney: -1, hint: null, scoped: null };
  let hitTimer = 0, dirTimer = 0, flashTimer = 0, mode = 'start';
  const call = (fn, ...args) => { if (typeof fn === 'function') fn(...args); };

  function setHealth(hp, armor) {
    const h = Math.max(0, Math.round(hp));
    if (h !== last.hp) { el.healthNum.textContent = h; el.healthFill.style.width = h + '%'; last.hp = h; }
    if (armor !== last.armor) {
      const pips = Math.max(0, Math.min(4, Math.round(armor / 25)));
      el.armorPips.textContent = '■'.repeat(pips) + '□'.repeat(4 - pips);
      last.armor = armor;
    }
    el.healthWrap.classList.toggle('low', h < 30);
    el.healthFill.classList.toggle('low', h < 30);
  }

  function setAmmo(mag, reserve, name) {
    if (mag !== last.mag) { el.ammoMag.textContent = mag; last.mag = mag; }
    if (reserve !== last.reserve) { el.ammoReserve.textContent = '/ ' + reserve; last.reserve = reserve; }
    if (name !== undefined && name !== last.name) { el.weaponName.textContent = name; last.name = name; }
    el.ammo.classList.toggle('empty', mag === 0);
  }

  function setMoney(m) {
    if (m !== last.money) { el.money.textContent = '$' + m; last.money = m; }
  }

  function setTimer(sec, planted) {
    const s = Math.max(0, Math.ceil(sec));
    const text = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    if (text !== last.timer) { el.timer.textContent = text; last.timer = text; }
    el.timer.classList.toggle('danger', s < 10 || !!planted);
  }

  function setScore(van, sen, round) {
    if (van !== last.van) { el.scoreVan.textContent = van; last.van = van; }
    if (sen !== last.sen) { el.scoreSen.textContent = sen; last.sen = sen; }
    if (round !== last.round) { el.roundNum.textContent = 'ROUND ' + round; last.round = round; }
  }

  function buildDots(container, aliveCount, total) {
    container.innerHTML = '';
    for (let i = 0; i < total; i++) {
      const s = document.createElement('span');
      s.className = i < aliveCount ? 'pip' : 'pip dead';
      container.appendChild(s);
    }
  }
  function setAlive(vanAlive, senAlive, vanTotal, senTotal) {
    if (vanAlive === last.va && senAlive === last.sa && vanTotal === last.vt && senTotal === last.st) return;
    last.va = vanAlive; last.sa = senAlive; last.vt = vanTotal; last.st = senTotal;
    buildDots(el.aliveVan, vanAlive, vanTotal);
    buildDots(el.aliveSen, senAlive, senTotal);
  }

  function setSpike(status, fuse, progress) {
    const visible = status === 'planted' || status === 'planting' || status === 'defusing';
    el.spikeStatus.hidden = !visible;
    if (!visible) return;
    const f = status === 'planted' ? fuse.toFixed(1) : '';
    if (f !== last.fuse) { el.spikeTimer.textContent = f; last.fuse = f; }
    const pct = status === 'planted' ? Math.max(0, Math.min(100, fuse / 35 * 100))
      : Math.max(0, Math.min(100, (progress || 0) * 100));
    if (el.spikeFill) el.spikeFill.style.width = pct + '%';
  }

  function hitMarker(killed, holdMs = 90) {
    el.hitmarker.classList.add('show');
    el.hitmarker.classList.toggle('kill', !!killed);
    clearTimeout(hitTimer);
    hitTimer = setTimeout(() => el.hitmarker.classList.remove('show', 'kill'), holdMs);
  }

  function killFeed(text) {
    const line = document.createElement('div');
    line.textContent = text;
    el.killfeed.prepend(line);
    while (el.killfeed.children.length > 5) el.killfeed.lastChild.remove();
    setTimeout(() => { line.classList.add('fade'); setTimeout(() => line.remove(), 600); }, 4000);
  }

  function showBanner(title, sub) {
    el.bannerTitle.textContent = title;
    el.bannerSub.textContent = sub || '';
    el.banner.hidden = false;
  }
  function hideBanner() { el.banner.hidden = true; }

  function showOverlay(nextMode, data = {}) {
    mode = nextMode;
    const copy = {
      start: ['HELIOS RELAY', 'A complete round-based tactical FPS: plant the spike, buy, outplay the bots. Click to play.', 'Click to play'],
      paused: ['Paused', 'Click to resume.', 'Click to resume'],
      end: [data.title || 'Match over', data.copy || '', 'Play again'],
    }[nextMode] || ['HELIOS RELAY', '', 'Click to play'];
    el.overlayTitle.textContent = copy[0];
    el.overlayCopy.textContent = copy[1];
    el.play.textContent = copy[2];
    el.overlay.hidden = false;
    el.play.focus();
  }
  function hideOverlay() { el.overlay.hidden = true; }

  el.play.addEventListener('click', () => {
    if (mode === 'end') call(callbacks.onRematch);
    else call(callbacks.onPlay);
  });

  function showBuy(items, money) {
    el.buyGrid.innerHTML = '';
    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'item' + (money < item.price ? ' poor' : '') + (item.owned ? ' owned' : '');
      const key = document.createElement('span'); key.className = 'key'; key.textContent = item.key || '';
      const name = document.createElement('span'); name.textContent = item.name;
      const price = document.createElement('span'); price.className = 'price'; price.textContent = '$' + item.price;
      row.append(key, name, price);
      row.addEventListener('click', () => call(callbacks.onBuy, item.id));
      el.buyGrid.appendChild(row);
    }
    setBuyMoney(money);
    el.buyMenu.hidden = false;
  }
  function hideBuy() { el.buyMenu.hidden = true; }
  function setBuyMoney(m) {
    if (m !== last.buyMoney) { el.buyMoney.textContent = '$' + m; last.buyMoney = m; }
  }
  // Close-buy affordance: Escape is handled by main.js via input; also expose via callback on buy-menu click-outside.
  el.buyMenu.addEventListener('click', (e) => { if (e.target === el.buyMenu) call(callbacks.onCloseBuy); });

  function setCrosshair(gapPx) { el.crosshair.style.setProperty('--gap', gapPx + 'px'); }

  function damageDir(angleRad) {
    el.vignette.style.setProperty('--dir', angleRad + 'rad');
    el.vignette.classList.add('show');
    clearTimeout(dirTimer);
    dirTimer = setTimeout(() => el.vignette.classList.remove('show'), 250);
  }

  function flashVignette() {
    el.vignette.classList.add('show');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => el.vignette.classList.remove('show'), 400);
  }

  function setScoped(on) {
    if (on === last.scoped) return;
    last.scoped = on;
    el.scopeOverlay.hidden = !on;
  }

  function setPlantProgress(p) {
    const show = p > 0 && p < 1;
    el.plantRing.hidden = !show;
    if (!show) return;
    const fg = el.plantRing.querySelector('.ring-fg') || el.plantRing;
    if (fg.style) fg.style.strokeDashoffset = String(188.5 * (1 - p));
  }

  function setHint(text) {
    if (text === last.hint) return;
    last.hint = text;
    el.hint.textContent = text || '';
    el.hint.hidden = !text;
  }

  return { setHealth, setAmmo, setMoney, setTimer, setScore, setAlive, setSpike, hitMarker,
    killFeed, showBanner, hideBanner, showOverlay, hideOverlay, showBuy, hideBuy, setBuyMoney,
    setCrosshair, damageDir, flashVignette, setScoped, setPlantProgress, setHint, el };
}
