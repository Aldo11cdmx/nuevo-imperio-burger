# Créditos y atribución de imágenes

## Estado actual: atribución pendiente, no publicar así

Las 40 fotos del bucket `products` son **imágenes de stock provisionales** que se
subieron para poder maquetar el catálogo. No son fotografías del restaurante.

Origen: se eligieron en Wikimedia Commons por tener licencia libre y atribución
claras, frente a los bancos de stock. Ese criterio se cumplió al elegir el
proveedor, pero **la atribución por archivo nunca se registró**.

## Lo que falta y por qué importa

No existe el dato de quién es el autor, qué licencia aplica ni de qué página de
Wikimedia salió cada archivo. Se revisó y no está en ninguno de estos lugares:

- El repositorio: no hay archivos de imagen en Git, solo el `favicon.svg`.
- Los metadatos de `storage.objects`: los 40 objetos tienen `source`, `author`,
  `license` y `source_url` en `NULL`. La Edge Function sube sin metadatos.
- Los scripts de subida: no existe ninguno en el repo.
- Las sesiones de trabajo: no guardaron las URL de origen.

Las licencias CC BY y CC BY-SA **obligan a dar crédito** al autor, nombrar la
licencia y enlazar el material original. Sin ese dato, publicar el sitio con estas
fotos es un incumplimiento de licencia, y una atribución inventada sería peor que
ninguna: sería un registro legal falso.

Por eso este archivo documenta el hueco en lugar de llenarlo con datos inventados.

## Cómo resolverlo

**Opción recomendada: subir las fotos reales del restaurante.** Es la que elimina la
obligación por completo, porque una foto propia no tiene licencias de terceros que
cumplir. El catálogo ya admite replacement: la Edge Function hace `upsert` sobre el
mismo `slug`, así que basta con subir la foto nueva del producto y el `image_url` del
producto apunta al archivo correcto. La imagen vieja no se acumula, solo se
reemplaza.

**Opción alternativa: recuperar el dato por archivo.** Si se decide conservar el
stock, hay que reidentificar cada una de las 40 imágenes y registrar por archivo el
autor, la licencia con su versión y la URL del archivo original. Con ese dato se
arma la tabla final y se publica.

## Cómo evitar que se repita

Las fotos que se suban a partir de ahora deberían registrar su procedencia en los
metadatos del objeto. La Edge Function `upload-product-image` hoy sube sin
metadatos, así que quien la use no tiene dónde dejar el crédito. Conviene
ampliarla para aceptar y guardar `author`, `license` y `source_url` cuando la
imagen sea de terceros.

## Nota sobre marcas

Además de la licencia, algunas fotos de stock pueden mostrar empaques o logotipos de
marcas reales. Al sustituir por fotos propias desaparece también ese riesgo, que en
un menú que se muestra al público es el motivo legal más probable.
