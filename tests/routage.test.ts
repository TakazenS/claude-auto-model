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

test('le panneau dessine deux anneaux sur desktop et du texte sur terminal', async ($, on) => {
  void on
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({
      plugin: 'auto-modele',
      surface,
      component: 'Pane',
      requestId: 'auto-modele-conso',
      props: { title: 'Consommation', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
    })
    expect(await ui.find({ text: /Semaine/ })).toBeDefined()
    await ui.unmount()
  }
})
