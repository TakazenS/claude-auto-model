import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Categorie, Contexte, Decision, Effort, Fenetre } from '../types'

// ─── Réglages ────────────────────────────────────────────────────────────────

const OPUS = { id: 'claude-opus-5-5', nom: 'Opus 5.5' }
const SONNET = { id: 'claude-sonnet-5-5', nom: 'Sonnet 5.5' }
const HAIKU = { id: 'claude-haiku-5-5', nom: 'Haiku 5.5' }

/** Modèle utilisé pour classer la demande (rapide et peu coûteux). */
const CLASSIFIEUR = 'haiku'

type Route = { modele: { id: string; nom: string }; effort: Effort }

const ROUTES: Record<Categorie, Route> = {
  code: { modele: OPUS, effort: 'high' },
  git: { modele: SONNET, effort: 'high' },
  redaction: { modele: SONNET, effort: 'medium' },
  'recherche-approfondie': { modele: OPUS, effort: 'xhigh' },
  'recherche-simple': { modele: SONNET, effort: 'high' },
  // « Autre » : le mod choisit, sans jamais dépasser Élevé.
  'autre-triviale': { modele: HAIKU, effort: 'low' },
  'autre-simple': { modele: SONNET, effort: 'low' },
  'autre-moyenne': { modele: SONNET, effort: 'medium' },
  'autre-complexe': { modele: OPUS, effort: 'high' },
}

const CATEGORIES = Object.keys(ROUTES) as Categorie[]

const LIBELLES: Record<Categorie, string> = {
  code: 'Code',
  git: 'Git',
  redaction: 'Rédaction',
  'recherche-approfondie': 'Recherche approfondie',
  'recherche-simple': 'Recherche simple',
  'autre-triviale': 'Autre (triviale)',
  'autre-simple': 'Autre (simple)',
  'autre-moyenne': 'Autre (moyenne)',
  'autre-complexe': 'Autre (complexe)',
}

const NOMS_EFFORT: Record<Effort, string> = {
  low: 'Faible',
  medium: 'Moyen',
  high: 'Élevé',
  xhigh: 'Extra',
  max: 'Max',
}

const RANG: Record<Effort, number> = { low: 0, medium: 1, high: 2, xhigh: 3, max: 4 }

const SYSTEME_CLASSIFIEUR = `Tu classes la demande d'une utilisatrice adressée à un assistant IA.
Réponds par UNE seule étiquette, exactement telle qu'écrite, sans rien d'autre :
code : écrire, générer, lire, relire, déboguer, expliquer ou refactorer du code.
git : commits, branches, merge, rebase, pull requests, historique, dépôt Git/GitHub.
redaction : écrire, reformuler, corriger ou traduire un texte, un mail, un document.
recherche-approfondie : recherche multi-sources, état de l'art, rapport détaillé, comparaison poussée.
recherche-simple : trouver une information précise, une définition, un fait vérifiable.
autre-triviale : salutation, remerciement, question très courte sans réflexion.
autre-simple : autre tâche simple.
autre-moyenne : autre tâche demandant un peu de réflexion.
autre-complexe : autre tâche difficile (raisonnement long, planification, analyse).
Si le message est une simple suite de la conversation (« oui », « continue », « vas-y », « ok »), réponds la catégorie précédente.`

// ─── État ────────────────────────────────────────────────────────────────────

const decision = atom({ plugin: 'auto-modele', key: 'decision' } as const, null)
const fenetres = atom({ plugin: 'auto-modele', key: 'fenetres' } as const, [])
const actif = atom({ plugin: 'auto-modele', key: 'actif' } as const, true)
const contexte = atom({ plugin: 'auto-modele', key: 'contexte' } as const, null)
const cout = atom({ plugin: 'auto-modele', key: 'cout' } as const, null)

// ─── Classement ──────────────────────────────────────────────────────────────

