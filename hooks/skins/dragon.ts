import type { Skin } from '../mascot'

// A chubby green dragon sitting smugly on its gold hoard: little horns, cream
// belly, folded bat wings, a curled tail, and coins piled up to its feet.
export const dragon: Skin = {
  id: 'dragon',
  name: 'Hoard Dragon',
  description: 'A smug little dragon on a pile of gold. Breathes fire at overspending.',
  price: 300,
  palette: {
    G: 0x4caf50, g: 0x2e7d32, L: 0x81c784, // scales, shadow, highlight
    C: 0xf3e5ab, c: 0xd9c78a, // belly plates
    H: 0xe8dcc0, h: 0xb8a98a, // horns and claws
    V: 0x66bb6a, w: 0x1b5e20, // wing membrane, wing bones
    E: 0xffffff, P: 0x1a1a1a, // eyes, pupils
    N: 0x1b3d1f, M: 0x1b3d1f, // nostrils, smug grin
    Y: 0xffc107, y: 0xc79100, O: 0xfff176, k: 0x8a6400, // gold coins, shade, glint, rim
    r: 0x9c1b1b, // ruby shade
    F: 0xff6d00, f: 0xffd54f, R: 0xe53935, // fire
    D: 0x6fb7ff, // sweat drop
    m: 0x9a9a9a, // smoke
  },
  rows: [
    '........................',
    '.......H........H.......',
    '.......hH......Hh.......',
    '........hGGGGGGh........',
    '......GGLLGGGGLLGG......',
    '.....GGLGGGGGGGGLGG.....',
    '.....GgggGGGGGGgggG.....',
    '.....GEEPGGGGGGEEPG.....',
    '.....GGGGGGGGGGGGGG.....',
    '....GGGGGGGGGGGGGGGG....',
    '....GGNGGGGGGGGGGNGG....',
    '....gGGGGGGGGGGMMGGg....',
    '.....gGGMMMMMMMGGGg.....',
    '......gGGGGGGGGGGg......',
    '.......GGGGGGGGGG.......',
    '..w....GGCCCCCCGG....w..',
    '.wVw..GGCCCCCCCCGG..wVw.',
    '.wVVw.GGCCCCCCCCGG.wVVw.',
    'wVVVwGGGCcCCCCcCGGGwVVVw',
    '.wVVwGGCCCCCCCCCCGGwVVw.',
    '..wVwGGCCCCCCCCCCGGwVw..',
    '...wwGGCcCCCCCCcCGGww...',
    '.....GGCCCCCCCCCCGG.....',
    '....GGGCCCCCCCCCCGGG....',
    '....GG.GCcCCCCcCG.GG....',
    '....gL.GCCCCCCCCG.Lg....',
    '......GGCCCCCCCCGG..LGG.',
    '.....GGGCcCCCCcCGGG..GG.',
    '....GGGGGCCCCCCGGGGG.GG.',
    '...GGGGGGGGGGGGGGGGGGGG.',
    '..gGGGGgGGGGGGGGgGGGGg..',
    '..gHgHg..........gHgHg..',
    '....YOYkYOYkYOYkYOYk....',
    '...kyYykyYykyYykyYyky...',
    '..YOYkYOYkYOYkYOYkYOYk..',
    '.kyYykyYyRrYykyYykyYyky.',
    'YOYkYOYkYrrkYOYkYOYkYOYk',
    'yYykyYykyYykyYykyYykyYyk',
    'YkYOYkYOYkYOYkYOYkYOYkYO',
    'ykyYykyYykyYykyYykyYykyY',
    'YOYkYOYkYOYkYOYkYOYkYOYk',
    'yYykyYykyYykyYykyYykyYyk',
    'YkYOYkYOYkYOYkYOYkYOYkYO',
    'ykyYykyYykyYykyYykyYykyY',
  ],
  worried: [
    [5, 5, 'GGEEGGGGGGGEEG'], // eyes wide open...
    [6, 5, 'GEEEEGGGGGEEEE'],
    [7, 5, 'GEPEEGGGGGEPEE'], // ...tiny pupils
    [11, 16, 'GG'],
    [12, 5, '.gGGGMGMGMGGGg.'], // wobbly mouth
    [4, 4, 'D'], // sweat
    [5, 3, 'D'],
    [6, 20, 'D'],
    [23, 4, 'hYOh'], // clutching a coin to its chest
    [24, 4, 'GyYG'],
  ],
  angry: [
    [6, 5, 'GPggGGGGGGggPG'], // brows slammed down
    [7, 5, 'GGEPGGGGGGPEGG'], // narrowed eyes
    [12, 7, 'MMMMMMMMMMMRff'], // jaw open, fire out of the mouth
    [11, 16, 'MRff'],
    [10, 19, 'fFff'],
    [9, 21, 'fF'],
    [8, 22, 'f'],
    [11, 20, 'FfFf'],
    [12, 20, 'fFFf'],
    [13, 18, 'RFfFf'],
    [14, 19, 'fFf'],
    [15, 21, 'f'],
    [2, 3, 'm.m'], // smoke from the nostrils
    [1, 4, 'm'],
    [2, 18, 'm.m'],
    [1, 19, 'm'],
  ],
  angryRecolor: { G: 0xc0453a, g: 0x8e2a22, L: 0xe57373, V: 0xd46a5e, w: 0x6d1b14 },
}
