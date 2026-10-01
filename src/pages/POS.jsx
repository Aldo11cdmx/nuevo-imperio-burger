import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Loader2, Minus, Plus, ReceiptText, RefreshCw, Send, Trash2, Wallet } from 'lucide-react'
import ScreenHeader from '../components/ScreenHeader'
import Toast from '../components/Toast'
import TouchButton from '../components/TouchButton'
import DiscountDialog from '../components/payment/DiscountDialog'
import { getGradient } from '../data/categories'
import { PRICES_INCLUDE_TAX, formatMXN } from '../lib/format'
import { buildKitchenText, printReceipt } from '../lib/receipt'
import supabase from '../lib/supabase'
import { useAuthStore } from '../store/useAuthStore'
import {
  ORDER_TYPES,
  PLATFORMS,
  TAKEAWAY_TABLE,
  useCartStore,
} from '../store/useCartStore'
import { selectCategories, useProductStore } from '../store/useProductStore'
import { OPEN_STATUSES } from '../store/useOrderStore'
import { useShiftStore } from '../store/useShiftStore'

/**
 * Campos que el POS necesita de una cuenta abierta.
 *
 * Va en una constante porque se lee en dos lugares y la lista es larga: si divergen,
 * `loadExisting` recibe unos datos y el botón otro, y la cuenta se ve a medias. Los items
 * vienen en la misma consulta para no hacer un segundo viaje al tocar "continuar".
 */
const CUENTAS_ABIERTAS =
  'id, code, total, paid_total, order_type, platform, table_number, customer_name, order_items(product_name, quantity, notes)'

