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

export interface StoryLine<T extends string> {
  shot: T;
  text: string;
  duration: number;
}

export function introScript(race: RaceId): StoryLine<ShotId>[] {
  const l = LORE[race];
  return [
    { shot: 'prosperity', duration: 9, text: `很久以前，${l.kingdom}在${l.king}的治理下，享受著漫長的和平。` },
    {
      shot: 'invasion',
      duration: 10,
      text: `直到那一夜，${DEMON_LORD}從深淵歸來。不死族、哥布林、獸人，以及背叛王國的叛軍，全都成了他的爪牙。`,
    },
    { shot: 'lastStand', duration: 11, text: `${l.king}率領最後的騎士死守${l.capital}，在城門前與魔王決戰……最終倒下了。` },
    { shot: 'exile', duration: 9, text: `年幼的${l.prince}在忠臣護送下逃出火海，躲進了邊境的曙光堡。` },
    { shot: 'oath', duration: 10, text: `多年後，${l.prince}拾起父親的劍，立下誓言：奪回每一寸國土，讓${DEMON_LORD}血債血償！` },
    { shot: 'map', duration: 8, text: `如今王國只剩下最後一塊領地。收復失土、累積力量，最終奪回${l.capital}！` },
  ];
}

export function endingScript(race: RaceId): StoryLine<EndingShotId>[] {
  const l = LORE[race];
  return [
    { shot: 'fall', duration: 8, text: `${DEMON_LORD}在王座前發出最後的嘶吼，化為灰燼。籠罩大地的黑暗終於散去。` },
    { shot: 'return', duration: 9, text: `${l.prince}踏進殘破的${l.capital}，在父親倒下的地方，將他的佩劍重新插回王座旁。` },
    { shot: 'coronation', duration: 10, text: `在子民的歡呼聲中，${l.prince}加冕為王。${l.kingdom}的新紀元，就此展開。` },
  ];
}
