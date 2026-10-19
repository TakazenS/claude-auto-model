# auto-modele

Mod pour Claude Code qui **choisit automatiquement le modèle et l'effort** selon la demande, et affiche la **consommation** (contexte, session de 5 h, semaine et coût) dans une barre compacte au-dessus du champ de saisie.

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

## Barre de consommation

Une barre s'affiche au-dessus du champ de saisie, de gauche à droite :

| Segment | Contenu |
| --- | --- |
| `S` | Contexte utilisé / taille de la fenêtre (ex. `128k/200k`) |
| `5h` | Limite de la session de 5 h : jauge, pourcentage, avance sur le rythme, temps avant réinitialisation |
| `Week` | Limite hebdomadaire, mêmes informations |
| `$` | Coût de la session |
| ⚙ | Met le routage automatique en pause ou le réactive |
| × | Masque la barre (`/conso` pour la réafficher) |

L'avance sur le rythme (`+32.3%`) est le temps écoulé de la fenêtre moins la part consommée : en vert si tu consommes moins vite que le rythme, en rouge sinon. La jauge passe du vert à l'orange (50 %) puis au rouge (80 %).

- **desktop** : la barre est dessinée en SVG et suit le thème clair ou sombre ;
- **terminal** : les mêmes informations sur une ligne de texte.

Les limites apparaissent après la première réponse (abonnement Claude requis pour les limites d'usage).

## Commandes

| Commande | Effet |
| --- | --- |
| `/conso` | Affiche ou masque la barre de consommation |
| `/conso on` / `/conso off` | Affiche / masque la barre |
| `/auto-modele` | Affiche l'état du routage et le dernier choix |
| `/auto-modele on` | Active le routage automatique |
| `/auto-modele off` | Désactive le routage automatique |

L'état du routage et l'affichage de la barre sont conservés d'une session à l'autre.

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
  register.tsx       routage, commandes et barre de consommation
types/
  index.d.ts         contrat d'état ($.state)
tests/
  routage.test.ts    tests du routage et de la barre
```

Les réglages (modèles, efforts par catégorie, consigne du classeur) sont en tête de `hooks/register.tsx`.
