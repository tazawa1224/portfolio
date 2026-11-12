import * as THREE from 'three';

// ポートフォリオのトップ。方眼を 1 枚の面として描き、マスに合わせてカード（HTML）を並べる。
// カードの下には上面が平らな立体物があり、持ち上がったり凹んだりして、方眼の線が縁で曲がる。
// 押している間（クリック・Enter・Space）は方眼より下へ凹み、離すと出っ張る。出っ張った状態で押して離すと平らに戻る。
// 装飾（data-follow）は、最後に押したカードと同じ動きを同時にする。
// 仕組みは main-poster.js と同じ：立体物ごとに真上から見たように、高い所ほど芯から外へ広げる。
// マス数（--cols, --rows）は portfolio.css から読む。
// 座標はすべてページ上の px（y は下向き）。

const FOV = 30;
const MARGIN = 1.6;          // ずらしても端が見えないよう、画面より大きく作る
const SEG_PX = 4;            // 何 px ごとに頂点を置くか
const SUBDIV = 2;            // 方眼の線は 1 マスをこの数に分けて引く（portfolio.css の --sub と同じ）。カードの縁は分割前のマスに合う
const LIFT = 0.5;            // 浮く高さ（マス）
const SINK = 0.6;            // 押したときに凹む深さ（浮く高さに対する割合）
const PRESS_MIN = 220;       // 短いクリックでも凹んだのが見えるよう、最低この時間（ms）は凹ませる
const PHOTO_END = 0.85;      // 画像に替わる装飾は、出っ張り（0〜1）がここまで来たときに全部のマスが替わり終わる
const PHOTO_SMEAR = 0.15;    // 1 マスが替わりきるまでの幅（出っ張りの量で）。その間は横に流れたように乱れる
const PHOTO_OUT = 600;       // 引っ込むとき、画像が全部消えるまでの最短の時間（ms）。出っ張りより遅れて、一定の速さで消える
const PHOTO_CLEAR = 600;     // 画像が出ている装飾にマウスを重ねたとき、方眼の線が消えきるまでの時間（ms）
const PHOTO_TEXT = 500;      // 01〜03 がスマホで装飾の代わりになるとき、文字が 1 マスずつ消えきる（戻りきる）までの時間（ms）
const MODAL_CLOSE = 600;     // モーダルが出っ張りから平らに戻るまでの時間（ms）
const PHOTO_FILTER = 'none';   // 画像の色の調整（canvas の filter）。'none' で元の色のまま
const EDGE = 0.5;            // 縁の斜面の幅（マス）。カードの外側に広がる
const VIEW_H = 2;            // 真上に置く視点の高さ（マス）。小さいほど上面が張り出す
const FOLD_LIMIT = 0.95;     // 縁で面が折り返さないよう、広げ方をここまでに抑える（1 で折り返し）
const LINE_W = 1.25;         // 線の太さ（px。portfolio.css の --line と同じ）
const LINE_NEAR = 1.2;       // 高い所ほど線を太くする強さ（近いものほど線が太く見える）。0 で一定
const LINE_NEAR_H = 1;       // 線の太さが半分ほど変わる高さ（マス）
const INK = 0x1c1c1c;
const PAPER = 0xf3f1ea;
const SOFTMAX_P = 3;         // 立体物どうしの面のつなぎ方（大きいほど境目がはっきり）

const canvas = document.getElementById('grid');
const board = document.querySelector('.board');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// --- モーダル（プロフィールなど）---
// data-modal-open="id" のリンクを押すと、ページを移らずに id のモーダル（data-modal）を開く。開いている間はほかの要素を消して方眼だけにし、
// モーダルは方眼ごと浮き上がる（以前の試作 portfolio-red.html の詳細パネルと同じ作り）。CLOSE × か Esc で閉じる。
// 開く・閉じるときは、ほかの要素とモーダルが細かいマス 1 マスずつ入れ替わる（下の「画面の切り替え」）。閉じるときは同時に方眼ごと平らに沈む
let modal = null, opener = null, closing = false;   // 開いているモーダル・閉じたときにフォーカスを戻すリンク・閉じている途中か
function openModal(el, from) {
  if (modal) return;
  el.dispatchEvent(new CustomEvent('modal-open', { detail: { from } }));   // 中身を入れ替えるモーダル（作例一覧）はこれを受けて並べ直す
  fxFinish();
  modal = el;
  opener = from;
  el.inert = false;
  const out = shownCards();
  el.classList.add('is-open');
  fxSwap(out, [el], { end: () => document.body.classList.add('is-modal-open') });
  el.querySelector('[data-close]')?.focus({ preventScroll: true });
}
function closeModal() {
  if (!modal || closing) return;
  fxFinish();
  closing = true;
  const m = modal;
  m.inert = true;
  document.body.classList.remove('is-modal-open');
  fxSwap([m], shownCards(), { end: () => m.classList.remove('is-open') });
  opener?.focus({ preventScroll: true });
  if (!document.body.classList.contains('webgl')) finishClose();   // 方眼が動かない環境では沈む動きがない
}
// 平らに戻りきったら呼ぶ（毎フレームの処理から）
function finishClose() {
  modal = opener = null;
  closing = false;
}
for (const a of document.querySelectorAll('[data-modal-open]')) {
  const el = document.getElementById(a.dataset.modalOpen);
  if (!el) continue;
  a.addEventListener('click', e => { e.preventDefault(); openModal(el, a); });
  el.querySelector('[data-close]')?.addEventListener('click', closeModal);
}
addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// --- 画面の切り替え ---
// モーダルを開く・閉じる・中身を替えるとき、装飾の画像と同じように細かいマスが 1 マスずつばらばらの順で替わる（替わる途中のマスは横に流れる）。
// 切り替えの間は本物の要素を隠し（fx-hide）、前の画面（from）と次の画面（to）の要素を毎フレーム canvas に描き写して、マスごとにどちらかを見せる。
// 要素はその間も動く（出っ張る・沈む）ので、描き写しも一緒に動く
const FX_DUR = 700;          // 全部のマスが替わりきるまでの時間（ms）
const FX_SUB = 4;            // 1 マスをこの数に分けたマスで替わる
const FX_SMEAR = 0.2;        // 1 マスが替わりきるまでの幅（全体の時間に対する割合）。前半で前の画面が流れて消え、後半で次の画面が流れて出る
let fx = null;
const fxCanvas = Object.assign(document.createElement('canvas'), { className: 'fx' });
fxCanvas.setAttribute('aria-hidden', 'true');
document.body.append(fxCanvas);
const fontMetrics = new Map();
const pitchCache = new WeakMap();

