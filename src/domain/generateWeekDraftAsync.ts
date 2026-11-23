import type { CanonicalIngredient } from './catalog'
import type { PlanningRequest } from './generatorV3'
import { generateWeekDraft, type GenerateWeekDraftOptions, type WeekDraft } from './weekGeneratorV3'

export type GenerateWeekDraftAsyncInput = { request: PlanningRequest; ingredients: CanonicalIngredient[]; options: GenerateWeekDraftOptions }

/** Uses a module worker in browsers so bounded search cannot freeze configuration or accessibility controls. */
export async function generateWeekDraftAsync(input: GenerateWeekDraftAsyncInput): Promise<WeekDraft> {
  if (typeof Worker === 'undefined') {
    return generateWeekDraft(input)
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/weekGeneratorWorker.ts', import.meta.url), { type: 'module', name: 'recipe-lab-week-generator' })
    worker.onmessage = (event: MessageEvent<{ ok: true; draft: WeekDraft } | { ok: false; error: string }>) => {
      worker.terminate()
      if (event.data.ok) resolve(event.data.draft)
      else reject(new Error(event.data.error))
    }
    worker.onerror = (event) => { worker.terminate(); reject(new Error(event.message || 'The generation worker stopped unexpectedly.')) }
    worker.postMessage(input)
  })
}
