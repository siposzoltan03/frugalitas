import type { Skin } from '../mascot'

// Captain Thrift: black tricorn with a little skull, eyepatch, bushy dark beard,
// red long coat with gold buttons, striped shirt, wide belt, a peg leg and a small
// chest of gold coins at his feet.
export const pirate: Skin = {
  id: 'pirate',
  name: 'Captain Thrift',
  description: 'Tricorn, eyepatch, peg leg and a chest of hoarded gold.',
  price: 200,
  palette: {
    K: 0x1a1a1a, k: 0xc9a032, W: 0xf0f0f0, // tricorn, gold trim, skull
    S: 0xe0a882, s: 0xbf8460, r: 0xd98a7a, R: 0xcf7466, // skin, shade, cheek, nose
    E: 0x111111, q: 0x2a2a2a, // eye and eyepatch, strap
    B: 0x3b2a1e, b: 0x2a1d14, // beard
    C: 0xa8282a, d: 0x7e1c1e, o: 0xe0b83a, // coat, coat shade, gold button
    L: 0xf2efe6, n: 0x2b3f7a, // striped shirt
    Z: 0x3a2615, Y: 0xe0b83a, // belt, buckle
    G: 0x3a3a4a, F: 0x141414, f: 0x4a4a4a, T: 0x8a5a2b, // trousers, boot, boot shine, peg leg
    X: 0x7a4a22, x: 0x4a2c12, O: 0xf2c94c, c: 0xc9a032, // chest, chest band, coins
    D: 0x6fb7ff, // sweat
    m: 0x9a9a9a, // steam
    M: 0xcfd6dc, h: 0xd4a83a, // cutlass blade, hilt
  },
  rows: [
    '........................',
    '........................',
    '........................',
    '..........KKKK..........',
    '........KKKKKKKK........',
    '.......KKKWWWWKKK.......',
    '......KKKKWKKWKKKK......',
    '.....KKKKKWWWWKKKKK.....',
    '...KKKKKKKKWKWKKKKKKK...',
    '..KkKKKKKKKKKKKKKKKKkK..',
    '...kkKKKKKKKKKKKKKKkk...',
    '.......SSSSqSSSSS.......',
    '.......SBBSSqSBBS.......',
    '.......SSESSqEESS.......',
    '.......SrSSRREEsS.......',
    '.......BSSSSSSSSB.......',
    '......BBBBBBBBBBBB......',
    '.....BBBBBsSSsBBBBB.....',
    '.....BBBbBBBBBBbBBB.....',
    '......BBbBBBBBBbBB......',
    '.......BBbBBBBbBB.......',
    '....CCCCBBbBBbBBCCCC....',
    '...CCCCCLnBBBBnLCCCCC...',
    '..CCCCCCLLLLLLLLCCCCCC..',
    '..CCdCConnnnnnnnoCCdCC..',
    '.CCCdCCCLLLLLLLLCCCdCCC.',
    '.CCCdCConnnnnnnnoCCdCCC.',
    '.CCCdCZZZZZYYZZZZZCdCCC.',
    '.CCCdCCCGGGGGGGGCCCdCCC.',
    '.SSCdCCCGGGGGGGGCCCdCSS.',
    '.sSCdCCCGGGGGGGGCCCdCSs.',
    '...CdCCCGGGGGGGGCCCdC...',
    '...CdCCCGGGGGGGGCCCdC...',
    '...CdCCGGGG..GGGGCCdC...',
    '...CCCCGGGG..GGGGCCCC...',
    '....ddd.GGG..GGG.ddd....',
    '........GGG..GGG........',
    '........GGG...T.........',
    '........GGG...T..OOcO...',
    '........FFF...T.OOcOOO..',
    '........FfF...T.XXXXXXX.',
    '.......FFFF...T.XxYYxXX.',
    '.......FFFF..TT.XXXXXXX.',
    '......FFFFF..TT.xxxxxxx.',
  ],
  worried: [
    [11, 7, 'SBBS'], // left brow jumps up
    [12, 7, 'SSSS'],
    [17, 11, 'EE'], // mouth falls open
    [12, 5, 'D'],
    [13, 5, 'D'],
    [13, 18, 'D'],
    [14, 18, 'D'],
  ],
  angry: [
    [12, 7, 'SBSSSqSSBS'], // outer brows high...
    [13, 10, 'B'], // ...inner brow pulled down
    // cutlass raised overhead in the left hand
    [1, 1, 'M'],
    [2, 1, 'M'],
    [3, 1, 'M'],
    [4, 1, 'M'],
    [5, 1, 'M'],
    [6, 1, 'M'],
    [7, 1, 'M'],
    [8, 1, 'M'],
    [9, 1, 'M'],
    [10, 0, 'hhh'],
    [11, 1, 'SS'],
    [12, 1, 'SS'],
    [13, 2, 'CC'],
    [14, 2, 'CC'],
    [15, 2, 'CC'],
    [16, 2, 'CC'],
    [17, 2, 'CC'],
    [18, 2, 'CC'],
    [19, 2, 'CC'],
    [20, 2, 'CC'],
    [21, 2, 'CC'],
    [29, 1, '..'],
    [30, 1, '..'],
    [3, 4, 'm.m'], // steam off the hat
    [2, 5, 'm'],
    [4, 19, 'm.m'],
    [3, 20, 'm'],
  ],
  angryRecolor: { S: 0xe07a62, r: 0xe07a62, s: 0xb85a48 },
}
