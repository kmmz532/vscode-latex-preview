/** 文書クラスの言語で変わる文言（LaTeX の \figurename, \abstractname, \today など） */
export interface Locale {
  figureName: string;
  tableName: string;
  abstractName: string;
  refName: string;
  listingName: string;
  /** キャプションの頭（「図1　」/「Figure 1: 」） */
  captionLabel(name: string, num: string): string;
  /** wareki は jsclasses の \和暦 が有効か（日本語以外では無視） */
  today(wareki?: boolean): string;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** jsarticle 系 */
const japanese: Locale = {
  figureName: '図',
  tableName: '表',
  abstractName: '概要',
  refName: '参考文献',
  listingName: 'Listing',
  captionLabel: (name, num) => `${name}${num}　`,
  // jsclasses の既定は西暦。\和暦 では令和で表す（令和元年は「元年」と書く）
  today: (wareki) => {
    const d = new Date();
    const y = d.getFullYear();
    const year = wareki && y >= 2019 ? `令和${y === 2019 ? '元' : y - 2018}` : String(y);
    return `${year}年${d.getMonth() + 1}月${d.getDate()}日`;
  },
};

/** article 系 */
const english: Locale = {
  figureName: 'Figure',
  tableName: 'Table',
  abstractName: 'Abstract',
  refName: 'References',
  listingName: 'Listing',
  captionLabel: (name, num) => `${name} ${num}: `,
  today: () => {
    const d = new Date();
    return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  },
};

export function localeFor(isJapanese: boolean): Locale {
  return isJapanese ? japanese : english;
}
