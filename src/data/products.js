/**
 * CARTA REAL — Nuevo Imperio Burger.
 *
 * Los precios vienen del menú y ya incluyen IVA, igual que en `src/lib/format.js`.
 * Todo `price` está en MXN.
 *
 * PENDIENTE CON EL RESTAURANTE:
 *  - "Malteadas" no traía precio. Se puso $50 como base provisional para poder venderla
 *    sin broncas en caja; cuando llegue el precio real se cambia solo en este archivo.
 *  - "Extra 10" y "Extra 5" no dicen qué extra es, pero se usan como comodines de caja
 *    para cobrar algo fuera de carta, así que se dejamos tal cual.
 *  - "Extras" son productos sueltos, no modificadores de una hamburguesa.
 *  - "Urburger" y "Sincronizada" se copiaron como estaban.
 *
 * Para cargar fotos, basta con poner la URL en `image`. Si no hay imagen, POS dibuja
 * el degradado de la categoría.
 *
 * `gradient` debe permanecer literal: el generador de Tailwind solo detecta las
 * clases completas escritas en el código, no las construidas por partes.
 */

export const CATEGORIES = [
  { id: 'hamburguesas', label: 'Hamburguesas Gigantes', gradient: 'from-emberred-500 via-emberred-600 to-ink-900' },
  { id: 'burros', label: 'Mega Burros', gradient: 'from-saffron-500 via-emberred-500 to-ink-900' },
  { id: 'snacks', label: 'Snacks', gradient: 'from-jade-500 via-jade-400 to-ink-900' },
  { id: 'antojitos', label: 'Antojitos Mexicanos', gradient: 'from-saffron-600 via-saffron-500 to-ink-900' },
  { id: 'tacos', label: 'Tacos', gradient: 'from-emberred-400 via-saffron-500 to-ink-900' },
  { id: 'combos', label: 'Combos & Promociones', gradient: 'from-saffron-400 via-saffron-300 to-ink-900' },
  { id: 'bebidas', label: 'Bebidas', gradient: 'from-jade-400 via-jade-500 to-ink-900' },
  { id: 'ninos', label: 'Niños', gradient: 'from-jade-500 via-saffron-300 to-ink-900' },
  { id: 'extras', label: 'Extras', gradient: 'from-bone-faint via-bone-muted to-ink-900' },
]

