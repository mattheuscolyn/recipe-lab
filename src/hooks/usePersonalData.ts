import { useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { emptyPersonalData, loadPersonalData, savePersonalData, type PersonalData } from '../domain/personalData'

function browserStorage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null }
}

export function usePersonalData() {
  const [initial] = useState(() => loadPersonalData(browserStorage()))
  const [data, setDataState] = useState<PersonalData>(initial.data)
  const dataRef = useRef(initial.data)
  const [storageError, setStorageError] = useState<string | null>(initial.error)

  const setData: Dispatch<SetStateAction<PersonalData>> = (action) => {
    const next = typeof action === 'function' ? action(dataRef.current) : action
    dataRef.current = next
    setDataState(next)
    const error = savePersonalData(initial.persistent ? browserStorage() : null, next)
    if (error !== storageError) setStorageError(error)
  }

  const replaceData = (next: PersonalData) => setData(next)
  const resetTemporary = () => replaceData(emptyPersonalData())
  return { data, setData, replaceData, resetTemporary, storageError, loaded: true, persistent: initial.persistent }
}
