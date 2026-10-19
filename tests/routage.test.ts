import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { TurnStepInput } from 'claude-code'

const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const ORIGINE = { kind: 'composer' } as const

async function essai(
  $: Parameters<TestBody>[0],
  on: Parameters<TestBody>[1],
  etiquette: string,
  effortSession: TurnStepInput['effort'],
) {
  let vu: TurnStepInput | undefined
  on('model.complete', () => ({ value: { isAnswered: true, text: etiquette, usage: USAGE } }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('ui.status', () => ({ value: undefined }))
  on('turn.step', async function* (_$, e) {
    vu = e
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: null, usage: null }
  })
  await $.prompt.submit({ text: 'une demande', wait: false, origin: ORIGINE })
  const flux = $.turn.step({ turnId: 't1', index: 0, model: 'claude-sonnet-5-5', effort: effortSession, messageCount: 1 })
  for await (const _ of flux) void _
  return vu
}

test('code → Opus 5.5 en élevé', async ($, on) => {
  const vu = await essai($, on, 'code', 'medium')
  expect(vu?.model).toBe('claude-opus-5-5')
  expect(vu?.effort).toBe('high')
})

test('git → Sonnet 5.5 en élevé', async ($, on) => {
  const vu = await essai($, on, 'git', 'medium')
  expect(vu?.model).toBe('claude-sonnet-5-5')
  expect(vu?.effort).toBe('high')
})

test('rédaction → Sonnet 5.5 en moyen', async ($, on) => {
  const vu = await essai($, on, 'redaction', 'high')
  expect(vu?.model).toBe('claude-sonnet-5-5')
  expect(vu?.effort).toBe('medium')
})

test('recherche approfondie → Opus 5.5 en extra', async ($, on) => {
  const vu = await essai($, on, 'recherche-approfondie', 'high')
  expect(vu?.model).toBe('claude-opus-5-5')
  expect(vu?.effort).toBe('xhigh')
})

test('autre → jamais au-delà de élevé', async ($, on) => {
  const vu = await essai($, on, 'autre-complexe', 'low')
  expect(vu?.effort).toBe('high')
})

test('effort manuel Extra : le mod ne touche à rien', async ($, on) => {
  const vu = await essai($, on, 'code', 'xhigh')
  expect(vu?.model).toBe('claude-sonnet-5-5')
  expect(vu?.effort).toBe('xhigh')
})

test('effort manuel Max : le mod ne touche à rien', async ($, on) => {
  const vu = await essai($, on, 'redaction', 'max')
  expect(vu?.model).toBe('claude-sonnet-5-5')
  expect(vu?.effort).toBe('max')
})

test('réponse illisible du classeur → heuristique', async ($, on) => {
  const vu = await essai($, on, '???', 'medium')
  // « une demande » : aucun mot-clé, message court → autre-triviale
  expect(vu?.model).toBe('claude-haiku-5-5')
})

test('la barre affiche contexte, 5h, Week puis le coût, sur desktop et terminal', async ($, on) => {
  const MAINTENANT = Date.parse('2026-10-19T16:00:00Z')
  on('clock.now', () => ({ value: MAINTENANT }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  await $.session.measure({
    context: { tokens: 128_000, window: 200_000 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 14, resetsAt: '2026-10-19T18:41:00Z' },
      { kind: 'seven_day', percentUsed: 90, resetsAt: '2026-10-19T22:30:00Z' },
    ],
    cost: { usd: 8.31 },
    changed: ['context', 'rateLimits', 'cost'],
  })
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({
      plugin: 'auto-modele',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
    })
    expect(await ui.find({ key: 'routage' })).toBeDefined()
    if (surface === 'terminal') {
      expect(await ui.find({ text: /S 128k\/200k .*5h .*14% \+32\.3% 2h .*Week .*90% \+6\.1% 6h .*\$8\.31/ })).toBeDefined()
    }
    await ui.unmount()
  }
})
