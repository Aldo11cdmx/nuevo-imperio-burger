import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://tlwiazszyqhddhefhirs.supabase.co'
const supabase = createClient(supabaseUrl, process.env.SUPABASE_ANON_KEY || '', {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
})

async function run() {
  // 1) Verificar funciones con rate_limit_clear() sin argumentos
  const { data, error } = await supabase.rpc('rpc_debug_sql', {
    query: `
      select proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
      and p.proname in ('login_with_pin','open_shift','adjust_stock','create_employee','list_all_products','list_employees','save_product','set_stock','toggle_employee')
      and p.prosrc like '%rate_limit_clear()%'
    `,
  })

  console.log('1. Funciones con rate_limit_clear() sin args (debe ser 0 filas):')
  console.log(JSON.stringify(data, null, 2))
  if (error) console.error('error:', error.message)

  // 2) Probar login_with_pin con admin PIN
  console.log('\n2. login_with_pin con admin PIN 1234:')
  const { data: login, error: loginErr } = await supabase.rpc('login_with_pin', { p_pin: '1234' })
  console.log('  data:', JSON.stringify(login))
  if (loginErr) console.error('  error:', loginErr.message)

  // 3) Probar open_shift (esto era el 404)
  console.log('\n3. open_shift (0000, 500):')
  const { data: shift, error: shiftErr } = await supabase.rpc('open_shift', { p_pin: '0000', p_opening_float: 500 })
  console.log('  data:', JSON.stringify(shift))
  if (shiftErr) console.error('  error:', shiftErr.message)
}

run()
