# auto-modele

Mod pour Claude Code qui **choisit automatiquement le modèle et l'effort** selon la demande, et affiche la **consommation** (session de 5 h et semaine) sous forme de jauges circulaires.

## Fonctionnement

À chaque message envoyé, la demande est classée par un appel rapide à Haiku (avec un repli sur une heuristique par mots-clés si la réponse est illisible ou si l'appel échoue). Le modèle et l'effort sont ensuite appliqués à chaque requête du fil principal :

| Catégorie | Modèle | Effort |
| --- | --- | --- |
| Code | Opus 5.5 | Élevé |
| Git | Sonnet 5.5 | Élevé |
| Rédaction | Sonnet 5.5 | Moyen |
| Recherche approfondie | Opus 5.5 | Extra |
| Recherche simple | Sonnet 5.5 | Élevé |
| Autre (triviale) | Haiku 5.5 | Faible |
| Autre (simple) | Sonnet 5.5 | Faible |
| Autre (moyenne) | Sonnet 5.5 | Moyen |
| Autre (complexe) | Opus 5.5 | Élevé |

- Les demandes « Autre » ne dépassent jamais l'effort **Élevé**.
- Une simple relance (« oui », « continue », « vas-y »…) reprend la catégorie précédente.
- Si l'effort de la session est réglé à la main sur **Extra** ou **Max**, le mod se met en retrait et ne touche à rien.
- Les sous-agents ne sont pas routés.
- Le choix courant s'affiche dans la ligne d'état, par exemple `🧭 Code → Opus 5.5 · Élevé`.

## Panneau « Consommation »

Le panneau s'ouvre au démarrage de la session :

- **desktop** : deux anneaux animés (session 5 h et semaine), vert / orange / rouge selon le pourcentage, avec l'heure de réinitialisation et un bouton pour mettre le routage en pause ;
- **terminal** : les mêmes informations en barres de progression.

Les jauges se remplissent après la première réponse (abonnement Claude requis pour les limites d'usage).

## Commandes

| Commande | Effet |
| --- | --- |
| `/conso` | Ouvre le panneau des jauges |
| `/auto-modele` | Affiche l'état du routage et le dernier choix |
| `/auto-modele on` | Active le routage automatique |
| `/auto-modele off` | Désactive le routage automatique |

L'état activé / désactivé est conservé d'une session à l'autre.

## Installation

À l'invite d'une session Claude Code dans un terminal :

```
/plugin install auto-modele --marketplace TakazenS/claude-auto-model
```

Depuis un shell :

```bash
claude plugin install auto-modele --marketplace TakazenS/claude-auto-model
```

Répondez `y` pour ajouter la marketplace, puis choisissez une portée (la portée utilisateur est proposée en premier). Le mod est actif immédiatement, sans redémarrage.

Dans l'application de bureau, où `/plugin` n'est pas disponible : cliquez sur **+** à côté de la zone de saisie, puis **Plugins**, **Add marketplace** avec `TakazenS/claude-auto-model`, puis **Add plugin**.

## Développement

```bash
claude --plugin-dir .
```

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

## Structure

```
.claude-plugin/
  plugin.json        manifeste du mod
  marketplace.json   fait de ce dépôt une marketplace
hooks/
  hooks.json         point d'entrée des hooks
  register.tsx       routage, commandes et panneau
types/
  index.d.ts         contrat d'état ($.state)
tests/
  routage.test.ts    tests du routage et du panneau
```

Les réglages (modèles, efforts par catégorie, consigne du classeur) sont en tête de `hooks/register.tsx`.