function heuristique(texte: string, precedente?: Categorie): Categorie {
  const t = texte.toLowerCase()
  if (precedente && /^(oui|ok|d'accord|vas[- ]y|continue|go|parfait|merci,? continue)\b/.test(t.trim()) && t.length < 40) {
    return precedente
  }
  if (/\bgit\b|commit|rebase|merge|\bbranche|pull request|\bpr\b|cherry-pick|stash|github/.test(t)) return 'git'
  if (/```|\bcode\b|fonction|\bbug|erreur|script|typescript|javascript|python|\bphp\b|\bcss\b|\bhtml\b|\bapi\b|composant|refactor|compil/.test(t)) return 'code'
  if (/recherche approfondie|deep research|état de l'art|rapport détaillé|analyse complète|enquête/.test(t)) return 'recherche-approfondie'
  if (/rédige|écris|reformule|corrige ce texte|\bmail\b|e-mail|lettre|paragraphe|traduis/.test(t)) return 'redaction'
  if (/cherche|recherche|trouve|c'est quoi|qu'est-ce que|qui est|quand est/.test(t)) return 'recherche-simple'
  if (t.length < 25) return 'autre-triviale'
  return t.length < 300 ? 'autre-simple' : 'autre-moyenne'
}

async function classer($: EngineInterface, texte: string, precedente?: Categorie): Promise<Categorie> {
  const extrait = texte.length > 4000 ? `${texte.slice(0, 4000)}\n[…]` : texte
  const prompt = `Catégorie précédente : ${precedente ?? 'aucune'}\n\nMessage :\n<<<\n${extrait}\n>>>`
  try {
    const r = await $.model.complete({
      model: CLASSIFIEUR,
      system: SYSTEME_CLASSIFIEUR,
      prompt,
      maxTokens: 16,
      effort: 'low',
      timeoutMs: 8000,
    })
    if (r.isAnswered) {
      const mot = r.text.trim().toLowerCase().replace(/[^a-z-]/g, '')
      const trouvee = CATEGORIES.find(c => c === mot)
      if (trouvee) return trouvee
    }
  } catch {
    // le classement retombe sur l'heuristique
  }
  return heuristique(texte, precedente)
}

function plafonner(categorie: Categorie, effort: Effort): Effort {
  return categorie.startsWith('autre-') && RANG[effort] > RANG.high ? 'high' : effort
}

function decider(categorie: Categorie): Decision {
  const route = ROUTES[categorie]
  return {
    categorie,
    modele: route.modele.id,
    nomModele: route.modele.nom,
    effort: plafonner(categorie, route.effort),
  }
}

function resumer(d: Decision): string {
  return `🧭 ${LIBELLES[d.categorie]} → ${d.nomModele} · ${NOMS_EFFORT[d.effort]}`
}

// ─── Barre de consommation ───────────────────────────────────────────────────

const H = 24 // hauteur de la barre, en px
const POLICE = 'system-ui, -apple-system, Segoe UI, sans-serif'
const DUREES: Record<string, number> = { five_hour: 5 * 3600_000, seven_day: 7 * 24 * 3600_000 }

function teinte(pct: number): string {
  if (pct < 50) return '#3fb950'
  if (pct < 80) return '#d29922'
  return '#f85149'
}

function echapper(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Largeur approximative d'un texte en px (police système 11 px). */
function largeur(t: string, gras = false): number {
  return Math.ceil(t.length * (gras ? 6.6 : 6.0))
}

function kilo(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}

function restant(ms: number): string {
  if (ms <= 0) return '0m'
  const h = ms / 3600_000
  if (h >= 24) return `${Math.floor(h / 24)}d`
  if (h >= 1) return `${Math.floor(h)}h`
  return `${Math.max(1, Math.floor(ms / 60_000))}m`
}

/** Avance (+) ou retard (−) sur le rythme : temps écoulé de la fenêtre moins part consommée. */
function rythme(f: Fenetre, maintenant: number): { ecart: number; reste: number } | undefined {
  const duree = DUREES[f.kind]
  if (duree === undefined || !f.resetsAt) return undefined
  const fin = Date.parse(f.resetsAt)
  if (Number.isNaN(fin)) return undefined
  const reste = Math.max(0, fin - maintenant)
  const ecoule = Math.min(100, Math.max(0, (1 - reste / duree) * 100))
  return { ecart: ecoule - f.percentUsed, reste }
}

type Mesures = {
  contexte: Contexte | null
  cout: number | null
  fenetres: Fenetre[]
  maintenant: number
}

function barreSvg(m: Mesures): string {
  const morceaux: string[] = []
  const GAP = 6
  const PAD = 10
  let x = 0

  const capsule = (contenu: (x0: number) => { svg: string; w: number }) => {
    const { svg, w } = contenu(x + PAD)
    const total = w + PAD * 2
    morceaux.push(`<rect class="cap" x="${x + 0.5}" y="0.5" width="${total - 1}" height="${H - 1}" rx="7"/>${svg}`)
    x += total + GAP
  }
  const texte = (tx: number, t: string, classe: string, couleur?: string) =>
    `<text x="${tx}" y="${H / 2}" class="${classe}"${couleur ? ` fill="${couleur}"` : ''}>${echapper(t)}</text>`

  // Contexte : S [128k/200k]
  capsule(x0 => {
    const c = m.contexte
    const libelle = c && c.tokens !== undefined ? `${kilo(c.tokens)}/${kilo(c.window)}` : '—'
    const part = c && c.tokens !== undefined && c.window > 0 ? Math.min(1, c.tokens / c.window) : 0
    const wS = largeur('S')
    const wPill = Math.max(64, largeur(libelle, true) + 18)
    const px = x0 + wS + 8
    const svg =
      texte(x0, 'S', 'dim') +
      `<rect class="pill" x="${px}" y="${(H - 16) / 2}" width="${wPill}" height="16" rx="8"/>` +
      (part > 0 ? `<rect x="${px}" y="${(H - 16) / 2}" width="${Math.max(16, wPill * part).toFixed(1)}" height="16" rx="8" fill="#2f6feb"/>` : '') +
      `<text x="${px + wPill / 2}" y="${H / 2}" class="pilltxt" text-anchor="middle">${echapper(libelle)}</text>`
    return { svg, w: wS + 8 + wPill }
  })

  // Fenêtres : 5h puis Week
  for (const [kind, nom] of [['five_hour', '5h'], ['seven_day', 'Week']] as const) {
    capsule(x0 => {
      const f = m.fenetres.find(one => one.kind === kind)
      const parts: string[] = []
      let cx = x0
      parts.push(texte(cx, nom, 'dim'))
      cx += largeur(nom) + 8
      const BW = 34
      parts.push(`<rect class="piste" x="${cx}" y="${H / 2 - 1.5}" width="${BW}" height="3" rx="1.5"/>`)
      if (f && f.percentUsed > 0) {
        const w = Math.max(3, (BW * Math.min(100, f.percentUsed)) / 100)
        parts.push(`<rect x="${cx}" y="${H / 2 - 1.5}" width="${w.toFixed(1)}" height="3" rx="1.5" fill="${teinte(f.percentUsed)}"/>`)
      }
      cx += BW + 8
      const pct = f ? `${Math.round(f.percentUsed)}%` : '—'
      parts.push(texte(cx, pct, 'fort'))
      cx += largeur(pct, true) + 7
      const r = f ? rythme(f, m.maintenant) : undefined
      if (r) {
        const ecart = `${r.ecart >= 0 ? '+' : '−'}${Math.abs(r.ecart).toFixed(1)}%`
        parts.push(texte(cx, ecart, 'moyen', r.ecart >= 0 ? '#3fb950' : '#f85149'))
        cx += largeur(ecart) + 7
        const t = restant(r.reste)
        parts.push(texte(cx, t, 'dim'))
        cx += largeur(t)
      } else {
        cx -= 7
      }
      return { svg: parts.join(''), w: cx - x0 }
    })
  }

  // Coût de la session
  capsule(x0 => {
    const libelle = m.cout === null ? '$—' : `$${m.cout.toFixed(2)}`
    return { svg: texte(x0, libelle, 'fort'), w: largeur(libelle, true) }
  })

  const W = Math.ceil(x - GAP)
  const style =
    `text{font-family:${POLICE};font-size:11px;dominant-baseline:central}` +
    `.cap{fill:#1c1c1e;stroke:#ffffff;stroke-opacity:.08}` +
    `.pill{fill:#2c2c30}.piste{fill:#ffffff;fill-opacity:.14}` +
    `.dim{fill:#8e8e93}.fort{fill:#f2f2f7;font-weight:600}.moyen{font-weight:500}.pilltxt{fill:#fff;font-weight:600}` +
    `@media (prefers-color-scheme: light){.cap{fill:#f4f4f5;stroke:#000;stroke-opacity:.08}` +
    `.pill{fill:#a1a1aa}.piste{fill:#000;fill-opacity:.12}.dim{fill:#6b6b70}.fort{fill:#18181b}}`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><style>${style}</style>${morceaux.join('')}</svg>`
}

function barreTexte(m: Mesures): string {
  const c = m.contexte
  const ctx = c && c.tokens !== undefined ? `${kilo(c.tokens)}/${kilo(c.window)}` : '—'
  const seg = (kind: string, nom: string) => {
    const f = m.fenetres.find(one => one.kind === kind)
    if (!f) return `${nom} —`
    const n = Math.round(Math.min(100, f.percentUsed) / 20)
    const r = rythme(f, m.maintenant)
    const suite = r ? ` ${r.ecart >= 0 ? '+' : '−'}${Math.abs(r.ecart).toFixed(1)}% ${restant(r.reste)}` : ''
    return `${nom} ${'▰'.repeat(n)}${'▱'.repeat(5 - n)} ${Math.round(f.percentUsed)}%${suite}`
  }
  const cout = m.cout === null ? '$—' : `$${m.cout.toFixed(2)}`
  return `S ${ctx}  │  ${seg('five_hour', '5h')}  │  ${seg('seven_day', 'Week')}  │  ${cout}`
}

function versFenetres(limites: readonly Fenetre[]): Fenetre[] {
  return limites.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt }))
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const sauvegarde = await $.store.get('actif')
    if (sauvegarde === false) await update($, actif, () => false)

    await $.command.register({
      name: 'auto-modele',
      description: 'Routage automatique du modèle : on, off, ou état',
      argumentHint: '[on|off]',
    })

    try {
      const usage = await $.session.usage()
      await update($, fenetres, () => versFenetres(usage.rateLimits))
      await update($, contexte, () => ({ tokens: usage.context.tokens, window: usage.context.window }))
      const usd = usage.cost?.usd
      if (usd !== undefined) await update($, cout, () => usd)
    } catch {
      // pas encore de mesure
    }

    // Rafraîchir les temps restants de la barre chaque minute.
    $.clock.every(60_000, () => $.ui.invalidate('ui.render'))
    return next(e)
  })

  on('command.run', { command: 'auto-modele' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'on' || arg === 'off') {
      const valeur = arg === 'on'
      await update($, actif, () => valeur)
      await $.store.set('actif', valeur)
      if (!valeur) $.ui.status(undefined)
      return { text: `Routage automatique ${valeur ? 'activé' : 'désactivé'}.` }
    }
    const estActif = await read($, actif)
    const d = await read($, decision)
    return {
      text: `Routage automatique : ${estActif ? 'activé' : 'désactivé'}.${d ? ` Dernier choix : ${resumer(d)}.` : ''}`,
    }
  })

  // 1. Classer chaque demande dès qu'elle est envoyée.
  on('prompt.submit', async ($, e, next) => {
    if (e.command !== undefined || e.isMeta === true) return next(e)
    if (!(await read($, actif))) return next(e)

    const precedente = (await read($, decision))?.categorie
    const d = decider(await classer($, e.text, precedente))
    await update($, decision, () => d)
    $.ui.status(resumer(d))

    return next(e)
  }).catch(($, e, next) => next(e))

  // 2. Appliquer le modèle et l'effort à chaque requête du fil principal.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)

    // Effort réglé à la main sur Extra ou Max : le mod s'efface.
    if (e.effort === 'xhigh' || e.effort === 'max') {
      if (e.index === 0) $.ui.status(`🧭 Manuel (effort ${e.effort === 'max' ? 'Max' : 'Extra'}) : routage en pause`)
      return yield* next(e)
    }
    if (!(await read($, actif))) return yield* next(e)

    const d = await read($, decision)
    if (d === null) return yield* next(e)

    return yield* next({ ...e, model: d.modele, effort: d.effort })
  })

  // 3. Mettre à jour la barre quand le contexte, les limites ou le coût bougent.
  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await update($, fenetres, () => versFenetres(e.rateLimits))
    if (e.changed.includes('context')) await update($, contexte, () => ({ tokens: e.context.tokens, window: e.context.window }))
    if (e.changed.includes('cost') && e.cost) {
      const usd = e.cost.usd
      await update($, cout, () => usd)
    }
    return next(e)
  })

  // 4. La barre au-dessus du champ de saisie.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const m: Mesures = {
      contexte: await read($, contexte),
      cout: await read($, cout),
      fenetres: await read($, fenetres),
      maintenant: await $.clock.now(),
    }
    const estActif = await read($, actif)
    const basculer = async () => {
      await update($, actif, v => !v)
      const valeur = await read($, actif)
      await $.store.set('actif', valeur)
      if (!valeur) $.ui.status(undefined)
      $.ui.toast(valeur ? 'Routage automatique réactivé' : 'Routage automatique en pause')
    }

    if (e.surface === 'terminal') {
      const { Box, Text, Button } = $.ui.resolve(e)
      return (
        <Box flexDirection="row">
          <Text dimColor>{barreTexte(m)}  </Text>
          <Button key="routage" plain label={estActif ? '⚙' : '⚙ (pause)'} onPress={basculer} />
        </Box>
      )
    }

    const { Box, Svg, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Svg source={barreSvg(m)} alt={barreTexte(m)} />
        <Button key="routage" plain label={estActif ? '⚙' : '⚙ ⏸'} onPress={basculer} />
      </Box>
    )
  })

}