// 要素（カード 1 枚）を、画面と同じ位置・見た目で ctx に描く。地と枠線（::before）、細かい方眼、子要素の地・枠・canvas・文字
function drawEl(ctx, root) {
  const rcs = getComputedStyle(root);
  if (rcs.visibility === 'hidden' || !root.getClientRects().length) return;
  const r = root.getBoundingClientRect(), L = LINE_W;
  const gx = parseFloat(root.style.getPropertyValue('--gx')) || 0, gy = parseFloat(root.style.getPropertyValue('--gy')) || 0;
  const x0 = r.left - gx, y0 = r.top - gy, w = r.width + 2 * gx, h = r.height + 2 * gy;
  const bcs = getComputedStyle(root, '::before');
  if (bcs.content !== 'none') {
    ctx.fillStyle = bcs.backgroundColor;
    ctx.fillRect(x0, y0, w, h);
    const ink = rcs.getPropertyValue('--ink');
    ctx.fillStyle = ink;
    if (bcs.backgroundImage !== 'none') {
      // 細かい方眼（portfolio.css の .card--grid と同じ。線はカードの左上に合わせる）
      let pitch = pitchCache.get(root);
      if (!pitch) {
        const probe = document.createElement('div');
        probe.style.cssText = 'position:absolute;width:var(--pitch)';
        root.append(probe);
        pitch = probe.getBoundingClientRect().width;
        probe.remove();
        pitchCache.set(root, pitch);
      }
      ctx.save();
      ctx.beginPath(); ctx.rect(x0, y0, w, h); ctx.clip();
      for (let x = r.left - L / 2 - Math.ceil(gx / pitch) * pitch; x < x0 + w; x += pitch) ctx.fillRect(x, y0, L, h);
      for (let y = r.top - L / 2 - Math.ceil(gy / pitch) * pitch; y < y0 + h; y += pitch) ctx.fillRect(x0, y, w, L);
      ctx.restore();
    }
    ctx.fillRect(x0 - L / 2, y0 - L / 2, w + L, L); ctx.fillRect(x0 - L / 2, y0 + h - L / 2, w + L, L);
    ctx.fillRect(x0 - L / 2, y0 - L / 2, L, h + L); ctx.fillRect(x0 + w - L / 2, y0 - L / 2, L, h + L);
  }
  // 中身はカードの内側に限って描く（スクロールして見えていない部分を外へはみ出させない）
  ctx.save();
  ctx.beginPath(); ctx.rect(x0, y0, w, h); ctx.clip();
  const range = document.createRange();
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let font = '';
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) {
      const cs = getComputedStyle(n.parentElement);
      if (cs.visibility === 'hidden' || !n.data.trim()) continue;
      const base = parseFloat(cs.fontSize), key = `${cs.fontStyle} ${cs.fontWeight} ${base}px ${cs.fontFamily}`;
      let m = fontMetrics.get(key);
      if (!m) { ctx.font = key; const t = ctx.measureText('Hg'); m = [t.fontBoundingBoxAscent, t.fontBoundingBoxDescent]; fontMetrics.set(key, m); }
      ctx.fillStyle = cs.color;
      ctx.globalAlpha = Math.min(parseFloat(cs.opacity), 1);
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
      for (let i = 0; i < n.data.length; i++) {
        if (/\s/.test(n.data[i])) continue;
        range.setStart(n, i); range.setEnd(n, i + 1);
        const c = range.getBoundingClientRect();
        if (!c.width) continue;
        const k = Math.round(c.height / (m[0] + m[1]) * 100) / 100;   // 拡大（--zoom）の分
        const f = `${cs.fontStyle} ${cs.fontWeight} ${base * k}px ${cs.fontFamily}`;
        if (f !== font) ctx.font = font = f;
        ctx.fillText(n.data[i], c.left, c.top + m[0] * k);
      }
      ctx.globalAlpha = 1;
      continue;
    }
    if (n === root) continue;
    const cs = getComputedStyle(n);
    if (cs.visibility === 'hidden' || !n.getClientRects().length) continue;
    const b = n.getBoundingClientRect();
    if (n instanceof HTMLCanvasElement) { if (n.width) ctx.drawImage(n, b.left, b.top, b.width, b.height); continue; }
    // 画像（作例のサムネイル）：object-fit: cover と object-position のとおりに切り抜いて描く
    if (n instanceof HTMLImageElement) {
      if (n.complete && n.naturalWidth) {
        const k = Math.max(b.width / n.naturalWidth, b.height / n.naturalHeight), dw = n.naturalWidth * k, dh = n.naturalHeight * k;
        const [px = 50, py = 50] = cs.objectPosition.split(' ').map(v => parseFloat(v));
        ctx.save(); ctx.beginPath(); ctx.rect(b.left, b.top, b.width, b.height); ctx.clip();
        ctx.drawImage(n, b.left + (b.width - dw) * px / 100, b.top + (b.height - dh) * py / 100, dw, dh);
        ctx.restore();
      }
      continue;
    }
    if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') { ctx.fillStyle = cs.backgroundColor; ctx.fillRect(b.left, b.top, b.width, b.height); }
    // 枠は辺ごとに（上だけ・下だけの罫線もそのまま描く）
    const bt = parseFloat(cs.borderTopWidth), br = parseFloat(cs.borderRightWidth), bb = parseFloat(cs.borderBottomWidth), bl = parseFloat(cs.borderLeftWidth);
    if (bt > 0) { ctx.fillStyle = cs.borderTopColor; ctx.fillRect(b.left, b.top, b.width, bt); }
    if (bb > 0) { ctx.fillStyle = cs.borderBottomColor; ctx.fillRect(b.left, b.bottom - bb, b.width, bb); }
    if (bl > 0) { ctx.fillStyle = cs.borderLeftColor; ctx.fillRect(b.left, b.top, bl, b.height); }
    if (br > 0) { ctx.fillStyle = cs.borderRightColor; ctx.fillRect(b.right - br, b.top, br, b.height); }
  }
  ctx.restore();
}

function fxDraw(cv, els) {
  const c = cv.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, cv.width, cv.height);
  c.setTransform(fx.dpr, 0, 0, fx.dpr, 0, 0);
  for (const el of els) drawEl(c, el);
}