export const PRODUCTS = [
  // ---------- Hamburguesas gigantes ----------
  { id: 'hamb-arrachera', name: 'Hamburguesa Arrachera', price: 95, category: 'hamburguesas' },
  { id: 'hamb-bufalo', name: 'Hamburguesa Búfalo Chicken Burger', price: 85, category: 'hamburguesas' },
  { id: 'hamb-camaron', name: 'Hamburguesa Camarón', price: 110, category: 'hamburguesas' },
  { id: 'hamb-chipotle', name: 'Hamburguesa Chipotle Burger', price: 90, category: 'hamburguesas' },
  { id: 'hamb-guacamole', name: 'Hamburguesa Guacamole Burger', price: 90, category: 'hamburguesas' },
  { id: 'hamb-hawaiana', name: 'Hamburguesa Hawaiana', price: 85, category: 'hamburguesas' },
  { id: 'hamb-hongo', name: 'Hamburguesa Hongo Burger', price: 90, category: 'hamburguesas' },
  { id: 'hamb-monster', name: 'Hamburguesa Monster Burger', price: 135, category: 'hamburguesas' },
  { id: 'hamb-nortec', name: 'Hamburguesa Nortec Burger', price: 85, category: 'hamburguesas' },
  { id: 'hamb-sencilla', name: 'Hamburguesa Sencilla', price: 75, category: 'hamburguesas' },
  { id: 'hamb-suiza', name: 'Hamburguesa Suiza', price: 90, category: 'hamburguesas' },
  { id: 'hamb-texas', name: 'Hamburguesa Texas Burger', price: 85, category: 'hamburguesas' },

  // ---------- Mega burros ----------
  { id: 'burro-arrachera', name: 'Burro Arrachera', price: 90, category: 'burros' },
  { id: 'burro-bistec', name: 'Burro Bistec', price: 80, category: 'burros' },
  { id: 'burro-campechano', name: 'Burro Campechano', price: 80, category: 'burros' },
  { id: 'burro-enchilada', name: 'Burro de Enchilada', price: 80, category: 'burros' },
  { id: 'burro-hawaiano', name: 'Burro Hawaiano', price: 80, category: 'burros' },
  { id: 'burro-pastor', name: 'Burro Pastor', price: 80, category: 'burros' },
  { id: 'burro-pollo', name: 'Burro Pollo', price: 80, category: 'burros' },
  { id: 'burro-texano', name: 'Burro Texano', price: 80, category: 'burros' },
  { id: 'carne-enchilada', name: 'Carne Enchilada', price: 80, category: 'burros' },

  // ---------- Snacks ----------
  { id: 'alitas', name: 'Alitas', price: 65, category: 'snacks' },
  { id: 'aros-cebolla', name: 'Aros de Cebolla', price: 50, category: 'snacks' },
  { id: 'boneless', name: 'Boneless', price: 80, category: 'snacks' },
  { id: 'club-sandwich', name: 'Club Sándwich', price: 65, category: 'snacks' },
  { id: 'costillas', name: 'Costillas', price: 85, category: 'snacks' },
  { id: 'ensalada-imperial', name: 'Ensalada Imperial', price: 75, category: 'snacks' },
  { id: 'nachos-chilli', name: 'Nachos Chilli', price: 60, category: 'snacks' },
  { id: 'papas-francesas', name: 'Papas Francesas', price: 50, category: 'snacks' },
  { id: 'papas-gajo', name: 'Papas Gajo', price: 50, category: 'snacks' },
  { id: 'poutine', name: 'Poutine', price: 85, category: 'snacks' },

  // ---------- Antojitos mexicanos ----------
  { id: 'carnita-asada', name: 'Carnita Asada', price: 85, category: 'antojitos' },
  { id: 'chilaquiles', name: 'Chilaquiles', price: 65, category: 'antojitos' },
  { id: 'enchiladas-casa', name: 'Enchiladas de la Casa', price: 75, category: 'antojitos' },
  { id: 'enchiladas-suizas', name: 'Enchiladas Suizas', price: 80, category: 'antojitos' },

  // ---------- Tacos ----------
  { id: 'taco-arrachera', name: 'Taco Arrachera', price: 33, category: 'tacos' },
  { id: 'taco-bistec', name: 'Taco Bistec', price: 30, category: 'tacos' },
  { id: 'taco-campechano', name: 'Taco Campechano', price: 30, category: 'tacos' },
  { id: 'taco-longaniza', name: 'Taco Longaniza', price: 30, category: 'tacos' },
  { id: 'taco-pastor', name: 'Taco Pastor', price: 30, category: 'tacos' },

  // ---------- Combos & promociones ----------
  { id: 'combo-alitas', name: 'Alitas c/Papas+Soda', price: 65, category: 'combos' },
  { id: 'combo-chilaquiles', name: 'Chilaquiles c/Bistec+Soda', price: 60, category: 'combos' },
  { id: 'combo-club', name: 'Club Sándwich+Papas+Soda', price: 60, category: 'combos' },
  { id: 'combo-familiar', name: 'Combo Familiar', price: 260, category: 'combos' },
  { id: 'combo-nuevo', name: 'Combo Nuevo', price: 290, category: 'combos' },
  { id: 'combo-gante', name: 'Hamburguesa Gante+Papas+Soda', price: 80, category: 'combos' },
  { id: 'combo-urburger', name: 'Urburger+Papas+Soda', price: 50, category: 'combos' },
  { id: 'combo-papas-refresco', name: 'Papas Francesa+Refresco', price: 45, category: 'combos' },

  // ---------- Bebidas ----------
  { id: 'malteadas', name: 'Malteadas', price: 50, category: 'bebidas' },
  { id: 'boing', name: 'Boing', price: 25, category: 'bebidas' },
  { id: 'coca-cola', name: 'Coca Cola', price: 25, category: 'bebidas' },
  { id: 'coca-cola-media', name: 'Coca-cola 1/2', price: 30, category: 'bebidas' },
  { id: 'limonada-nieve', name: 'Limonada con Nieve', price: 30, category: 'bebidas' },
  { id: 'manzanita', name: 'Manzanita Deliciosa', price: 15, category: 'bebidas' },
  { id: 'sangria', name: 'Sangria Preparada', price: 30, category: 'bebidas' },
  { id: 'sprite', name: 'Sprite', price: 20, category: 'bebidas' },
  { id: 'vaso-agua', name: 'Vaso de Agua', price: 15, category: 'bebidas' },

  // ---------- Niños ----------
  { id: 'bolitas-pollo', name: 'Bolitas de Pollo', price: 45, category: 'ninos' },
  { id: 'mini-burguer', name: 'Mini Burguer', price: 45, category: 'ninos' },
  { id: 'sincronizada', name: 'Sincronizada', price: 45, category: 'ninos' },

  // ---------- Extras ----------
  // Ver nota sobre "Extra 10" / "Extra 5": se dejaron tal cual vinieron.
  { id: 'extra-10', name: 'Extra 10', price: 10, category: 'extras' },
  { id: 'extra-5', name: 'Extra 5', price: 5, category: 'extras' },
  { id: 'pina', name: 'Piña', price: 10, category: 'extras' },
  { id: 'queso', name: 'Queso', price: 5, category: 'extras' },
  { id: 'tocino', name: 'Tocino', price: 10, category: 'extras' },
]

const BY_CATEGORY = CATEGORIES.reduce((acc, category) => {
  acc[category.id] = category
  return acc
}, {})

export const getCategory = (product) => BY_CATEGORY[product.category] ?? CATEGORIES[0]

export const getGradient = (product) => getCategory(product).gradient

/**
 * Sin precio no se puede vender: evita que un producto sin cargar salga a $0 en la comanda.
 * Hoy los 65 tienen precio, pero la red de seguridad se queda por si mañana se agrega
 * uno nuevo y se olvida.
 */
export const isPriced = (product) => typeof product.price === 'number'