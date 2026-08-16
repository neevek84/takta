#!/usr/bin/env node
// Produit `public/apple-touch-icon.png` (180×180) à partir de `public/icon.svg`.
//
// iOS ignore les icônes du manifeste : sans `apple-touch-icon`, l'application
// ajoutée à l'écran d'accueil affiche une capture d'écran de la page. Le PNG
// est donc un livrable, mais un binaire committé sans source dérive en
// silence — d'où ce script, qui rejoue le dessin du SVG plutôt que d'en
// dupliquer les couleurs.
//
// Rendu volontairement minimal : le SVG n'est fait que de rectangles pleins,
// éventuellement groupés sous un `<g fill>`. Les coins arrondis (`rx`) sont
// ignorés : iOS applique son propre masque arrondi, et l'icône doit être
// pleine bord.
//
//   node scripts/generate-apple-touch-icon.mjs

import { readFileSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const COTE = 180

/** Rectangles du SVG, dans l'ordre de peinture, en coordonnées du viewBox. */
function lireRectangles(svg) {
  const rects = []
  let fillGroupe = null

  const jetons = svg.match(/<g\b[^>]*>|<\/g>|<rect\b[^>]*\/?>/g) ?? []
  for (const jeton of jetons) {
    if (jeton.startsWith('</g')) {
      fillGroupe = null
      continue
    }
    if (jeton.startsWith('<g')) {
      fillGroupe = /fill="([^"]+)"/.exec(jeton)?.[1] ?? null
      continue
    }

    const nombre = (nom) => Number(new RegExp(`\\b${nom}="([^"]+)"`).exec(jeton)?.[1] ?? 0)
    const fill = /fill="([^"]+)"/.exec(jeton)?.[1] ?? fillGroupe
    if (!fill) continue

    rects.push({
      x: nombre('x'),
      y: nombre('y'),
      w: nombre('width'),
      h: nombre('height'),
      couleur: hexVersRvb(fill),
    })
  }
  return rects
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

/** Rastérise les rectangles (peintre : le dernier couvrant gagne). */
function rasteriser(rects, source, cote) {
  const echelle = source / cote
  const pixels = Buffer.alloc(cote * cote * 3)

  for (let y = 0; y < cote; y++) {
    for (let x = 0; x < cote; x++) {
      // Centre du pixel ramené dans le repère du SVG.
      const sx = (x + 0.5) * echelle
      const sy = (y + 0.5) * echelle
      let couleur = [0, 0, 0]
      for (const r of rects) {
        if (sx >= r.x && sx < r.x + r.w && sy >= r.y && sy < r.y + r.h) couleur = r.couleur
      }
      pixels.set(couleur, (y * cote + x) * 3)
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
const png = encoderPng(rasteriser(lireRectangles(svg), tailleViewBox(svg), COTE), COTE)
const sortie = path.join(RACINE, 'public/apple-touch-icon.png')
writeFileSync(sortie, png)
console.log(`Écrit ${sortie} (${COTE}×${COTE}, ${png.length} octets)`)
