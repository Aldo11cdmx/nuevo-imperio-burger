import { useEffect, useMemo, useState } from 'react'
import { Check, Loader2, Pencil, Plus, RefreshCw, X } from 'lucide-react'
import TouchButton from '../TouchButton'
import Toast from '../Toast'
import { formatMXN } from '../../lib/format'
import { friendlyError, isAuthError } from '../../lib/errors'
import supabase from '../../lib/supabase'
import { INPUT, PANEL, PANEL_TITLE } from './fields'

/**
 * Extras: qué grupos existen, qué hay en cada uno y en qué productos se ofrecen.
 *
 * Es una pestaña aparte del menú y no una columna más de la tabla de productos, porque
 * un extra no se edita en un solo lugar. El nombre y el precio viven en el grupo (que es
 * compartido por todos los productos que lo ofrecen) y la decisión de "este producto sí
 * ofrece cheese, este otro no" vive en el producto. Meter las dos cosas en la misma
 * pantalla obligaría a repetir el precio del queso en cada producto que lo ofrece, y
 * cambiar el precio del queso sería cambiarlo en veinte lugares.
 *
 * Por eso la pantalla tiene dos mitades y una sola fuente: se edita el precio una vez y
 * todos los productos que ofrecen ese grupo lo cobran al precio nuevo.
 */

const EMPTY_GROUP = { name: '', min_select: 0, max_select: 1, is_active: true }
const EMPTY_MODIFIER = { name: '', price: '' }

