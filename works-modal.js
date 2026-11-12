// トップ（index.html）の作例一覧のモーダル（#works）。「ALL ○○ →」から開く。
// 開くときに main-portfolio.js が送る modal-open で、押したリンクの ?c= のカテゴリの作例を並べる。中のカテゴリの切り替えはページを移らずに並べ直す
import { WORKS, CATS } from './works-data.js';

const el = document.getElementById('works');
if (el) {
  const show = cat => {
    const list = WORKS.filter(w => !cat || w.cat === cat);
    el.querySelector('#works-title').textContent = cat ? CATS[cat] : 'ALL';
    el.querySelector('[data-works-count]').textContent = `${String(list.length).padStart(2, '0')} WORKS`;
    el.querySelector('[data-works-cats]').innerHTML = [[null, 'ALL'], ...Object.entries(CATS)].map(([c, n]) =>
      `<button type="button" data-c="${c ?? ''}"${c === cat ? ' aria-current="true"' : ''}>${n}</button>`).join('');
    // 公開した作例（href あり）はサムネイル付きのリンクにして、作例サイトを別のタブで開く。まだのものはグレーの地に「COMING SOON」
    el.querySelector('[data-works-list]').innerHTML = list.map((w, i) => {
      const thumb = w.thumb
        ? `<span class="modal__work-thumb"><img src="${w.thumb}" alt="" loading="lazy" style="object-position:${w.focus ?? '50% 50%'}"></span>`
        : '<span class="modal__work-thumb modal__work-thumb--soon" aria-hidden="true"><span>COMING</span><span>SOON</span></span>';
      const inner = `${thumb}<span class="modal__work-meta"><span>${String(i + 1).padStart(2, '0')}</span><span class="modal__work-name">${w.title}</span><span>${w.href ? w.note : cat ? w.note : CATS[w.cat]}</span></span>`;
      return w.href
        ? `\n      <li><a class="modal__work" href="${w.href}" target="_blank" rel="noopener" aria-label="${w.title}（作例のサイトを開く）">${inner}</a></li>`
        : `\n      <li><div class="modal__work">${inner}</div></li>`;
    }).join('');
  };
  el.addEventListener('modal-open', e => {
    const q = new URL(e.detail.from.href, location.href).searchParams.get('c');
    show(Object.hasOwn(CATS, q) ? q : null);
  });
  el.querySelector('[data-works-cats]').addEventListener('click', e => {
    const b = e.target.closest('button[data-c]');
    if (!b) return;
    // 中身の入れ替えは main-portfolio.js の画面の切り替え（1 マスずつ替わる）に任せる。受け手がなければそのまま替える
    const update = () => { show(b.dataset.c || null); el.querySelector(`[data-works-cats] [data-c="${b.dataset.c}"]`).focus(); };
    if (document.dispatchEvent(new CustomEvent('fx-swap', { cancelable: true, detail: { el, update } }))) update();
  });
}
