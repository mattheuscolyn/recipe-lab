import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { emptyPersonalData } from '../domain/personalData'
import { usePersonalData } from './usePersonalData'

describe('usePersonalData persistence status', () => {
  it('switches to temporary-memory status when a browser write fails', () => {
    const storage = { getItem: () => null, setItem: () => { throw new Error('quota exceeded') } }
    const { result } = renderHook(() => usePersonalData(new Set(), storage))
    let persistence: ReturnType<typeof result.current.replaceData> | undefined
    act(() => { persistence = result.current.replaceData(emptyPersonalData()) })
    expect(persistence).toMatchObject({ persisted: false, error: expect.stringContaining('could not be saved') })
    expect(result.current.persistent).toBe(false)
    expect(result.current.storageError).toMatch(/could not be saved/i)
    expect(result.current.data).toEqual(emptyPersonalData())
  })
})
