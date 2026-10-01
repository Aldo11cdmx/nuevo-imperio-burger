/**
 * Alerta sonora del KDS.
 *
 * No hay archivo de audio: el sonido se genera con un oscilador de WebAudio. Un
 * archivo agregaría peso al bundle y, sobre todo, una operación más de red en una
 * tablet que puede estar en una red de restaurante lenta; un pitido no se descarga.
 *
 * -----------------------------------------------------------------------------
 * El bloqueo de autoplay y por qué no es un problema aquí
 * -----------------------------------------------------------------------------
 * Chrome y Android dejan el AudioContext en estado 'suspended' hasta que la página
 * recibe un gesto del usuario. Una tablet de cocina abre /kitchen con el dedo
 * encima, así que `unlock()` se llama desde un manejador de toque y a partir de ahí
 * el contexto queda activo.
 *
 * Por eso NO se dispara el sonido dentro de esta función esperando a que el contexto
 * esté listo: si sonara antes de la primera llamada, no sonaría. La función
 * `unlock` es la que se engancha al primer toque.
 *
 * -----------------------------------------------------------------------------
 * Todo puede fallar y no se nota
 * -----------------------------------------------------------------------------
 * Una tablet puede no tener WebAudio, el navegador puede rechazarlo por política de
 * autoplay, y `navigator.vibrate` no existe fuera de Android. Nada de eso puede
 * romper el KDS: la alerta sonora es una comodidad, y la información importante
 * (qué hay que hacer) siempre está en la pantalla. Por eso todo va en try/catch y
 * nadie espera un resultado.
 */

let context = null

/** Devuelve el AudioContext, creándolo la primera vez. null si el navegador no lo tiene. */
function getContext() {
  if (context) return context
  const Ctor = window.AudioContext ?? window.webkitAudioContext
  if (!Ctor) return null
  context = new Ctor()
  return context
}

/**
 * Desbloquea el audio. Se llama desde un gesto del usuario (el primer toque).
 *
 * Sin esto el primer pitido se pierde siempre: es exactamente el caso para el que
 * existe el estado 'suspended'.
 *
 * @returns {boolean} Si el audio queda disponible.
 */
export function unlockAudio() {
  try {
    const ctx = getContext()
    if (!ctx) return false
    if (ctx.state === 'suspended') ctx.resume()
    return ctx.state !== 'closed'
  } catch {
    return null
  }
}

/** @returns {boolean} Si se puede reproducir en este momento. */
export function audioReady() {
  try {
    return getContext()?.state === 'running'
  } catch {
    return false
  }
}

/**
 * Un pitido corto.
 *
 * Se hace con un oscilador y una envolvente de ganancia para que no suene a
 * pitido seco: attack de 5 ms y caída exponencial. Un tono plano de 800 Hz al
 * máximo le da a quien cocina la sensación de error del sistema, no de "llegó
 * algo".
 *
 * @param {number} frequency Hz.
 * @param {number} at        Segundos desde ahora, para encadenar pitidos.
 * @param {number} duration  Segundos.
 */
function beep(frequency, at, duration) {
  const ctx = getContext()
  if (!ctx) return

  const start = ctx.currentTime + at
  const oscillator = ctx.createOscillator()
  const gain = ctx.createGain()

  oscillator.type = 'sine'
  oscillator.frequency.setValueAtTime(frequency, start)

  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(0.35, start + 0.005)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)

  oscillator.connect(gain)
  gain.connect(ctx.destination)

  oscillator.start(start)
  oscillator.stop(start + duration + 0.02)
}

/**
 * Alerta de pedido nuevo: dos pitidos ascendentes y una vibración corta.
 *
 * Se llama CUANDO LLEGA la orden, no cuando se monta la pantalla. Un sonido en el
 * montage solo le avisa al que ya estaba mirando.
 */
export function alertNewOrder() {
  try {
    if (audioReady()) {
      beep(880, 0, 0.14)
      beep(1180, 0.18, 0.2)
    }
  } catch {
    // El audio es opcional; el tablero sigue funcionando sin él.
  }

  try {
    if (typeof navigator.vibrate === 'function') navigator.vibrate([90, 60, 90])
  } catch {
    // La vibración no existe en todas las tablets y no pasa nada si falla.
  }
}

/**
 * Pitido corto para confirmar una acción (avanzar de estado).
 *
 * Distinto del de pedido nuevo a propósito: el cocinero oye las dos señales todo el
 * día y tiene que poder distinguirlas sin mirar.
 */
export function beepDone() {
  try {
    if (!audioReady()) return
    beep(660, 0, 0.07)
  } catch {
    // Igual que arriba.
  }
}