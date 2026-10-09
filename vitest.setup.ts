import { vi } from 'vitest'

// `annoncer()` écrit un cookie de réponse, ce que `next/headers` n'autorise
// qu'au sein d'une requête Next. Hors de lui, chaque action qui annonce son
// résultat lèverait : on la remplace partout par un double, qu'un test peut
// importer de `@/services/annonce` pour vérifier ce qui a été dit.
vi.mock('@/services/annonce', () => ({ annoncer: vi.fn(async () => {}) }))