export default function ModifiersPanel({ adminPin }) {
  const [groups, setGroups] = useState([])
  const [productGroups, setProductGroups] = useState([])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [toast, setToast] = useState(null)

  /**
   * Qué operación está guardando, para el mensaje de éxito y para el spinner.
   *
   * No es un simple booleano porque el panel tiene tres formularios distintos: sin esto
   * el spinner del grupo parpadearía al agregar un extra, y el toast de "guardado"
   * aparecería sin que quede claro qué se guardó.
   */
  const [pendingAction, setPendingAction] = useState(null)

  const [groupForm, setGroupForm] = useState(EMPTY_GROUP)
  const [editingGroupId, setEditingGroupId] = useState(null)

  // Qué grupo está abierto para editar sus extras, y el extra en edición dentro de él.
  // El extra va anidado y no suelto porque su formulario necesita saber a qué grupo
  // pertenece para poder guardarlo, y porque un "nuevo extra" sin grupo no significa
  // nada en este modelo.
  const [openGroupId, setOpenGroupId] = useState(null)
  const [modifierForm, setModifierForm] = useState(EMPTY_MODIFIER)
  const [editingModifierId, setEditingModifierId] = useState(null)

  const load = async () => {
    setLoading(true)
    setError(null)

    const [catalog, productRows] = await Promise.all([
      supabase.rpc('modifier_admin_catalog', { p_admin_pin: adminPin }),
      supabase.rpc('list_all_products', { p_admin_pin: adminPin }),
    ])

    if (catalog.error) {
      setLoading(false)
      setError(friendlyError(catalog.error, 'No se pudo cargar el catálogo de extras.'))
      return
    }
    // null es el PIN que no es de admin. Las dos RPCs devuelven null igual, así que con
    // una basta para saber que la sesión ya no vale.
    if (!catalog.data) {
      setLoading(false)
      setError('Autorización de administrador fallida')
      return
    }

    setGroups(catalog.data.groups ?? [])
    setProductGroups(catalog.data.product_groups ?? [])
    setProducts(productRows.data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminPin])

  /**
   * Falla de una operación, en el mismo formato siempre.
   *
   * Centralizarla tiene dos beneficios. Uno visible: nunca se muestra el texto crudo de
   * Postgres. El otro es el que más importa: un fallo de sesión dice explícitamente que
   * hay que volver a ingresar con el PIN, y uno de red no. Antes esos dos casos salían
   * iguales y el administrador acababa reingresando su PIN cada vez que se le caía el
   * wifi, que es lo contrario de lo útil.
   *
   * @param {unknown} rpcError
   * @param {string} que  Qué se intentaba hacer, para el mensaje.
   */
  const fail = (rpcError, que) => {
    const message = friendlyError(rpcError, `No se pudo ${que}. Intenta de nuevo.`)
    setError(message)
    setToast({
      tone: 'error',
      title: isAuthError(rpcError) ? 'Tu sesión venció' : `No se pudo ${que}`,
      detail: message,
    })
    setPendingAction(null)
    return false
  }

  /** Éxito: se avisa en el toast y se limpia el error de la cinta. */
  const done = (title, detail) => {
    setError(null)
    setToast({ tone: 'success', title, detail })
    setPendingAction(null)
  }

  // Qué grupos ofrece cada producto, invertido a un diccionario para no recorrer la
  // lista entera por cada producto al pintar. Con 60 productos y 3 grupos da igual, pero
  // la versión que no reventaría con 600 productos es la que se escribe ahora.
  const groupsByProduct = useMemo(() => {
    const map = new Map()
    for (const entry of productGroups) {
      map.set(entry.product_id, entry.group_ids ?? [])
    }
    return map
  }, [productGroups])

  const productsByGroup = useMemo(() => {
    const map = new Map()
    for (const group of groups) map.set(group.group_id, [])
    for (const product of products) {
      for (const groupId of groupsByProduct.get(product.id) ?? []) {
        map.get(groupId)?.push(product)
      }
    }
    return map
  }, [groups, products, groupsByProduct])

  // ---------------------------------------------------------------------------
  // Grupos
  // ---------------------------------------------------------------------------

  const startEditGroup = (group) => {
    setEditingGroupId(group.group_id)
    setGroupForm({
      name: group.name,
      min_select: group.min_select,
      max_select: group.max_select,
      is_active: group.is_active,
    })
  }

  const saveGroup = async (event) => {
    event.preventDefault()
    setSaving(true)
    setPendingAction('grupo')
    setError(null)

    const { error: rpcError } = await supabase.rpc('save_modifier_group', {
      p_pin: adminPin,
      p_id: editingGroupId,
      p_name: groupForm.name,
      p_min_select: Number(groupForm.min_select) || 0,
      p_max_select: Number(groupForm.max_select) || 1,
      p_is_active: groupForm.is_active,
    })

    if (rpcError) {
      setSaving(false)
      return fail(rpcError, 'guardar el grupo de extras')
    }

    setSaving(false)
    setEditingGroupId(null)
    setGroupForm(EMPTY_GROUP)
    await load()
    done(
      editingGroupId ? 'Grupo actualizado' : 'Grupo creado',
      `"${groupForm.name}" quedó guardado.`,
    )
  }

  // ---------------------------------------------------------------------------
  // Extras
  // ---------------------------------------------------------------------------

  const openGroup = (groupId) => {
    setOpenGroupId(openGroupId === groupId ? null : groupId)
    setEditingModifierId(null)
    setModifierForm(EMPTY_MODIFIER)
  }

  const startEditModifier = (groupId, modifier) => {
    setOpenGroupId(groupId)
    setEditingModifierId(modifier.modifier_id)
    setModifierForm({ name: modifier.name, price: String(modifier.price) })
  }

  const saveModifier = async (event, groupId) => {
    event.preventDefault()
    setSaving(true)
    setError(null)

    const { error: rpcError } = await supabase.rpc('save_modifier', {
      p_pin: adminPin,
      p_group_id: groupId,
      p_id: editingModifierId,
      p_name: modifierForm.name,
      p_price: Number(modifierForm.price) || 0,
      p_is_active: true,
    })

    if (rpcError) {
      setSaving(false)
      return fail(rpcError, 'guardar el extra')
    }

    setSaving(false)
    const nombre = modifierForm.name
    setEditingModifierId(null)
    setModifierForm(EMPTY_MODIFIER)
    await load()
    done(editingModifierId ? 'Extra actualizado' : 'Extra agregado', `"${nombre}" quedó guardado.`)
  }

  /**
   * Activa o desactiva un extra sin abrir el formulario.
   *
   * Es el gesto más frecuente y el que más consecuencias tiene de equivocar: si el queso
   * se queda marcado como activo y en realidad ya no hay, el mesero lo vende y la cocina
   * lo recibe sin poder cumplirlo. Por eso es un botón de una línea y no una casilla en
   * un formulario que hay que abrir, guardar y rezar para que se haya guardado bien.
   */
  const toggleModifier = async (groupId, modifier) => {
    const { error: rpcError } = await supabase.rpc('save_modifier', {
      p_pin: adminPin,
      p_group_id: groupId,
      p_id: modifier.modifier_id,
      p_name: modifier.name,
      p_price: modifier.price,
      p_is_active: !modifier.is_active,
    })
    if (rpcError) {
      return fail(rpcError, 'cambiar el extra')
    }
    await load()
    done(
      modifier.is_active ? `Se ocultó ${modifier.name}` : `${modifier.name} volvió a la carta`,
      modifier.is_active
        ? 'El mesero ya no lo verá en el POS.'
        : 'Vuelve a aparecer en la carta.',
    )
  }

  // ---------------------------------------------------------------------------
  // Productos
  // ---------------------------------------------------------------------------

  /**
   * Conecta o desconecta un grupo de un producto.
   *
   * La RPC reemplaza el conjunto completo de grupos del producto, así que se manda la
   * lista entera con el grupo agregado o quitado, nunca solo el cambio. Mandar solo el
   * cambio dejaría al producto con lo que la RPC decida conservar, que es un bug que
   * depende de qué se había editado antes, y esos bugs son los que nadie reproduce.
   */
  const toggleProductGroup = async (productId, groupId) => {
    const current = groupsByProduct.get(productId) ?? []
    const next = current.includes(groupId)
      ? current.filter((id) => id !== groupId)
      : [...current, groupId]

    const { error: rpcError } = await supabase.rpc('set_product_modifier_groups', {
      p_pin: adminPin,
      p_product_id: productId,
      p_group_ids: next,
    })
    if (rpcError) {
      return fail(rpcError, 'actualizar los extras del producto')
    }
    await load()
  }

  return (
    <div className="space-y-5">
      <section className={PANEL}>
        <h2 className={PANEL_TITLE}>
          {editingGroupId ? 'Editando grupo' : 'Nuevo grupo de extras'}
        </h2>
        <p className="mt-1 mb-4 text-sm text-bone-muted">
          Un grupo es un conjunto de extras que se ofrecen juntos. El mínimo y el máximo
          marcan cuántos se pueden elegir: 0 a 4 significa "los que quieras, hasta cuatro";
          1 a 1 significa que hay que escoger exactamente uno.
        </p>

        {/*
          El `sm:items-end` alinea los campos por su BASE, no por su centro, y por eso
          los labels de arriba tienen que tener la misma altura en las cuatro columnas:
          los de Mínimo y Máximo son una sola palabra y los de Nombre pueden partirse en
          dos líneas. Con labels de una sola línea fija, la grilla queda con los campos
          desalineados en cuanto el nombre del grupo es largo, y se nota a la vista.

          Por eso los labels viven en una fila fija arriba y el campo siempre ocupa la misma
          altura en la parte de baja de su celda, de modo que la grilla no se descuadra
          aunque el nombre del grupo ocupe dos líneas.
        */}
        <form
          onSubmit={saveGroup}
          className="grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-[1fr_5.5rem_5.5rem_auto] sm:items-end"
        >
          <div className="col-span-2 sm:col-span-1">
            <label htmlFor="group-name" className="mb-1.5 block text-xs text-bone-muted">
              Nombre del grupo
            </label>
            <input
              id="group-name"
              value={groupForm.name}
              onChange={(event) => setGroupForm({ ...groupForm, name: event.target.value })}
              placeholder="Extras, Terminado, Sin gluten…"
              required
              disabled={saving && pendingAction === 'grupo'}
              className={INPUT}
            />
          </div>
          <div>
            <label htmlFor="group-min" className="mb-1.5 block text-xs text-bone-muted">
              Mínimo
            </label>
            <input
              id="group-min"
              value={groupForm.min_select}
              onChange={(event) =>
                setGroupForm({ ...groupForm, min_select: event.target.value.replace(/\D/g, '') })
              }
              inputMode="numeric"
              aria-label="Mínimo de extras a elegir"
              disabled={saving && pendingAction === 'grupo'}
              className={`${INPUT} text-center font-ticket`}
            />
          </div>
          <div>
            <label htmlFor="group-max" className="mb-1.5 block text-xs text-bone-muted">
              Máximo
            </label>
            <input
              id="group-max"
              value={groupForm.max_select}
              onChange={(event) =>
                setGroupForm({ ...groupForm, max_select: event.target.value.replace(/\D/g, '') })
              }
              inputMode="numeric"
              required
              aria-label="Máximo de extras a elegir"
              disabled={saving && pendingAction === 'grupo'}
              className={`${INPUT} text-center font-ticket`}
            />
          </div>
          <div className="col-span-2 flex gap-2 sm:col-span-1">
            <TouchButton
              type="submit"
              disabled={saving}
              className="min-h-touch flex-1 px-4 text-sm sm:flex-none"
            >
              {saving && pendingAction === 'grupo' ? (
                <>
                  <Loader2 className="animate-spin" size={16} />
                  Guardando…
                </>
              ) : (
                <>
                  {editingGroupId ? <Check size={16} /> : <Plus size={16} />}
                  {editingGroupId ? 'Guardar' : 'Crear grupo'}
                </>
              )}
            </TouchButton>
            {editingGroupId && (
              <TouchButton
                variant="ghost"
                aria-label="Cancelar edición del grupo"
                disabled={saving}
                onClick={() => {
                  setEditingGroupId(null)
                  setGroupForm(EMPTY_GROUP)
                }}
                className="min-h-touch px-3"
              >
                <X size={16} />
              </TouchButton>
            )}
          </div>
        </form>

        <label className="mt-3 flex min-h-touch cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={groupForm.is_active}
            onChange={(event) => setGroupForm({ ...groupForm, is_active: event.target.checked })}
            disabled={saving && pendingAction === 'grupo'}
            className="h-5 w-5 accent-saffron-400"
          />
          Grupo activo (aparece en la carta)
        </label>
      </section>

      {error && (
        <p role="alert" className="rounded-xl border border-emberred-500/40 bg-emberred-500/10 px-4 py-3 text-sm text-emberred-400">
          {error}
        </p>
      )}

      {loading && (
        <p className="flex items-center justify-center gap-2 py-16 text-bone-muted">
          <Loader2 className="animate-spin" size={18} /> Cargando extras…
        </p>
      )}

      {!loading && groups.length === 0 && (
        <p className={`${PANEL} py-16 text-center text-sm text-bone-muted`}>
          Todavía no hay grupos de extras. Crea el primero arriba.
        </p>
      )}

      {!loading &&
        groups.map((group) => {
          const offered = productsByGroup.get(group.group_id) ?? []
          const open = openGroupId === group.group_id

          return (
            <section key={group.group_id} className={PANEL}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-display text-lg font-bold">
                    {group.name}{' '}
                    {!group.is_active && (
                      <span className="ml-1 text-xs font-normal text-emberred-400">inactivo</span>
                    )}
                  </h3>
                  <p className="text-xs text-bone-faint">
                    De {group.min_select} a {group.max_select} · {group.modifiers.length}{' '}
                    {group.modifiers.length === 1 ? 'extra' : 'extras'} ·{' '}
                    {offered.length === 0
                      ? 'sin productos'
                      : `${offered.length} ${offered.length === 1 ? 'producto' : 'productos'}`}
                  </p>
                </div>
                <TouchButton
                  variant="ghost"
                  onClick={() => startEditGroup(group)}
                  aria-label={`Editar el grupo ${group.name}`}
                  className="min-h-touch w-11 rounded-lg"
                >
                  <Pencil size={16} />
                </TouchButton>
              </div>

              {/*
                Cada fila se lee de izquierda a derecha como una frase: nombre, precio,
                acción. El precio va antes de los botones y no después para que la
                columna de montos quede alineada al limpiar los botones; con el precio
                al final, el número salta hacia la izquierda y la columna deja de
                leerse como una columna.
              */}
              <ul className="mt-3 divide-y divide-white/5">
                {group.modifiers.map((modifier) => (
                  <li
                    key={modifier.modifier_id}
                    className="flex min-h-touch items-center justify-between gap-3 py-1.5"
                  >
                    <span
                      className={
                        modifier.is_active
                          ? 'min-w-0 flex-1 truncate text-sm'
                          : 'min-w-0 flex-1 truncate text-sm text-bone-faint line-through'
                      }
                    >
                      {modifier.name}
                    </span>
                    <span className="w-20 shrink-0 text-right font-ticket text-sm font-semibold text-saffron-400">
                      {Number(modifier.price) === 0 ? 'gratis' : formatMXN(modifier.price)}
                    </span>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <TouchButton
                        variant="ghost"
                        onClick={() => startEditModifier(group.group_id, modifier)}
                        aria-label={`Editar ${modifier.name}`}
                        className="min-h-touch w-11 rounded-lg"
                      >
                        <Pencil size={16} />
                      </TouchButton>
                      <TouchButton
                        variant="secondary"
                        onClick={() => toggleModifier(group.group_id, modifier)}
                        aria-pressed={!modifier.is_active}
                        className="min-h-touch rounded-lg px-3 text-sm"
                      >
                        {modifier.is_active ? 'Ocultar' : 'Mostrar'}
                      </TouchButton>
                    </div>
                  </li>
                ))}
              </ul>

              {open && (
                <form
                  onSubmit={(event) => saveModifier(event, group.group_id)}
                  className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3 border-t border-white/10 pt-3 sm:grid-cols-[1fr_8rem_auto] sm:items-end"
                >
                  <div className="col-span-2 sm:col-span-1">
                    <label htmlFor="mod-name" className="mb-1.5 block text-xs text-bone-muted">
                      {editingModifierId ? 'Nombre del extra' : 'Nuevo extra'}
                    </label>
                    <input
                      id="mod-name"
                      value={modifierForm.name}
                      onChange={(event) => setModifierForm({ ...modifierForm, name: event.target.value })}
                      placeholder="Extra queso"
                      required
                      disabled={saving && pendingAction === 'extra'}
                      className={INPUT}
                    />
                  </div>
                  <div>
                    <label htmlFor="mod-price" className="mb-1.5 block text-xs text-bone-muted">
                      Precio
                    </label>
                    <input
                      id="mod-price"
                      value={modifierForm.price}
                      onChange={(event) =>
                        setModifierForm({ ...modifierForm, price: event.target.value.replace(/[^\d.]/g, '') })
                      }
                      inputMode="decimal"
                      placeholder="0.00"
                      required
                      disabled={saving && pendingAction === 'extra'}
                      className={`${INPUT} text-center font-ticket`}
                    />
                  </div>
                  <div className="col-span-2 flex gap-2 sm:col-span-1">
                    <TouchButton type="submit" disabled={saving} className="min-h-touch flex-1 px-4 text-sm sm:flex-none">
                      {saving && pendingAction === 'extra' ? (
                        <>
                          <Loader2 className="animate-spin" size={16} />
                          Guardando…
                        </>
                      ) : (
                        <>
                          {editingModifierId ? <Check size={16} /> : <Plus size={16} />}
                          {editingModifierId ? 'Guardar' : 'Agregar'}
                        </>
                      )}
                    </TouchButton>
                    <TouchButton
                      variant="ghost"
                      aria-label="Cerrar el formulario de extra"
                      disabled={saving}
                      onClick={() => {
                        setEditingModifierId(null)
                        setModifierForm(EMPTY_MODIFIER)
                      }}
                      className="min-h-touch px-3"
                    >
                      <X size={16} />
                    </TouchButton>
                  </div>
                </form>
              )}

              <TouchButton
                variant="ghost"
                onClick={() => openGroup(group.group_id)}
                aria-expanded={open}
                className="mt-3 min-h-touch px-4 text-sm"
              >
                {open ? <X size={16} /> : <Plus size={16} />}
                {open ? 'Ocultar extras' : 'Agregar extra'}
              </TouchButton>

              {/*
                Los productos que ofrecen el grupo se listan como texto, no como casillas
                de cada producto. Con 26 productos y 2 grupos eso serían 52 casillas para
                revisar en cada cambio, y casi todas van a estar igual. Lo que se necesita
                es cambiar de aquí un producto concreto, y para eso la lista de productos
                de abajo tiene la casilla.
              */}
              {offered.length > 0 && (
                <p className="mt-2 text-xs text-bone-faint">
                  Se ofrecen en: {offered.map((product) => product.name).join(', ')}
                </p>
              )}
            </section>
          )
        })}

      {groups.length > 0 && (
        <ProductGroupsSection
          products={products}
          groups={groups}
          groupsByProduct={groupsByProduct}
          onToggle={toggleProductGroup}
        />
      )}

      <TouchButton variant="ghost" onClick={load} disabled={loading} className="min-h-touch px-4 text-sm">
        {loading ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}
        {loading ? 'Actualizando…' : 'Recargar'}
      </TouchButton>

      {/*
        El toast va al final y FUERA del flujo del documento, pero dentro del panel: así
        el mensaje de éxito no empuja hacia abajo la lista de productos, que es lo que
        se estaba editando. Un aviso que mueve el contenido mientras se está TECLEANDO
        sobre él es peor que no avisar.
      */}
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}

/**
 * Qué productos ofrecen cuáles grupos.
 *
 * Va al final y aparte porque es la pregunta inversa y se responde diferente: arriba se
 * edita un grupo y se ve a quién le toca, aquí se edita un producto y se ve qué grupos
 * tiene. Escribir la lista de productos en cada grupo duplicaba el problema.
 */
function ProductGroupsSection({ products, groups, groupsByProduct, onToggle }) {
  // Solo los grupos activos se ofrecen. Desactivar un grupo no lo saca de los productos
  // que ya lo tienen, lo esconde: si está inactivo no aparece en el POS, y reactivarlo
  // tiene que devolverlo a todos los productos que ya lo tenían, no solo a los que se
  // reconectaron a mano mientras estaba apagado.
  const offerable = groups.filter((group) => group.is_active)
  const [filter, setFilter] = useState('')

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!needle) return products
    return products.filter((product) => product.name.toLowerCase().includes(needle))
  }, [products, filter])

  if (offerable.length === 0) return null

  return (
    <section className={PANEL}>
      <h2 className={PANEL_TITLE}>Extras por producto</h2>
      <p className="mt-1 mb-4 text-sm text-bone-muted">
        Marca qué grupos ofrece cada producto. Un producto sin ninguna casilla no abre el
        diálogo de extras al tocarlo.
      </p>

      {products.length > 8 && (
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Buscar producto…"
          aria-label="Buscar producto"
          className={`${INPUT} mb-3`}
        />
      )}

      <ul className="space-y-2">
        {visible.map((product) => {
          const assigned = groupsByProduct.get(product.id) ?? []

          return (
            <li
              key={product.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-ink-800/50 px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{product.name}</p>
                <p className="text-xs text-bone-faint">{product.category}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {/*
                  Cada botón crece a `min-h-touch` (3.5rem) en vez de un padding de 4px.
                  Antes medía unos 24px de alto: en una tablet de 8 pulgadas eso está por
                  debajo del mínimo comfortable para un dedo, y con cuatro grupos por
                  producto quedaban tan juntos que era fácil tocar el de al lado. El ancho
                  se deja al texto porque los nombres de grupo varían mucho; lo que se fija
                  es la ALTURA, que es la dimensión que decide si dos objetivos vecinos se
                  distinguen con un dedo.
                */}
                {offerable.map((group) => {
                  const on = assigned.includes(group.group_id)
                  return (
                    <button
                      key={group.group_id}
                      type="button"
                      onClick={() => onToggle(product.id, group.group_id)}
                      aria-pressed={on}
                      className={`flex min-h-touch items-center gap-1.5 rounded-full border px-3.5 text-sm transition-colors ${
                        on
                          ? 'border-jade-400 bg-jade-400/15 font-semibold text-jade-300'
                          : 'border-white/10 text-bone-muted hover:bg-white/5'
                      }`}
                    >
                      {on && <Check size={12} />}
                      {group.name}
                    </button>
                  )
                })}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
