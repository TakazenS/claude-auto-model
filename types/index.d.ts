export type Categorie =
  | 'code'
  | 'git'
  | 'redaction'
  | 'recherche-approfondie'
  | 'recherche-simple'
  | 'autre-triviale'
  | 'autre-simple'
  | 'autre-moyenne'
  | 'autre-complexe'

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type Decision = {
  categorie: Categorie
  modele: string
  nomModele: string
  effort: Effort
}

export type Fenetre = { kind: string; percentUsed: number; resetsAt?: string }

declare module 'claude-code' {
  interface PluginState {
    'auto-modele': {
      decision: Decision | null
      fenetres: Fenetre[]
      actif: boolean
    }
  }
}
