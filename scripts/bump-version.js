/*
 * Incrementa versionCode y versionName de la app Android.
 *
 * Uso:  npm run version:bump            # +1 a versionCode, parche en versionName
 *        VERSION_NAME=1.2.3 npm run version:bump   # versionName explícito
 *
 * Sensible a entornos CI: lee/actualiza android/app/build.gradle en texto plano
 * (evita parsear Gradle). No toca el store.
 */
const fs = require('fs')
const path = require('path')

const gradlePath = path.join(__dirname, '..', 'android', 'app', 'build.gradle')
let src = fs.readFileSync(gradlePath, 'utf8')

const codeMatch = src.match(/versionCode\s+(\d+)/)
if (!codeMatch) {
  console.error('No se encontró versionCode en build.gradle')
  process.exit(1)
}
let versionCode = Number(codeMatch[1])
versionCode += 1

const nameMatch = src.match(/versionName\s+"([^"]+)"/)
let versionName = nameMatch ? nameMatch[1] : `${versionCode}.0`
if (process.env.VERSION_NAME) {
  versionName = process.env.VERSION_NAME
} else {
  const parts = versionName.split('.').map(Number)
  if (parts.length < 3) parts.push(0)
  parts[parts.length - 1] = (parts[parts.length - 1] || 0) + 1
  versionName = parts.join('.')
}

src = src.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`)
src = src.replace(/versionName\s+"[^"]+"/, `versionName "${versionName}"`)
fs.writeFileSync(gradlePath, src)

console.log(`versionCode -> ${versionCode}`)
console.log(`versionName -> ${versionName}`)
