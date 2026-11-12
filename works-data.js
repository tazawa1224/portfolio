// 作例のリスト。作例一覧のページ（works.js）と、トップの作例一覧のモーダル（works-modal.js）で使う。
// cat = カテゴリ、title = 名前、note = 右下の一言。
// 公開した作例は href = 作例サイト（別のタブで開く）、thumb = サムネイル画像、focus = 画像のどこを見せるか（CSS の object-position）
export const WORKS = [
  { cat: 'web', title: '土の子FARM', note: 'VIEW SITE ↗',
    href: 'https://tazawa1224.github.io/tsuchinoko-firm/%E5%9C%9F%E3%81%AE%E5%AD%90FARM%20SP.dc.html',
    thumb: './assets/portfolio/works/tsuchinoko-farm.jpg', focus: '50% 55%' },
  { cat: 'web', title: 'ALONGSIDE PARTNERS', note: 'VIEW SITE ↗',
    href: 'https://tazawa1224.github.io/ALONGSIDE-PARTNERS/',
    thumb: './assets/portfolio/works/alongside-partners.jpg', focus: '70% 40%' },
  { cat: 'web',   title: 'PROJECT 03', note: 'COMING SOON' },
  { cat: 'app',   title: 'PROJECT 01', note: 'COMING SOON' },
  { cat: 'app',   title: 'PROJECT 02', note: 'COMING SOON' },
  { cat: 'app',   title: 'PROJECT 03', note: 'COMING SOON' },
];
// カテゴリの名前（トップの 01 のカードと同じ。data-cat と対応。02 はプロフィールなので作例のカテゴリではない）
export const CATS = { web: 'WEB DESIGN', app: 'APPLICATION' };
