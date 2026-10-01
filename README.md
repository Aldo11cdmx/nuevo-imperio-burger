# Nuevo Imperio Burger

Punto de venta para restaurante, pensado para operar sobre tablets Android en el
mostrador y la barra. React + Vite + Supabase, sin servidor de aplicación.

## Puesta en marcha

```bash
npm install
cp .env.example .env   # llenar VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY
npm run dev
```

Otros comandos:

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Servidor de desarrollo con HMR |
| `npm run build` | Compila a `dist/` |
| `npm run preview` | Sirve la compilación local |
| `npm run lint` | Oxlint |

## Pantallas

| Ruta | Pantalla | Para quién |
| --- | --- | --- |
| `/` | Login por PIN | Todos |
| `/pos` | Punto de venta | Todos |
| `/tables` | Mapa de mesas y cobro por mesa | Todos |
| `/caja` | Turnos, corte X y corte Z | Todos |
| `/kitchen` | Comanda por estación (cocina y barra) y cobro | Todos |
| `/admin` | Productos, extras, inventario, empleados, cortes y layout de mesas | Gerente y admin |

El menú se arma con roles: `waiter`, `manager` y `admin`. Las acciones sensibles
(descuento, anulación, edición del catálogo, layout de mesas) exigen además un PIN
de administrador revalidado en el servidor.

## Cómo está protegido el dinero

El navegador nunca escribe en las tablas de dinero. `orders` y `order_payments` no
tienen permisos de escritura para el rol anónimo: todo entra por funciones
`SECURITY DEFINER` que revalidan el PIN dentro de la transacción.

- Cada función de escritura recibe un PIN y llama a `auth_admin()` o
  `login_with_pin()` antes de tocar nada.
- `order_payments` y los pagos se leen con `FOR UPDATE`, así que dos tablets cobrando
  a la vez no pueden duplicar un cobro.
- Un PIN no se puede probar sin límite: `pin_rate_limits` frena los intentos.
- Una orden con varios pagos queda `partially_paid` hasta liquidar el saldo, y cada
  pago entra al corte con su método real.
- Las órdenes anuladas y los pagos revertidos quedan fuera de todos los reportes.

Los precios ya incluyen IVA, por eso `orders.tax` es `0`. Los reportes usan la zona
horaria `America/Mexico_City`.

## Cocina por estación

El KDS dejó de ser un tablero de órdenes y pasó a ser uno de renglones. Cada renglón
nace con `station` (la del producto) y `status` (`pending`, `in_progress`, `ready`), y
`advance_station_items` avanza **una estación, un paso por toque**. Servir el lonche no
marca listo el refresco, que sigue en barra.

- La estación se copia del producto al crear la orden, y `append_order_items` la recalcula
  en cada agregado.
- Cuando una orden se queda sin renglones pendientes en ninguna estación, sale del
  tablero. Los estados de cobro (`served`, `partially_paid`) **no** la sacan: una cuenta
  servida con la bebida pendiente sigue siendo una cuenta por cobrar.
- `order_items` está en la publicación de Realtime, no solo `orders`. Sin eso, marcar
  una bebida lista en barra actualiza el renglón sin tocar la orden y el tablero no se
  entera.
- Las notas de preparación se escriben sin acentos a propósito: la impresora térmica es
  ASCII y los elimina. Los atajos de nota de `src/data/quickNotes.js` son texto en el
  campo que ya existía, no modificadores: "sin cebolla" no tiene precio.

## Extras

Un extra es una fila de `modifiers` dentro de un grupo, y el grupo se ofrece por producto
vía `product_modifier_groups`. El precio del extra es **por unidad de producto**: dos
hamburguesas con queso son $30 de queso, no $15.

- Tocar un producto con grupos abre un diálogo de extras en vez de agregar la línea. El
  precio final se ve antes de aceptar.
- `order_items.price` conserva el **precio base** y los extras viven en
  `order_item_modifiers`. Por eso `top_products` no se infla con extras y hay un
  `top_modifiers` aparte.
