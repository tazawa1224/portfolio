// 作例一覧（works.html）。?c= のカテゴリ（web / app。なしで全部）の作例を方眼に並べる。
// main-portfolio.js より先に読み込み、カードを並べ終えてから方眼と立体物を作らせる

// 作例とカテゴリの名前は works-data.js（トップの作例一覧のモーダルと共通）
import { WORKS, CATS } from './works-data.js';

const q = new URLSearchParams(location.search).get('c');
const cat = Object.hasOwn(CATS, q) ? q : null;
const list = WORKS.filter(w => !cat || w.cat === cat);
const name = cat ? CATS[cat] : 'ALL';
document.title = `${name} WORKS | TAZAWA PORTFOLIO`;

// 置き場所。l = 横長の画面（16 列）、p = 縦長の画面（8 列）での [左上の列, 行, 幅, 高さ]（マス）
const place = (l, p) => `--c:${l[0]}; --r:${l[1]}; --w:${l[2]}; --h:${l[3]};  --mc:${p[0]}; --mr:${p[1]}; --mw:${p[2]}; --mh:${p[3]};`;

// 上の 2 行：見出し・カテゴリの切り替え・トップへ戻る
let html = `
  <h1 class="card card--title" style="${place([0, 0, 7, 2], [0, 0, 8, 2])}">
    <span>${name}</span><span>WORKS</span>
  </h1>
  <nav class="card card--index card--cats" aria-label="カテゴリ" style="${place([9, 0, 4, 2], [3, 2, 5, 2])}">
    ${[[null, 'ALL'], ...Object.entries(CATS)].map(([c, n]) =>
      `<a href="./works.html${c ? `?c=${c}` : ''}"${c === cat ? ' aria-current="page"' : ''}>${n}</a>`).join('')}
  </nav>
  <a class="card card--index card--all" href="./index.html" style="${place([13, 0, 3, 2], [0, 2, 3, 2])}">
    <span>← TOP</span><span>${String(list.length).padStart(2, '0')} WORKS</span>
  </a>`;

// 作例：横長は 4 行目から 4×3 マスを 3 枚ずつ（間は 2 マス）。縦長は 6×3 マスを左右交互に
// 公開した作例（href あり）は作例サイトへのリンク（別のタブ）。押している間だけ凹み、離すと開く（data-link）
list.forEach((w, i) => {
  const tag = w.href ? 'a' : 'button';
  const attrs = w.href ? `href="${w.href}" target="_blank" rel="noopener" data-link` : 'type="button"';
  html += `
  <${tag} class="card card--link" data-card ${attrs}
          style="${place([(i % 3) * 6, 3 + Math.floor(i / 3) * 4, 4, 3], [i % 2 ? 2 : 0, 5 + i * 4, 6, 3])}">
    <span class="card__no">${String(i + 1).padStart(2, '0')}</span>
    <span class="card__name">${w.title}</span>
    <span class="card__go">${w.href || cat ? w.note : CATS[w.cat]}</span>
  </${tag}>`;
});

// いちばん下の行：フッター。行数は作例の数に合わせて増やす（横長は最低でもトップと同じ 10 行）
const rowsL = Math.max(10, 3 + Math.ceil(list.length / 3) * 4 + 1), rowsP = 5 + list.length * 4 + 1;
html += `
  <footer class="card card--foot" style="${place([5, rowsL - 1, 5, 1], [0, rowsP - 1, 5, 1])}">
    <span>© 2026 TAZAWA</span><span>DESIGN / CODE</span>
  </footer>`;

document.querySelector('.board').innerHTML = html;
// main-portfolio.js は --rows を読んでマスの大きさを決める
const style = document.createElement('style');
style.textContent = `:root { --rows: ${rowsL}; } @media (max-aspect-ratio: 1/1), (max-width: 760px) { :root { --rows: ${rowsP}; } }`;
document.head.append(style);
