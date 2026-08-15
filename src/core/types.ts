export type TimeEntryKind = 'REALISE' | 'PREVISIONNEL'
export type CraStatus = 'BROUILLON' | 'ENVOYE' | 'VALIDE' | 'REFUSE'
export type DisplayUnit = 'JOUR' | 'DEMI_JOUR' | 'HEURE'
export type Role = 'ADMIN' | 'MANAGER' | 'CONSULTANT'
export type EngagementSource = 'MANUEL' | 'DOLIBARR_PROPALE' | 'DOLIBARR_PROJET'
export type CapacityMode = 'DESACTIVE' | 'AVERTISSEMENT' | 'BLOCAGE'

export const TIME_ENTRY_KINDS: readonly TimeEntryKind[] = ['REALISE', 'PREVISIONNEL']
export const CRA_STATUSES: readonly CraStatus[] = ['BROUILLON', 'ENVOYE', 'VALIDE', 'REFUSE']
export const DISPLAY_UNITS: readonly DisplayUnit[] = ['JOUR', 'DEMI_JOUR', 'HEURE']
export const CAPACITY_MODES: readonly CapacityMode[] = ['DESACTIVE', 'AVERTISSEMENT', 'BLOCAGE']
