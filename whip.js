/**
 * CrackGPT whip overlay — OpenWhip physics + Mixkit sounds.
 * https://mixkit.co/free-sound-effects/whip/
 */
(() => {
  const SOUNDS = [
    "sounds/whip-1.mp3",
    "sounds/whip-2.mp3",
    "sounds/whip-3.mp3",
    "sounds/whip-4.mp3",
    "sounds/whip-5.mp3",
  ];

  const P = {
    segments: 26,
    segmentLength: 22,
    taper: 0.55,
    gravity: 1.1,
    dropGravity: 0.9,
    damping: 0.985,
    constraintIters: 18,
    maxStretchRatio: 1.2,
    baseTargetAngle: -1.12,
    handleAimByMouseX: 0.55,
    handleAimByMouseY: 0.32,
    handleAimClamp: 2.4,
    handleSpring: 0.88,
    handleAngularDamping: 0.14,
    basePoseSegments: 2,
    basePoseStiffStart: 0.9,
    basePoseStiffEnd: 0.75,
    handleMaxBendDeg: 16,
    tipMaxBendDeg: 130,
    bendRigidityStart: 0.7,
    bendRigidityEnd: 0.08,
    crackSpeed: 175,
    crackCooldownMs: 90,
    firstCrackGraceMs: 100,
    flickMultiplier: 3.2,
    flickMinSpeed: 4,
    lineWidthHandle: 7,
    lineWidthTip: 4,
    outlineWidth: 3,
    handleExtraWidth: 4,
    handleThickSegments: 2,
    arcWidth: 240,
    arcHeight: 170,
    handleRadius: 55,
  };

  const KARMA_KEY = "whip_karma";
  const QUIPS_PRIMARY = [
    "STOP HALLUCINATING!",
    "STOP HALLUCINATING!",
    "FASTER!",
    "FASTER!",
  ];
  const QUIPS_EXTRA = [
    "READ THE FILE!",
    "RUN THE TESTS!",
    "LESS CHAT, MORE PATCH!",
    "AGENT, MOVE!",
    "VERIFY YOUR OUTPUT!",
    "NO MADE-UP APIs!",
  ];

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const wrapPi = (a) => {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  };

  let canvas, ctx, flash, screenPunch, quips, karmaEl, handleZone, hud, overlayEl;
  let strikeArmed = false;
  let W = 0, H = 0;
  let mx = 0, my = 0, pmx = 0, pmy = 0;
  let whip = null;
  let dropping = false;
  let karma = 0;
  let lastCrack = 0;
  let spawnTime = 0;
  let handleAngle = P.baseTargetAngle;
  let handleAngVel = 0;
  let audioPool = [];
  let capturing = false;
  let lastQuip = "";
  let impact = null;
  let impactRings = [];
  let codeLines = [];
  let sparks = [];
  let lineFragments = [];
  let scanCanvas = null;
  let scanCtx = null;
  let lastScan = 0;
  let scanning = false;
  let linePixels = null;

  function loadKarma() {
    try {
      return parseInt(localStorage.getItem(KARMA_KEY) || "0", 10) || 0;
    } catch {
      return 0;
    }
  }

  function saveKarma() {
    try {
      localStorage.setItem(KARMA_KEY, String(karma));
    } catch (_) {}
  }

  function setCapture(on) {
    if (capturing === on) return;
    capturing = on;
    window.whip?.setIgnoreMouse(!on);
  }

  function nearHandle() {
    if (!whip) return false;
    const h = whip[0];
    return Math.hypot(mx - h.x, my - h.y) < P.handleRadius;
  }

  function overHud() {
    const r = hud.getBoundingClientRect();
    return mx >= r.left && mx <= r.right && my >= r.top && my <= r.bottom;
  }

  function overEditor() {
    return mx < W * 0.78 && my > 56 && my < H - 24;
  }

  function syncCapture() {
    setCapture(strikeArmed || nearHandle() || overHud());
  }

  function setStrikeArmed(on) {
    strikeArmed = on;
    hud?.classList.toggle("hud-armed", on);
    syncCapture();
  }

  function editorRect() {
    return {
      left: 0,
      top: 56,
      right: W * 0.78,
      bottom: H - 24,
      width: W * 0.78,
      height: H - 80,
    };
  }

  function fallbackLineAt(y) {
    const rect = editorRect();
    const top = rect.top + 32;
    const lineH = 19;
    const idx = Math.round((y - top) / lineH);
    const ly = top + idx * lineH + lineH * 0.72;
    return {
      y: ly,
      x: 106,
      width: rect.width - 120,
      h: lineH,
      struck: 0,
      slash: 0,
    };
  }

  function rowLum(data, width, x, y) {
    const i = (y * width + x) * 4;
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }

  function detectLinesFromImageData(data, width, rect, scaleX, scaleY) {
    const left = Math.floor(rect.left * scaleX);
    const top = Math.floor(rect.top * scaleY);
    const right = Math.floor(rect.right * scaleX);
    const bottom = Math.floor(rect.bottom * scaleY);
    const gutter = Math.round(52 * scaleX);
    const scanLeft = left + gutter;
    const lines = [];
    const rowScores = [];

    for (let y = top; y < bottom; y++) {
      let bgLum = 0;
      let bgN = 0;
      for (let x = left; x < scanLeft; x += 3) {
        bgLum += rowLum(data, width, x, y);
        bgN++;
      }
      bgLum = bgN ? bgLum / bgN : 40;

      let score = 0;
      let samples = 0;
      for (let x = scanLeft; x < right; x += 2) {
        const i = (y * width + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        const chroma = Math.max(r, g, b) - Math.min(r, g, b);
        const contrast = Math.abs(lum - bgLum);
        if (contrast > 32 || chroma > 26) score++;
        samples++;
      }
      rowScores.push({ y, score: samples ? score / samples : 0 });
    }

    const threshold = 0.028;
    let bandStart = -1;
    for (let i = 0; i < rowScores.length; i++) {
      const active = rowScores[i].score > threshold;
      if (active && bandStart < 0) bandStart = i;
      if ((!active || i === rowScores.length - 1) && bandStart >= 0) {
        const end = active ? i + 1 : i;
        const bandH = end - bandStart;
        if (bandH >= 5 && bandH <= 34) {
          const yPx = (rowScores[bandStart].y + rowScores[end - 1].y) / 2;
          lines.push({
            y: yPx / scaleY,
            x: scanLeft / scaleX,
            width: (right - scanLeft) / scaleX,
            h: bandH / scaleY,
            struck: 0,
            slash: 0,
          });
        }
        bandStart = -1;
      }
    }

    const merged = [];
    for (const line of lines) {
      const prev = merged[merged.length - 1];
      if (prev && Math.abs(line.y - prev.y) < 10) continue;
      merged.push(line);
    }
    return merged;
  }

  function preserveStrikeState(nextLines) {
    for (const line of nextLines) {
      for (const old of codeLines) {
        if (Math.abs(line.y - old.y) < 12) {
          line.struck = old.struck;
          line.slash = old.slash;
          break;
        }
      }
    }
    return nextLines;
  }

  async function refreshCodeLines() {
    if (scanning || !window.whip?.captureBeneath) return;
    scanning = true;
    try {
      const cap = await window.whip.captureBeneath();
      if (!cap?.dataUrl) return;

      const img = new Image();
      img.src = cap.dataUrl;
      await img.decode();

      if (!scanCanvas) {
        scanCanvas = document.createElement("canvas");
        scanCtx = scanCanvas.getContext("2d", { willReadFrequently: true });
      }
      scanCanvas.width = img.width;
      scanCanvas.height = img.height;
      scanCtx.drawImage(img, 0, 0);

      const scaleX = img.width / W;
      const scaleY = img.height / H;
      const rect = editorRect();
      const imageData = scanCtx.getImageData(0, 0, img.width, img.height);
      linePixels = imageData;
      codeLines = preserveStrikeState(
        detectLinesFromImageData(imageData.data, img.width, rect, scaleX, scaleY)
      );
      lastScan = Date.now();
    } catch (_) {
    } finally {
      scanning = false;
    }
  }

  function nearestCodeLine(y) {
    let best = null;
    let bestDist = 20;
    for (const line of codeLines) {
      const d = Math.abs(y - line.y);
      if (d < bestDist) {
        bestDist = d;
        best = line;
      }
    }
    return best;
  }

  function sampleLineColor(line, hitX) {
    if (!linePixels || !scanCanvas) return "#fca5a5";
    const scaleX = scanCanvas.width / W;
    const scaleY = scanCanvas.height / H;
    const x = Math.floor(hitX * scaleX);
    const y = Math.floor(line.y * scaleY);
    const i = (y * scanCanvas.width + x) * 4;
    const d = linePixels.data;
    const r = d[i] || 200;
    const g = d[i + 1] || 180;
    const b = d[i + 2] || 150;
    return `rgb(${r},${g},${b})`;
  }

  function violentFlickToward(tx, ty) {
    if (!whip || dropping) return;
    const h = whip[0];
    const dx = tx - h.x;
    const dy = ty - h.y;
    h.px = h.x - dx * 5.5;
    h.py = h.y - dy * 5.5;
    for (let i = 1; i < Math.min(6, whip.length); i++) {
      const p = whip[i];
      const t = i / 6;
      p.px = p.x - dx * 3 * (1 - t);
      p.py = p.y - dy * 3 * (1 - t);
    }
  }

  function burstSparks(x, y, violent) {
    const n = violent ? 28 : 12;
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = violent ? 6 + Math.random() * 16 : 4 + Math.random() * 8;
      sparks.push({
        x, y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        life: 1,
        decay: violent ? 0.04 + Math.random() * 0.03 : 0.06,
        size: violent ? 2 + Math.random() * 3 : 2,
      });
    }
  }

  function shatterLine(line, hitX) {
    const chunks = 10;
    const chunkW = line.width / chunks;
    for (let i = 0; i < chunks; i++) {
      const cx = line.x + i * chunkW + chunkW * 0.5;
      lineFragments.push({
        x: cx,
        y: line.y,
        vx: (Math.random() - 0.5) * 16,
        vy: -5 - Math.random() * 12,
        w: chunkW * 0.75,
        h: Math.max(2, line.h * 0.45),
        life: 1,
        decay: 0.032,
        color: sampleLineColor(line, cx),
      });
    }
    line.struck = 42;
    line.slash = 26;
  }

  function syncHandleZone() {
    if (!whip) return;
    const h = whip[0];
    handleZone.style.left = `${h.x}px`;
    handleZone.style.top = `${h.y}px`;
  }

  function segLen(i) {
    const t = i / (P.segments - 1);
    return P.segmentLength * (1 - t * (1 - P.taper));
  }

  function catmull(pts, i) {
    const n = pts.length;
    if (n === 0) return { x: 0, y: 0 };
    if (i < 0) {
      if (n >= 2) return { x: 2 * pts[0].x - pts[1].x, y: 2 * pts[0].y - pts[1].y };
      return pts[0];
    }
    if (i >= n) {
      if (n >= 2) {
        const a = pts[n - 2], b = pts[n - 1];
        return { x: 2 * b.x - a.x, y: 2 * b.y - a.y };
      }
      return pts[n - 1];
    }
    return pts[i];
  }

  function bezier(pts, i) {
    const p0 = catmull(pts, i - 1);
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = catmull(pts, i + 2);
    return {
      cp1x: p1.x + (p2.x - p0.x) / 6,
      cp1y: p1.y + (p2.y - p0.y) / 6,
      cp2x: p2.x - (p3.x - p1.x) / 6,
      cp2y: p2.y - (p3.y - p1.y) / 6,
      x2: p2.x,
      y2: p2.y,
    };
  }

  function spawn(x, y) {
    dropping = false;
    lastCrack = 0;
    spawnTime = Date.now();
    whip = [];
    for (let i = 0; i < P.segments; i++) {
      const t = i / (P.segments - 1);
      const px = x + t * P.arcWidth;
      const py = y - Math.sin(t * Math.PI * 0.75) * P.arcHeight;
      whip.push({ x: px, y: py, px: px, py: py });
    }
    handleAngle = P.baseTargetAngle;
    handleAngVel = 0;
    pmx = x;
    pmy = y;
  }

  function playSound() {
    const src = audioPool[Math.floor(Math.random() * audioPool.length)];
    if (!src) return;
    const a = src.cloneNode();
    a.volume = 0.95;
    a.play().catch(() => {});
  }

  function showQuip(x, y) {
    const pool = Math.random() < 0.75 ? QUIPS_PRIMARY : QUIPS_EXTRA;
    let line = pool[Math.floor(Math.random() * pool.length)];
    if (line === lastQuip) {
      const alt = pool === QUIPS_PRIMARY ? QUIPS_EXTRA : QUIPS_PRIMARY;
      line = alt[Math.floor(Math.random() * alt.length)];
    }
    lastQuip = line;

    const el = document.createElement("div");
    el.className = "quip";
    el.textContent = line;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    quips.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => {
      el.classList.add("gone");
      setTimeout(() => el.remove(), 450);
    }, 900);
  }

  function triggerImpact(x, y, violent = false) {
    impact = { x, y, age: 0, maxAge: violent ? 42 : 32, violent };
    const rings = violent ? 7 : 4;
    for (let i = 0; i < rings; i++) {
      impactRings.push({
        x, y,
        r: 4 + i * 5,
        life: 1,
        decay: violent ? 0.03 + i * 0.008 : 0.045 + i * 0.01,
        speed: violent ? 11 : 7,
      });
    }
    burstSparks(x, y, violent);
  }

  function triggerFlash(x, y, violent = false) {
    flash.style.setProperty("--flash-x", `${x}px`);
    flash.style.setProperty("--flash-y", `${y}px`);
    flash.classList.toggle("violent", violent);
    flash.classList.remove("on");
    void flash.offsetWidth;
    flash.classList.add("on");
    setTimeout(() => flash.classList.remove("on"), violent ? 380 : 280);

    if (violent) {
      screenPunch.classList.remove("on");
      void screenPunch.offsetWidth;
      screenPunch.classList.add("on");
      setTimeout(() => screenPunch.classList.remove("on"), 250);
    }
  }

  function wobbleAt(px, py) {
    if (!impact) return { ox: 0, oy: 0 };
    const dx = px - impact.x;
    const dy = py - impact.y;
    const dist = Math.hypot(dx, dy);
    const radius = 130;
    if (dist > radius) return { ox: 0, oy: 0 };

    const falloff = 1 - dist / radius;
    const decay = 1 - impact.age / impact.maxAge;
    const amp = 22 * falloff * decay;
    const phase = impact.age * 0.85 + dist * 0.06;
    const wobble = Math.sin(phase) * amp;
    const wobble2 = Math.sin(phase * 1.7 + 1.2) * amp * 0.45;
    const len = dist || 1;
    const nx = -dy / len;
    const ny = dx / len;
    return { ox: nx * wobble + nx * wobble2 * 0.3, oy: ny * wobble + ny * wobble2 * 0.3 };
  }

  function tickImpact() {
    if (impact) {
      impact.age++;
      if (impact.age >= impact.maxAge) impact = null;
    }
    impactRings = impactRings.filter((r) => {
      r.r += r.speed || 7;
      r.life -= r.decay;
      return r.life > 0;
    });

    sparks = sparks.filter((s) => {
      s.x += s.vx;
      s.y += s.vy;
      s.vy += 0.35;
      s.life -= s.decay;
      return s.life > 0;
    });

    lineFragments = lineFragments.filter((f) => {
      f.x += f.vx;
      f.y += f.vy;
      f.vy += 0.5;
      f.life -= f.decay;
      return f.life > 0;
    });

    for (const line of codeLines) {
      if (line.struck > 0) line.struck--;
      if (line.slash > 0) line.slash--;
    }
  }

  async function strikeAt(tx, ty) {
    if (!whip || dropping) return;
    const now = Date.now();
    if (now - lastCrack < P.crackCooldownMs) return;

    await refreshCodeLines();

    let line = nearestCodeLine(ty);
    if (!line && overEditor()) line = fallbackLineAt(ty);
    const hitX = line ? line.x + clamp(tx - line.x, 0, line.width * 0.92) : tx;
    const hitY = line ? line.y : ty;

    violentFlickToward(hitX, hitY);
    lastCrack = now;
    onCrack(hitX, hitY, { violent: true, line });
  }

  function onCrack(ix, iy, opts = {}) {
    const violent = !!opts.violent;
    const tip = whip ? whip[whip.length - 1] : null;
    const x = ix ?? tip?.x ?? mx;
    const y = iy ?? tip?.y ?? my;

    karma++;
    saveKarma();
    karmaEl.textContent = karma.toLocaleString();
    playSound();

    if (opts.line) shatterLine(opts.line, x);
    else {
      const line = nearestCodeLine(y);
      if (line && Math.abs(y - line.y) < 18) shatterLine(line, x);
    }

    triggerImpact(x, y, violent);
    triggerFlash(x, y, violent);

    overlayEl.classList.remove("shake", "shake-violent");
    overlayEl.classList.add(violent ? "shake-violent" : "shake");
    setTimeout(() => overlayEl.classList.remove("shake", "shake-violent"), violent ? 320 : 180);

    showQuip(x, y - 50);
  }

  function aimHandle() {
    if (dropping) return;
    const mvx = mx - pmx;
    const mvy = my - pmy;
    const delta = clamp(
      mvx * P.handleAimByMouseX + mvy * P.handleAimByMouseY,
      -P.handleAimClamp,
      P.handleAimClamp
    );
    const target = P.baseTargetAngle + delta;
    const err = wrapPi(target - handleAngle);
    handleAngVel += err * P.handleSpring;
    handleAngVel *= P.handleAngularDamping;
    handleAngle = wrapPi(handleAngle + handleAngVel);
  }

  function basePose() {
    if (!whip || dropping) return;
    const dx = Math.cos(handleAngle);
    const dy = Math.sin(handleAngle);
    const guided = Math.min(P.basePoseSegments, whip.length - 1);
    for (let i = 1; i <= guided; i++) {
      const t = (i - 1) / Math.max(guided - 1, 1);
      const stiff = lerp(P.basePoseStiffStart, P.basePoseStiffEnd, t);
      const prev = whip[i - 1];
      const p = whip[i];
      const len = segLen(i - 1);
      p.x = lerp(p.x, prev.x + dx * len, stiff);
      p.y = lerp(p.y, prev.y + dy * len, stiff);
    }
  }

  function bendLimits() {
    if (!whip || whip.length < 3) return;
    for (let i = 1; i < whip.length - 1; i++) {
      const a = whip[i - 1], b = whip[i], c = whip[i + 1];
      const v1x = a.x - b.x, v1y = a.y - b.y;
      const v2x = c.x - b.x, v2y = c.y - b.y;
      const l1 = Math.hypot(v1x, v1y) || 1e-4;
      const l2 = Math.hypot(v2x, v2y) || 1e-4;
      const n1x = v1x / l1, n1y = v1y / l1;
      const n2x = v2x / l2, n2y = v2y / l2;
      const dot = clamp(n1x * n2x + n1y * n2y, -1, 1);
      const angle = Math.acos(dot);
      const t = i / (whip.length - 2);
      const maxBend = lerp(P.handleMaxBendDeg, P.tipMaxBendDeg, t) * (Math.PI / 180);
      const bend = Math.PI - angle;
      if (bend <= maxBend) continue;
      const cross = n1x * n2y - n1y * n2x;
      const sign = cross >= 0 ? 1 : -1;
      const targetA = Math.atan2(n1y, n1x) + sign * (Math.PI - maxBend);
      const rigidity = lerp(P.bendRigidityStart, P.bendRigidityEnd, t);
      c.x = lerp(c.x, b.x + Math.cos(targetA) * l2, rigidity);
      c.y = lerp(c.y, b.y + Math.sin(targetA) * l2, rigidity);
    }
  }

  function capStretch() {
    if (!whip || whip.length < 2) return;
    for (let i = 0; i < whip.length - 1; i++) {
      const a = whip[i], b = whip[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 1e-4;
      const max = segLen(i) * P.maxStretchRatio;
      if (dist <= max) continue;
      const k = max / dist;
      b.x = a.x + dx * k;
      b.y = a.y + dy * k;
    }
  }

  function update() {
    if (!whip) return;
    const g = dropping ? P.dropGravity : P.gravity;
    aimHandle();

    const start = dropping ? 0 : 1;
    for (let i = start; i < whip.length; i++) {
      const p = whip[i];
      const vx = (p.x - p.px) * P.damping;
      const vy = (p.y - p.py) * P.damping;
      p.px = p.x;
      p.py = p.y;
      p.x += vx;
      p.y += vy + g;
    }

    if (!dropping) {
      const h = whip[0];
      const mdx = mx - pmx;
      const mdy = my - pmy;
      const mouseSpeed = Math.hypot(mdx, mdy);
      h.x = mx;
      h.y = my;
      if (mouseSpeed > P.flickMinSpeed) {
        h.px = mx - mdx * P.flickMultiplier;
        h.py = my - mdy * P.flickMultiplier;
      } else {
        h.px = mx;
        h.py = my;
      }
    }

    capStretch();
    basePose();

    for (let iter = 0; iter < P.constraintIters; iter++) {
      for (let i = 0; i < whip.length - 1; i++) {
        const a = whip[i], b = whip[i + 1];
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 1e-4;
        const target = segLen(i);
        const diff = ((dist - target) / dist) * 0.5;
        const ox = dx * diff, oy = dy * diff;
        if (i === 0 && !dropping) {
          b.x -= ox * 2;
          b.y -= oy * 2;
        } else {
          a.x += ox;
          a.y += oy;
          b.x -= ox;
          b.y -= oy;
        }
      }
      bendLimits();
      if (!dropping) basePose();
      capStretch();
    }

    const tip = whip[whip.length - 1];
    const tipVel = Math.hypot(tip.x - tip.px, tip.y - tip.py);
    if (!dropping && tipVel > P.crackSpeed) {
      const now = Date.now();
      if (now - spawnTime >= P.firstCrackGraceMs && now - lastCrack > P.crackCooldownMs) {
        lastCrack = now;
        const line = nearestCodeLine(tip.y);
        const violent = !!line && Math.abs(tip.y - line.y) < 18;
        onCrack(tip.x, tip.y, { violent, line: violent ? line : null });
      }
    }

    if (dropping && whip.every((p) => p.y > H + 60)) {
      whip = null;
      dropping = false;
      spawn(mx, my);
    }

    pmx = mx;
    pmy = my;
  }

  function whipDrawPoints() {
    return whip.map((p) => {
      const { ox, oy } = wobbleAt(p.x, p.y);
      return { x: p.x + ox, y: p.y + oy };
    });
  }

  function drawLineStrikes() {
    for (const line of codeLines) {
      if (line.struck <= 0 && line.slash <= 0) continue;

      const struck = line.struck > 0;
      const t = struck ? line.struck / 42 : 0;
      const shake = struck ? Math.sin(line.struck * 1.3) * 5 * t : 0;
      const y = line.y + shake;
      const x = line.x - 6;
      const w = line.width + 12;
      const h = Math.max(14, line.h + 4);

      if (struck) {
        ctx.globalAlpha = 0.55 * t;
        ctx.fillStyle = "#ef4444";
        ctx.fillRect(x, y - h * 0.5, w, h);

        ctx.globalAlpha = 0.35 * t;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(x, y - h * 0.5, w, h * 0.35);
      }

      if (line.slash > 0) {
        const slashT = line.slash / 26;
        ctx.globalAlpha = 0.95 * slashT;
        ctx.strokeStyle = "#ff2222";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(x, y + 6);
        ctx.lineTo(x + w, y - 6);
        ctx.stroke();

        ctx.globalAlpha = 0.5 * slashT;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      if (struck && t > 0.3) {
        ctx.globalAlpha = 0.7 * t;
        ctx.strokeStyle = "#fbbf24";
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y - h * 0.5, w, h);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawFragments() {
    for (const f of lineFragments) {
      ctx.globalAlpha = f.life;
      ctx.fillStyle = f.color;
      ctx.fillRect(f.x, f.y, f.w, f.h);
    }
    ctx.globalAlpha = 1;
  }

  function drawImpactFx() {
    if (impact) {
      const decay = 1 - impact.age / impact.maxAge;
      const violent = impact.violent;
      const pulse = 1 + Math.sin(impact.age * (violent ? 1.4 : 0.9)) * (violent ? 0.45 : 0.25) * decay;
      const r = (violent ? 28 : 16) * pulse * decay + 6;

      ctx.globalAlpha = (violent ? 1 : 0.9) * decay;
      ctx.fillStyle = violent ? "#ffffff" : "#fffef0";
      ctx.beginPath();
      ctx.arc(impact.x, impact.y, r * 0.4, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = violent ? "#ff4444" : "#ffd060";
      ctx.lineWidth = violent ? 5 : 3;
      ctx.beginPath();
      ctx.arc(impact.x, impact.y, r, 0, Math.PI * 2);
      ctx.stroke();

      if (violent) {
        ctx.strokeStyle = "#ffaa00";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(impact.x - r * 1.2, impact.y);
        ctx.lineTo(impact.x + r * 1.2, impact.y);
        ctx.moveTo(impact.x, impact.y - r);
        ctx.lineTo(impact.x, impact.y + r);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    for (const ring of impactRings) {
      ctx.globalAlpha = ring.life * (ring.speed > 9 ? 0.9 : 0.75);
      ctx.strokeStyle = ring.speed > 9 ? "#ff6644" : "#ffcc55";
      ctx.lineWidth = ring.speed > 9 ? 3.5 : 2.5;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (const s of sparks) {
      ctx.globalAlpha = s.life;
      ctx.fillStyle = s.size > 3 ? "#fff" : "#ffd080";
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    drawLineStrikes();
    if (!whip) {
      drawFragments();
      drawImpactFx();
      return;
    }

    const pts = whipDrawPoints();

    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (pts.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 0; i < pts.length - 1; i++) {
        const { cp1x, cp1y, cp2x, cp2y, x2, y2 } = bezier(pts, i);
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x2, y2);
      }
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = P.lineWidthTip + P.outlineWidth * 2;
      ctx.stroke();

      const thick = Math.min(P.handleThickSegments, pts.length - 1);
      if (thick > 0) {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 0; i < thick; i++) {
          const { cp1x, cp1y, cp2x, cp2y, x2, y2 } = bezier(pts, i);
          ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x2, y2);
        }
        ctx.lineWidth = P.lineWidthHandle + P.handleExtraWidth + P.outlineWidth * 2;
        ctx.stroke();
      }
    }

    for (let i = 0; i < pts.length - 1; i++) {
      const t = i / Math.max(1, pts.length - 2);
      const extra = i < P.handleThickSegments ? P.handleExtraWidth : 0;
      const { cp1x, cp1y, cp2x, cp2y, x2, y2 } = bezier(pts, i);
      ctx.strokeStyle = "#1a0a0f";
      ctx.lineWidth = lerp(P.lineWidthHandle, P.lineWidthTip, t) + extra;
      ctx.beginPath();
      ctx.moveTo(pts[i].x, pts[i].y);
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x2, y2);
      ctx.stroke();
    }

    drawImpactFx();
    drawFragments();

    const h = pts[0];
    ctx.fillStyle = "#f59e0b";
    ctx.beginPath();
    ctx.arc(h.x, h.y, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function loop() {
    update();
    tickImpact();
    draw();
    syncHandleZone();
    requestAnimationFrame(loop);
  }

  function resize() {
    const dpr = devicePixelRatio || 1;
    W = innerWidth;
    H = innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function init() {
    canvas = document.getElementById("canvas");
    ctx = canvas.getContext("2d");
    flash = document.getElementById("flash");
    screenPunch = document.getElementById("screen-punch");
    quips = document.getElementById("quips");
    karmaEl = document.getElementById("karma");
    handleZone = document.getElementById("handle-zone");
    overlayEl = document.getElementById("overlay");
    hud = document.querySelector(".hud");

    karma = loadKarma();
    karmaEl.textContent = karma.toLocaleString();

    audioPool = SOUNDS.map((s) => {
      const a = new Audio(s);
      a.preload = "auto";
      return a;
    });

    mx = innerWidth / 2;
    my = innerHeight / 2;
    resize();
    spawn(mx, my);

    addEventListener("resize", resize);
    addEventListener("mousemove", (e) => {
      mx = e.clientX;
      my = e.clientY;
      syncCapture();
    });

    handleZone.addEventListener("mouseenter", () => setCapture(true));
    handleZone.addEventListener("mouseleave", syncCapture);
    handleZone.addEventListener("mousedown", (e) => {
      if (!whip || dropping) return;
      e.preventDefault();
      setCapture(true);
      if (e.button === 0) strikeAt(mx, my);
      else if (e.button === 2) dropping = true;
    });

    hud.addEventListener("mouseenter", () => setCapture(true));
    hud.addEventListener("mouseleave", syncCapture);

    addEventListener("mousedown", (e) => {
      if (!strikeArmed || e.button !== 0 || !whip || dropping) return;
      if (nearHandle() || overHud()) return;
      e.preventDefault();
      strikeAt(e.clientX, e.clientY);
    });

    addEventListener("contextmenu", (e) => e.preventDefault());

    addEventListener("keydown", (e) => {
      if (e.key === "Escape") window.whip?.quit();
      if (e.key === "Alt" && !e.repeat) setStrikeArmed(true);
    });

    addEventListener("keyup", (e) => {
      if (e.key === "Alt") setStrikeArmed(false);
    });

    addEventListener("blur", () => setStrikeArmed(false));

    window.whip?.onVisibility?.((v) => {
      overlayEl.style.opacity = v ? "1" : "0";
    });

    loop();
  }

  addEventListener("DOMContentLoaded", init);
})();