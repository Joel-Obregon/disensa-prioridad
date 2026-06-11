-- Schema limpio 2.0 para una Supabase nueva.
-- Fuente principal: Seguimiento de Pedidos Ecuador.xlsx.
-- Ejecutar completo en SQL Editor antes de importar el Excel.

create extension if not exists pgcrypto;

create table if not exists public.usuarios_app (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  correo text not null unique,
  rol text not null default 'administrador'
    check (rol in ('administrador', 'suministrador', 'bodega')),
  estado text not null default 'activo'
    check (estado in ('activo', 'inactivo')),
  created_at timestamptz not null default now()
);

insert into public.usuarios_app (nombre, correo, rol, estado)
values
  ('Administrador', 'admin@disensa.local', 'administrador', 'activo'),
  ('Suministrador', 'suministrador@disensa.local', 'suministrador', 'activo'),
  ('Bodega', 'bodega@disensa.local', 'bodega', 'activo')
on conflict (correo) do update
set
  nombre = excluded.nombre,
  rol = excluded.rol,
  estado = excluded.estado;

create table if not exists public.proveedores (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  contacto_email text,
  contacto_telefono text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists proveedores_nombre_normalizado_idx
on public.proveedores (lower(btrim(nombre)));

create table if not exists public.solicitantes (
  codigo_solicitante text primary key,
  nombre text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.material_catalogo (
  codigo_material text primary key,
  nombre_material text not null,
  numero_fb text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pedidos_erp (
  id uuid primary key default gen_random_uuid(),
  numero_pedido text not null unique,
  orden_compra text,
  numero_factura text,
  codigo_solicitante text references public.solicitantes(codigo_solicitante)
    on update cascade on delete set null,
  proveedor_id uuid references public.proveedores(id)
    on update cascade on delete set null,
  incoterm text,
  fecha_pedido date,
  valor_pedido numeric(14, 2) not null default 0,
  valor_facturado numeric(14, 2) not null default 0,
  valor_pendiente numeric(14, 2) not null default 0,
  status_erp text not null,
  estado_operativo text not null default 'pendiente'
    check (estado_operativo in (
      'pendiente',
      'en_revision',
      'aprobado',
      'en_despacho',
      'retrasado',
      'sin_stock',
      'entregado',
      'cancelado',
      'rechazado'
    )),
  motivo_pedido text,
  condicion_pago numeric(8, 2),
  fecha_a_procesar_nc date,
  fecha_objetivo date,
  prioridad_calculada integer not null default 0
    check (prioridad_calculada between 0 and 100),
  fuente text not null default 'Seguimiento de Pedidos Ecuador.xlsx',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pedidos_erp_estado_idx on public.pedidos_erp (estado_operativo);
create index if not exists pedidos_erp_status_idx on public.pedidos_erp (status_erp);
create index if not exists pedidos_erp_fecha_idx on public.pedidos_erp (fecha_pedido);
create index if not exists pedidos_erp_proveedor_idx on public.pedidos_erp (proveedor_id);
create index if not exists pedidos_erp_solicitante_idx on public.pedidos_erp (codigo_solicitante);
create index if not exists pedidos_erp_valor_pendiente_idx on public.pedidos_erp (valor_pendiente desc);

create table if not exists public.pedido_lineas (
  id uuid primary key default gen_random_uuid(),
  linea_key text not null unique,
  pedido_id uuid not null references public.pedidos_erp(id) on delete cascade,
  documento_compras text,
  documento_ventas text not null,
  codigo_material text references public.material_catalogo(codigo_material)
    on update cascade on delete set null,
  nombre_material_snapshot text not null,
  cantidad_pedido numeric(14, 3) not null default 0,
  cantidad_pendiente numeric(14, 3) not null default 0,
  valor_neto numeric(14, 2) not null default 0,
  motivo_pedido text,
  condicion_pago numeric(8, 2),
  fecha_a_procesar_nc date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pedido_lineas_pedido_idx on public.pedido_lineas (pedido_id);
create index if not exists pedido_lineas_material_idx on public.pedido_lineas (codigo_material);
create index if not exists pedido_lineas_pendiente_idx on public.pedido_lineas (cantidad_pendiente desc);
create index if not exists pedido_lineas_documento_ventas_idx on public.pedido_lineas (documento_ventas);

create table if not exists public.gestiones_pedido (
  respuesta_id text primary key,
  pedido_id uuid references public.pedidos_erp(id) on delete set null,
  numero_pedido text,
  tipo_entrega text,
  fecha_ultima_gestion timestamptz,
  status_gestion text not null,
  motivo_gestion text,
  comentario text,
  fecha_tentativa_entrega date,
  respondido_por text,
  proveedor_login text,
  numero_interno_producto text,
  accion_derivada text not null default 'despachar'
    check (accion_derivada in ('despachar', 'nota_credito', 'esperar_pedido')),
  condicion_derivada text not null default 'normal'
    check (condicion_derivada in (
      'normal',
      'no_planificable',
      'restrictivo',
      'urgente_despacho',
      'caducidad'
    )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists gestiones_pedido_pedido_idx on public.gestiones_pedido (pedido_id);
create index if not exists gestiones_pedido_numero_idx on public.gestiones_pedido (numero_pedido);
create index if not exists gestiones_pedido_fecha_idx on public.gestiones_pedido (fecha_ultima_gestion desc);
create index if not exists gestiones_pedido_accion_idx on public.gestiones_pedido (accion_derivada);

create table if not exists public.solicitudes_gestion (
  solicitud_id text primary key,
  pedido_id uuid references public.pedidos_erp(id) on delete set null,
  numero_pedido text,
  tipo text not null default 'GESTION',
  mensaje text not null,
  estado text not null default 'PENDIENTE',
  fecha_solicitud timestamptz,
  solicitado_por text,
  fecha_atendido timestamptz,
  atendido_por text,
  archivo_guia text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists solicitudes_gestion_pedido_idx on public.solicitudes_gestion (pedido_id);
create index if not exists solicitudes_gestion_numero_idx on public.solicitudes_gestion (numero_pedido);
create index if not exists solicitudes_gestion_estado_idx on public.solicitudes_gestion (estado);

create table if not exists public.notas_credito (
  nc_id text primary key,
  respuesta_id text,
  pedido_id uuid references public.pedidos_erp(id) on delete set null,
  numero_pedido text,
  proveedor_id uuid references public.proveedores(id)
    on update cascade on delete set null,
  motivo_nc text not null,
  motivo_gestion text,
  comentario text,
  estado_nc text not null default 'PENDIENTE',
  fecha_creacion timestamptz,
  creado_por text,
  fecha_resuelto timestamptz,
  resuelto_por text,
  comentario_equipo_nc text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notas_credito_pedido_idx on public.notas_credito (pedido_id);
create index if not exists notas_credito_numero_idx on public.notas_credito (numero_pedido);
create index if not exists notas_credito_respuesta_idx on public.notas_credito (respuesta_id);
create index if not exists notas_credito_estado_idx on public.notas_credito (estado_nc);
create index if not exists notas_credito_fecha_idx on public.notas_credito (fecha_creacion desc);

create table if not exists public.nota_credito_lineas (
  linea_id text primary key,
  nc_id text references public.notas_credito(nc_id)
    on update cascade on delete cascade,
  respuesta_id text,
  codigo_material text references public.material_catalogo(codigo_material)
    on update cascade on delete set null,
  nombre_material_snapshot text not null,
  cantidad_pendiente numeric(14, 3) not null default 0,
  cantidad_nc numeric(14, 3) not null default 0,
  numero_fb text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists nota_credito_lineas_nc_idx on public.nota_credito_lineas (nc_id);
create index if not exists nota_credito_lineas_respuesta_idx on public.nota_credito_lineas (respuesta_id);
create index if not exists nota_credito_lineas_material_idx on public.nota_credito_lineas (codigo_material);

create table if not exists public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  fecha_hora timestamptz not null,
  estado text not null,
  pedidos_actualizados integer not null default 0,
  detalle_actualizado integer not null default 0,
  usuario text,
  error text,
  created_at timestamptz not null default now(),
  unique (fecha_hora, estado)
);

create table if not exists public.seguimiento_proveedor_fuente (
  proveedor_nombre text primary key,
  proveedor_id uuid references public.proveedores(id)
    on update cascade on delete set null,
  pedidos_totales integer not null default 0,
  pedidos_respondidos integer not null default 0,
  pedidos_pendientes integer not null default 0,
  tasa_respuesta numeric(8, 2) not null default 0,
  fuente text not null default 'Seguimiento de pedidos',
  updated_at timestamptz not null default now()
);

create table if not exists public.consolidado_nc_fuente (
  key_consolidado text primary key,
  nc_id text,
  respuesta_id text,
  numero_pedido text,
  proveedor_nombre text,
  motivo_nc text,
  motivo_gestion text,
  estado_nc text,
  fecha_creacion timestamptz,
  creado_por text,
  fecha_resuelto timestamptz,
  resuelto_por text,
  comentario text,
  comentario_equipo_nc text,
  codigo_material text,
  nombre_material text,
  cantidad_pendiente numeric(14, 3),
  cantidad_nc numeric(14, 3),
  numero_fb text,
  motivo_pedido text,
  condicion_pago numeric(8, 2),
  fecha_a_procesar_nc date,
  numero_factura text,
  codigo_solicitante text,
  solicitante_nombre text,
  updated_at timestamptz not null default now()
);

create table if not exists public.import_errores_2_0 (
  id uuid primary key default gen_random_uuid(),
  origen text not null,
  entidad text not null,
  llave text,
  severidad text not null default 'media'
    check (severidad in ('baja', 'media', 'alta', 'critica')),
  mensaje text not null,
  detalle jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Tablas de compatibilidad del prototipo original.
-- Estas mantienen funcionales Dashboard, Pedidos, Inventario, Reglas y Alertas
-- usando la data normalizada del Excel como fuente.

create table if not exists public.materiales (
  id uuid primary key default gen_random_uuid(),
  codigo_material text unique,
  nombre text not null,
  categoria text not null,
  stock_actual integer not null default 0 check (stock_actual >= 0),
  stock_minimo integer not null default 0 check (stock_minimo >= 0),
  unidad_medida text not null,
  es_critico boolean not null default false,
  estado text not null default 'activo',
  created_at timestamptz not null default now()
);

create index if not exists materiales_categoria_idx on public.materiales (categoria);
create index if not exists materiales_stock_idx on public.materiales (stock_actual, stock_minimo);

create table if not exists public.pedidos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  codigo_consulta text,
  tipo_pedido text not null default 'suministrador_franquiciado',
  descripcion text not null default 'Pedido importado desde ERP',
  fecha_pedido date not null default current_date,
  fecha_requerida date not null default current_date,
  fecha_entrega date not null default current_date,
  prioridad text not null default 'media',
  observaciones text not null default '',
  material_id uuid references public.materiales(id) on delete set null,
  origen text not null default 'suministrador'
    check (origen in ('suministrador', 'bodega')),
  destino text not null default 'franquiciado'
    check (destino in ('bodega', 'franquiciado')),
  solicitante text not null,
  cedula_solicitante text,
  material text not null,
  cantidad integer not null default 1 check (cantidad > 0),
  unidad_medida text not null default 'unidad',
  stock_disponible integer not null default 0 check (stock_disponible >= 0),
  fecha_solicitud timestamptz not null default now(),
  fecha_compromiso timestamptz not null default now(),
  urgencia text not null default 'media'
    check (urgencia in ('baja', 'media', 'alta', 'critica')),
  estado text not null default 'pendiente'
    check (estado in (
      'pendiente',
      'en_revision',
      'aprobado',
      'en_despacho',
      'retrasado',
      'sin_stock',
      'entregado',
      'cancelado',
      'rechazado'
    )),
  tipo_cliente text not null default 'franquiciado'
    check (tipo_cliente in ('bodega', 'franquiciado', 'obra_critica')),
  accion_solicitante text not null default 'despachar'
    check (accion_solicitante in ('despachar', 'nota_credito', 'esperar_pedido')),
  condicion_material text not null default 'normal'
    check (condicion_material in (
      'normal',
      'no_planificable',
      'restrictivo',
      'urgente_despacho',
      'caducidad'
    )),
  cantidad_despacho integer not null default 0 check (cantidad_despacho >= 0),
  cantidad_despachada integer not null default 0 check (cantidad_despachada >= 0),
  despachado_at timestamptz,
  despachado_por text,
  valor_pendiente numeric(14, 2) not null default 0,
  status_erp text,
  nc_pendientes integer not null default 0 check (nc_pendientes >= 0),
  tiene_gestion_stock boolean not null default false,
  prioridad_calculada integer not null default 0 check (prioridad_calculada between 0 and 100),
  created_at timestamptz not null default now()
);

alter table public.pedidos add column if not exists status_erp text;
alter table public.pedidos add column if not exists nc_pendientes integer not null default 0;
alter table public.pedidos add column if not exists tiene_gestion_stock boolean not null default false;

create index if not exists pedidos_estado_idx on public.pedidos (estado);
create index if not exists pedidos_material_idx on public.pedidos (material_id);
create index if not exists pedidos_prioridad_idx on public.pedidos (prioridad_calculada desc);
create index if not exists pedidos_fecha_compromiso_idx on public.pedidos (fecha_compromiso);

create table if not exists public.reglas_negocio (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  descripcion text not null default 'Regla de negocio',
  condicion text not null default 'Condicion pendiente',
  accion text not null default 'Accion pendiente',
  color text not null default 'orange',
  activo boolean not null default true,
  criterio text not null,
  efecto text not null,
  peso integer not null check (peso > 0),
  estado text not null default 'activa' check (estado in ('activa', 'inactiva')),
  created_at timestamptz not null default now()
);

create table if not exists public.alertas (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid references public.pedidos(id) on delete set null,
  material_id uuid references public.materiales(id) on delete set null,
  tipo_alerta text not null,
  nivel text not null check (nivel in ('informativa', 'media', 'alta', 'critica')),
  mensaje text not null,
  estado text not null default 'activa' check (estado in ('activa', 'revisada', 'cerrada')),
  responsable text,
  created_at timestamptz not null default now()
);

create index if not exists alertas_estado_idx on public.alertas (estado);
create index if not exists alertas_nivel_idx on public.alertas (nivel);
create index if not exists alertas_pedido_idx on public.alertas (pedido_id);
create index if not exists alertas_material_idx on public.alertas (material_id);

create table if not exists public.notificaciones_correo (
  id uuid primary key default gen_random_uuid(),
  alerta_id uuid references public.alertas(id) on delete set null,
  pedido_id uuid references public.pedidos(id) on delete set null,
  material_id uuid references public.materiales(id) on delete set null,
  departamento text not null default 'Departamento de inventario',
  destinatario text not null default 'Departamento de inventario',
  asunto text not null,
  mensaje text not null,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'enviada', 'fallida')),
  created_at timestamptz not null default now(),
  enviado_at timestamptz
);

create index if not exists notificaciones_correo_estado_idx
on public.notificaciones_correo (estado, created_at desc);
create index if not exists notificaciones_correo_alerta_idx
on public.notificaciones_correo (alerta_id);

create table if not exists public.movimientos_inventario (
  id uuid primary key default gen_random_uuid(),
  material_id uuid references public.materiales(id) on delete set null,
  material_nombre text not null,
  tipo text not null check (tipo in ('entrada', 'salida', 'ajuste')),
  cantidad integer not null check (cantidad >= 0),
  stock_anterior integer not null check (stock_anterior >= 0),
  stock_nuevo integer not null check (stock_nuevo >= 0),
  motivo text not null,
  responsable text not null default 'Administrador',
  created_at timestamptz not null default now()
);

create index if not exists movimientos_inventario_material_idx on public.movimientos_inventario (material_id);
create index if not exists movimientos_inventario_fecha_idx on public.movimientos_inventario (created_at desc);

create or replace function public.registrar_alerta_stock_material(
  p_material_id uuid,
  p_pedido_id uuid default null,
  p_stock_nuevo integer default null,
  p_responsable text default 'Departamento de inventario'
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_material public.materiales%rowtype;
  v_stock integer;
  v_alerta_id uuid;
  v_mensaje text;
  v_nivel text;
begin
  select * into v_material
  from public.materiales
  where id = p_material_id;

  if not found then
    return null;
  end if;

  v_stock := coalesce(p_stock_nuevo, v_material.stock_actual);

  if v_stock >= v_material.stock_minimo then
    update public.alertas
    set estado = 'cerrada'
    where material_id = v_material.id
      and tipo_alerta = 'stock_bajo'
      and estado in ('activa', 'revisada');

    return null;
  end if;

  v_nivel := case when v_stock <= 0 then 'critica' else 'alta' end;
  v_mensaje :=
    'Material '
    || coalesce(v_material.codigo_material || ' - ', '')
    || v_material.nombre
    || ' bajo el minimo en venta: stock '
    || v_stock::text
    || ' / minimo '
    || v_material.stock_minimo::text
    || '. Departamento debe verificar la falta de stock.';

  select id into v_alerta_id
  from public.alertas
  where material_id = v_material.id
    and tipo_alerta = 'stock_bajo'
    and estado in ('activa', 'revisada')
  order by created_at desc
  limit 1;

  if v_alerta_id is null then
    insert into public.alertas (
      pedido_id,
      material_id,
      tipo_alerta,
      nivel,
      mensaje,
      estado,
      responsable
    )
    values (
      p_pedido_id,
      v_material.id,
      'stock_bajo',
      v_nivel,
      v_mensaje,
      'activa',
      coalesce(p_responsable, 'Departamento de inventario')
    )
    returning id into v_alerta_id;
  else
    update public.alertas
    set
      pedido_id = coalesce(p_pedido_id, pedido_id),
      nivel = v_nivel,
      mensaje = v_mensaje,
      estado = 'activa',
      responsable = coalesce(p_responsable, responsable, 'Departamento de inventario')
    where id = v_alerta_id;
  end if;

  insert into public.notificaciones_correo (
    alerta_id,
    pedido_id,
    material_id,
    departamento,
    destinatario,
    asunto,
    mensaje,
    estado
  )
  select
    v_alerta_id,
    p_pedido_id,
    v_material.id,
    coalesce(p_responsable, 'Departamento de inventario'),
    coalesce(p_responsable, 'Departamento de inventario'),
    'Verificar falta de stock: ' || v_material.nombre,
    v_mensaje,
    'pendiente'
  where not exists (
    select 1
    from public.notificaciones_correo nc
    where nc.alerta_id = v_alerta_id
      and nc.estado = 'pendiente'
  );

  return v_alerta_id;
end;
$$;

create or replace function public.materiales_stock_alerta_trg()
returns trigger
language plpgsql
security definer
as $$
begin
  if tg_op = 'INSERT' then
    perform public.registrar_alerta_stock_material(
      new.id,
      null,
      new.stock_actual,
      'Departamento de inventario'
    );
  elsif old.stock_actual is distinct from new.stock_actual
    or old.stock_minimo is distinct from new.stock_minimo then
    perform public.registrar_alerta_stock_material(
      new.id,
      null,
      new.stock_actual,
      'Departamento de inventario'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists materiales_stock_alerta_after_save on public.materiales;
create trigger materiales_stock_alerta_after_save
after insert or update on public.materiales
for each row execute function public.materiales_stock_alerta_trg();

create table if not exists public.auditoria (
  id uuid primary key default gen_random_uuid(),
  entidad text not null,
  entidad_id uuid,
  accion text not null,
  detalle text not null,
  responsable text not null default 'Administrador',
  created_at timestamptz not null default now()
);

create index if not exists auditoria_entidad_idx on public.auditoria (entidad, entidad_id);
create index if not exists auditoria_fecha_idx on public.auditoria (created_at desc);

create table if not exists public.reportes_operativos (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  tipo text not null default 'operativo'
    check (tipo in ('operativo', 'inventario', 'pedido', 'incidente', 'suministro')),
  descripcion text not null,
  prioridad text not null default 'media'
    check (prioridad in ('baja', 'media', 'alta', 'critica')),
  estado text not null default 'abierto'
    check (estado in ('abierto', 'en_revision', 'resuelto')),
  rol_origen text not null default 'administrador'
    check (rol_origen in ('administrador', 'suministrador', 'bodega')),
  creado_por text not null default 'Administrador',
  pedido_codigo text,
  material_id uuid references public.materiales(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reportes_operativos_estado_idx on public.reportes_operativos (estado);
create index if not exists reportes_operativos_material_idx on public.reportes_operativos (material_id);

create table if not exists public.reportes_franquiciado (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid references public.pedidos(id) on delete set null,
  codigo_consulta text not null,
  cedula_solicitante text not null,
  solicitante text,
  motivo text not null check (motivo in ('retraso', 'material_defectuoso', 'otro')),
  descripcion text not null,
  estado text not null default 'recibido'
    check (estado in ('recibido', 'en_revision', 'cerrado')),
  created_at timestamptz not null default now()
);

create index if not exists reportes_franquiciado_pedido_idx on public.reportes_franquiciado (pedido_id);
create index if not exists reportes_franquiciado_codigo_idx on public.reportes_franquiciado (codigo_consulta, cedula_solicitante);

insert into public.reglas_negocio (
  nombre,
  descripcion,
  condicion,
  accion,
  color,
  activo,
  criterio,
  efecto,
  peso,
  estado
)
values
  (
    'Cantidad pendiente ERP',
    'Prioriza pedidos con cantidad pendiente importada del Excel.',
    'cantidad_despacho > 0',
    'Elevar prioridad y mostrar alerta visual',
    'red',
    true,
    'Si el pedido tiene cantidad pendiente por despachar.',
    'Aumenta el puntaje y empuja el pedido arriba en la cola.',
    35,
    'activa'
  ),
  (
    'Nota de credito pendiente',
    'Resalta pedidos con solicitud de nota de credito abierta.',
    'accion_solicitante = nota_credito',
    'Enviar a revision comercial',
    'orange',
    true,
    'Si la gestion del proveedor deriva en NC total o parcial.',
    'Marca el pedido en revision y genera alerta de negocio.',
    30,
    'activa'
  ),
  (
    'Antiguedad del pedido',
    'Aumenta prioridad a pedidos antiguos o con fecha objetivo vencida.',
    'fecha_compromiso <= current_date or fecha_solicitud antigua',
    'Acelerar seguimiento operativo',
    'yellow',
    true,
    'Si el pedido supera los umbrales de espera definidos.',
    'Incrementa prioridad por riesgo de retraso.',
    20,
    'activa'
  ),
  (
    'Valor pendiente',
    'Da mayor peso a pedidos con valor pendiente alto.',
    'valor_pendiente >= 1000',
    'Atender por impacto financiero',
    'blue',
    true,
    'Si el pedido representa un monto pendiente relevante.',
    'Sube prioridad por impacto comercial.',
    15,
    'activa'
  ),
  (
    'Condicion de material',
    'Prioriza falta de stock, minimos comerciales y condiciones restrictivas.',
    'condicion_material in (no_planificable, restrictivo, urgente_despacho)',
    'Mostrar alerta de abastecimiento',
    'red',
    true,
    'Si la gestion indica falta de stock, produccion o restriccion comercial.',
    'Crea una alerta visual para compras, bodega o suministrador.',
    25,
    'activa'
  ),
  (
    'Stock agotado planificable',
    'Detecta materiales planificables sin stock disponible para despacho.',
    'stock_disponible = 0 and estado_planificable = planificable',
    'Generar alerta critica para bodega e inventario',
    'red',
    true,
    'Si un pedido usa un material planificable y el inventario real disponible es cero.',
    'El pedido queda marcado por falta de material y se alerta al departamento responsable.',
    40,
    'activa'
  ),
  (
    'Retraso critico mayor a 60 dias',
    'Escala pedidos con retraso superior a dos meses.',
    'dias_retraso > 60',
    'Subir al inicio de la cola priorizada',
    'red',
    true,
    'Si la fecha limite fue superada por mas de 60 dias.',
    'El pedido se considera critico y se mantiene arriba en la lista por antiguedad de retraso.',
    45,
    'activa'
  ),
  (
    'Hasta agotar stock',
    'Controla materiales restrictivos cuya venta depende del stock disponible.',
    'estado_planificable = agotar stock and cantidad > stock_disponible',
    'Validar alternativa, sustituto o reabastecimiento',
    'yellow',
    true,
    'Si el material esta marcado como hasta agotar stock y la cantidad solicitada supera el inventario real.',
    'Genera gestion preventiva para evitar prometer un despacho que no se puede cubrir.',
    24,
    'activa'
  ),
  (
    'Reporte de franquiciado abierto',
    'Prioriza pedidos con novedad reportada por el franquiciado.',
    'reportes_franquiciado.estado in (recibido, en_revision)',
    'Crear alerta operativa y enviar a revision',
    'red',
    true,
    'Si el franquiciado registra una novedad activa sobre su pedido.',
    'El reporte aparece en Reportes y genera alerta visual para que Operacion lo revise.',
    26,
    'activa'
  ),
  (
    'Reporte duplicado del mismo pedido',
    'Escala reclamos repetidos del mismo pedido.',
    'count(reportes_franquiciado activos por pedido) > 1',
    'Escalar alerta a critica',
    'red',
    true,
    'Si existe mas de un reporte activo asociado al mismo pedido o codigo de consulta.',
    'La alerta del reporte sube a critica por recurrencia del problema.',
    32,
    'activa'
  ),
  (
    'Material pedido no existe en inventario',
    'Detecta pedidos con material operativo que no tiene registro en inventario_bodega.',
    'pedidos_bodega_fq.codigo_material not in inventario_bodega.codigo_material',
    'Crear alerta de consistencia de datos',
    'red',
    true,
    'Si un material existe en pedidos pendientes pero no tiene fila en el inventario operativo.',
    'Advierte que el material debe crearse o corregirse para evitar stock cero incoherente.',
    38,
    'activa'
  )
on conflict (nombre) do update
set
  descripcion = excluded.descripcion,
  condicion = excluded.condicion,
  accion = excluded.accion,
  color = excluded.color,
  activo = excluded.activo,
  criterio = excluded.criterio,
  efecto = excluded.efecto,
  peso = excluded.peso,
  estado = excluded.estado;

create or replace function public.touch_updated_at_2_0()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.estado_operativo_desde_status_erp(p_status text)
returns text
language plpgsql
immutable
as $$
declare
  normalized text := lower(coalesce(p_status, ''));
begin
  if normalized like '%entregado y facturado%' then
    return 'entregado';
  elsif normalized like '%parcialmente entregado%' then
    return 'en_despacho';
  elsif normalized like '%pendiente por retiro%' then
    return 'aprobado';
  elsif normalized like '%parcialmente retirado%' then
    return 'en_despacho';
  elsif normalized like '%nota credito sin confirmar%'
    or normalized like '%nota credito pendiente%'
    or normalized like '%nota cr%dito sin confirmar%'
    or normalized like '%nota cr%dito pendiente%' then
    return 'en_revision';
  elsif normalized like '%anulado%' then
    return 'cancelado';
  elsif normalized like '%ajustado%' then
    return 'entregado';
  elsif normalized like '%pendiente por despacho%' then
    return 'pendiente';
  end if;

  return 'pendiente';
end;
$$;

-- ============================================================
-- Motor de priorizacion dinamico
-- Lee los pesos desde `reglas_negocio` por nombre exacto.
-- Debe mantenerse alineado con calcularPrioridad() en src/lib/prioridad.ts.
-- Ambas deben mantenerse sincronizadas.
-- ============================================================
create or replace function public.prioridad_pedido_erp(
  p_status_erp text,
  p_estado_operativo text,
  p_valor_pendiente numeric,
  p_fecha_pedido date,
  p_fecha_objetivo date,
  p_nc_pendientes integer,
  p_cantidad_pendiente numeric,
  p_tiene_gestion_stock boolean
)
returns integer
language plpgsql
stable
as $$
declare
  puntaje          integer := 0;
  dias_pedido      integer := 0;
  dias_objetivo    integer := 999;
  -- Pesos leidos dinamicamente desde reglas_negocio (con valores de respaldo)
  peso_cant_pend   integer;
  peso_nota_cred   integer;
  peso_antiguedad  integer;
  peso_valor_pend  integer;
  peso_cond_mat    integer;
begin
  -- Leer pesos de las reglas activas (por nombre exacto)
  select coalesce(max(peso), 35) into peso_cant_pend
    from public.reglas_negocio
    where nombre = 'Cantidad pendiente ERP' and estado = 'activa';

  select coalesce(max(peso), 30) into peso_nota_cred
    from public.reglas_negocio
    where nombre = 'Nota de credito pendiente' and estado = 'activa';

  select coalesce(max(peso), 20) into peso_antiguedad
    from public.reglas_negocio
    where nombre = 'Antiguedad del pedido' and estado = 'activa';

  select coalesce(max(peso), 15) into peso_valor_pend
    from public.reglas_negocio
    where nombre = 'Valor pendiente' and estado = 'activa';

  select coalesce(max(peso), 25) into peso_cond_mat
    from public.reglas_negocio
    where nombre = 'Condicion de material' and estado = 'activa';

  -- Calcular dias
  if p_fecha_pedido is not null then
    dias_pedido := greatest(0, current_date - p_fecha_pedido);
  end if;

  if p_fecha_objetivo is not null then
    dias_objetivo := p_fecha_objetivo - current_date;
  end if;

  -- 1. Estado operativo
  puntaje := puntaje + case coalesce(p_estado_operativo, 'pendiente')
    when 'sin_stock'    then 40
    when 'retrasado'    then 38
    when 'en_revision'  then 32
    when 'pendiente'    then 26
    when 'aprobado'     then 18
    when 'en_despacho'  then 14
    else 0
  end;

  -- 2. STATUS ERP: despacho pendiente
  if coalesce(p_status_erp, '') ilike '%pendiente por despacho%' then
    puntaje := puntaje + 20;
  end if;

  -- 3. NC pendientes (regla "Nota de credito pendiente")
  if coalesce(p_nc_pendientes, 0) > 0 then
    puntaje := puntaje + peso_nota_cred;
  end if;

  -- 4. Cantidad pendiente ERP (regla "Cantidad pendiente ERP")
  if coalesce(p_cantidad_pendiente, 0) > 0 then
    puntaje := puntaje + least(
      peso_cant_pend,
      5 + floor(coalesce(p_cantidad_pendiente, 0) / 100)::integer
    );
  end if;

  -- 5. Valor pendiente (regla "Valor pendiente")
  if coalesce(p_valor_pendiente, 0) >= 5000 then
    puntaje := puntaje + peso_valor_pend + 5;
  elsif coalesce(p_valor_pendiente, 0) >= 1000 then
    puntaje := puntaje + round(peso_valor_pend * 0.8)::integer;
  elsif coalesce(p_valor_pendiente, 0) > 0 then
    puntaje := puntaje + round(peso_valor_pend * 0.4)::integer;
  end if;

  -- 6. Condicion de material / gestion de stock (regla "Condicion de material")
  if p_tiene_gestion_stock then
    puntaje := puntaje + (peso_cond_mat - 7);
  end if;

  -- 7. Fecha objetivo (regla "Antiguedad del pedido")
  if dias_objetivo < 0 then
    puntaje := puntaje + 22;
  elsif dias_objetivo <= 2 then
    puntaje := puntaje + 14;
  end if;

  -- 8. Antiguedad del pedido (regla "Antiguedad del pedido")
  if dias_pedido >= 30 then
    puntaje := puntaje + (peso_antiguedad - 2);
  elsif dias_pedido >= 14 then
    puntaje := puntaje + round(peso_antiguedad * 0.5)::integer;
  end if;

  return least(100, greatest(0, puntaje));
end;
$$;

create or replace function public.preparar_pedido_erp_2_0()
returns trigger
language plpgsql
as $$
begin
  if new.estado_operativo is null
    or new.estado_operativo = ''
    or (tg_op = 'INSERT' and new.estado_operativo = 'pendiente') then
    new.estado_operativo := public.estado_operativo_desde_status_erp(new.status_erp);
  end if;

  new.fecha_objetivo := coalesce(new.fecha_objetivo, new.fecha_a_procesar_nc, new.fecha_pedido);
  new.prioridad_calculada := public.prioridad_pedido_erp(
    new.status_erp,
    new.estado_operativo,
    new.valor_pendiente,
    new.fecha_pedido,
    new.fecha_objetivo,
    0,
    0,
    false
  );
  return new;
end;
$$;

drop trigger if exists trg_preparar_pedido_erp_2_0 on public.pedidos_erp;
create trigger trg_preparar_pedido_erp_2_0
before insert or update on public.pedidos_erp
for each row execute function public.preparar_pedido_erp_2_0();

drop trigger if exists trg_touch_proveedores_2_0 on public.proveedores;
create trigger trg_touch_proveedores_2_0 before update on public.proveedores
for each row execute function public.touch_updated_at_2_0();

drop trigger if exists trg_touch_solicitantes_2_0 on public.solicitantes;
create trigger trg_touch_solicitantes_2_0 before update on public.solicitantes
for each row execute function public.touch_updated_at_2_0();

drop trigger if exists trg_touch_material_catalogo_2_0 on public.material_catalogo;
create trigger trg_touch_material_catalogo_2_0 before update on public.material_catalogo
for each row execute function public.touch_updated_at_2_0();

drop trigger if exists trg_touch_pedido_lineas_2_0 on public.pedido_lineas;
create trigger trg_touch_pedido_lineas_2_0 before update on public.pedido_lineas
for each row execute function public.touch_updated_at_2_0();

drop trigger if exists trg_touch_gestiones_pedido_2_0 on public.gestiones_pedido;
create trigger trg_touch_gestiones_pedido_2_0 before update on public.gestiones_pedido
for each row execute function public.touch_updated_at_2_0();

drop trigger if exists trg_touch_solicitudes_gestion_2_0 on public.solicitudes_gestion;
create trigger trg_touch_solicitudes_gestion_2_0 before update on public.solicitudes_gestion
for each row execute function public.touch_updated_at_2_0();

drop trigger if exists trg_touch_notas_credito_2_0 on public.notas_credito;
create trigger trg_touch_notas_credito_2_0 before update on public.notas_credito
for each row execute function public.touch_updated_at_2_0();

drop trigger if exists trg_touch_nota_credito_lineas_2_0 on public.nota_credito_lineas;
create trigger trg_touch_nota_credito_lineas_2_0 before update on public.nota_credito_lineas
for each row execute function public.touch_updated_at_2_0();

create or replace view public.pedidos_erp_resumen_v as
with lineas as (
  select
    pedido_id,
    count(*)::integer as lineas_total,
    count(*) filter (where cantidad_pendiente > 0)::integer as lineas_pendientes,
    coalesce(sum(cantidad_pedido), 0) as cantidad_pedido_total,
    coalesce(sum(cantidad_pendiente), 0) as cantidad_pendiente_total,
    coalesce(sum(valor_neto), 0) as valor_neto_total,
    count(distinct codigo_material)::integer as materiales_total
  from public.pedido_lineas
  group by pedido_id
),
gestiones as (
  select distinct on (pedido_id)
    pedido_id,
    respuesta_id,
    fecha_ultima_gestion,
    status_gestion,
    motivo_gestion,
    accion_derivada,
    condicion_derivada
  from public.gestiones_pedido
  where pedido_id is not null
  order by pedido_id, fecha_ultima_gestion desc nulls last, updated_at desc
),
nc as (
  select
    pedido_id,
    count(*)::integer as notas_credito_total,
    count(*) filter (where upper(coalesce(estado_nc, '')) <> 'RESUELTO')::integer as notas_credito_pendientes
  from public.notas_credito
  where pedido_id is not null
  group by pedido_id
),
solicitudes as (
  select
    pedido_id,
    count(*)::integer as solicitudes_total,
    count(*) filter (where upper(coalesce(estado, '')) = 'PENDIENTE')::integer as solicitudes_pendientes
  from public.solicitudes_gestion
  where pedido_id is not null
  group by pedido_id
)
select
  p.id,
  p.numero_pedido,
  p.orden_compra,
  p.numero_factura,
  p.codigo_solicitante,
  s.nombre as solicitante_nombre,
  p.proveedor_id,
  pr.nombre as proveedor_nombre,
  p.incoterm,
  p.fecha_pedido,
  p.fecha_objetivo,
  p.valor_pedido,
  p.valor_facturado,
  p.valor_pendiente,
  p.status_erp,
  p.estado_operativo,
  p.motivo_pedido,
  p.condicion_pago,
  p.fecha_a_procesar_nc,
  coalesce(lineas.lineas_total, 0) as lineas_total,
  coalesce(lineas.lineas_pendientes, 0) as lineas_pendientes,
  coalesce(lineas.cantidad_pedido_total, 0) as cantidad_pedido_total,
  coalesce(lineas.cantidad_pendiente_total, 0) as cantidad_pendiente_total,
  coalesce(lineas.valor_neto_total, 0) as valor_neto_total,
  coalesce(lineas.materiales_total, 0) as materiales_total,
  gestiones.respuesta_id as ultima_respuesta_id,
  gestiones.fecha_ultima_gestion,
  gestiones.status_gestion,
  gestiones.motivo_gestion,
  gestiones.accion_derivada,
  gestiones.condicion_derivada,
  coalesce(nc.notas_credito_total, 0) as notas_credito_total,
  coalesce(nc.notas_credito_pendientes, 0) as notas_credito_pendientes,
  coalesce(solicitudes.solicitudes_total, 0) as solicitudes_total,
  coalesce(solicitudes.solicitudes_pendientes, 0) as solicitudes_pendientes,
  public.prioridad_pedido_erp(
    p.status_erp,
    p.estado_operativo,
    p.valor_pendiente,
    p.fecha_pedido,
    p.fecha_objetivo,
    coalesce(nc.notas_credito_pendientes, 0),
    coalesce(lineas.cantidad_pendiente_total, 0),
    coalesce(gestiones.motivo_gestion, '') ilike '%stock%'
      or coalesce(gestiones.status_gestion, '') ilike '%stock%'
  ) as prioridad_calculada,
  p.fuente,
  p.created_at,
  p.updated_at
from public.pedidos_erp p
left join public.solicitantes s on s.codigo_solicitante = p.codigo_solicitante
left join public.proveedores pr on pr.id = p.proveedor_id
left join lineas on lineas.pedido_id = p.id
left join gestiones on gestiones.pedido_id = p.id
left join nc on nc.pedido_id = p.id
left join solicitudes on solicitudes.pedido_id = p.id;

create or replace view public.proveedor_kpis_v as
with pedidos as (
  select
    proveedor_id,
    count(*)::integer as pedidos_total,
    count(*) filter (
      where estado_operativo not in ('entregado', 'cancelado', 'rechazado')
    )::integer as pedidos_abiertos,
    coalesce(sum(valor_pendiente), 0) as valor_pendiente
  from public.pedidos_erp
  where proveedor_id is not null
  group by proveedor_id
),
respuestas as (
  select
    p.proveedor_id,
    count(g.respuesta_id)::integer as respuestas_total,
    count(distinct g.pedido_id)::integer as pedidos_respondidos,
    max(g.fecha_ultima_gestion) as ultima_gestion_at
  from public.gestiones_pedido g
  join public.pedidos_erp p on p.id = g.pedido_id
  group by p.proveedor_id
)
select
  pr.id as proveedor_id,
  pr.nombre as proveedor_nombre,
  coalesce(pedidos.pedidos_total, 0) as pedidos_total,
  coalesce(pedidos.pedidos_abiertos, 0) as pedidos_abiertos,
  coalesce(respuestas.respuestas_total, 0) as respuestas_total,
  greatest(
    coalesce(pedidos.pedidos_total, 0) - coalesce(respuestas.pedidos_respondidos, 0),
    0
  )::integer as pedidos_sin_respuesta,
  coalesce(pedidos.valor_pendiente, 0) as valor_pendiente,
  case
    when coalesce(pedidos.pedidos_total, 0) = 0 then 0
    else round(
      (coalesce(respuestas.pedidos_respondidos, 0)::numeric / pedidos.pedidos_total::numeric) * 100,
      2
    )
  end as tasa_respuesta,
  respuestas.ultima_gestion_at
from public.proveedores pr
left join pedidos on pedidos.proveedor_id = pr.id
left join respuestas on respuestas.proveedor_id = pr.id;

create or replace view public.seguimiento_kpis_v as
select
  count(*)::integer as pedidos_total,
  count(*) filter (where estado_operativo not in ('entregado', 'cancelado', 'rechazado'))::integer as pedidos_abiertos,
  count(*) filter (where estado_operativo = 'entregado')::integer as pedidos_entregados,
  count(*) filter (where estado_operativo = 'en_revision')::integer as pedidos_en_revision,
  count(*) filter (where estado_operativo = 'cancelado')::integer as pedidos_cancelados,
  coalesce(sum(valor_pedido), 0) as valor_pedido_total,
  coalesce(sum(valor_facturado), 0) as valor_facturado_total,
  coalesce(sum(valor_pendiente), 0) as valor_pendiente_total,
  (select count(*)::integer from public.pedido_lineas) as lineas_total,
  (select count(*)::integer from public.pedido_lineas where cantidad_pendiente > 0) as lineas_pendientes,
  (select count(*)::integer from public.material_catalogo) as materiales_total,
  (select count(*)::integer from public.notas_credito where upper(coalesce(estado_nc, '')) <> 'RESUELTO') as notas_credito_pendientes,
  (select count(*)::integer from public.solicitudes_gestion where upper(coalesce(estado, '')) = 'PENDIENTE') as solicitudes_pendientes,
  (select max(fecha_hora) from public.sync_runs) as ultima_sincronizacion_at
from public.pedidos_erp;

create or replace view public.materiales_demanda_v as
select
  m.codigo_material,
  m.nombre_material,
  m.numero_fb,
  count(pl.id)::integer as lineas_total,
  count(distinct pl.pedido_id)::integer as pedidos_total,
  coalesce(sum(pl.cantidad_pedido), 0) as cantidad_pedido_total,
  coalesce(sum(pl.cantidad_pendiente), 0) as cantidad_pendiente_total,
  coalesce(sum(pl.valor_neto) filter (where pl.cantidad_pendiente > 0), 0) as valor_pendiente_estimado,
  max(p.fecha_pedido) as ultima_fecha_pedido
from public.material_catalogo m
left join public.pedido_lineas pl on pl.codigo_material = m.codigo_material
left join public.pedidos_erp p on p.id = pl.pedido_id
group by m.codigo_material, m.nombre_material, m.numero_fb;

create or replace view public.import_errores_resumen_v as
select
  entidad,
  severidad,
  mensaje,
  count(*)::integer as total,
  max(created_at) as ultimo_registro_at
from public.import_errores_2_0
group by entidad, severidad, mensaje;

create or replace function public.refrescar_prototipo_desde_erp_2_0()
returns jsonb
language plpgsql
security definer
as $$
declare
  v_materiales integer := 0;
  v_pedidos integer := 0;
  v_alertas integer := 0;
  v_insertadas integer := 0;
begin
  insert into public.materiales (
    codigo_material,
    nombre,
    categoria,
    stock_actual,
    stock_minimo,
    unidad_medida,
    es_critico,
    estado
  )
  with demanda as (
    select
      codigo_material,
      coalesce(sum(cantidad_pedido), 0) as cantidad_pedido_total,
      coalesce(sum(cantidad_pendiente), 0) as cantidad_pendiente_total
    from public.pedido_lineas
    where codigo_material is not null
    group by codigo_material
  )
  select
    m.codigo_material,
    m.nombre_material,
    case
      when coalesce(d.cantidad_pendiente_total, 0) > 0 then 'Demanda pendiente ERP'
      else 'Catalogo ERP'
    end,
    case
      when coalesce(d.cantidad_pendiente_total, 0) > 0 then 0
      else least(2147483647, greatest(0, ceil(coalesce(d.cantidad_pedido_total, 0))))::integer
    end,
    case
      when coalesce(d.cantidad_pendiente_total, 0) > 0 then least(2147483647, greatest(1, ceil(d.cantidad_pendiente_total)))::integer
      else 0
    end,
    'unidad',
    coalesce(d.cantidad_pendiente_total, 0) > 0,
    'activo'
  from public.material_catalogo m
  left join demanda d on d.codigo_material = m.codigo_material
  on conflict (codigo_material) do update
  set
    nombre = excluded.nombre,
    categoria = excluded.categoria,
    stock_actual = excluded.stock_actual,
    stock_minimo = excluded.stock_minimo,
    unidad_medida = excluded.unidad_medida,
    es_critico = excluded.es_critico,
    estado = excluded.estado;

  get diagnostics v_materiales = row_count;

  insert into public.pedidos (
    codigo,
    codigo_consulta,
    tipo_pedido,
    descripcion,
    fecha_pedido,
    fecha_requerida,
    fecha_entrega,
    prioridad,
    observaciones,
    material_id,
    origen,
    destino,
    solicitante,
    cedula_solicitante,
    material,
    cantidad,
    unidad_medida,
    stock_disponible,
    fecha_solicitud,
    fecha_compromiso,
    urgencia,
    estado,
    tipo_cliente,
    accion_solicitante,
    condicion_material,
    cantidad_despacho,
    cantidad_despachada,
    valor_pendiente,
    status_erp,
    nc_pendientes,
    tiene_gestion_stock,
    prioridad_calculada
  )
  with lineas as (
    select
      pedido_id,
      count(*)::integer as lineas_total,
      count(*) filter (where cantidad_pendiente > 0)::integer as lineas_pendientes,
      coalesce(sum(cantidad_pedido), 0) as cantidad_pedido_total,
      coalesce(sum(cantidad_pendiente), 0) as cantidad_pendiente_total,
      min(codigo_material) filter (where codigo_material is not null) as primer_codigo_material,
      min(nombre_material_snapshot) as primer_material
    from public.pedido_lineas
    group by pedido_id
  ),
  gestiones as (
    select distinct on (pedido_id)
      pedido_id,
      accion_derivada,
      condicion_derivada,
      status_gestion,
      motivo_gestion
    from public.gestiones_pedido
    where pedido_id is not null
    order by pedido_id, fecha_ultima_gestion desc nulls last, updated_at desc
  ),
  nc as (
    select
      pedido_id,
      count(*) filter (where upper(coalesce(estado_nc, '')) <> 'RESUELTO')::integer as nc_pendientes
    from public.notas_credito
    where pedido_id is not null
    group by pedido_id
  )
  select
    p.numero_pedido,
    p.numero_pedido,
    'suministrador_franquiciado',
    'Pedido ERP ' || p.numero_pedido || ' - ' || coalesce(pr.nombre, 'Proveedor sin registrar'),
    coalesce(p.fecha_pedido, current_date),
    coalesce(p.fecha_objetivo, p.fecha_a_procesar_nc, p.fecha_pedido, current_date),
    coalesce(p.fecha_objetivo, p.fecha_a_procesar_nc, p.fecha_pedido, current_date),
    case
      when public.prioridad_pedido_erp(
        p.status_erp,
        p.estado_operativo,
        p.valor_pendiente,
        p.fecha_pedido,
        coalesce(p.fecha_objetivo, p.fecha_a_procesar_nc, p.fecha_pedido),
        coalesce(nc.nc_pendientes, 0),
        coalesce(lineas.cantidad_pendiente_total, 0),
        coalesce(gestiones.motivo_gestion, '') ilike '%stock%'
          or coalesce(gestiones.status_gestion, '') ilike '%stock%'
      ) >= 80 then 'critica'
      when public.prioridad_pedido_erp(
        p.status_erp,
        p.estado_operativo,
        p.valor_pendiente,
        p.fecha_pedido,
        coalesce(p.fecha_objetivo, p.fecha_a_procesar_nc, p.fecha_pedido),
        coalesce(nc.nc_pendientes, 0),
        coalesce(lineas.cantidad_pendiente_total, 0),
        coalesce(gestiones.motivo_gestion, '') ilike '%stock%'
          or coalesce(gestiones.status_gestion, '') ilike '%stock%'
      ) >= 60 then 'alta'
      when public.prioridad_pedido_erp(
        p.status_erp,
        p.estado_operativo,
        p.valor_pendiente,
        p.fecha_pedido,
        coalesce(p.fecha_objetivo, p.fecha_a_procesar_nc, p.fecha_pedido),
        coalesce(nc.nc_pendientes, 0),
        coalesce(lineas.cantidad_pendiente_total, 0),
        coalesce(gestiones.motivo_gestion, '') ilike '%stock%'
          or coalesce(gestiones.status_gestion, '') ilike '%stock%'
      ) >= 35 then 'media'
      else 'baja'
    end,
    concat_ws(
      ' | ',
      'STATUS ERP: ' || p.status_erp,
      'Valor pendiente: ' || p.valor_pendiente::text,
      'OC: ' || coalesce(p.orden_compra, 'sin OC'),
      'Factura: ' || coalesce(p.numero_factura, 'sin factura')
    ),
    mat.id,
    'suministrador',
    'franquiciado',
    coalesce(s.nombre, p.codigo_solicitante, 'Solicitante sin registrar'),
    p.codigo_solicitante,
    case
      when coalesce(lineas.lineas_total, 0) > 1 then
        coalesce(lineas.primer_material, 'Materiales ERP') || ' +' || (lineas.lineas_total - 1)::text || ' lineas'
      else coalesce(lineas.primer_material, 'Pedido sin detalle de material')
    end,
    least(2147483647, greatest(1, ceil(coalesce(lineas.cantidad_pedido_total, 1))))::integer,
    'unidad',
    case
      when coalesce(lineas.cantidad_pendiente_total, 0) > 0 then 0
      else least(2147483647, greatest(0, ceil(coalesce(lineas.cantidad_pedido_total, 0))))::integer
    end,
    coalesce(p.fecha_pedido::timestamptz, now()),
    coalesce(p.fecha_objetivo, p.fecha_a_procesar_nc, p.fecha_pedido, current_date)::timestamptz,
    case
      when public.prioridad_pedido_erp(
        p.status_erp,
        p.estado_operativo,
        p.valor_pendiente,
        p.fecha_pedido,
        coalesce(p.fecha_objetivo, p.fecha_a_procesar_nc, p.fecha_pedido),
        coalesce(nc.nc_pendientes, 0),
        coalesce(lineas.cantidad_pendiente_total, 0),
        coalesce(gestiones.motivo_gestion, '') ilike '%stock%'
          or coalesce(gestiones.status_gestion, '') ilike '%stock%'
      ) >= 80 then 'critica'
      when public.prioridad_pedido_erp(
        p.status_erp,
        p.estado_operativo,
        p.valor_pendiente,
        p.fecha_pedido,
        coalesce(p.fecha_objetivo, p.fecha_a_procesar_nc, p.fecha_pedido),
        coalesce(nc.nc_pendientes, 0),
        coalesce(lineas.cantidad_pendiente_total, 0),
        coalesce(gestiones.motivo_gestion, '') ilike '%stock%'
          or coalesce(gestiones.status_gestion, '') ilike '%stock%'
      ) >= 60 then 'alta'
      when public.prioridad_pedido_erp(
        p.status_erp,
        p.estado_operativo,
        p.valor_pendiente,
        p.fecha_pedido,
        coalesce(p.fecha_objetivo, p.fecha_a_procesar_nc, p.fecha_pedido),
        coalesce(nc.nc_pendientes, 0),
        coalesce(lineas.cantidad_pendiente_total, 0),
        coalesce(gestiones.motivo_gestion, '') ilike '%stock%'
          or coalesce(gestiones.status_gestion, '') ilike '%stock%'
      ) >= 35 then 'media'
      else 'baja'
    end,
    p.estado_operativo,
    'franquiciado',
    coalesce(
      gestiones.accion_derivada,
      case
        when p.status_erp ilike '%nota cr%dito%' or p.status_erp ilike '%nota credito%' then 'nota_credito'
        else 'despachar'
      end
    ),
    coalesce(
      gestiones.condicion_derivada,
      case
        when coalesce(lineas.cantidad_pendiente_total, 0) > 0 then 'no_planificable'
        else 'normal'
      end
    ),
    least(2147483647, greatest(0, ceil(coalesce(lineas.cantidad_pendiente_total, 0))))::integer,
    0,
    p.valor_pendiente,
    p.status_erp,
    coalesce(nc.nc_pendientes, 0),
    coalesce(gestiones.motivo_gestion, '') ilike '%stock%'
      or coalesce(gestiones.status_gestion, '') ilike '%stock%',
    public.prioridad_pedido_erp(
      p.status_erp,
      p.estado_operativo,
      p.valor_pendiente,
      p.fecha_pedido,
      coalesce(p.fecha_objetivo, p.fecha_a_procesar_nc, p.fecha_pedido),
      coalesce(nc.nc_pendientes, 0),
      coalesce(lineas.cantidad_pendiente_total, 0),
      coalesce(gestiones.motivo_gestion, '') ilike '%stock%'
        or coalesce(gestiones.status_gestion, '') ilike '%stock%'
    )
  from public.pedidos_erp p
  left join public.proveedores pr on pr.id = p.proveedor_id
  left join public.solicitantes s on s.codigo_solicitante = p.codigo_solicitante
  left join lineas on lineas.pedido_id = p.id
  left join public.materiales mat on mat.codigo_material = lineas.primer_codigo_material
  left join gestiones on gestiones.pedido_id = p.id
  left join nc on nc.pedido_id = p.id
  on conflict (codigo) do update
  set
    codigo_consulta = excluded.codigo_consulta,
    tipo_pedido = excluded.tipo_pedido,
    descripcion = excluded.descripcion,
    fecha_pedido = excluded.fecha_pedido,
    fecha_requerida = excluded.fecha_requerida,
    fecha_entrega = excluded.fecha_entrega,
    prioridad = excluded.prioridad,
    observaciones = excluded.observaciones,
    material_id = excluded.material_id,
    origen = excluded.origen,
    destino = excluded.destino,
    solicitante = excluded.solicitante,
    cedula_solicitante = excluded.cedula_solicitante,
    material = excluded.material,
    cantidad = excluded.cantidad,
    unidad_medida = excluded.unidad_medida,
    stock_disponible = excluded.stock_disponible,
    fecha_solicitud = excluded.fecha_solicitud,
    fecha_compromiso = excluded.fecha_compromiso,
    urgencia = excluded.urgencia,
    estado = excluded.estado,
    tipo_cliente = excluded.tipo_cliente,
    accion_solicitante = excluded.accion_solicitante,
    condicion_material = excluded.condicion_material,
    cantidad_despacho = excluded.cantidad_despacho,
    valor_pendiente = excluded.valor_pendiente,
    status_erp = excluded.status_erp,
    nc_pendientes = excluded.nc_pendientes,
    tiene_gestion_stock = excluded.tiene_gestion_stock,
    prioridad_calculada = excluded.prioridad_calculada;

  get diagnostics v_pedidos = row_count;

  delete from public.alertas
  where tipo_alerta in (
    'priorizacion_pedido',
    'stock_bajo',
    'nota_credito_pendiente',
    'sincronizacion_error',
    'pedido_sin_detalle'
  );

  insert into public.alertas (pedido_id, material_id, tipo_alerta, nivel, mensaje, estado, responsable)
  select
    p.id,
    p.material_id,
    'priorizacion_pedido',
    case when p.prioridad_calculada >= 80 then 'critica' else 'alta' end,
    'Pedido ' || p.codigo || ' requiere atencion: ' || p.material || ' para ' || p.solicitante || '. Prioridad ' || p.prioridad_calculada::text || '.',
    'activa',
    'Operacion'
  from public.pedidos p
  where p.estado not in ('entregado', 'cancelado', 'rechazado')
    and p.prioridad_calculada >= 60;

  get diagnostics v_insertadas = row_count;
  v_alertas := v_alertas + v_insertadas;

  insert into public.alertas (material_id, tipo_alerta, nivel, mensaje, estado, responsable)
  select
    m.id,
    'stock_bajo',
    case when m.stock_actual <= 0 then 'critica' else 'alta' end,
    'Material ' || m.nombre || ' sin cobertura suficiente: disponible ' || m.stock_actual::text || ' / minimo ' || m.stock_minimo::text || '.',
    'activa',
    'Bodega'
  from public.materiales m
  where m.stock_actual < m.stock_minimo;

  get diagnostics v_insertadas = row_count;
  v_alertas := v_alertas + v_insertadas;

  insert into public.alertas (pedido_id, tipo_alerta, nivel, mensaje, estado, responsable)
  select
    p.id,
    'nota_credito_pendiente',
    'alta',
    'Pedido ' || p.codigo || ' tiene una nota de credito pendiente o en revision.',
    'activa',
    'Comercial'
  from public.pedidos p
  where p.accion_solicitante = 'nota_credito'
    and p.estado not in ('entregado', 'cancelado', 'rechazado');

  get diagnostics v_insertadas = row_count;
  v_alertas := v_alertas + v_insertadas;

  insert into public.alertas (tipo_alerta, nivel, mensaje, estado, responsable)
  select
    'sincronizacion_error',
    'alta',
    'SYNC_LOG reporta estado ' || estado || coalesce(': ' || nullif(error, ''), ''),
    'activa',
    'Administrador'
  from public.sync_runs
  where upper(coalesce(estado, '')) not in ('OK', 'TRIGGERS INSTALADOS');

  get diagnostics v_insertadas = row_count;
  v_alertas := v_alertas + v_insertadas;

  insert into public.alertas (pedido_id, tipo_alerta, nivel, mensaje, estado, responsable)
  select
    p.id,
    'pedido_sin_detalle',
    'media',
    'Pedido ' || p.codigo || ' no tiene lineas de detalle relacionadas en el Excel.',
    'activa',
    'Administrador'
  from public.pedidos p
  where not exists (
    select 1
    from public.pedido_lineas pl
    where pl.documento_ventas = p.codigo
  );

  get diagnostics v_insertadas = row_count;
  v_alertas := v_alertas + v_insertadas;

  insert into public.auditoria (entidad, accion, detalle, responsable)
  values (
    'sistema',
    'refrescar_prototipo_2_0',
    'Se sincronizaron tablas del prototipo desde pedidos ERP, lineas, gestiones, notas de credito y catalogo.',
    'Importador Excel 2.0'
  );

  return jsonb_build_object(
    'ok', true,
    'materiales_afectados', v_materiales,
    'pedidos_afectados', v_pedidos,
    'alertas_generadas', v_alertas
  );
end;
$$;

create or replace function public.despachar_pedido_seguro(
  p_material_id uuid,
  p_pedido_id uuid,
  p_responsable text default 'Bodega'
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
  v_cantidad integer;
begin
  select * into v_pedido
  from public.pedidos
  where id = p_pedido_id
  for update;

  if not found then
    raise exception 'No se encontro el pedido %', p_pedido_id;
  end if;

  if p_material_id is null and v_pedido.material_id is null then
    raise exception 'El pedido no tiene material asociado para descontar inventario';
  end if;

  select * into v_material
  from public.materiales
  where id = coalesce(p_material_id, v_pedido.material_id)
  for update;

  if not found then
    raise exception 'No se encontro el material asociado al pedido';
  end if;

  v_cantidad := case
    when coalesce(v_pedido.cantidad_despacho, 0) > 0 then v_pedido.cantidad_despacho
    else v_pedido.cantidad
  end;

  if v_material.stock_actual < v_cantidad then
    raise exception 'Stock insuficiente para despachar %. Disponible %, requerido %',
      v_pedido.codigo, v_material.stock_actual, v_cantidad;
  end if;

  stock_anterior := v_material.stock_actual;
  stock_nuevo := v_material.stock_actual - v_cantidad;

  update public.materiales
  set stock_actual = stock_nuevo
  where id = v_material.id;

  perform public.registrar_alerta_stock_material(
    v_material.id,
    v_pedido.id,
    stock_nuevo,
    'Departamento de inventario'
  );

  update public.pedidos
  set
    estado = 'en_despacho',
    stock_disponible = stock_nuevo,
    cantidad_despachada = v_cantidad,
    despachado_at = now(),
    despachado_por = coalesce(p_responsable, 'Bodega')
  where id = v_pedido.id;

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
    v_material.nombre,
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

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on
  public.usuarios_app,
  public.proveedores,
  public.solicitantes,
  public.material_catalogo,
  public.pedidos_erp,
  public.pedido_lineas,
  public.gestiones_pedido,
  public.solicitudes_gestion,
  public.notas_credito,
  public.nota_credito_lineas,
  public.sync_runs,
  public.seguimiento_proveedor_fuente,
  public.consolidado_nc_fuente,
  public.import_errores_2_0,
  public.materiales,
  public.pedidos,
  public.reglas_negocio,
  public.alertas,
  public.notificaciones_correo,
  public.movimientos_inventario,
  public.auditoria,
  public.reportes_operativos,
  public.reportes_franquiciado
to anon, authenticated;

grant select on
  public.pedidos_erp_resumen_v,
  public.proveedor_kpis_v,
  public.seguimiento_kpis_v,
  public.materiales_demanda_v,
  public.import_errores_resumen_v
to anon, authenticated;

grant execute on function public.refrescar_prototipo_desde_erp_2_0() to anon, authenticated;
grant execute on function public.despachar_pedido_seguro(uuid, uuid, text) to anon, authenticated;
grant execute on function public.registrar_alerta_stock_material(uuid, uuid, integer, text) to anon, authenticated;

alter table public.usuarios_app disable row level security;
alter table public.proveedores disable row level security;
alter table public.solicitantes disable row level security;
alter table public.material_catalogo disable row level security;
alter table public.pedidos_erp disable row level security;
alter table public.pedido_lineas disable row level security;
alter table public.gestiones_pedido disable row level security;
alter table public.solicitudes_gestion disable row level security;
alter table public.notas_credito disable row level security;
alter table public.nota_credito_lineas disable row level security;
alter table public.sync_runs disable row level security;
alter table public.seguimiento_proveedor_fuente disable row level security;
alter table public.consolidado_nc_fuente disable row level security;
alter table public.import_errores_2_0 disable row level security;
alter table public.materiales disable row level security;
alter table public.pedidos disable row level security;
alter table public.reglas_negocio disable row level security;
alter table public.alertas disable row level security;
alter table public.notificaciones_correo disable row level security;
alter table public.movimientos_inventario disable row level security;
alter table public.auditoria disable row level security;
alter table public.reportes_operativos disable row level security;
alter table public.reportes_franquiciado disable row level security;

notify pgrst, 'reload schema';
