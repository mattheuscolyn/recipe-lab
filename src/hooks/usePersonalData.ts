import { useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { emptyPersonalData, loadPersonalData, savePersonalData, type IngredientVariantCatalog, type PersonalData, type StorageLike } from '../domain/personalData'

function browserStorage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null }
}

export type PersistenceResult = { persisted: boolean; error: string | null }

export function usePersonalData(knownRecipeIds?: ReadonlySet<string>, storageOverride?: StorageLike | null, ingredientCatalog?: IngredientVariantCatalog) {
  const [storage] = useState(() => storageOverride === undefined ? browserStorage() : storageOverride)
  const [initial] = useState(() => loadPersonalData(storage, knownRecipeIds, ingredientCatalog))
  const [data, setDataState] = useState<PersonalData>(initial.data)
  const dataRef = useRef(initial.data)
  const [storageError, setStorageError] = useState<string | null>(initial.error)
  const [persistent, setPersistent] = useState(initial.persistent)

  const commitData = (action: SetStateAction<PersonalData>): PersistenceResult => {
    const next = typeof action === 'function' ? action(dataRef.current) : action
    dataRef.current = next
    setDataState(next)
    const error = savePersonalData(storage, next)
    setStorageError(error)
    setPersistent(!error)
    return { persisted: !error, error }
  }

  const setData: Dispatch<SetStateAction<PersonalData>> = (action) => { commitData(action) }
  const replaceData = (next: PersonalData) => commitData(next)
  const resetTemporary = () => replaceData(emptyPersonalData())
  return { data, setData, replaceData, resetTemporary, storageError, recoveryBackup: initial.recoveryBackup, loaded: true, persistent }
}
