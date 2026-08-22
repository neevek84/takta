#!/usr/bin/env node
// Produit `public/apple-touch-icon.png` (180×180) à partir de `public/icon.svg`.
//
// iOS ignore les icônes du manifeste : sans `apple-touch-icon`, l'application
// ajoutée à l'écran d'accueil affiche une capture d'écran de la page. Le PNG
// est donc un livrable, mais un binaire committé sans source dérive en
// silence — d'où ce script, qui rejoue le dessin du SVG plutôt que d'en
// dupliquer les couleurs.
//
// Rendu minimal mais suffisant pour l'icône : des rectangles pleins, et des
// chemins faits de segments et de cubiques (`M`, `L`, `C`, `Z`, en absolu),
// éventuellement sous un `<g transform="matrix(...)">`. Les coins arrondis
// (`rx`) sont ignorés : iOS applique son propre masque arrondi, et l'icône
// doit être pleine bord.
//
// Les cubiques sont aplaties en segments, et le remplissage suit la règle
// **pair-impair** — celle que déclare le SVG. Chaque pixel est échantillonné
// 3×3 puis moyenné : sans cela, les diagonales du « K » sortent en escalier à
// 180 px, et c'est précisément ce qui distingue une icône d'un brouillon.
//
//   node scripts/generate-apple-touch-icon.mjs

import { readFileSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const COTE = 180

/** Segments par cubique aplatie. 16 suffit à 180 px ; au-delà on paie sans voir. */
const PAS_COURBE = 16

/** Échantillons par côté de pixel. 3×3 = 9 mesures, moyennées. */
const SUR_ECHANTILLON = 3

/** `matrix(a,b,c,d,e,f)` d'un `<g>`, ou l'identité. */
function lireMatrice(jeton) {
  const m = /transform="matrix\(([^)]+)\)"/.exec(jeton)
  if (!m) return [1, 0, 0, 1, 0, 0]
  return m[1].split(',').map(Number)
}

function appliquer([a, b, c, d, e, f], x, y) {
  return [a * x + c * y + e, b * x + d * y + f]
}

/**
 * Le `d` d'un chemin, aplati en une liste de contours (chacun une liste de
 * points). Seuls `M`, `L`, `C` et `Z` absolus sont reconnus — c'est tout ce
 * que produit l'export du logotype, et refuser le reste vaut mieux que le
 * dessiner faux.
 */
function aplatirChemin(d, matrice) {
  const contours = []
  let courant = []
  let px = 0
  let py = 0

  const jetons = d.match(/[MLCZmlcz]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? []
  let i = 0
  const nombre = () => Number(jetons[i++])

  while (i < jetons.length) {
    const cmd = jetons[i++]
    if (cmd === 'M') {
      if (courant.length > 1) contours.push(courant)
      px = nombre()
      py = nombre()
      courant = [appliquer(matrice, px, py)]
    } else if (cmd === 'L') {
      px = nombre()
      py = nombre()
      courant.push(appliquer(matrice, px, py))
    } else if (cmd === 'C') {
      const x1 = nombre()
      const y1 = nombre()
      const x2 = nombre()
      const y2 = nombre()
      const x3 = nombre()
      const y3 = nombre()
      for (let k = 1; k <= PAS_COURBE; k++) {
        const t = k / PAS_COURBE
        const u = 1 - t
        const bx = u * u * u * px + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3
        const by = u * u * u * py + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3
        courant.push(appliquer(matrice, bx, by))
      }
      px = x3
      py = y3
    } else if (cmd === 'Z' || cmd === 'z') {
      if (courant.length > 1) contours.push(courant)
      courant = []
    } else {
      throw new Error(`Commande de chemin non gérée dans icon.svg : « ${cmd} »`)
    }
  }
  if (courant.length > 1) contours.push(courant)
  return contours
}

/** Pair-impair : un point est dedans si une demi-droite croise un nombre impair d'arêtes. */
function dansContours(contours, x, y) {
  let dedans = false
  for (const pts of contours) {
    for (let j = 0, k = pts.length - 1; j < pts.length; k = j++) {
      const [xj, yj] = pts[j]
      const [xk, yk] = pts[k]
      if (yj > y !== yk > y && x < ((xk - xj) * (y - yj)) / (yk - yj) + xj) dedans = !dedans
    }
  }
  return dedans
}

/** Formes du SVG, dans l'ordre de peinture, en coordonnées du viewBox. */
function lireFormes(svg) {
  const formes = []
  let fillGroupe = null
  let matrice = [1, 0, 0, 1, 0, 0]

  const jetons = svg.match(/<g\b[^>]*>|<\/g>|<rect\b[^>]*\/?>|<path\b[^>]*\/?>/g) ?? []
  for (const jeton of jetons) {
    if (jeton.startsWith('</g')) {
      fillGroupe = null
      matrice = [1, 0, 0, 1, 0, 0]
      continue
    }
    if (jeton.startsWith('<g')) {
      fillGroupe = /fill="([^"]+)"/.exec(jeton)?.[1] ?? null
      matrice = lireMatrice(jeton)
      continue
    }

    if (jeton.startsWith('<path')) {
      const d = /\sd="([^"]+)"/.exec(jeton)?.[1]
      if (!d) continue
      formes.push({
        contours: aplatirChemin(d, matrice),
        couleur: lireCouleur(jeton) ?? [0, 0, 0],
      })
      continue
    }

    const nombre = (nom) => Number(new RegExp(`\\b${nom}="([^"]+)"`).exec(jeton)?.[1] ?? 0)
    const fill = /fill="([^"]+)"/.exec(jeton)?.[1] ?? fillGroupe
    if (!fill) continue

    formes.push({
      x: nombre('x'),
      y: nombre('y'),
      w: nombre('width'),
      h: nombre('height'),
      couleur: hexVersRvb(fill),
    })
  }
  return formes
}