- El nombre y el precio salen del servidor, nunca del cliente.
- La comanda muestra los extras con `+` y sin precio; el ticket los muestra con su
  importe.
- La categoría `extras` antigua sigue conteniendo productos genéricos de relleno: es lo
  mismo que antes, no son los extras nuevos.

## Caja, mesas y pagos

- **Turnos**: apertura con fondo, corte X, corte Z con arqueo por método.
- **Gastos de caja**: cualquier empleado con turno abierto registra una salida de
  efectivo con motivo obligatorio. El esperado del corte es
  `fondo + efectivo − gastos`; sin esto, comprar hielo se veía como un faltante sin
  explicación.
- Un gasto mal capturado se **anula con motivo, no se borra**: queda con `voided_at`,
  `voided_by` y `void_reason`, y deja de descontarse. Solo quien lo registró o un
  administrador puede anularlo, y solo mientras el turno siga abierto: con el corte ya
  hecho, el dinero ya se contó contra el cajero.
- `shifts.expenses_total` se congela al cerrar, como `expected_cash`. Mientras el turno
  está abierto el total vivo lo da el acumulado de `list_shift_expenses`.
- **Cobro mixto**: efectivo, tarjeta y transferencia en la misma cuenta, o dividido
  entre N personas o por consumo. La división reparte por centavos enteros, así que
  `485.00 / 3` da `161.67 + 161.67 + 161.66` y nunca pierde ni inventa un centavo.
- **Mesas**: mapa configurable por arrastre en Administración. La mesa `0` es Barra y
  la `999` es Para llevar, ambas virtuales. Una mesa se libera cuando todas sus
  órdenes están liquidadas.
- **Descuentos**: monto fijo, motivo obligatorio y PIN de administrador.

## Tickets

El ticket está en `src/lib/receipt.js`, con área imprimible de 72 mm para la
impresora END 80TEUX. Se imprime por HTML/CSS con Android Print Service, no con
ESC/POS. El botón de WhatsApp arma el enlace `wa.me`; el mesero confirma el envío a
mano porque la app no manda mensajes por el usuario.

## Migraciones

Van en `supabase/migrations/` y se aplican en orden de nombre. Las últimas son:

| Migración | Qué agrega |
| --- | --- |
| `20261001010000_order_payments_split` | `order_payments`, pagos mixtos, `partially_paid`, corte por método |
| `20261001015000_fix_split_amount_cents` | División por centavos enteros |
| `20261001020000_restaurant_tables` | Mapa de mesas y sus RPC |
| `20261001030000_order_type_and_discounts` | Tipo de pedido, plataformas y descuentos |
| `20261001035000_order_detail_receipt_fields` | Descuento y tipo en ticket e historial |
| `20261001050000_estaciones_kds` | Estación y estado por renglón, `advance_station_items`, Realtime de `order_items` |
| `20261001060000_modificadores` | Grupos y extras, extras por producto, `top_modifiers` |
| `20261001070000_cash_expenses` | Gastos de caja, `expected_cash` con gastos, corte Z y reportes |
| `20261001080000_modifier_admin_catalog` | Catálogo completo de extras para Administración |

La Edge Function `upload-product-image` sube las fotos del catálogo. Revalida el PIN
de administrador en el servidor porque necesita `service_role`, que no puede viajar
en el cliente.

## Pendiente de verificar en el dispositivo

- Impresión real en la END 80TEUX.
- Envío del ticket por WhatsApp.
- Catalogo ilustrado en pantalla de tablet.
- Fotografías reales del producto, precio real de Malteadas y el conteo físico de los
  productos con stock.
- Comanda de cocina y barra en paralelo en dos tablets, y el cambio de estación con la
  pantalla en uso.
- Gastos de caja chica capturados desde una tablet y su reflejo en el corte Z.

## Créditos de imágenes

Las fotos del catálogo son provisionales. Ver [ATTRIBUTION.md](ATTRIBUTION.md) antes
de publicar el sitio.
