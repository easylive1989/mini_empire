/** Line icons of the 王國紋章 interface (24×24, 1.8 stroke, round caps). */
const PATHS = {
  coin: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z',
  castle: 'M4 20V9h3V6h2v3h2V6h2v3h2V6h2v3h3v11H4zM10 20v-4a2 2 0 0 1 4 0v4',
  swords: 'M4 4l9 9M20 4l-9 9M7 17l-3 3M17 17l3 3M6 14l4 4M18 14l-4 4',
  shield: 'M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-3z',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  skull: 'M12 3a7 7 0 0 0-7 7c0 2.5 1.3 4.2 3 5.2V19h8v-3.8c1.7-1 3-2.7 3-5.2a7 7 0 0 0-7-7zM9.5 10.5h.01M14.5 10.5h.01',
  map: 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15',
  sparkle: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6',
  lock: 'M7 11h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2zM8 11V8a4 4 0 0 1 8 0v3',
  music: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  musicOff: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM3 3l18 18',
  sound: 'M4 9h4l5-4v14l-5-4H4zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11',
  soundOff: 'M4 9h4l5-4v14l-5-4H4zM16 10l5 5M21 10l-5 5',
  gauge: 'M4 17a8 8 0 1 1 16 0M12 17l4.5-5.5M7 12.5l1 .7M12 9v1.2',
  home: 'M4 11l8-7 8 7M6 9.5V20h12V9.5',
  help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5h.01',
  play: 'M8 5l11 7-11 7z',
  back: 'M10 6l-6 6 6 6M4 12h16',
  next: 'M14 6l6 6-6 6M20 12H4',
  exit: 'M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10',
  check: 'M5 12l5 5 9-10',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  up: 'M12 19V5M6 11l6-6 6 6',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  crown: 'M4 18h16M5 18L3.5 8l5 4L12 5l3.5 7 5-4L19 18',
  army: 'M9 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.5a3 3 0 0 1 0 6M18 14c2 .8 3 2.8 3 6',
  tower: 'M8 21V10l-2-2V4h3v2h2V4h2v2h2V4h3v4l-2 2v11z',
  tent: 'M3 20L12 4l9 16H3zM12 20v-6',
  hammer: 'M14 6l4 4M12 8l-8 8 4 4 8-8M15 3l6 6-3 3-6-6z',
  fire: 'M12 21c-4 0-7-2.7-7-6.5 0-4 4-6.5 4-10.5 2.5 1.5 4 4 4 6 1-1 1.5-2.5 1.5-3.5 2.5 2 3.5 5 3.5 8C18 18.3 16 21 12 21z',
  skip: 'M5 5l9 7-9 7zM18 5v14',
  close: 'M6 6l12 12M18 6L6 18',
  scroll: 'M7 4h11a2 2 0 0 1 2 2v1H9M7 4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V9M7 4a2 2 0 0 1 2 2v12M12 11h5M12 15h5',
  warn: 'M12 4l9 16H3zM12 10v4M12 17.2h.01',
  target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM12 11.5h.01',
  replay: 'M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4',
  medal: 'M8 3h8l-2 6h-4zM12 21a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 12.5l1 2 2.2.3-1.6 1.5.4 2.2-2-1-2 1 .4-2.2-1.6-1.5 2.2-.3z',
} as const;

export type IconName = keyof typeof PATHS;

const NS = 'http://www.w3.org/2000/svg';

/** An inline stroke icon that inherits the text colour. */
export function icon(name: IconName, size = 18, opts: { fill?: boolean; strokeWidth?: number; cls?: string } = {}): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `ico ${opts.cls ?? ''}`.trim());
  if (opts.fill) {
    svg.setAttribute('fill', 'currentColor');
  } else {
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', String(opts.strokeWidth ?? 1.8));
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
  }
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', PATHS[name]);
  svg.append(path);
  return svg;
}

/** The kingdom crest: a heraldic shield in the race colour with a brass rim. */
export function crest(color: string, size = 28): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(Math.round(size * 1.15)));
  svg.setAttribute('viewBox', '0 0 24 28');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'crest');
  const shield = document.createElementNS(NS, 'path');
  shield.setAttribute('d', 'M12 1l10 4v8c0 7-4.6 11.4-10 14C6.6 24.4 2 20 2 13V5z');
  shield.setAttribute('fill', color);
  shield.setAttribute('stroke', '#e2b34a');
  shield.setAttribute('stroke-width', '1.4');
  const star = document.createElementNS(NS, 'path');
  star.setAttribute('d', 'M12 7l1.8 3.7 4 .6-2.9 2.8.7 4L12 16.2 8.4 18.1l.7-4-2.9-2.8 4-.6z');
  star.setAttribute('fill', '#f3e4bf');
  svg.append(shield, star);
  return svg;
}

/** A gold coin glyph for prices and treasury. */
export function coinIcon(size = 16): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'coin-ico');
  const outer = document.createElementNS(NS, 'circle');
  outer.setAttribute('cx', '12');
  outer.setAttribute('cy', '12');
  outer.setAttribute('r', '9');
  outer.setAttribute('fill', '#e2b34a');
  const inner = document.createElementNS(NS, 'circle');
  inner.setAttribute('cx', '12');
  inner.setAttribute('cy', '12');
  inner.setAttribute('r', '5.5');
  inner.setAttribute('fill', 'none');
  inner.setAttribute('stroke', '#9c7426');
  inner.setAttribute('stroke-width', '1.6');
  svg.append(outer, inner);
  return svg;
}
