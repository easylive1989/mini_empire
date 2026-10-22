import type { RaceId } from '../types';

export interface KingdomLore {
  kingdom: string;
  king: string;
  prince: string;
  capital: string;
}

export const LORE: Record<RaceId, KingdomLore> = {
  human: { kingdom: '艾斯特蘭王國', king: '雷歐尼斯王', prince: '艾倫王子', capital: '白獅王城' },
  elf: { kingdom: '銀月森林王國', king: '伊洛溫王', prince: '林恩王子', capital: '世界樹之都' },
  dwarf: { kingdom: '鐵爐山王國', king: '巴爾金王', prince: '布洛克王子', capital: '鐵爐要塞' },
  angel: { kingdom: '天穹聖國', king: '賽拉菲恩王', prince: '艾利爾王子', capital: '天穹聖城' },
};

export const DEMON_LORD = '魔王莫爾加斯';

export type ShotId = 'prosperity' | 'invasion' | 'lastStand' | 'exile' | 'oath' | 'map';
export type EndingShotId = 'fall' | 'return' | 'coronation';

/**
 * One beat of a cutscene: a 3D shot with a subtitle, or an intertitle card (`shot: 'card'`) — a
 * full-screen framed line between shots, like the title cards of an old film.
 */
export interface StoryLine<T extends string> {
  shot: T | 'card';
  /** The subtitle of a shot, or the card's line. */
  text: string;
  duration: number;
  /** A shot's chapter heading, shown in the top letterbox. */
  chapter?: string;
  /** A card's small line above its text. */
  eyebrow?: string;
  /** The finale: the logo slams in `at` seconds into the beat and holds until it ends. */
  slam?: { at: number; title: string; sub: string };
}

export function introScript(race: RaceId): StoryLine<ShotId>[] {
  const l = LORE[race];
  return [
    { shot: 'card', eyebrow: '序章', text: '王國的黃昏', duration: 3.4 },
    { shot: 'prosperity', chapter: '第一幕・盛世', duration: 7.5, text: `很久以前，${l.kingdom}在${l.king}的治理下，享受著漫長的和平。` },
    {
      shot: 'invasion',
      chapter: '第二幕・深淵歸來',
      duration: 8.5,
      text: `直到那一夜，${DEMON_LORD}從深淵歸來。不死族、哥布林、獸人，以及背叛王國的叛軍，全都成了他的爪牙。`,
    },
    { shot: 'lastStand', chapter: '第三幕・最後的防線', duration: 9, text: `${l.king}率領最後的騎士死守${l.capital}，在城門前與魔王決戰……` },
    { shot: 'card', text: '王，倒下了。', duration: 2.8 },
    { shot: 'exile', chapter: '第四幕・流亡', duration: 8, text: `年幼的${l.prince}在忠臣護送下逃出火海，躲進了邊境的曙光堡。` },
    { shot: 'card', text: '多年以後——', duration: 2.6 },
    { shot: 'oath', chapter: '第五幕・誓言', duration: 8.5, text: `${l.prince}拾起父親的劍，立下誓言：奪回每一寸國土，讓${DEMON_LORD}血債血償！` },
    {
      shot: 'map',
      chapter: '終幕・反攻',
      duration: 10.5,
      text: `如今王國只剩下最後一塊領地。收復失土、累積力量，最終奪回${l.capital}！`,
      slam: { at: 6.5, title: '迷你帝國', sub: '王子的復國之戰' },
    },
  ];
}

export function endingScript(race: RaceId): StoryLine<EndingShotId>[] {
  const l = LORE[race];
  return [
    { shot: 'card', eyebrow: '終章', text: '新王的黎明', duration: 3.2 },
    { shot: 'fall', chapter: '第一幕・魔王的末日', duration: 8, text: `${DEMON_LORD}在王座前發出最後的嘶吼，化為灰燼。籠罩大地的黑暗終於散去。` },
    { shot: 'return', chapter: '第二幕・歸還', duration: 9, text: `${l.prince}踏進殘破的${l.capital}，在父親倒下的地方，將他的佩劍重新插回王座旁。` },
    {
      shot: 'coronation',
      chapter: '終幕・加冕',
      duration: 13,
      text: `在子民的歡呼聲中，${l.prince}加冕為王。${l.kingdom}的新紀元，就此展開。`,
      slam: { at: 9, title: '王國光復', sub: '— 全劇終 —' },
    },
  ];
}
