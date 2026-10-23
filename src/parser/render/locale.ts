/** 文書クラスの言語で変わる文言（LaTeX の \figurename, \abstractname, \today など） */
export interface Locale {
  figureName: string;
  tableName: string;
  abstractName: string;
  refName: string;
  listingName: string;
  /** キャプションの頭（「図1　」/「Figure 1: 」） */
  captionLabel(name: string, num: string): string;
  today(): string;
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
  // jsclasses の既定は西暦
  today: () => {
    const d = new Date();
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
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
