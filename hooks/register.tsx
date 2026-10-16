import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Categorie, Decision, Effort, Fenetre } from '../types'

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

const PANE = 'auto-modele-conso'
const decision = atom({ plugin: 'auto-modele', key: 'decision' } as const, null)
const fenetres = atom({ plugin: 'auto-modele', key: 'fenetres' } as const, [])
const actif = atom({ plugin: 'auto-modele', key: 'actif' } as const, true)

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

// ─── Jauges ──────────────────────────────────────────────────────────────────

function couleur(pct: number | undefined): string {
  if (pct === undefined) return '#9a9a9a'
  if (pct < 50) return '#2f9e6b'
  if (pct < 80) return '#e0a100'
  return '#d9534f'
}

function anneau(pct: number | undefined): string {
  const r = 52
  const c = 2 * Math.PI * r
  const p = Math.max(0, Math.min(100, pct ?? 0))
  const plein = ((c * p) / 100).toFixed(2)
  const teinte = couleur(pct)
  const texte = pct === undefined ? '—' : `${Math.round(p)}%`
  const arc =
    p > 0
      ? `<circle cx="70" cy="70" r="${r}" fill="none" stroke="${teinte}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${plein} ${c.toFixed(2)}" transform="rotate(-90 70 70)"><animate attributeName="stroke-dasharray" from="0 ${c.toFixed(2)}" to="${plein} ${c.toFixed(2)}" dur="0.9s" fill="freeze"/></circle>`
      : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="140" viewBox="0 0 140 140"><circle cx="70" cy="70" r="${r}" fill="none" stroke="#8a8a8a" stroke-opacity="0.25" stroke-width="12"/>${arc}<text x="70" y="70" text-anchor="middle" dominant-baseline="central" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="26" font-weight="600" fill="${teinte}">${texte}</text></svg>`
}

function barre(pct: number | undefined): string {
  if (pct === undefined) return '░░░░░░░░░░░░░░░░░░░░  —'
  const n = Math.round(Math.max(0, Math.min(100, pct)) / 5)
  return `${'█'.repeat(n)}${'░'.repeat(20 - n)}  ${Math.round(pct)}%`
}

function reinitialisation(iso?: string): string {
  if (!iso) return ''
  try {
    const date = new Date(iso)
    const jour = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'][date.getDay()]
    const hh = String(date.getHours()).padStart(2, '0')
    const mm = String(date.getMinutes()).padStart(2, '0')
    return `Réinitialisation : ${jour} ${hh}:${mm}`
  } catch {
    return ''
  }
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
      name: 'conso',
      description: 'Affiche la consommation de tokens (session et semaine) en jauges',
    })
    await $.command.register({
      name: 'auto-modele',
      description: 'Routage automatique du modèle : on, off, ou état',
      argumentHint: '[on|off]',
    })

    try {
      const usage = await $.session.usage()
      await update($, fenetres, () => versFenetres(usage.rateLimits))
    } catch {
      // pas encore de mesure
    }

    void $.ui.open({ id: PANE, title: 'Consommation' })
    return next(e)
  })

  on('command.run', { command: 'conso' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Consommation' })
    return { text: 'Jauges de consommation ouvertes.' }
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

  // 3. Mettre à jour les jauges quand les limites bougent.
  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      await update($, fenetres, () => versFenetres(e.rateLimits))
    }
    return next(e)
  })

  // 4. Le panneau : deux anneaux (session 5 h, semaine).
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const liste = await read($, fenetres)
    const session = liste.find(f => f.kind === 'five_hour')
    const semaine = liste.find(f => f.kind === 'seven_day')
    const d = await read($, decision)
    const estActif = await read($, actif)
    const routage = !estActif ? 'Routage : désactivé' : d ? `Routage : ${resumer(d).replace('🧭 ', '')}` : 'Routage : en attente de la première demande'
    const vide = liste.length === 0

    if (e.surface === 'terminal') {
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          <Text bold>Session (5 h)</Text>
          <Text>{barre(session?.percentUsed)}</Text>
          <Text dimColor>{reinitialisation(session?.resetsAt)}</Text>
          <Text bold>Semaine</Text>
          <Text>{barre(semaine?.percentUsed)}</Text>
          <Text dimColor>{reinitialisation(semaine?.resetsAt)}</Text>
          {vide && <Text dimColor>Les jauges se remplissent après la première réponse.</Text>}
          <Text dimColor>{routage}</Text>
        </Box>
      )
    }

    const { Box, Text, Svg, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={2}>
          <Box flexDirection="column" alignItems="center">
            <Svg
              source={anneau(session?.percentUsed)}
              alt={`Session : ${session ? Math.round(session.percentUsed) : '—'} %`}
              width={140}
              height={140}
              isInteractive
            />
            <Text bold>Session (5 h)</Text>
            <Text dimColor>{reinitialisation(session?.resetsAt)}</Text>
          </Box>
          <Box flexDirection="column" alignItems="center">
            <Svg
              source={anneau(semaine?.percentUsed)}
              alt={`Semaine : ${semaine ? Math.round(semaine.percentUsed) : '—'} %`}
              width={140}
              height={140}
              isInteractive
            />
            <Text bold>Semaine</Text>
            <Text dimColor>{reinitialisation(semaine?.resetsAt)}</Text>
          </Box>
        </Box>
        {vide && <Text dimColor>Les jauges se remplissent après la première réponse (abonnement Claude).</Text>}
        <Text dimColor>{routage}</Text>
        <Button
          key="bascule"
          label={estActif ? 'Mettre le routage en pause' : 'Réactiver le routage'}
          onPress={async () => {
            await update($, actif, v => !v)
            const valeur = await read($, actif)
            await $.store.set('actif', valeur)
            if (!valeur) $.ui.status(undefined)
          }}
        />
      </Box>
    )
  })
}
