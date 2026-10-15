import type { Skin } from '../mascot'

// Old Penny, the original miser: tall top hat, round spectacles, grey mutton chops,
// a frown, a dark tailcoat over a burgundy waistcoat with a gold watch chain,
// a cane in one hand and a bulging "$" money sack clutched in the other.
export const miser: Skin = {
  id: 'miser',
  name: 'Old Penny',
  description: 'The original miser: top hat, spectacles, cane and a bulging money sack.',
  price: 0,
  palette: {
    K: 0x1a1a1a, k: 0x3c3c3c, // top hat, highlight
    W: 0x6a1e24, // hat band, waistcoat
    H: 0xa8a8a8, B: 0x7a7a7a, // grey hair and mutton chops, brows
    S: 0xe8c4a0, s: 0xc49a78, R: 0xd8948a, // skin, shadow, nose
    G: 0xc8a040, E: 0x1a1a1a, // spectacle rims, eyes
    M: 0x8a4a40, // frowning mouth
    L: 0xf0ece0, // shirt collar
    C: 0x2a2438, c: 0x1a1626, // tailcoat, its shade
    O: 0xe0b040, // watch chain, cane knob
    P: 0x3a3a44, // trousers
    A: 0xb89a68, a: 0x8a7048, Y: 0xd4a017, // money sack, its shade, the "$"
    T: 0x5a3a20, // cane
    Z: 0x0e0e0e, z: 0x6a6a6a, // polished shoes, shine
    D: 0x6fb7ff, // sweat drop
    m: 0x9a9a9a, // steam
  },
  rows: [
    '........................',
    '........KKKKKKKK........',
    '........KkKKKKKK........',
    '........KkKKKKKK........',
    '........KkKKKKKK........',
    '........KkKKKKKK........',
    '........KkKKKKKK........',
    '........KkKKKKKK........',
    '........WWWWWWWW........',
    '........KKKKKKKK........',
    '.....KKKKKKKKKKKKKK.....',
    '.......HSSSSSSSSH.......',
    '.......HBBBSSBBBH.......',
    '.......HGEGSSGEGH.......',
    '......HHSSSRRSSSHH......',
    '......HHHSSSSSSHHH......',
    '......HHHSSMMSSHHH......',
    '......HHHSMSSMSHHH......',
    '.......HHsSSSSsHH.......',
    '........HsSSSSsH........',
    '.........LsSSsL.........',
    '.......CCLLWWLLCC.......',
    '.....CCCCCLWWLCCCCC.....',
    '....CCCCCcLWWLcCCCCC....',
    '...CCCCCCcWWWWcCCCCCC...',
    '..CCCcCCCcWOWWcCCCcCCC..',
    '..CCCcCCCcWWOWcCCCcCCC..',
    '..CCCcCCCcWWWOcCCCcCCC..',
    '..CCCcCCCcWWWWcCCCcCCC..',
    '..SOS.CCcCPPPPCcCC.SSS..',
    '...T..CCcCPPPPCcCC.aa...',
    '...T..CCcCPPPPCcCAAYAAA.',
    '...T..CCcCPPPPCcAAAYYAA.',
    '...T..CCcCPPPPCcAAYAAAAa',
    '...T..CCcCPPPPCcAAAYAAAa',
    '...T..CCcCPPPPCcAAAAYAAa',
    '...T..CCcCPPPPCcAAYYAAAa',
    '...T...CcPP..PPcaAAYAAa.',
    '...T.....PP..PP..aaaaaa.',
    '...T.....PP..PP.........',
    '...T.....PP..PP.........',
    '...T....ZZZ..ZZZ........',
    '...T...ZzZZ..ZZzZ.......',
    '...T..ZZZZZ..ZZZZZ......',
  ],
  worried: [
    [11, 7, 'HBBBSSBBBH'], // brows up into the forehead
    [12, 7, 'HSSSSSSSSH'],
    [11, 5, 'D'],
    [12, 5, 'D'],
    [13, 18, 'D'],
    [16, 6, 'HHHSSMMSSHHH'], // mouth open in alarm
    [17, 6, 'HHHSSMMSSHHH'],
  ],
  angry: [
    [12, 7, 'HSSBBBBSSH'], // brows knitted into a scowl
    [16, 6, 'HHHSMMMMSHHH'], // teeth gritted
    [17, 6, 'HHHSSSSSSHHH'],
    [3, 4, 'm.m'], // steam beside the hat
    [2, 5, 'm'],
    [3, 17, 'm.m'],
    [2, 18, 'm'],
    [29, 18, 'SSSS'], // both fists tight on the sack
    [30, 18, 'Saa'],
  ],
  angryRecolor: { S: 0xe8806a, s: 0xc0604c, R: 0xc0604c },
}
