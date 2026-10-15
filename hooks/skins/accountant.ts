import type { Skin } from '../mascot'

// The bean counter: green eyeshade visor, slicked hair, round glasses, pencil behind
// the ear, white shirt with sleeve garters, suspenders and a narrow tie, ledger in hand.
export const accountant: Skin = {
  id: 'accountant',
  name: 'Bean Counter',
  description: 'Green eyeshade, pencil behind the ear, the ledger always balanced.',
  price: 150,
  palette: {
    H: 0x3b2a1e, h: 0x5a4130, // slicked hair
    V: 0x1f6b3a, v: 0x5fbf7a, // eyeshade band, translucent brim
    S: 0xe0a882, s: 0xbf8460, r: 0xd98a7a, R: 0xcf7466, // skin, shade, cheeks, nose
    g: 0xbcb27c, // forehead tinted green under the visor
    l: 0x9a4a3a, // lips
    B: 0x3b2a1e, E: 0x1a1a1a, // brows, eyes and mouth
    G: 0x333333, L: 0xcfe6f0, // glasses frame, lenses
    Y: 0xf2c230, y: 0x8a5a2b, // pencil, its tip
    W: 0xf5f2ea, w: 0xd3cbb9, // shirt
    U: 0x8b1e1e, A: 0x8b1e1e, // suspenders, sleeve garters
    T: 0x23305e, t: 0x18213f, // tie
    K: 0x2f4f2f, k: 0xf0e8d0, M: 0x9b2d20, o: 0xd8b04a, // ledger cover, pages, label, gilt
    P: 0x4a4f57, p: 0x363a40, // trousers
    C: 0x141414, c: 0x4a4a4a, // shoes
    D: 0x6fb7ff, // sweat
    m: 0x9a9a9a, // steam
    Q: 0xfaf6e8, // adding-machine tape
  },
  rows: [
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........hhHHHHHH........',
    '.......hHHHHHHHHH.......',
    '.......HHHHHHHHHH.......',
    '.....VVVVVVVVVVVVVV.....',
    '....vvvvvvvvvvvvvvvv....',
    '.....vvvvvvvvvvvvvv.....',
    '.......HggggggggHY......',
    '.......SBBBSSBBBSy......',
    '.......SGGGSSGGGS.......',
    '.......GLELGGLELG.......',
    '.......SGGGRRGGGS.......',
    '.......SrSSSSSSrS.......',
    '.......SSSllllSSS.......',
    '.......sSSSSSSSSs.......',
    '........sSSSSSSs........',
    '.........sSSSSs.........',
    '......WWWWsSSsWWWW......',
    '....WWWWUWWTTWWUWWWW....',
    '...WWWWwUWWTTWWUwWWWW...',
    '..WWWWwWUWWTTWWUWwWWWW..',
    '..WAAAWWUWWTTWWUWWAAAW..',
    '..wWWWwWUWWttWWUWwWWWw..',
    '..SSSS.WUWWWWWWUW.SSSS..',
    '..SSSs.WUWWWWWWUW.sSSS..',
    '...SSKKKKKKKKKKKKKKSS...',
    '...sSKKKKMMMMMMKKKKSs...',
    '....KKKKKMooooMKKKKK....',
    '....KKKKKMMMMMMKKKKK....',
    '....kkkkkkkkkkkkkkkk....',
    '......PPPPPPPPPPPP......',
    '......PPPPPPpPPPPP......',
    '......PPPPPp.PPPPP......',
    '......PPPPp..pPPPP......',
    '......PPPPp..pPPPP......',
    '......PPPPp..pPPPP......',
    '......PPPPp..pPPPP......',
    '.....CCCCCC..CCCCCC.....',
    '.....CcCCCC..CCCCcC.....',
  ],
  worried: [
    [12, 8, 'BBB'], // brows up into the forehead
    [12, 13, 'BBB'],
    [13, 7, 'SSSSSSSSSS'],
    [18, 10, 'lEEl'],
    [19, 11, 'EE'], // mouth falls open
    [13, 5, 'D'], // sweat
    [14, 5, 'D'],
    [16, 18, 'D'],
  ],
  angry: [
    [12, 8, 'B'], // outer brows high...
    [12, 15, 'B'],
    [13, 7, 'SSBBSSBBSS'], // ...inner ones pulled down
    [18, 9, 'SEEEES'], // a hard frown, corners down
    [19, 9, 'E'],
    [19, 14, 'E'],
    [12, 17, '.'], // pencil snapped, halves flying
    [13, 17, '.'],
    [9, 20, 'Yy'],
    [11, 20, 'yY'],
    [26, 0, 'Q'], // adding-machine tape everywhere
    [27, 1, 'Q'],
    [26, 23, 'Q'],
    [27, 22, 'Q'],
    [29, 22, 'QQ'],
    [5, 6, 'm.m'], // steam
    [4, 7, 'm'],
    [5, 15, 'm.m'],
    [4, 16, 'm'],
  ],
  angryRecolor: { S: 0xe07a62, r: 0xe07a62, s: 0xb85a48, g: 0xc98a5e },
}