// from の要素から to の要素へ切り替える。update = 切り替えの最初に画面を替える処理（from を描き写した後に呼ぶ）。
// freeze = from を最初の 1 回だけ描き写す（同じ要素の中身を替えるとき）。end = 替わりきったときの処理
function fxSwap(from, to, { update, end, freeze = false } = {}) {
  fxFinish();
  if (reduceMotion) { update?.(); end?.(); return; }
  const dpr = Math.min(devicePixelRatio, 2), vw = innerWidth, vh = innerHeight;
  fxCanvas.width = Math.round(vw * dpr); fxCanvas.height = Math.round(vh * dpr);
  const mk = () => Object.assign(document.createElement('canvas'), { width: fxCanvas.width, height: fxCanvas.height });
  fx = { from, to, end, freeze, dpr, a: mk(), b: mk(), start: performance.now() };
  fxDraw(fx.a, from);
  update?.();
  for (const el of [...from, ...to]) el.classList.add('fx-hide');
  // マスは方眼にそろえる。前後の要素がある所（出っ張る分も見込んで少し広く）だけ
  const cell = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cell')) || 64;
  const pitch = cell / FX_SUB, br = board.getBoundingClientRect();
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  for (const el of [...from, ...to]) for (const q of el.getClientRects()) { l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom); }
  const ox = br.left - Math.ceil((br.left - (l - cell)) / pitch) * pitch, oy = br.top - Math.ceil((br.top - (t - cell)) / pitch) * pitch;
  fx.pitch = pitch;
  fx.cells = [];
  for (let y = oy; y < b + cell; y += pitch) {
    const row = Math.random();
    for (let x = ox; x < r + cell; x += pitch) {
      fx.cells.push({ x, y, r: (1 - FX_SMEAR) * (0.55 * Math.random() + 0.45 * row), shift: (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 4)) });
    }
  }
  requestAnimationFrame(fxFrame);
}

function fxFrame(now) {
  if (!fx) return;
  const k = Math.min((now - fx.start) / FX_DUR, 1);
  if (k >= 1) { fxFinish(); return; }
  if (!fx.freeze) fxDraw(fx.a, fx.from);
  fxDraw(fx.b, fx.to);
  const c = fxCanvas.getContext('2d'), { dpr: s, pitch: p } = fx;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
  c.setTransform(s, 0, 0, s, 0, 0);
  const W = fxCanvas.width / s;
  for (const cl of fx.cells) {
    const m = (k - cl.r) / FX_SMEAR;
    const src = m < 0.5 ? fx.a : fx.b;
    if (m <= 0 || m >= 1) { c.drawImage(src, cl.x * s, cl.y * s, p * s, p * s, cl.x, cl.y, p, p); continue; }
    // 前半：前の画面が横に流れながら細くなって消える。後半：次の画面が横に流れた所から戻ってくる
    const e = m < 0.5 ? m * 2 : 2 - m * 2;
    const sw = p * (0.15 + 0.85 * (1 - e)), sx = Math.min(Math.max(cl.x + cl.shift * p * e, 0), W - sw);
    c.drawImage(src, sx * s, cl.y * s, sw * s, p * s, cl.x, cl.y, p, p);
  }
  requestAnimationFrame(fxFrame);
}

// 切り替えを終わらせる（途中なら替わりきった所まで飛ばす）
function fxFinish() {
  if (!fx) return;
  const f = fx;
  fx = null;
  for (const el of [...f.from, ...f.to]) el.classList.remove('fx-hide');
  f.end?.();
  fxCanvas.getContext('2d').clearRect(0, 0, fxCanvas.width, fxCanvas.height);
}
// いま見えているカード（モーダル以外）
const shownCards = () => [...board.querySelectorAll(':scope > .card:not(.card--modal)')].filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
// モーダルの中身を替えるとき（作例一覧のカテゴリの切り替え）。works-modal.js が送る
document.addEventListener('fx-swap', e => {
  e.preventDefault();
  fxSwap([e.detail.el], [e.detail.el], { update: e.detail.update, freeze: true });
});

// 上面が平らな角丸長方形の高さ（0〜1）。r = 角の半径, s = 縁の斜面の半幅
function bump(lx, ly, a, b, r, s) {
  const qx = Math.abs(lx) - a + r, qy = Math.abs(ly) - b + r;
  const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  const t = THREE.MathUtils.clamp((d + s) / (2 * s), 0, 1);
  return 1 - t * t * (3 - 2 * t);
}
// 真上から見たときに押し広げる向きと量。中心ではなく芯（長い方向に伸びた線分）から測る
function spread(lx, ly, a, b, bm) {
  const m = Math.min(a, b), ex = a - m, ey = b - m;
  return [(lx - THREE.MathUtils.clamp(lx, -ex, ex)) * bm, (ly - THREE.MathUtils.clamp(ly, -ey, ey)) * bm];
}

