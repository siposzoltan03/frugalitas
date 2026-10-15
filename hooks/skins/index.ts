import type { Skin } from '../mascot'
import { accountant } from './accountant'
import { dragon } from './dragon'
import { miser } from './miser'
import { pirate } from './pirate'
import { squirrel } from './squirrel'

export const SKINS: readonly Skin[] = [miser, accountant, squirrel, pirate, dragon]

export const skinById = (id: string | undefined): Skin => SKINS.find(s => s.id === id) ?? miser
