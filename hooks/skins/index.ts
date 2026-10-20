import type { Skin } from '../mascot'
import { type Mode, mode } from '../mode'
import { accountant } from './accountant'
import { csikos } from './csikos'
import { dragon } from './dragon'
import { juhasz } from './juhasz'
import { kofa } from './kofa'
import { matyo } from './matyo'
import { miser } from './miser'
import { paraszt } from './paraszt'
import { pirate } from './pirate'
import { squirrel } from './squirrel'

/** Each mode's skins, its free default first. */
export const SKINS_BY_MODE: Readonly<Record<Mode, readonly Skin[]>> = {
  frugalitas: [miser, accountant, squirrel, pirate, dragon],
  fukarlec: [paraszt, csikos, kofa, juhasz, matyo],
}

export const SKINS: readonly Skin[] = [...SKINS_BY_MODE.frugalitas, ...SKINS_BY_MODE.fukarlec]

/** The skins of the current mode. */
export const modeSkins = (): readonly Skin[] => SKINS_BY_MODE[mode()]

export const skinById = (id: string | undefined): Skin => modeSkins().find(s => s.id === id) ?? modeSkins()[0]!
