/// <reference lib="webworker" />
import { generateWeekDraft } from '../domain/weekGeneratorV3'
import type { GenerateWeekDraftAsyncInput } from '../domain/generateWeekDraftAsync'

self.onmessage = (event: MessageEvent<GenerateWeekDraftAsyncInput>) => {
  try { self.postMessage({ ok: true, draft: generateWeekDraft(event.data) }) }
  catch (error) { self.postMessage({ ok: false, error: error instanceof Error ? error.message : 'The week could not be generated.' }) }
}

export {}
