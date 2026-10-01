/**
 * Errores de Postgres y de red traducidos a algo que un cajero pueda actuar.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ EXISTE ESTE ARCHIVO
 * -----------------------------------------------------------------------------
 * Las RPC levantan sus errores de negocio con `raise exception 'texto en español'`.
 * Esos textos sí se muestran tal cual: los escribió alguien para que se entendieran y
 * aquí no se tocan.
 *
 * Lo que NO debe llegar a una pantalla es el ruido de la infraestructura. "cannot
 * execute DELETE in a read-only transaction" no le dice nada a quien está frente a la
 * tablet: no sabe qué es una transacción de solo lectura ni qué hacer al respecto. Le
 * dice que algo falló y lo deja igual que antes, que es peor que mostrarle un error
 * feo pero al menos verdadero.
 *
 * -----------------------------------------------------------------------------
 * LA REGLA QUE SEPARA UN CASO DEL OTRO
 * -----------------------------------------------------------------------------
 * Se traduce lo que se reconoce; se deja pasar lo que no. Un mensaje desconocido se
 * muestra tal cual porque, en este proyecto, casi siempre es texto nuestro que sí tiene
 * sentido. Adivinar "es raro, seguro es del servidor" y tragárselo convertiría un
 * mensaje útil en un "intenta de nuevo" que no explica nada.
 *
 * La traducción se decide por el CÓDIGO de SQLSTATE cuando existe, y solo por el texto
 * cuando no. El código no cambia entre versiones de Postgres ni entre versiones del
 * mensaje en inglés, así que es la señal estable.
 */

/**
 * Errores de infraestructura, por SQLSTATE.
 *
 * Los códigos van entre comillas porque son de cinco caracteres y JavaScript los trata
 * como número: sin comillas, `42501` sería un número, no la cadena "42501", y la clave
 * del mapa nunca coincidiría.
 */
const BY_CODE = {
  // Transacción de solo lectura. Es el error que se veía al administrar extras.
  25006: 'La base de datos no aceptó el cambio porque la conexión está en solo lectura. Revisa que la app apunte al proyecto principal y no a una réplica.',
  // Permisos insuficientes: casi siempre una RPC a la que se le retiró el permiso.
  42501: 'Tu sesión no tiene permiso para esta operación. Vuelve a ingresar con tu PIN.',
  // Sentencia cancelada: el statement_timeout del rol, o el usuario apretó cancelar.
  57014: 'La operación tardó demasiado y se canceló. Intenta de nuevo.',
  // Violación de unicidad.
  23505: 'Ya existe un registro con esos datos.',
  // Violación de llave foránea.
  23503: 'No se puede completar: hay datos que dependen de este registro.',
  // Violación de un CHECK: un valor fuera de lo permitido.
  23514: 'Alguno de los valores capturados no está permitido.',
  // Rango fuera de los límites del tipo.
  22003: 'Uno de los números capturados está fuera de rango.',
  // Tipo de dato inválido: casi siempre un número donde el servidor esperaba un entero,
  // como un "2.5" en un campo de "cuántas personas". Sin esto se filtraba el
  // "invalid input syntax for type integer" de Postgres, que no le dice nada al cajero.
  '22P02': 'Alguno de los valores capturados no tiene el formato esperado.',
  // Violación de sintaxis en SQL: casi siempre un nombre de columna mal escrito.
  42601: 'La operación no se pudo preparar. Revisa la actualización de la base de datos.',
}

/**
 * Errores de infraestructura que se reconocen solo por el texto.
 *
 * Se buscan en minúsculas y sin acentos, porque el mismo error llega redactado
 * distinto según la versión del motor y según si el mensaje pasó por una traducción
 * intermedia.
 */