/** `fill="#hex"` ou `style="fill:rgb(r,g,b)"`. */
function lireCouleur(jeton) {
  const rgb = /fill:\s*rgb\(([^)]+)\)/.exec(jeton)
  if (rgb) return rgb[1].split(',').map((v) => Number(v.trim()))
  const hex = /fill="(#[0-9a-fA-F]{3,6})"/.exec(jeton)
  return hex ? hexVersRvb(hex[1]) : null
}

function hexVersRvb(hex) {
  const v = hex.replace('#', '')
  const plein = v.length === 3 ? [...v].map((c) => c + c).join('') : v
  return [0, 2, 4].map((i) => parseInt(plein.slice(i, i + 2), 16))
}

function tailleViewBox(svg) {
  const vb = /viewBox="([^"]+)"/.exec(svg)?.[1]
  if (!vb) throw new Error('viewBox absent de icon.svg')
  const [, , largeur] = vb.split(/\s+/).map(Number)
  return largeur
}

/** Rastérise les formes (peintre : la dernière couvrante gagne). */
function rasteriser(formes, source, cote) {
  const echelle = source / cote
  const pixels = Buffer.alloc(cote * cote * 3)
  const n = SUR_ECHANTILLON

  for (let y = 0; y < cote; y++) {
    for (let x = 0; x < cote; x++) {
      let r = 0
      let v = 0
      let b = 0
      for (let sy = 0; sy < n; sy++) {
        for (let sx = 0; sx < n; sx++) {
          const px = (x + (sx + 0.5) / n) * echelle
          const py = (y + (sy + 0.5) / n) * echelle
          let couleur = [0, 0, 0]
          for (const f of formes) {
            const dedans =
              f.contours === undefined
                ? px >= f.x && px < f.x + f.w && py >= f.y && py < f.y + f.h
                : dansContours(f.contours, px, py)
            if (dedans) couleur = f.couleur
          }
          r += couleur[0]
          v += couleur[1]
          b += couleur[2]
        }
      }
      const total = n * n
      pixels.set([Math.round(r / total), Math.round(v / total), Math.round(b / total)], (y * cote + x) * 3)
    }
  }
  return pixels
}

function crc32(buf) {
  let c = ~0
  for (const octet of buf) {
    c ^= octet
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function bloc(type, donnees) {
  const entete = Buffer.alloc(4)
  entete.writeUInt32BE(donnees.length)
  const corps = Buffer.concat([Buffer.from(type, 'ascii'), donnees])
  const somme = Buffer.alloc(4)
  somme.writeUInt32BE(crc32(corps))
  return Buffer.concat([entete, corps, somme])
}

function encoderPng(pixels, cote) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(cote, 0)
  ihdr.writeUInt32BE(cote, 4)
  ihdr[8] = 8 // profondeur
  ihdr[9] = 2 // couleur vraie, sans alpha
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  // Une ligne = un octet de filtre (0 : aucun) puis les pixels.
  const lignes = []
  for (let y = 0; y < cote; y++) {
    lignes.push(Buffer.from([0]), pixels.subarray(y * cote * 3, (y + 1) * cote * 3))
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloc('IHDR', ihdr),
    bloc('IDAT', deflateSync(Buffer.concat(lignes), { level: 9 })),
    bloc('IEND', Buffer.alloc(0)),
  ])
}

const svg = readFileSync(path.join(RACINE, 'public/icon.svg'), 'utf8')
const png = encoderPng(rasteriser(lireFormes(svg), tailleViewBox(svg), COTE), COTE)
const sortie = path.join(RACINE, 'public/apple-touch-icon.png')
writeFileSync(sortie, png)
console.log(`Écrit ${sortie} (${COTE}×${COTE}, ${png.length} octets)`)