export default function POS() {
  const [category, setCategory] = useState('all')
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState(null)
  const [showDiscount, setShowDiscount] = useState(false)
  /**
   * Cuentas abiertas de la mesa escrita arriba, con la mesa a la que pertenecen.
   *
   * Se guarda de qué mesa son las filas en vez de un simple array porque así el "está
   * cargando" se DERIVA durante el render en vez de ser otro estado que actualizar. Con
   * un array suelto, cambiar de mesa dejaba las filas de la anterior en pantalla hasta
   * que llegara la respuesta: el mesero vería la cuenta de la mesa 5 estando en la 7.
   */
  const [tableAccounts, setTableAccounts] = useState({ table: null, rows: [] })
  // El PIN de administrador que autoriza el descuento NO vive en el store del carrito:
  // se queda aquí y se borra al mandar o vaciar la cuenta. Un PIN de gerente dentro
  // de un store global quedaría disponible para cualquier componente que lo lea.
  const [discountPin, setDiscountPin] = useState(null)

  const products = useProductStore((state) => state.products)
  const loadProducts = useProductStore((state) => state.load)
  const subscribeProducts = useProductStore((state) => state.subscribe)
  const catalogLoading = useProductStore((state) => state.loading)
  const catalogError = useProductStore((state) => state.error)
  const catalogLoaded = useProductStore((state) => state.loaded)

  const employee = useAuthStore((state) => state.employee)
  const pin = useAuthStore((state) => state.pin)
  const shift = useShiftStore((state) => state.shift)
  const loadMyShift = useShiftStore((state) => state.loadMyShift)
  const {
    lines,
    customerName,
    tableNumber,
    orderType,
    platform,
    discount,
    addItem,
    increase,
    decrease,
    removeLine,
    setNotes,
    setCustomer,
    setTable,
    setOrderType,
    setPlatform,
    setDiscount,
    clear,
    totals,
  } = useCartStore()
  const existingOrder = useCartStore((state) => state.existingOrder)
  const loadExisting = useCartStore((state) => state.loadExisting)
  const exitExisting = useCartStore((state) => state.exitExisting)
  const clearLines = useCartStore((state) => state.clearLines)
  // itemCount son renglones del ticket ("N líneas"); unitCount son unidades cobradas.
  // El toast anuncia unidades porque es lo que el cliente acaba de pagar.
  const { subtotal, tax, total, discount: discountTotal, itemCount, unitCount } = totals()

  useEffect(() => {
    loadProducts()
    return subscribeProducts()
  }, [loadProducts, subscribeProducts])

  // Al entrar al POS se busca el turno abierto. El servidor no lo entrega en la carga del
  // catálogo, y sin él el botón de enviar queda inútil sin avisar por qué.
  useEffect(() => {
    if (employee && pin) loadMyShift()
  }, [employee, pin, loadMyShift])

  const dismissToast = useCallback(() => setToast(null), [])

  /**
   * Relee las cuentas abiertas de una mesa.
   *
   * La lectura va directo a `orders` porque el permiso de SELECT ya existe y lo usan
   * Cocina y el mapa de mesas: no hace falta una RPC nueva para algo que nadie
   * escribe. Los items vienen en la misma consulta para no hacer un segundo viaje al
   * tocar "continuar".
   *
   * Si la lectura falla se deja la lista vacía sin avisar: el POS sigue pudiendo mandar
   * un pedido nuevo, que es el caso normal, y un aviso por algo que no impide cobrar
   * solo mete ruido.
   */
  const fetchTableAccounts = useCallback(async (number) => {
    if (number === null || number === undefined || Number.isNaN(number)) return []

    const { data } = await supabase
      .from('orders')
      .select(CUENTAS_ABIERTAS)
      .eq('table_number', number)
      .in('status', OPEN_STATUSES)
      .order('code', { ascending: true })

    const rows = data ?? []
    setTableAccounts({ table: number, rows })
    return rows
  }, [])

  /**
   * El store del carrito es global y sobrevive al cambio de pantalla: si el mesero fue a
   * Mesas y volvió, la mesa sigue escrita y sus cuentas hay que volver a buscarlas. Por
   * eso esto se lee en un efecto y no solo al cambiar la mesa.
   *
   * Va en línea y no llamando a fetchTableAccounts porque esa función fija estado, y la
   * regla de oxlint rightly marca un setState sincrónico dentro de un efecto: el efecto
   * arrancaría un render de más con la mesa anterior todavía en pantalla. Aquí el
   * setState solo pasa después del await.
   *
   * `alive` evita que la respuesta llegue cuando el componente ya se cerró.
   */
  useEffect(() => {
    if (tableNumber === null || tableNumber === undefined || Number.isNaN(tableNumber)) return undefined

    let alive = true

    supabase
      .from('orders')
      .select(CUENTAS_ABIERTAS)
      .eq('table_number', tableNumber)
      .in('status', OPEN_STATUSES)
      .order('code', { ascending: true })
      .then(({ data }) => {
        if (!alive) return
        setTableAccounts({ table: tableNumber, rows: data ?? [] })
      })

    // Si la lectura falla la lista se queda como estaba: el POS sigue pudiendo mandar un
    // pedido nuevo, que es el caso normal, y avisar de algo que no impide cobrar solo
    // mete ruido.
    return () => {
      alive = false
    }
  }, [tableNumber])

  /**
   * "Está cargando" y "estas filas son de la mesa actual" salen de la misma comparación,
   * así que las filas de otra mesa nunca se muestran aunque lleguen tarde.
   */
  const accountsForTable = tableAccounts.table === tableNumber ? tableAccounts.rows : null
  const accountsLoading = tableNumber !== null && tableAccounts.table !== tableNumber

  /**
   * Vuelve a leer la cuenta después de un agregado.
   *
   * Sin esto el mesero vería el saldo viejo: si otra tablet ya había agregado algo a la
   * misma cuenta, el total de aquí quedaría viejo y el siguiente cobro saldría mal.
   */
  const refreshAccount = async (orderId) => {
    const { data } = await supabase
      .from('orders')
      .select(CUENTAS_ABIERTAS)
      .eq('id', orderId)
      .maybeSingle()

    if (data) loadExisting(data)
    if (existingOrder) await fetchTableAccounts(existingOrder.tableNumber)
  }

  /** Cambiar de mesa es cambiar de intención: se sale del modo cuenta. */
  const changeTable = (value) => {
    setTable(value)
    // Solo se suelta la cuenta si venía de una. exitExisting vacía el carrito, y en un
    // pedido nuevo el mesero pudo capturar productos ANTES de escribir la mesa:
    // borrarlos ahí sería perder el pedido sin avisar. En modo cuenta sí se descartan,
    // porque esos productos eran para esa cuenta y ahora la mesa es otra.
    if (existingOrder) exitExisting()
  }

  /** Saldo que queda por cobrar de la cuenta a la que se está agregando. */
  const accountRemaining = existingOrder
    ? Math.max(0, Math.round((existingOrder.total - existingOrder.paidTotal) * 100) / 100)
    : 0

  const categories = useMemo(() => selectCategories(products), [products])

  const visibleProducts = useMemo(
    () => (category === 'all' ? products : products.filter((product) => product.category === category)),
    [category, products],
  )

  /**
   * A dónde va la orden si el cajero no escribió una mesa.
   *
   * "Para llevar" y los pedidos a domicilio se agrupan bajo la mesa virtual 999. Sin
   * esto, un pedido para llevar sin mesa sería una orden con table_number NULL y no
   * aparecería en el mapa de mesas. La barra (0) se escribe a mano, porque el campo
   * de mesa sigue siendo la forma más rápida de decir "voy a la barra".
   */
  const effectiveTable =
    tableNumber ?? (orderType === 'takeout' || orderType === 'platform' ? TAKEAWAY_TABLE : null)

  const sendToKitchen = async () => {
    if (!employee) {
      setToast({ tone: 'error', title: 'Sin sesión iniciada', detail: 'Ingresa con tu PIN para enviar la orden.' })
      return
    }
    // El servidor rechaza create_order sin turno abierto, pero avisar aquí evita el viaje y
    // le dice al cajero qué hacer en vez de un error genérico.
    if (!shift) {
      setToast({
        tone: 'error',
        title: 'No hay caja abierta',
        detail: 'Abre tu turno en Caja antes de enviar la orden.',
      })
      return
    }
    if (lines.length === 0 || submitting) return

    setSubmitting(true)

    // Comanda: se arma con el carrito local porque create_order y append_order_items no
    // devuelven los items, y order_detail exige PIN de administrador. Se construye antes
    // de tocar la base porque las dos ramas necesitan lo mismo.
    const kitchenItems = lines.map((line) => ({
      name: line.name,
      quantity: line.quantity,
      notes: line.notes,
    }))

    /**
     * Agrega a una cuenta abierta en vez de crear una orden nueva.
     *
     * Solo se llega aquí con `existingOrder` presente, o sea que el carrito ya solo
     * contiene lo nuevo: lo viejo nunca entró en `lines`.
     */
    if (existingOrder) {
      const { data, error: appendError } = await supabase.rpc('append_order_items', {
        p_pin: pin,
        p_order_id: existingOrder.id,
        p_items: lines.map((line) => ({
          product_id: line.productId,
          quantity: line.quantity,
          notes: line.notes.trim() || null,
        })),
      })

      if (appendError) {
        setSubmitting(false)
        setToast({ tone: 'error', title: 'No se pudo agregar a la cuenta', detail: appendError.message })
        return
      }

      const result = Array.isArray(data) ? data[0] : data
      if (!result) {
        setSubmitting(false)
        setToast({ tone: 'error', title: 'PIN no reconocido', detail: 'Ingresa de nuevo con tu PIN.' })
        return
      }

      const code = result.code ?? existingOrder.code
      const table = existingOrder.tableNumber ?? effectiveTable

      // El total de la cuenta cambió en el servidor; recargar evita que el siguiente
      // agregado se calcule sobre un saldo viejo.
      await refreshAccount(existingOrder.id)

      // El carrito se vacía pero NO se sale de la cuenta: lo agregado ya es parte de
      // ella, y el mesero muchas veces sigue captureando ("y otra de papas").
      clearLines()
      setSubmitting(false)

      // La comanda del agregado lleva SOLO lo nuevo, y por eso se rotula distinto:
      // el cocinero tiene que saber de un vistazo que no es una orden completa.
      const printed = printReceipt(
        buildKitchenText({
          kind: 'addon',
          code,
          tableNumber: table,
          orderType: existingOrder.orderType,
          platform: existingOrder.platform,
          items: kitchenItems,
        }),
        { fontSize: 18, bold: true },
      )

      setToast(
        printed
          ? {
              tone: 'success',
              title: `Agregado a la cuenta #${code}`,
              detail: `${unitCount} ${unitCount === 1 ? 'producto' : 'productos'} a cocina`,
            }
          : {
              tone: 'error',
              title: `Agregado a la cuenta #${code}, pero no se imprimió`,
              detail: 'Abre Cocina y usa el botón Comanda para sacarla.',
            },
      )
      return
    }

    // El carrito se manda por product_id y nada más. El precio, el IVA, el stock y el
    // descuento los calcula o valida el servidor: si la tablet tuviera abierto el
    // precio, la cuenta de la gaveta no cuadraría con lo que el cliente pagó.
    const { data, error: orderError } = await supabase.rpc('create_order', {
      p_pin: pin,
      p_shift_id: shift.id,
      p_table_number: effectiveTable,
      p_customer_name: customerName.trim() || null,
      p_items: lines.map((line) => ({
        product_id: line.productId,
        quantity: line.quantity,
        notes: line.notes.trim() || null,
      })),
      p_order_type: orderType,
      p_platform: platform,
      p_discount_amount: discountTotal,
      p_admin_pin: discountPin,
    })

    if (orderError) {
      setSubmitting(false)
      setToast({ tone: 'error', title: 'No se pudo enviar la orden', detail: orderError.message })
      return
    }

    const order = Array.isArray(data) ? data[0] : data
    if (!order) {
      setSubmitting(false)
      setToast({ tone: 'error', title: 'PIN no reconocido', detail: 'Ingresa de nuevo con tu PIN.' })
      return
    }

    clear()
    setDiscountPin(null)
    setSubmitting(false)

    const printed = printReceipt(
      buildKitchenText({
        code: order.code,
        tableNumber: effectiveTable,
        orderType,
        platform,
        items: kitchenItems,
      }),
      { fontSize: 18, bold: true },
    )

    // Un toast que solo dice "enviada" deja al mesero creyendo que la cocina ya tiene
    // el papel. La impresión va DESPUÉS del await del RPC, fuera del gesto del
    // usuario, y Chrome puede rechazarla: si eso pasa, el pedido existe en la base
    // pero no hay comanda, así que hay que decirlo y señalar dónde recuperarla.
    setToast(
      printed
        ? {
            tone: 'success',
            title: `Orden #${order.code} enviada a cocina`,
            detail: `${unitCount} ${unitCount === 1 ? 'producto' : 'productos'}`,
          }
        : {
            tone: 'error',
            title: `Orden #${order.code} guardada, pero no se imprimió`,
            detail: 'Abre Cocina y usa el botón Comanda para sacarla.',
          },
    )
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <ScreenHeader
        title="Punto de venta"
        subtitle={employee ? `${employee.full_name} · ${itemCount} líneas` : `${itemCount} líneas`}
      />

      <div className="grid flex-1 grid-cols-1 gap-4 p-4 md:gap-5 md:p-5 lg:grid-cols-[1fr_360px] xl:grid-cols-[1fr_400px]">
        <section className="min-w-0">
          <div className="mb-3 flex flex-wrap gap-2">
            <TouchButton
              variant={category === 'all' ? 'primary' : 'secondary'}
              onClick={() => setCategory('all')}
              className="shrink-0 px-4 text-sm"
            >
              Todos
            </TouchButton>
            {categories.map((item) => (
              <TouchButton
                key={item.id}
                variant={category === item.id ? 'primary' : 'secondary'}
                onClick={() => setCategory(item.id)}
                className="shrink-0 px-4 text-sm"
              >
                {item.label}
              </TouchButton>
            ))}
          </div>

          {catalogError && !catalogLoaded ? (
            <div
              role="alert"
              className="flex flex-col items-center gap-3 rounded-3xl border border-emberred-500/40 bg-emberred-500/10 px-6 py-12 text-center"
            >
              <AlertTriangle size={32} className="text-emberred-400" />
              <div>
                <p className="font-semibold">No se pudo cargar la carta</p>
                <p className="mt-1 text-sm text-bone-muted">
                  Sin la carta no se puede cobrar. Revisa la conexión y reintenta.
                </p>
              </div>
              <TouchButton
                variant="secondary"
                onClick={() => loadProducts({ force: true })}
                disabled={catalogLoading}
              >
                {catalogLoading ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />}
                Reintentar
              </TouchButton>
            </div>
          ) : catalogLoading && !catalogLoaded ? (
            <p className="py-20 text-center text-bone-muted">Cargando carta…</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {visibleProducts.map((product) => {
                // Agotado significa que el stock llegó a cero Y el producto sí lo
                // controla. Un producto sin control de stock nunca se deshabilita,
                // porque su `stock` es 0 siempre.
                const soldOut = product.tracks_stock && product.stock <= 0
                const low = product.tracks_stock && !soldOut && product.stock <= product.low_stock_threshold

                return (
                  <button
                    key={product.id}
                    type="button"
                    disabled={soldOut}
                    onClick={() => addItem(product)}
                    title={soldOut ? 'Agotado' : product.name}
                    className="relative flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-ink-800/70 text-left transition-[transform,border-color,opacity] duration-100 active:scale-[0.97] active:border-saffron-400/50 disabled:opacity-45"
                  >
                    {/* Sin backdrop-blur: desenfuntar una cuadrícula entera hunde los
                        frames en las tablets Android. El degradado hace de foto. */}
                    <span
                      className={`flex h-20 items-center justify-center bg-gradient-to-br ${getGradient(product.category)}`}
                    >
                      {product.image_url ? (
                        <img
                          src={product.image_url}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="font-display text-3xl font-bold text-white/85">
                          {product.name.charAt(0)}
                        </span>
                      )}
                    </span>

                    {soldOut && (
                      <span className="absolute inset-x-0 top-0 bg-ink-950/85 py-1 text-center text-xs font-bold tracking-wider text-emberred-400 uppercase">
                        Agotado
                      </span>
                    )}
                    {!soldOut && low && (
                      <span className="absolute right-1.5 top-1.5 rounded-full bg-saffron-400 px-2 py-0.5 text-[0.65rem] font-bold text-ink-950">
                        Quedan {product.stock}
                      </span>
                    )}

                    <span className="flex flex-1 flex-col justify-between p-3">
                      <span className="text-sm leading-tight font-semibold">{product.name}</span>
                      <span className="mt-2 font-ticket text-base font-bold text-saffron-400">
                        {formatMXN(product.price)}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </section>

        <aside className="relative flex flex-col self-start lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7rem)]">
          {/* Firma visual: el borde troquelado de un ticket de impresora. */}
          <div className="pointer-events-none -mb-2 flex justify-between px-3" aria-hidden="true">
            {Array.from({ length: 22 }, (_, index) => (
              <span key={index} className="h-2.5 w-2.5 rounded-full bg-ink-950" />
            ))}
          </div>

          <div className="flex min-h-0 flex-col rounded-3xl border border-white/10 bg-white/[0.06] p-4 shadow-glass backdrop-blur-2xl">
            {!employee && (
              <Link
                to="/"
                className="mb-3 flex items-center gap-2 rounded-xl border border-emberred-500/40 bg-emberred-500/10 px-3 py-2.5 text-sm font-medium text-emberred-400"
              >
                <AlertTriangle size={16} />
                Ingresa con tu PIN para enviar
              </Link>
            )}

            {employee && !shift && (
              <Link
                to="/caja"
                className="mb-3 flex items-center gap-2 rounded-xl border border-saffron-400/40 bg-saffron-400/10 px-3 py-2.5 text-sm font-medium text-saffron-400"
              >
                <Wallet size={16} />
                Sin caja abierta. Ábrela para poder cobrar
              </Link>
            )}

            {shift && (
              <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-ink-900/50 px-3 py-2 text-xs">
                <span className="text-bone-muted">
                  Fondo <span className="font-ticket font-bold text-bone">{formatMXN(shift.opening_float)}</span>
                </span>
                <span className="text-bone-muted">
                  Vendido{' '}
                  <span className="font-ticket font-bold text-jade-300">{formatMXN(shift.total_sales)}</span>
                </span>
              </div>
            )}

            <h2 className="mb-3 text-xs font-semibold tracking-[0.2em] text-bone-muted uppercase">Cuenta</h2>

            {/*
              Aviso de cuenta abierta. Solo aparece si hay una cuenta viva en esa mesa y
              no se está trabajando sobre ella: es una opción, no un redireccionamiento.
              Dos personas pueden compartir mesa con cuentas separadas, y forzar una
              decisión con un modal en cada cambio de número sería peor que ofrecerla.
            */}
            {accountsLoading && (
              <p className="mb-3 flex items-center gap-1.5 text-xs text-bone-muted">
                <Loader2 className="animate-spin" size={13} />
                Buscando cuentas de la mesa {tableNumber}…
              </p>
            )}

            {!existingOrder && accountsForTable && accountsForTable.length > 0 && (
              <div className="mb-3 rounded-xl border border-saffron-400/40 bg-saffron-400/10 p-2.5">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-saffron-400">
                  <ReceiptText size={14} />
                  Mesa {tableNumber} ya tiene{' '}
                  {accountsForTable.length === 1 ? 'una cuenta' : `${accountsForTable.length} cuentas`}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {accountsForTable.map((account) => (
                    <TouchButton
                      key={account.id}
                      variant="secondary"
                      className="px-2.5 py-1.5 text-xs"
                      onClick={() => loadExisting(account)}
                    >
                      Continuar #{account.code} ·{' '}
                      {formatMXN(Math.max(0, account.total - (account.paid_total ?? 0)))}
                    </TouchButton>
                  ))}
                </div>
              </div>
            )}

            {existingOrder && (
              <div className="mb-3 rounded-xl border border-white/10 bg-ink-900/60 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-jade-300">
                    Agregando a la cuenta #{existingOrder.code}
                  </p>
                  <TouchButton
                    variant="ghost"
                    className="h-8 min-h-0 px-2 py-1 text-xs"
                    onClick={exitExisting}
                  >
                    Pedido nuevo
                  </TouchButton>
                </div>

                {/*
                  Lo ya pedido se muestra en solo lectura y sin controles. No es
                  decoración: es la razón por la que "solo se agrega" no puede fallar.
                  Un producto viejo no se puede tocar, y tocarlo sería cancelar algo
                  que quizá ya está en la plancha.
                */}
                <ul className="mt-2 space-y-1">
                  {existingOrder.items.map((item) => (
                    <li key={item.id} className="flex items-baseline gap-1.5 text-xs text-bone-muted">
                      <span className="font-ticket font-bold text-bone">{item.quantity}×</span>
                      <span className="min-w-0 flex-1 truncate">{item.name}</span>
                      {item.notes && <span className="shrink-0 truncate italic opacity-70">{item.notes}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mb-3 grid grid-cols-3 gap-1.5">
              {ORDER_TYPES.map((type) => (
                <TouchButton
                  key={type.id}
                  variant={orderType === type.id ? 'primary' : 'secondary'}
                  onClick={() => setOrderType(type.id)}
                  disabled={Boolean(existingOrder)}
                  className="flex-col gap-0.5 py-2 text-[0.7rem]"
                >
                  <span className="text-sm">{type.emoji}</span>
                  {type.label}
                </TouchButton>
              ))}
            </div>

            {orderType === 'platform' && (
              <div className="mb-3 grid grid-cols-3 gap-1.5">
                {PLATFORMS.map((item) => (
                  <TouchButton
                    key={item.id}
                    variant={platform === item.id ? 'primary' : 'secondary'}
                    onClick={() => setPlatform(item.id)}
                    className="px-2 py-2 text-xs"
                  >
                    {item.label}
                  </TouchButton>
                ))}
              </div>
            )}

            <div className="mb-3 grid grid-cols-[86px_1fr] gap-2">
              <input
                value={tableNumber ?? ''}
                onChange={(event) => changeTable(event.target.value === '' ? null : Number(event.target.value) || null)}
                placeholder="Mesa"
                type="number"
                min="0"
                inputMode="numeric"
                aria-label="Número de mesa (0 es la barra)"
                className="w-full rounded-xl border border-white/10 bg-ink-800/70 px-3 py-3 text-center outline-none transition-colors focus:border-saffron-400/60"
              />
              <input
                value={customerName}
                onChange={(event) => setCustomer(event.target.value)}
                placeholder="Cliente (opcional)"
                disabled={Boolean(existingOrder)}
                aria-label="Nombre del cliente"
                className="w-full rounded-xl border border-white/10 bg-ink-800/70 px-3 py-3 outline-none transition-colors focus:border-saffron-400/60 disabled:opacity-50"
              />
            </div>

            <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain">
              {lines.length === 0 && (
                <li className="py-10 text-center text-sm text-bone-muted">Sin productos agregados</li>
              )}
              {lines.map((line) => (
                <li key={line.id} className="rounded-xl border border-white/5 bg-ink-800/60 p-2.5">
                  <div className="flex items-center gap-1.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{line.name}</p>
                      <p className="font-ticket text-xs text-bone-muted">{formatMXN(line.price)} c/u</p>
                    </div>
                    <TouchButton
                      variant="ghost"
                      onClick={() => decrease(line.id)}
                      aria-label={`Quitar una unidad de ${line.name}`}
                      className="h-10 min-h-0 rounded-lg px-2.5"
                    >
                      <Minus size={18} />
                    </TouchButton>
                    <span className="w-6 text-center font-ticket text-sm font-bold">{line.quantity}</span>
                    <TouchButton
                      variant="ghost"
                      onClick={() => increase(line.id)}
                      aria-label={`Añadir una unidad de ${line.name}`}
                      className="h-10 min-h-0 rounded-lg px-2.5"
                    >
                      <Plus size={18} />
                    </TouchButton>
                    <TouchButton
                      variant="ghost"
                      onClick={() => removeLine(line.id)}
                      aria-label={`Eliminar ${line.name} de la cuenta`}
                      className="h-10 min-h-0 rounded-lg px-2.5 text-emberred-400"
                    >
                      <Trash2 size={16} />
                    </TouchButton>
                  </div>

                  <input
                    value={line.notes}
                    onChange={(event) => setNotes(line.id, event.target.value)}
                    placeholder="Nota para cocina…"
                    aria-label={`Nota para ${line.name}`}
                    className="mt-2 w-full rounded-lg bg-ink-900/70 px-2.5 py-2 text-xs outline-none transition-colors focus:bg-ink-900"
                  />
                </li>
              ))}
            </ul>

            <dl className="mt-3 space-y-1 border-t border-dashed border-white/15 pt-3 text-sm">
              {/*
                En modo cuenta el total que importa NO es el del carrito: es lo que
                quedará debiendo el cliente cuando se cobre todo, o sea el saldo de la
                cuenta más lo que se está agregando ahora. Mostrar solo el carrito
                haría creer que se van a cobrar $180 cuando en realidad son $930.
              */}
              {existingOrder ? (
                <>
                  <div className="flex justify-between">
                    <dt className="text-bone-muted">Cuenta #{existingOrder.code}</dt>
                    <dd className="font-ticket">{formatMXN(existingOrder.total)}</dd>
                  </div>
                  {existingOrder.paidTotal > 0 && (
                    <div className="flex justify-between">
                      <dt className="text-bone-muted">Ya pagado</dt>
                      <dd className="font-ticket text-jade-300">-{formatMXN(existingOrder.paidTotal)}</dd>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <dt className="text-bone-muted">Falta de la cuenta</dt>
                    <dd className="font-ticket">{formatMXN(accountRemaining)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-bone-muted">Agregando ahora</dt>
                    <dd className="font-ticket">{formatMXN(subtotal)}</dd>
                  </div>
                  <div className="flex items-baseline justify-between pt-1">
                    <dt className="text-base font-semibold">Total a cobrar</dt>
                    <dd className="font-ticket text-2xl font-bold text-saffron-400">
                      {formatMXN(accountRemaining + total)}
                    </dd>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex justify-between">
                    <dt className="text-bone-muted">Subtotal</dt>
                    <dd className="font-ticket">{formatMXN(subtotal)}</dd>
                  </div>
                  {!PRICES_INCLUDE_TAX && (
                    <div className="flex justify-between">
                      <dt className="text-bone-muted">IVA</dt>
                      <dd className="font-ticket">{formatMXN(tax)}</dd>
                    </div>
                  )}
                  {discountTotal > 0 && (
                    <div className="flex items-baseline justify-between">
                      <dt className="text-bone-muted">
                        Descuento
                        {discount?.reason && (
                          <span className="ml-1 text-[0.7rem] italic opacity-70">{discount.reason}</span>
                        )}
                      </dt>
                      <dd className="font-ticket text-emberred-400">-{formatMXN(discountTotal)}</dd>
                    </div>
                  )}
                  <div className="flex items-baseline justify-between pt-1">
                    <dt className="text-base font-semibold">Total</dt>
                    <dd className="font-ticket text-2xl font-bold text-saffron-400">{formatMXN(total)}</dd>
                  </div>
                  {PRICES_INCLUDE_TAX && (
                    <p className="text-right text-[0.7rem] text-bone-faint">Precios con IVA incluido</p>
                  )}
                </>
              )}
            </dl>

            <div className="mt-4 flex gap-2">
              <TouchButton
                variant="secondary"
                onClick={() => {
                  clear()
                  setDiscountPin(null)
                }}
                className="flex-1"
                disabled={submitting}
              >
                Vaciar
              </TouchButton>
              <TouchButton
                variant="secondary"
                onClick={() => setShowDiscount(true)}
                className="flex-1"
                // Agregar nunca lleva descuento: append_order_items no toca
                // discount_amount y el descuento se autoriza sobre la cuenta completa.
                disabled={submitting || lines.length === 0 || Boolean(existingOrder)}
              >
                {discountTotal > 0 ? `-${formatMXN(discountTotal)}` : 'Descuento'}
              </TouchButton>
              <TouchButton
                className="flex-[2]"
                onClick={sendToKitchen}
                disabled={lines.length === 0 || submitting || !employee || !shift}
              >
                {submitting ? (
                  <>
                    <Loader2 className="animate-spin" size={18} />
                    Enviando…
                  </>
                ) : (
                  <>
                    <Send size={18} />
                    {existingOrder ? `Agregar a #${existingOrder.code}` : 'Enviar a cocina'}
                  </>
                )}
              </TouchButton>
            </div>
          </div>
        </aside>
      </div>

      {showDiscount && (
        <DiscountDialog
          subtotal={subtotal}
          onClose={() => setShowDiscount(false)}
          onConfirm={({ amount, reason, adminPin }) => {
            setDiscount({ amount, reason })
            setDiscountPin(adminPin)
            setShowDiscount(false)
          }}
        />
      )}

      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  )
}