const BY_TEXT = [
  [
    ['read-only', 'solo lectura', 'read only'],
    'La base de datos no aceptó el cambio porque la conexión está en solo lectura. Revisa que la app apunte al proyecto principal y no a una réplica.',
  ],
  [
    ['permission denied', 'permiso denegado'],
    'Tu sesión no tiene permiso para esta operación. Vuelve a ingresar con tu PIN.',
  ],
  [
    ['jwt', 'token', 'signature has expired'],
    'Tu sesión venció. Vuelve a ingresar con tu PIN.',
  ],
  [
    [
      'fetch failed',
      'failed to fetch',
      'network',
      'load failed',
      'conexi',
      'timeout',
      'timed out',
      'aborted',
      // Los códigos de error de red de Chromium llegan como `net::ERR_*`. El caso más
      // común en una tablet es ERR_INTERNET_DISCONNECTED, que ocurre cada vez que el
      // Wi-Fi del local se cae: es exactamente cuando más importa que el mensaje sea
      // entendible y no una cadena de navegador en inglés.
      'net::err',
      'err_inter',
      'err_net',
      'offline',
    ],
    'No se pudo hablar con el servidor. Revisa la conexión e intenta de nuevo.',
  ],
  [
    ['cors', 'access-control-allow-origin'],
    'El servidor bloqueó la petición desde el navegador. Revisa la configuración de la app.',
  ],
  // 22P02 también por texto, y no solo por código. Supabase siempre manda el código, así
  // que esto es una red de seguridad para cuando el error llega sin él, que es lo que pasa
  // si algo en medio reescribe la respuesta. El texto es inequívoco de Postgres, así que
  // no hay riesgo de tragarse un mensaje nuestro.
  [
    ['invalid input syntax', 'invalid text representation', 'malformed array literal'],
    'Alguno de los valores capturados no tiene el formato esperado.',
  ],
]

/**
 * Deja pasar los mensajes que escribió el proyecto.
 *
 * Los errores de negocio se levantan como frases en español. Se reconocen por las
 * palabras con las que casi siempre empiezan, que es un indicio suficientemente bueno
 * para no tragarse un mensaje que sí era útil.
 */
const OUR_PREFIXES = [
  'el ',
  'escribe',
  'no ',
  'se ',
  'solo ',
  'quien ',
  'elige ',
  'tu turno',
  'ya se',
  'ese gasto',
]

/**
 * Quita acentos y pasa a minúsculas, para comparar mensajes sin que la tilde cambie
 * el resultado.
 *
 * @param {string} text
 * @returns {string}
 */
function normalize(text) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/**
 * Convierte un error de Supabase o de Postgres en un mensaje presentable.
 *
 * @param {unknown} error  `{ message, code, details, hint }` de Supabase, o un Error.
 * @param {string} [fallback] Qué decir cuando no se reconoce el error.
 * @returns {string} Siempre texto en español, nunca una cadena vacía.
 */
export function friendlyError(error, fallback = 'No se pudo completar la operación. Intenta de nuevo.') {
  if (!error) return fallback

  // Un string suelto ya viene listo para mostrarse.
  if (typeof error === 'string') return error.trim() || fallback

  const message = typeof error.message === 'string' ? error.message : ''
  const code = error.code ? String(error.code) : ''

  if (BY_CODE[code]) return BY_CODE[code]

  const flat = normalize(message)

  if (flat) {
    // Un error nuestro se muestra tal cual. Se comprueba ANTES que la lista de
    // infraestructura, porque "no se pudo leer el turno" es un mensaje nuestro y
    // contiene un "no" que podría dar un falso positivo con una regla genérica.
    const looksLikeOurs = OUR_PREFIXES.some((prefix) => flat.startsWith(normalize(prefix)))
    if (looksLikeOurs) return message

    for (const [needles, friendly] of BY_TEXT) {
      if (needles.some((needle) => flat.includes(needle))) return friendly
    }
  }

  // Reconocido por SQLSTATE pero sin código mapeado, o al revés: se cae al texto y
  // luego al genérico. Devolver el texto crudo es preferible a inventar un diagnóstico.
  return message.trim() || fallback
}

/**
 * ¿Este error es culpa de la sesión y conviene pedir el PIN otra vez?
 *
 * Los permisos y los tokens vencidos se resuelven reingresando; los demás no. Mezclarlos
 * en un mismo mensaje obliga al cajero a volver a ingresar su PIN cada vez que la red se
 * cae, que es justo lo contrario de lo que se le pide.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export function isAuthError(error) {
  const code = error?.code ? String(error.code) : ''
  if (code === '42501') return true

  const flat = normalize(error?.message ?? '')
  return flat.includes('jwt') || flat.includes('token') || flat.includes('permission denied')
}
