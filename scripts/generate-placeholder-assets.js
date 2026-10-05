/*
 * Generador de placeholders de branding para Capacitor.
 *
 * No hay logo oficial en el repo: crea PNG SOLO para que `npm run assets` funcione y
 * la APK tenga icono/splash. Reemplazar los archivos en assets/ con el logo real y
 * volver a correr `npm run assets` para branding definitivo.
 *
 * Nombres obligados por @capacitor/assets: icon-only / icon-foreground /
 * icon-background / splash (véase node_modules/@capacitor/assets/dist/project.js).
 */
import sharp from 'sharp'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets')
const SIZE = 1024

function make(name, svg) {
  return sharp({
    create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: Buffer.from(svg), gravity: 'centre' }])
    .png()
    .toFile(path.join(dir, name))
}

const bg =
  '<svg width="1024" height="1024"><rect width="1024" height="1024" fill="%23F59E0B"/></svg>'
const fg =
  '<svg width="1024" height="1024">' +
  '<circle cx="512" cy="512" r="220" fill="%2318181B"/>' +
  '<circle cx="512" cy="512" r="85" fill="%23F59E0B"/>' +
  '</svg>'
const only =
  '<svg width="1024" height="1024">' +
  '<rect width="1024" height="1024" fill="%23F59E0B"/>' +
  '<circle cx="512" cy="512" r="220" fill="%2318181B"/>' +
  '<circle cx="512" cy="512" r="85" fill="%23F59E0B"/>' +
  '</svg>'
const splash =
  '<svg width="1024" height="1024">' +
  '<rect width="1024" height="1024" fill="%23101014"/>' +
  '<circle cx="512" cy="470" r="150" fill="%23F59E0B"/>' +
  '</svg>'

await Promise.all([
  make('icon-only.png', only),
  make('icon-foreground.png', fg),
  make('icon-background.png', bg),
  make('splash.png', splash),
])
console.log('placeholders creados en assets/')
