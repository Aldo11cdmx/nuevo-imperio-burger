-- =============================================================================
-- Corrección de slugify: el orden de lower() y regexp_replace estaba invertido
-- =============================================================================
-- El cuerpo original era:
--     lower(regexp_replace(p_text, '[^a-z0-9]+', '-', 'g'))
-- Se reemplaza primero y se baja a minúsculas después, así que las mayúsculas
-- tampoco coincidían con [a-z0-9] y desaparecían. "Prueba Admin Temporal" salía
-- como "-rueba-dmin-emporal-...".
--
-- Hay que bajar a minúsculas primero y luego sustituir:
--     regexp_replace(lower(p_text), '[^a-z0-9]+', '-', 'g')
--
-- Solo afecta a los slugs generados automáticamente. Los 65 de la semilla son
-- literales y no cambian, así que no hace falta reseedeear nada.
--
-- El slug no se muestra nunca al usuario, solo se usa como clave estable, así que
-- perder los acentos ("Búfalo" -> "b-falo") es aceptable.
-- =============================================================================

create or replace function public.slugify(p_text text)
returns text
language sql
immutable
set search_path = public
as $fn$
  select coalesce(nullif(btrim(regexp_replace(lower(p_text), '[^a-z0-9]+', '-', 'g'), '-'), ''), 'producto') || '-' || substr(md5(random()::text), 1, 6)
$fn$;
