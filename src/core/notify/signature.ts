/**
 * Les courriels du circuit de signature (lot 3b). Texte brut, en français,
 * comme les gabarits voisins. **Aucun montant** : le CRA atteste du temps.
 */
import type { Gabarit } from './templates'

interface Contexte {
  clientNom: string
  missionLabel: string
  moisLibelle: string
  signataireNom: string
}

function objet(c: Contexte): string {
  return `${c.clientNom} · ${c.missionLabel} — ${c.moisLibelle}`
}

export function gabaritEnvoiClient(c: Contexte & { lien: string }): Gabarit {
  return {
    sujet: `Votre CRA de ${c.moisLibelle} est prêt — ${c.missionLabel}`,
    corps: [
      `Bonjour ${c.signataireNom},`,
      '',
      `Le compte-rendu d'activité ${objet(c)} est prêt pour votre validation.`,
      '',
      'Pour le consulter et le signer :',
      `  ${c.lien}`,
      '',
      'Un code de confirmation vous sera envoyé à cette adresse à l’ouverture du lien.',
    ].join('\n'),
  }
}

export function gabaritCodeClient(args: { code: string; minutes: number }): Gabarit {
  return {
    sujet: 'Votre code de confirmation',
    corps: [
      `Votre code : ${args.code}`,
      '',
      `Il est valable ${args.minutes} minutes.`,
      'Si vous n’avez rien demandé, ignorez ce message.',
    ].join('\n'),
  }
}

export function gabaritValideConsultant(c: Contexte & { pdfJoint: boolean }): Gabarit {
  return {
    sujet: `CRA validé — ${objet(c)}`,
    corps: [
      `${c.signataireNom} a validé et signé le CRA ${objet(c)}.`,
      '',
      c.pdfJoint
        ? 'Le document signé est joint à ce message.'
        : 'Le document signé n’est pas encore disponible ; il le sera dans l’outil dès son archivage.',
    ].join('\n'),
  }
}

export function gabaritValideClient(c: Contexte & { pdfJoint: boolean }): Gabarit {
  return {
    sujet: `Confirmation — CRA ${c.moisLibelle} signé`,
    corps: [
      `Bonjour ${c.signataireNom},`,
      '',
      `Votre signature du CRA ${objet(c)} est bien enregistrée.`,
      '',
      c.pdfJoint
        ? 'Le document signé est joint à ce message.'
        : 'Le document signé n’est pas encore disponible ; il reste téléchargeable depuis le lien reçu.',
    ].join('\n'),
  }
}

export function gabaritRefusConsultant(c: Contexte & { motif: string; lienCra: string }): Gabarit {
  return {
    sujet: `CRA refusé — ${objet(c)}`,
    corps: [
      `${c.signataireNom} a refusé le CRA ${objet(c)}.`,
      '',
      'Motif :',
      `  « ${c.motif} »`,
      '',
      'La saisie du mois est rouverte. Corrigez puis renvoyez :',
      `  ${c.lienCra}`,
    ].join('\n'),
  }
}

export function gabaritRefusClient(c: Contexte & { motif: string }): Gabarit {
  return {
    sujet: `Refus transmis — CRA ${c.moisLibelle}`,
    corps: [
      `Bonjour ${c.signataireNom},`,
      '',
      `Votre refus du CRA ${objet(c)} a bien été transmis, avec ce motif :`,
      `  « ${c.motif} »`,
      '',
      'Une version corrigée vous sera adressée.',
    ].join('\n'),
  }
}

export function gabaritAnnulationClient(c: Contexte): Gabarit {
  return {
    sujet: `CRA retiré — ${c.moisLibelle}`,
    corps: [
      `Bonjour ${c.signataireNom},`,
      '',
      `Le CRA ${objet(c)} qui vous avait été adressé a été retiré.`,
      'Une nouvelle version vous sera envoyée. Le lien précédent n’est plus valable.',
    ].join('\n'),
  }
}

export function gabaritRelanceClient(c: Contexte & { lien: string }): Gabarit {
  return {
    sujet: `Rappel — CRA ${c.moisLibelle} en attente de signature`,
    corps: [
      `Bonjour ${c.signataireNom},`,
      '',
      `Le CRA ${objet(c)} attend toujours votre validation.`,
      '',
      `  ${c.lien}`,
    ].join('\n'),
  }
}
