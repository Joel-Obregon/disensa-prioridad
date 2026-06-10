-- Parche operativo: despacho descuenta inventario_bodega y evita stock negativo.
-- Ejecutar en Supabase SQL Editor despues de schema_bases_operativas_3_0.sql.

begin;

update public.inventario_bodega
set
  stock_libre_utilizacion = greatest(0, coalesce(stock_libre_utilizacion, 0)),
  bloqueado = greatest(0, coalesce(bloqueado, 0)),
  comprometido_ped_vta = greatest(0, coalesce(comprometido_ped_vta, 0)),
  comprometido_entregas = greatest(0, coalesce(comprometido_entregas, 0)),
  consignacion_libre = greatest(0, coalesce(consignacion_libre, 0)),
  stock_en_curso_pedido = greatest(0, coalesce(stock_en_curso_pedido, 0)),
  devoluciones = greatest(0, coalesce(devoluciones, 0)),
  stock_disponible = greatest(0, coalesce(stock_disponible, 0)),
  updated_at = now();

update public.materiales
set
  stock_actual = greatest(0, coalesce(stock_actual, 0)),
  stock_minimo = greatest(0, coalesce(stock_minimo, 0));

update public.pedidos
set
  stock_disponible = greatest(0, coalesce(stock_disponible, 0)),
  cantidad_despacho = greatest(0, coalesce(cantidad_despacho, 0)),
  cantidad_despachada = greatest(0, coalesce(cantidad_despachada, 0));

alter table public.inventario_bodega
  drop constraint if exists inventario_bodega_stock_no_negativo;

alter table public.inventario_bodega
  add constraint inventario_bodega_stock_no_negativo
  check (
    stock_libre_utilizacion >= 0
    and bloqueado >= 0
    and comprometido_ped_vta >= 0
    and comprometido_entregas >= 0
    and consignacion_libre >= 0
    and stock_en_curso_pedido >= 0
    and devoluciones >= 0
    and stock_disponible >= 0
  );

create or replace function public.despachar_pedido_operativo_seguro(
  p_material_id uuid,
  p_pedido_id uuid,
  p_responsable text default 'Bodega',
  p_codigo_material text default null,
  p_stock_operativo numeric default null
)
returns table (
  pedido_estado text,
  stock_anterior integer,
  stock_nuevo integer
)
language plpgsql
security definer
as $$
declare
  v_pedido public.pedidos%rowtype;
  v_material public.materiales%rowtype;
  v_codigo_material text;
  v_cantidad integer;
  v_stock_operativo numeric := 0;
  v_restante numeric := 0;
  v_descuento numeric := 0;
  v_libre_descuento numeric := 0;
  v_inv record;
begin
  select * into v_pedido
  from public.pedidos
  where id = p_pedido_id
  for update;

  if not found then
    raise exception 'No se encontro el pedido %', p_pedido_id;
  end if;

  select * into v_material
  from public.materiales
  where id = coalesce(p_material_id, v_pedido.material_id)
  for update;

  if not found and nullif(btrim(coalesce(p_codigo_material, '')), '') is not null then
    select * into v_material
    from public.materiales
    where codigo_material = nullif(btrim(p_codigo_material), '')
    for update;
  end if;

  v_codigo_material := nullif(
    btrim(coalesce(p_codigo_material, v_material.codigo_material, '')),
    ''
  );

  if v_codigo_material is null then
    raise exception 'El pedido % no tiene codigo de material para descontar inventario operativo',
      v_pedido.codigo;
  end if;

  v_cantidad := case
    when coalesce(v_pedido.cantidad_despacho, 0) > 0 then v_pedido.cantidad_despacho
    else v_pedido.cantidad
  end;

  if v_cantidad <= 0 then
    raise exception 'La cantidad de despacho debe ser mayor a cero para %', v_pedido.codigo;
  end if;

  perform 1
  from public.inventario_bodega
  where codigo_material = v_codigo_material
  for update;

  if not found then
    raise exception 'No existe inventario operativo para el material %', v_codigo_material;
  end if;

  select coalesce(sum(greatest(0, stock_disponible)), 0)
  into v_stock_operativo
  from public.inventario_bodega
  where codigo_material = v_codigo_material;

  if v_stock_operativo < v_cantidad then
    raise exception 'Stock insuficiente para despachar %. Disponible %, requerido %',
      v_pedido.codigo, v_stock_operativo, v_cantidad;
  end if;

  stock_anterior := floor(v_stock_operativo)::integer;
  v_restante := v_cantidad;

  for v_inv in
    select
      centro_codigo,
      greatest(0, stock_disponible) as stock_disponible,
      greatest(0, stock_libre_utilizacion) as stock_libre_utilizacion
    from public.inventario_bodega
    where codigo_material = v_codigo_material
    order by stock_disponible desc
    for update
  loop
    exit when v_restante <= 0;

    v_descuento := least(v_inv.stock_disponible, v_restante);
    v_libre_descuento := least(v_inv.stock_libre_utilizacion, v_descuento);

    update public.inventario_bodega
    set
      stock_disponible = greatest(0, v_inv.stock_disponible - v_descuento),
      stock_libre_utilizacion = greatest(0, v_inv.stock_libre_utilizacion - v_libre_descuento),
      updated_at = now()
    where codigo_material = v_codigo_material
      and centro_codigo = v_inv.centro_codigo;

    v_restante := v_restante - v_descuento;
  end loop;

  if v_restante > 0 then
    raise exception 'No se completo el descuento de inventario para %. Restante %',
      v_pedido.codigo, v_restante;
  end if;

  stock_nuevo := greatest(0, stock_anterior - v_cantidad)::integer;

  if v_material.id is not null then
    update public.materiales
    set stock_actual = stock_nuevo
    where id = v_material.id;

    perform public.registrar_alerta_stock_material(
      v_material.id,
      v_pedido.id,
      stock_nuevo,
      'Departamento de inventario'
    );
  end if;

  update public.pedidos
  set
    estado = 'en_despacho',
    stock_disponible = stock_nuevo,
    cantidad_despachada = v_cantidad,
    despachado_at = now(),
    despachado_por = coalesce(p_responsable, 'Bodega')
  where id = v_pedido.id;

  if v_pedido.codigo like 'BFQ-%' then
    update public.pedidos_bodega_fq
    set
      estado = 'En despacho',
      resolucion = 'Listo para entregar',
      fecha_revision = current_date,
      updated_at = now()
    where pedido_key = substring(v_pedido.codigo from 5);
  end if;

  insert into public.movimientos_inventario (
    material_id,
    material_nombre,
    tipo,
    cantidad,
    stock_anterior,
    stock_nuevo,
    motivo,
    responsable
  )
  values (
    v_material.id,
    coalesce(v_material.nombre, v_pedido.material, v_codigo_material),
    'salida',
    v_cantidad,
    stock_anterior,
    stock_nuevo,
    'Despacho de pedido ' || v_pedido.codigo,
    coalesce(p_responsable, 'Bodega')
  );

  pedido_estado := 'en_despacho';
  return next;
end;
$$;

grant execute on function public.despachar_pedido_operativo_seguro(uuid, uuid, text, text, numeric)
to anon, authenticated;

notify pgrst, 'reload schema';

commit;