// --- 画像に替わる装飾 ---
// 細かい方眼（--pitch）の 1 マスずつ、ばらばらの順で画像に替わる。行ごとに少しまとまって替わり、替わる途中のマスは横に流れて見える。
// 出っ張り t（0〜1）だけで決まるので、引っ込むときは同じ道をたどって元に戻る
function makePhoto(el) {
  const cv = document.createElement('canvas');
  cv.className = 'card__photo';
  el.append(cv);
  const p = { el, cv, ctx: cv.getContext('2d'), img: new Image(), off: null, cells: [], key: '', hover: false, q: 0, t: 0, f: 0, face: null, last: 0, more: el.querySelector('.card__more'), m: -1 };
  // 画像が出ている間にマウスを重ねると線を消す（指で触れたときは除く）
  el.addEventListener('pointerenter', e => { if (e.pointerType !== 'touch') p.hover = true; });
  el.addEventListener('pointerleave', () => { p.hover = false; });
  p.img.onload = () => { p.off = null; p.key = ''; if (p.size) sizePhoto(p, ...p.size); };
  p.img.src = el.dataset.photo;
  return p;
}
// W, H = カードの半幅・半高さ、E = 広がる最大の幅（px）。canvas は四方に E ずつ大きく置く
function sizePhoto(p, W, H, E) {
  p.size = [W, H, E];
  const probe = document.createElement('div');   // --pitch を px で測る
  probe.style.cssText = 'position:absolute;width:var(--pitch)';
  p.el.append(probe);
  const pitch = probe.getBoundingClientRect().width;
  probe.remove();
  const dpr = Math.min(devicePixelRatio, 2), cw = 2 * W + 2 * E, ch = 2 * H + 2 * E;
  Object.assign(p.cv.style, { left: `${-E}px`, top: `${-E}px`, width: `${cw}px`, height: `${ch}px` });
  p.cv.width = Math.round(cw * dpr); p.cv.height = Math.round(ch * dpr);
  Object.assign(p, { W, H, E, pitch, dpr, cw, ch, key: '' });
  p.bare = true;   // 装飾も 01・02 と同じく、画像の上に方眼の線を引かない（外枠だけ）
  // 画像は canvas いっぱいに切り抜いて（data-photo-focus の位置・拡大率で）おく
  if (p.img.complete && p.img.naturalWidth) {
    const off = p.off ?? document.createElement('canvas');
    off.width = p.cv.width; off.height = p.cv.height;
    // 切り抜く位置（0〜1）と拡大率。縦長の画面（スマホ）では data-photo-focus-sp があればそちらを使う
    const sp = matchMedia('(max-aspect-ratio: 1/1), (max-width: 760px)').matches;
    const focus = (sp && p.el.dataset.photoFocusSp) || p.el.dataset.photoFocus || '';
    const [fx = 0.5, fy = 0.5, zoom = 1] = focus.split(' ').filter(Boolean).map(Number);
    const o = off.getContext('2d'), k = Math.max(off.width / p.img.naturalWidth, off.height / p.img.naturalHeight) * zoom;
    o.filter = PHOTO_FILTER;
    o.drawImage(p.img, (off.width - p.img.naturalWidth * k) * fx, (off.height - p.img.naturalHeight * k) * fy, p.img.naturalWidth * k, p.img.naturalHeight * k);
    p.off = off;
  }
  if (p.el.matches('.card--link')) makeFace(p);
  // マスごとの替わる順（行ごとの乱数を混ぜて、横にまとまって替わるように）と、流れる向き・量
  p.cells = [];
  const i0 = Math.floor(-E / pitch), i1 = Math.ceil((2 * W + E) / pitch), j0 = Math.floor(-E / pitch), j1 = Math.ceil((2 * H + E) / pitch);
  for (let j = j0; j < j1; j++) {
    const row = Math.random();
    for (let i = i0; i < i1; i++) {
      const r = (PHOTO_END - PHOTO_SMEAR) * (0.55 * Math.random() + 0.45 * row);
      p.cells.push({ x: E + i * pitch, y: E + j * pitch, r, shift: (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 4)) });
    }
  }
}
// 01〜03 の文字のある面（地と文字）を、canvas と同じ大きさ・位置で描いておく。文字が 1 マスずつ消える・戻るときに使う
function makeFace(p) {
  const face = p.face ?? document.createElement('canvas');
  face.width = p.cv.width; face.height = p.cv.height;
  const o = face.getContext('2d');
  o.setTransform(p.dpr, 0, 0, p.dpr, 0, 0);
  const cs0 = getComputedStyle(p.el);
  o.fillStyle = cs0.getPropertyValue('--face') || cs0.getPropertyValue('--paper');
  o.fillRect(0, 0, p.cw, p.ch);
  o.textBaseline = 'middle';
  for (const el of p.el.children) {
    if (el === p.cv || !el.textContent.trim()) continue;
    const cs = getComputedStyle(el);
    o.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    o.fillStyle = cs.color;
    if ('letterSpacing' in o) o.letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing;
    o.fillText(el.textContent, p.E + el.offsetLeft, p.E + el.offsetTop + el.offsetHeight / 2);
  }
  p.face = face;
}
// q = 線の消え具合（0 = 方眼、1 = 線なしの画像）。全部のマスが替わった後にマウスを重ねている間だけ 1 へ進み、外すと 0 へ戻る
// fast = 別のカードへ切り替える途中（平らなカードを押して凹ませている）。このときは出っ張りと同じ速さで消す
// decor = 01〜03 が装飾の代わりをしている。f = 文字の消え具合（0 = 文字のあるカード、1 = 文字が消えて細かい方眼）。
// 装飾の代わりをしている間と、画像が残っている間は 1 へ進み、画像が消えきってから 0 へ戻る（画像と同じように 1 マスずつ）
function drawPhoto(p, t, gx, gy, now, fast, decor) {
  const dt = p.last ? now - p.last : 0;
  p.last = now;
  const qGoal = p.hover && t > 0.97 ? 1 : 0;
  // 出るときは出っ張りと同じ、消えるときは PHOTO_OUT より速くは消さない（切り替えの途中は除く）
  t = p.t = reduceMotion || fast || t >= p.t ? t : Math.max(t, p.t - dt / PHOTO_OUT);
  p.q = reduceMotion ? qGoal : Math.min(Math.max(p.q + Math.sign(qGoal - p.q) * dt / PHOTO_CLEAR, 0), 1);
  const q = p.q;
  const fGoal = p.face && (decor || p.t > 0.001) ? 1 : 0;
  p.f = reduceMotion ? fGoal : Math.min(Math.max(p.f + Math.sign(fGoal - p.f) * dt / PHOTO_TEXT, 0), 1);
  const f = p.f;
  // MORE ボタン：線が「＋」に縮み始めた所から出始め、点が消えるのと一緒に出きる。画像が引っ込み始めたら一緒に消す
  if (p.more) {
    const a = Math.min(Math.max((q - 0.3) / 0.7, 0), 1), m = +(a * a * (3 - 2 * a) * Math.min(Math.max((t - 0.9) / 0.1, 0), 1)).toFixed(3);
    if (m !== p.m) {
      p.m = m;
      p.more.style.setProperty('--more', m);
      p.more.style.visibility = m > 0 ? 'visible' : '';
    }
  }
  const key = `${t.toFixed(3)} ${gx.toFixed(2)} ${gy.toFixed(2)} ${q.toFixed(3)} ${f.toFixed(3)}`;
  if (!p.off || key === p.key) return;
  p.key = key;
  const { ctx, dpr, E, W, H, pitch } = p, L = LINE_W, ink = '#1c1c1c';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, p.cw, p.ch);
  if (t < 0.001 && (f <= 0 || f >= 1)) return;   // 平らに戻りきるまで少しずつ 0 に近づくので、ほぼ 0 なら何も描かない（文字が替わる途中は除く）
  // 見えている範囲（地と同じだけ広がった四角）に限って描く
  const x0 = E - gx, y0 = E - gy, x1 = E + 2 * W + gx, y1 = E + 2 * H + gy;
  ctx.save();
  ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip();
  // 文字のある面：まだ消えていないマスを描く。替わる途中のマスは画像と同じように横に流れる（進むほどずれて細くなる）。
  // 文字は広がった地の左上に付いて動くので、その分ずらして切り出す
  if (p.face && f > 0 && f < 1) {
    const tf = f * PHOTO_END, s = dpr;
    for (const c of p.cells) {
      const k = (tf - c.r) / PHOTO_SMEAR;
      if (k >= 1 || c.x + pitch < x0 || c.x > x1 || c.y + pitch < y0 || c.y > y1) continue;
      const fx = c.x + gx, fy = c.y + gy;
      if (k <= 0) ctx.drawImage(p.face, fx * s, fy * s, pitch * s, pitch * s, c.x, c.y, pitch, pitch);
      else {
        const sx = fx + c.shift * pitch * k, sw = pitch * (0.15 + 0.85 * (1 - k));
        ctx.drawImage(p.face, Math.min(Math.max(sx, 0), p.cw - sw) * s, fy * s, sw * s, pitch * s, c.x, c.y, pitch, pitch);
      }
    }
  }
  const shown = [];
  for (const c of p.cells) {
    if (t <= c.r || c.x + pitch < x0 || c.x > x1 || c.y + pitch < y0 || c.y > y1) continue;
    const k = Math.min((t - c.r) / PHOTO_SMEAR, 1), s = dpr;
    if (k >= 1) ctx.drawImage(p.off, c.x * s, c.y * s, pitch * s, pitch * s, c.x, c.y, pitch, pitch);
    else {
      // 替わる途中：横にずれた所の細い帯を引き伸ばす（流れたように見える）。進むほどずれが戻る
      const sx = c.x + c.shift * pitch * (1 - k), sw = pitch * (0.15 + 0.85 * k);
      ctx.drawImage(p.off, Math.min(Math.max(sx, 0), p.cw - sw) * s, c.y * s, sw * s, pitch * s, c.x, c.y, pitch, pitch);
    }
    shown.push(c);
  }
  // 替わったマスの上に方眼の線を引き直す（地の方眼と同じ位置・太さ）。外枠は内側の半分だけ。
  // いまは全部（p.bare）画像の上に線を引かず、外枠だけ。p.bare を外すと、線を引き、マウスを重ねている間だけ消す
  ctx.fillStyle = ink;
  if (p.face || p.bare) {
    // 線なし
  } else if (q <= 0) {
    for (const c of shown) {
      ctx.fillRect(c.x - L / 2, c.y - L / 2, pitch + L, L);
      ctx.fillRect(c.x - L / 2, c.y + pitch - L / 2, pitch + L, L);
      ctx.fillRect(c.x - L / 2, c.y - L / 2, L, pitch + L);
      ctx.fillRect(c.x + pitch - L / 2, c.y - L / 2, L, pitch + L);
    }
  } else {
    // 線を消す：線が交点へ縮んで「＋」になり（前 7 割）、点になって消える（後 3 割）
    const e = Math.min(q / 0.7, 1), arm = L / 2 + (pitch / 2) * (1 - e * e * (3 - 2 * e));
    const dot = q < 0.7 ? 0 : L * 0.9 * (1 - (q - 0.7) / 0.3);
    const seen = new Set();
    for (const c of shown) for (const [x, y] of [[c.x, c.y], [c.x + pitch, c.y], [c.x, c.y + pitch], [c.x + pitch, c.y + pitch]]) {
      const k = `${x},${y}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (q < 0.7) { ctx.fillRect(x - arm, y - L / 2, arm * 2, L); ctx.fillRect(x - L / 2, y - arm, L, arm * 2); }
      else if (dot > 0) { ctx.beginPath(); ctx.arc(x, y, dot, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.globalAlpha = 1 - e;   // 外枠も一緒に薄くする
  }
  ctx.fillRect(x0, y0, x1 - x0, L / 2); ctx.fillRect(x0, y1 - L / 2, x1 - x0, L / 2);
  ctx.fillRect(x0, y0, L / 2, y1 - y0); ctx.fillRect(x1 - L / 2, y0, L / 2, y1 - y0);
  ctx.restore();
}

// --- 方眼と立体物 ---
function start(renderer) {
  const els = [...document.querySelectorAll('[data-card]')];
  const N = els.length;
  // 立体物 1 つ = カード 1 枚。a, b = 半幅・半高さ（斜面込み）、W, H = カードの半幅・半高さ
  const objs = els.map(el => ({ el, x: 0, y: 0, a: 1, b: 1, W: 1, H: 1, view: 1, amt: 0, raised: false, press: false, pressUntil: 0 }));
  for (const o of objs) o.modal = o.el.hasAttribute('data-modal');
  const cards = objs.filter(o => !o.el.hasAttribute('data-follow') && !o.modal);   // 押して動かすカード（モーダルは開いている間だけ浮く）
  let active = null;   // 最後に押したカード（装飾はこのカードと同じ高さになる）
  for (const o of objs) o.photo = o.el.dataset.photo ? makePhoto(o.el) : null;

  const VERT = /* glsl */`
#define N ${N}
uniform vec2  uViewport;
uniform float uScroll;
uniform vec2  uC[N];        // 中心（ページ px）
uniform vec4  uP[N];        // a, b, 高さ(px), 視点の高さ(px)
uniform vec2  uR[N];        // 角の半径, 縁の斜面の半幅 (px)
uniform float uAmt[N];      // 浮き上がり (0〜1)。負の値は凹み
varying vec2  vPage;
varying float vH;

float bump(vec2 l, float a, float b, vec2 r){
  vec2 q = abs(l) - vec2(a, b) + r.x;
  float d = length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r.x;
  return 1. - smoothstep(-r.y, r.y, d);
}
vec2 spread(vec2 l, float a, float b, float bm){
  vec2 e = vec2(a, b) - min(a, b);
  return (l - clamp(l, -e, e)) * bm;
}

// disp: 立体物ごとに真上から見たときの見た目のずれ（浮くと芯から外向き、凹むと内向き）
// 凹んだ所は遠いので、視点からの距離（視点の高さ + 深さ）で割って縮める
float height(vec2 p, out vec2 disp){
  float up = 0., down = 0.;
  disp = vec2(0.);
  for (int i = 0; i < N; i++){
    vec2 l = p - uC[i];
    float bm = bump(l, uP[i].x, uP[i].y, uR[i]);
    float h = uP[i].z * uAmt[i] * bm;
    if (h >= 0.) up += pow(h, ${SOFTMAX_P.toFixed(1)}); else down += pow(-h, ${SOFTMAX_P.toFixed(1)});
    disp += spread(l, uP[i].x, uP[i].y, bm) * h / (uP[i].w + max(-h, 0.));
  }
  return pow(up + 1e-6, ${(1 / SOFTMAX_P).toFixed(4)}) - pow(down + 1e-6, ${(1 / SOFTMAX_P).toFixed(4)});
}

void main(){
  vec2 P = vec2(position.x + uViewport.x * 0.5, uViewport.y * 0.5 - position.y + uScroll);
  vec2 disp;
  float h = height(P, disp);
  vec2 q = P + disp;
  vPage = P;
  vH = h;
  // 高さは見た目のずれ（disp）だけで表す（カメラの遠近は使わない）
  vec3 pos = vec3(q.x - uViewport.x * 0.5, uViewport.y * 0.5 - (q.y - uScroll), 0.);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.);
}
`;

  // 線の太さは画面上で一定（px）。斜面で面が詰まっても線が細く・かすれず、1 本の線のまま曲がる
  const FRAG = /* glsl */`
uniform float uCell, uLine, uLineNear, uLineNearH;
uniform float uPxRatio;     // 画面の px / CSS の px
uniform vec2  uOrigin;      // 方眼の左上（ページ px）
uniform vec4  uFrame;       // 方眼を描く範囲（ページ px）
uniform vec3  uInk, uPaper;
varying vec2  vPage;
varying float vH;

// px = 画面上の線の太さ。いちばん近い線までの距離を画面の px に直して塗る
// 線どうしが数 px まで詰まる所（角の外側など）は、つぶれてかすれた形に見えるので描かない
float gridLine(float uv, float px){
  float perPx = length(vec2(dFdx(uv), dFdy(uv)));   // 画面 1px あたりの uv の変化
  float d = abs(fract(uv + .5) - .5) / max(perPx, 1e-6);
  float crowd = 1. - smoothstep(.35 / (px + 2.), .7 / (px + 2.), perPx);   // 線の間隔 ≒ 線幅 + 3px 以下で消す
  return clamp(px * .5 + .5 - d, 0., 1.) * crowd;
}

void main(){
  vec2 uv = (vPage - uOrigin) / uCell;
  // 高い所ほど近い → 線を太く、凹んだ所は遠い → 細く（線だけで奥行きを出す。方向の偏りは出ない）
  float near = vH >= 0. ? vH / (vH + uLineNearH) : vH / (uLineNearH - vH);
  float lw = uLine * (1. + uLineNear * near) * uPxRatio;
  float g = 1. - (1. - gridLine(uv.x, lw)) * (1. - gridLine(uv.y, lw));
  // 方眼の外枠の外には描かない（境界の線は残すよう、線幅の半分だけ外側まで描く）
  float e = uLine;
  vec4 f = uFrame + vec4(-e, -e, e, e);
  float inFrame = step(f.x, vPage.x) * step(vPage.x, f.z) * step(f.y, vPage.y) * step(vPage.y, f.w);
  g *= inFrame;
  gl_FragColor = vec4(mix(uPaper, uInk, g), 1.);
  #include <colorspace_fragment>   // HTML の色（sRGB）とそろえる
}
`;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 10, 20000);
  const uniforms = {
    uViewport: { value: new THREE.Vector2() },
    uScroll:   { value: 0 },
    uC:        { value: objs.map(() => new THREE.Vector2()) },
    uP:        { value: objs.map(() => new THREE.Vector4()) },
    uR:        { value: objs.map(() => new THREE.Vector2()) },
    uAmt:      { value: objs.map(() => 0) },
    uCell:     { value: 1 },
    uLine:     { value: LINE_W },
    uPxRatio:  { value: 1 },
    uLineNear: { value: LINE_NEAR },
    uLineNearH: { value: 1 },
    uOrigin:   { value: new THREE.Vector2() },
    uFrame:    { value: new THREE.Vector4() },
    uInk:      { value: new THREE.Color(INK) },
    uPaper:    { value: new THREE.Color(PAPER) },
  };
  const mesh = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide })
  );
  mesh.frustumCulled = false;
  scene.add(mesh);

  let cell = 1, dist = 1, sp = false;   // sp = 縦長の画面（スマホ）

  // 中心から外へ向かう線上で、見た目の位置 t + F(t)/D が戻り始めない（折り返さない）D を求める。
  // F = 外向きのずれ（spread の線方向の成分 × 高さ）。d/dt = 1 + F'/D なので、F' がいちばん負になる所で決まる
  function foldSafeView(o, Hpx) {
    const R = Math.max(o.a, o.b) * 1.5, s = EDGE * cell;
    let worst = 0;
    for (let k = 0; k < 32; k++) {
      const ux = Math.cos(k / 32 * Math.PI * 2), uy = Math.sin(k / 32 * Math.PI * 2);
      const F = t => {
        const bm = bump(ux * t, uy * t, o.a, o.b, s, s);
        const [vx, vy] = spread(ux * t, uy * t, o.a, o.b, bm);
        return (vx * ux + vy * uy) * Hpx * bm;
      };
      for (let t = 1; t < R; t += 1) worst = Math.min(worst, F(t + 0.5) - F(t - 0.5));
    }
    return -worst / FOLD_LIMIT;
  }
  // 角の外側は芯の端から斜めに押し広げるので、大きなカード（モーダル）ほど中心からの向きでは測れない折り返しが出る。
  // 角のまわりで面の向き（ずれの微分の行列式）が裏返らない視点の高さを探す
  function cornerSafeView(o, Hpx) {
    const s = EDGE * cell, d = 0.5;
    const D = (x, y) => { const bm = bump(x, y, o.a, o.b, s, s), [vx, vy] = spread(x, y, o.a, o.b, bm); return [vx * Hpx * bm, vy * Hpx * bm]; };
    const J = [];
    for (let x = o.W - 2 * s; x < o.W + 2 * s; x += 1) for (let y = o.H - 2 * s; y < o.H + 2 * s; y += 1) {
      const p = D(x, y), px = D(x + d, y), py = D(x, y + d);
      J.push([(px[0] - p[0]) / d, (px[1] - p[1]) / d, (py[0] - p[0]) / d, (py[1] - p[1]) / d]);
    }
    const ok = v => J.every(j => (1 + j[0] / v) * (1 + j[3] / v) - j[1] * j[2] / v / v >= 1 - FOLD_LIMIT);
    let lo = 1, hi = 1;
    while (!ok(hi)) hi *= 2;
    for (let k = 0; k < 20; k++) { const m = (lo + hi) / 2; if (ok(m)) hi = m; else lo = m; }
    return hi;
  }

  function layout() {
    // 縦にスクロールする画面ではスクロールバーの分だけ狭い。canvas（position: fixed）の大きさと合わせる
    const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    const css = getComputedStyle(document.documentElement);
    document.documentElement.style.removeProperty('--rows');   // 前に足した行を外して、CSS の行数から測り直す
    const cols = parseInt(css.getPropertyValue('--cols'));
    let rows = parseInt(css.getPropertyValue('--rows'));
    // 横長の画面は 1 画面に収める。縦長の画面は幅に合わせて縦にスクロールする。
    // マスは整数 px、分割した方眼の線も整数 px にそろえる（HTML の枠線と方眼の線がずれないように）
    const portrait = cols < 16;
    sp = portrait;
    const fit = portrait ? (vw - 32) / cols : Math.min((vw - 64) / cols, (vh - 64) / rows);
    cell = Math.max(16, Math.floor(fit / SUBDIV) * SUBDIV);
    // スマホで data-fill のボード：上下の余白が左右の余白とほぼ同じになるまで行を足し、3 枚の高さに同じだけ配る（余りは間に）。
    // マスは 1 割小さくするまでの中から、上下と左右の余白の差が小さく、余白が広がりすぎない大きさを選ぶ
    const fill = portrait && board.hasAttribute('data-fill');
    // 画面が低くて決まった行数が入りきらないときは、マスを縮めてスクロールさせない（上下にも左右と同じ 16px は空ける）
    if (fill) cell = Math.max(16, Math.min(cell, Math.floor((vh - 32) / rows / SUBDIV) * SUBDIV));
    if (fill) {
      const side0 = (vw - cols * cell) / 2;
      let best = Infinity;
      for (let c = cell; c >= Math.max(16, cell * 0.9); c -= SUBDIV) {
        const side = (vw - cols * c) / 2, n = Math.max(rows, Math.floor((vh - 2 * side) / c));
        const score = Math.abs((vh - n * c) / 2 - side) + (side - side0) / 2;
        if (score < best - 0.5) { best = score; cell = c; }
      }
    }
    document.documentElement.style.setProperty('--cell', `${cell}px`);
    if (fill) {
      const side = (vw - cols * cell) / 2, x = Math.max(0, Math.floor((vh - 2 * side) / cell) - rows);
      rows += x;
      document.documentElement.style.setProperty('--rows', rows);
      // 3 枚に同じだけ（半マス刻み）。余りが 1 行あれば 2 つの間に半マスずつ、半マス残れば ALL の上に回す
      const e = Math.floor(x * 2 / 3) / 2;
      board.style.setProperty('--xe', e);
      board.style.setProperty('--xg', x - 3 * e >= 1 ? 0.5 : 0);
      board.style.setProperty('--xr', x);
    }
    // 横長の画面は、左右の余白が上下の余白とほぼ同じになるよう左右にマスを足し、
    // 左端・右端に接する要素をその分だけ外へ伸ばす（空いたマスの列が出ないように）
    const ext = portrait ? 0 : Math.max(0, Math.floor(((vw - cols * cell) - (vh - rows * cell)) / 2 / cell));
    document.documentElement.style.setProperty('--ext', ext);
    for (const el of board.querySelectorAll('.card')) {
      const c = parseFloat(el.style.getPropertyValue('--c')), w = parseFloat(el.style.getPropertyValue('--w'));
      el.style.setProperty('--gl', c === 0 ? ext : 0);
      el.style.setProperty('--gr', c + w === cols ? ext : 0);
    }

    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    uniforms.uPxRatio.value = renderer.getPixelRatio();
    renderer.setSize(vw, vh, false);
    camera.aspect = vw / vh;
    camera.updateProjectionMatrix();
    dist = (vh / 2) / Math.tan(THREE.MathUtils.degToRad(FOV / 2));

    const w = vw * MARGIN, h = vh * MARGIN;
    mesh.geometry.dispose();
    mesh.geometry = new THREE.PlaneGeometry(w, h, Math.ceil(w / SEG_PX), Math.ceil(h / SEG_PX));
    uniforms.uViewport.value.set(vw, vh);
    uniforms.uCell.value = cell / SUBDIV;
    uniforms.uLineNearH.value = LINE_NEAR_H * cell;

    const br = board.getBoundingClientRect();
    const ox = br.left + scrollX, oy = br.top + scrollY;
    uniforms.uOrigin.value.set(ox, oy);
    uniforms.uFrame.value.set(ox, oy, ox + (cols + ext * 2) * cell, oy + rows * cell);

    // カードの位置・大きさから立体物を作る。上面 = カード、斜面はカードの外側に EDGE マス
    const s = EDGE * cell, Hpx = LIFT * cell;
    objs.forEach((o, i) => {
      o.hidden = !o.el.getClientRects().length;   // 画面に出していないもの（スマホの装飾など）は動かさない
      // 中身はカードの左上を中心に拡大・縮小する。そのためにカード内の位置を測っておく
      for (const c of o.el.children) {
        c.style.setProperty('--ox', `${c.offsetLeft}px`);
        c.style.setProperty('--oy', `${c.offsetTop}px`);
      }
      const r = o.el.getBoundingClientRect();
      o.W = r.width / 2; o.H = r.height / 2;
      o.x = r.left + scrollX + o.W; o.y = r.top + scrollY + o.H;
      o.a = o.W + s; o.b = o.H + s;
      o.view = Math.max(VIEW_H * cell, foldSafeView(o, Hpx), o.modal ? cornerSafeView(o, Hpx) : 0);   // モーダルは角も確かめる
      uniforms.uC.value[i].set(o.x, o.y);
      uniforms.uP.value[i].set(o.a, o.b, Hpx, o.view);
      uniforms.uR.value[i].set(s, s);   // 角の半径 = 斜面の半幅 → 上面（カード）の角は 90 度
      if (o.photo && !o.hidden) {
        const [ex, ey] = spread(o.W, o.H, o.a, o.b, 1);
        sizePhoto(o.photo, o.W, o.H, Math.ceil(Math.max(ex, ey) * Hpx / o.view) + 2);
      }
    });
  }
  addEventListener('resize', layout);
  layout();
  document.fonts?.ready.then(layout);

  // data-all のリンクは、出っ張っているカードのカテゴリ（data-cat）の作例一覧へ「ALL ○○ →」と向ける。
  // 出っ張っているカードがなければ「ALL CONTENTS →」（全部の一覧）。リンク自体は装飾（data-follow）と同じに動く
  const all = document.querySelector('[data-all]');
  const pointAll = () => {
    for (const o of cards) o.el.classList.toggle('is-selected', !!o.raised);   // 選択中（出っ張っている）カードは地と文字の色を入れ替える
    if (!all) return;
    const el = cards.find(o => o.raised && o.el.dataset.cat)?.el;
    all.href = el ? `./works.html?c=${el.dataset.cat}` : './works.html';
    all.classList.toggle('is-selected', !!el);   // 01・02 を選んでいる間は、ホバーと同じ色にする
    all.querySelector('[data-all-label]').textContent = `ALL ${el ? el.querySelector('.card__name').textContent : 'CONTENTS'}`;
  };
  // 押している間（マウス・指・Enter・Space）は凹む。離すと、平らだったものは出っ張り、出っ張っていたものは平らに戻る。
  // ホバーでは何も起こらない。押したまま外へ出たとき・中断したときは、出っ張り／平らを切り替えずに元へ戻す
  // data-link のカード（プロフィールなど）は凹むだけで出っ張らず、装飾も動かさない（離すとリンク先へ移る）
  for (const o of cards) {
    o.link = o.el.hasAttribute('data-link');
    const press = () => { if (o.el.classList.contains('is-live')) return; o.press = true; o.pressUntil = performance.now() + PRESS_MIN; o.fromFlat = !o.raised; if (!o.link) active = o; };
    const release = commit => {
      if (o.press && commit && !o.link) {
        o.raised = !o.raised;
        if (o.raised) for (const p of cards) if (p !== o) p.raised = false;   // 出っ張るのは 1 枚だけ。ほかは同時に平らへ戻す
        pointAll();
      }
      o.press = false;
    };
    o.el.addEventListener('pointerdown', e => { if (e.button === 0) press(); });
    o.el.addEventListener('pointerup', () => release(true));
    o.el.addEventListener('pointerleave', () => release(false));
    o.el.addEventListener('pointercancel', () => release(false));
    o.el.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) press(); });
    o.el.addEventListener('keyup', e => { if (e.key === 'Enter' || e.key === ' ') release(true); });
    o.el.addEventListener('blur', () => release(false));
  }
  // 01〜03 以外の場所を押したら、出っ張っているカードを平らに戻す（装飾も一緒に戻る）。装飾の MORE ボタンと「ALL ○○ →」は除く
  addEventListener('pointerdown', e => {
    if (e.button === 0 && !cards.some(o => o.el.contains(e.target)) && !e.target.closest('.card__more, [data-all], [data-modal], [data-work].is-live')) {
      for (const o of cards) o.raised = false;
      pointAll();
    }
  });

  // スマホで装飾の代わりをしている 01・02 は、画像が出きっている間（is-live）は作例のサムネイルになり、
  // 押すと data-work-href の作例サイトを別のタブで開く（カード本来の動き・リンク・モーダルは止める）
  for (const o of cards) if (o.el.dataset.workHref) {
    o.el.addEventListener('click', e => {
      if (!o.el.classList.contains('is-live')) return;
      e.preventDefault(); e.stopImmediatePropagation();
      open(o.el.dataset.workHref, '_blank', 'noopener');
    }, true);
  }
  // 作例のサムネイル（data-work）は、画像が出きっている間だけ作例サイトへ移れる（平らなとき・出る途中は押しても何もしない）
  for (const o of objs) if (o.el.hasAttribute('data-work')) {
    o.el.addEventListener('click', e => { if (!o.el.classList.contains('is-live')) e.preventDefault(); });
  }

  renderer.setAnimationLoop(() => {
    camera.position.set(0, 0, dist);
    camera.lookAt(0, 0, 0);
    uniforms.uScroll.value = scrollY;

    const now = performance.now();
    // 装飾は最後に押したカードと同じ目標・同じ速さで動く（押すカードが変わったときも跳ばずにつながる）。
    // スマホでは 3 枚の装飾を出さず、出っ張っている（これから出っ張る）カード以外の 01・02 が装飾の代わりになって同じように動く
    const lead = active && (active.raised || (active.press || now < active.pressUntil) && active.fromFlat) ? active : null;
    for (const o of objs) {
      // モーダルは開いている間だけ浮く。開いている間はほかの要素を平らにする（閉じると元の高さに戻る）
      if (o.modal) {
        o.follow = o.switching = false;
        if (modal === o.el && closing) {
          // 閉じる：すぐに沈み始め、決まった時間で平らへ（なめらかに動き出し、ゆっくり着地する）
          o.closeAt ??= now;
          o.closeFrom ??= o.amt;
          const k = reduceMotion ? 1 : Math.min((now - o.closeAt) / MODAL_CLOSE, 1);
          o.amt = o.closeFrom * (1 - (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2));
          if (k >= 1) { o.closeAt = o.closeFrom = null; finishClose(); }
        } else o.amt += ((modal === o.el ? 1 : 0) - o.amt) * (reduceMotion ? 1 : 0.1);
        continue;
      }
      o.follow = !cards.includes(o) || (sp && !!lead && lead !== o);
      const src = o.follow ? active : o;
      const pressed = !!src && (src.press || now < src.pressUntil);
      const goal = modal && !closing ? 0 : pressed ? -SINK : src?.raised ? 1 : 0;   // モーダルを閉じ始めたら、沈むのと同時に元の高さへ戻る
      o.switching = pressed && src.fromFlat;   // 平らだったカードを押している（離すと出っ張る）
      const ease = reduceMotion ? 1 : pressed ? 0.25 : 0.1;   // 凹むときは素早く
      o.amt += (goal - o.amt) * ease;
    }
    objs.forEach((o, i) => {
      uniforms.uAmt.value[i] = o.hidden ? 0 : o.amt;
      // カードの地と枠線を、立体物の上面と同じ見た目の大きさまで広げる（凹んだときは縮める。芯から測るので四辺ほぼ同じ幅）。
      // 文字は縦横同じ倍率で、長い辺の広がりに合わせて少しだけ大きく（小さく）する
      const h = LIFT * cell * o.amt;
      const [ex, ey] = spread(o.W, o.H, o.a, o.b, 1);
      const gx = ex * h / (o.view + Math.max(-h, 0)), gy = ey * h / (o.view + Math.max(-h, 0));
      o.el.style.setProperty('--gx', `${gx}px`);
      o.el.style.setProperty('--gy', `${gy}px`);
      o.el.style.setProperty('--zoom', 1 + Math.min(gx / o.W, gy / o.H));
      if (!o.modal) o.el.style.zIndex = o.amt > 0.001 ? 2 : '';   // 浮いたカードは隣のカードより手前（モーダルはいつもいちばん上）
      if (o.photo && !o.hidden) {
        // 01〜03 は装飾の代わりをしている間だけ画像に替わる。文字は 1 マスずつ消え、戻るときは画像が消えきってから 1 マスずつ戻る
        const card = cards.includes(o);
        drawPhoto(o.photo, card && !o.follow ? 0 : Math.min(Math.max(o.amt, 0), 1), gx, gy, now, o.switching, card && o.follow);
        if (card) {
          o.el.classList.toggle('is-decor', o.follow || o.photo.f > 0);
          o.el.classList.toggle('is-live', !!o.el.dataset.workHref && o.follow && o.photo.t > 0.97);
        } else o.el.classList.toggle('is-live', o.photo.t > 0.97);
      }
    });

    renderer.render(scene, camera);
  });
}

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
} catch (e) {
  console.warn('WebGL unavailable, falling back to CSS grid', e);
}

if (renderer) {
  document.body.classList.add('webgl');
  renderer.setClearColor(PAPER, 1);
  start(renderer);
}
