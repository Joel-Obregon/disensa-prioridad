from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

import pandas as pd


PEDIDOS_COLS = [
    "numero_pedido",
    "orden_compra",
    "numero_factura",
    "codigo_solicitante",
    "solicitante_nombre",
    "incoterm",
    "fecha_pedido",
    "proveedor",
    "valor_pedido",
    "valor_facturado",
    "status_erp",
    "valor_pendiente",
    "motivo_pedido",
    "condicion_pago",
    "fecha_a_procesar_nc",
]

DETALLE_COLS = [
    "documento_compras",
    "documento_ventas",
    "codigo_material",
    "nombre_material",
    "cantidad_pedido",
    "valor_neto",
    "cantidad_pendiente",
    "motivo_pedido",
    "condicion_pago",
    "fecha_a_procesar_nc",
    "numero_fb",
]

SYNC_COLS = [
    "fecha_hora",
    "estado",
    "pedidos_actualizados",
    "detalle_actualizado",
    "usuario",
    "error",
]

RESPUESTAS_COLS = [
    "respuesta_id",
    "numero_pedido",
    "orden_compra",
    "numero_factura",
    "codigo_solicitante",
    "solicitante_nombre",
    "incoterm",
    "fecha_pedido",
    "proveedor",
    "valor_pedido",
    "valor_facturado",
    "status_erp",
    "valor_pendiente",
    "tipo_entrega",
    "fecha_ultima_gestion",
    "status_gestion",
    "motivo_gestion",
    "comentario",
    "fecha_tentativa_entrega",
    "respondido_por_email",
    "proveedor_login",
    "contrasena_usada",
    "numero_interno_producto",
    "motivo_pedido",
    "condicion_pago",
    "fecha_a_procesar_nc",
]

SOLICITUDES_COLS = [
    "solicitud_id",
    "numero_pedido",
    "tipo",
    "mensaje",
    "estado",
    "fecha_solicitud",
    "solicitado_por",
    "fecha_atendido",
    "atendido_por",
    "numero_guia",
    "fecha_guia",
    "archivo_guia",
]

NC_DETALLE_COLS = [
    "linea_id",
    "respuesta_id",
    "codigo_material",
    "nombre_material",
    "cantidad_pendiente",
    "cantidad_nc",
    "numero_fb",
]

SOLICITUDES_NC_COLS = [
    "nc_id",
    "respuesta_id",
    "numero_pedido",
    "proveedor",
    "motivo_nc",
    "motivo_gestion",
    "comentario",
    "estado_nc",
    "fecha_creacion",
    "creado_por",
    "fecha_resuelto",
    "resuelto_por",
    "comentario_equipo_nc",
]

CONSOLIDADO_NC_COLS = [
    "key_consolidado",
    "nc_id",
    "respuesta_id",
    "numero_pedido",
    "proveedor",
    "motivo_nc",
    "motivo_gestion",
    "estado_nc",
    "fecha_creacion",
    "creado_por",
    "fecha_resuelto",
    "resuelto_por",
    "comentario",
    "comentario_equipo_nc",
    "codigo_material",
    "nombre_material",
    "cantidad_pendiente",
    "cantidad_nc",
    "numero_fb",
    "motivo_pedido",
    "condicion_pago",
    "fecha_a_procesar_nc",
    "numero_factura",
    "codigo_solicitante",
    "solicitante_nombre",
]

MATERIALES_COLS = ["codigo_material", "nombre_material", "numero_fb"]
SEGUIMIENTO_COLS = ["proveedor", "pedidos_totales", "pedidos_respondidos"]
FORMULARIO_COLS = [
    "marca_temporal",
    "proveedor",
    "contrasena",
    "correo_contacto",
    "correo_contacto_2",
    "celular",
]


@dataclass
class SupabaseRest:
    url: str
    key: str
    dry_run: bool = False
    batch_size: int = 1000

    def request(
        self,
        method: str,
        table: str,
        *,
        params: dict[str, Any] | None = None,
        payload: Any | None = None,
        prefer: str | None = None,
    ) -> Any:
        endpoint = f"{self.url.rstrip('/')}/rest/v1/{table}"
        if params:
            endpoint += "?" + urllib.parse.urlencode(params)

        headers = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
        }
        data = None

        if payload is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(payload, ensure_ascii=False, default=json_default).encode("utf-8")

        if prefer:
            headers["Prefer"] = prefer

        if self.dry_run and method != "GET":
            return None

        request = urllib.request.Request(endpoint, data=data, headers=headers, method=method)

        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                body = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"{method} {table} failed: HTTP {exc.code} {body}") from exc

        if not body:
            return None
        return json.loads(body)

    def rpc(self, function_name: str, payload: dict[str, Any] | None = None) -> Any:
        endpoint = f"{self.url.rstrip('/')}/rest/v1/rpc/{function_name}"
        headers = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
        }
        data = json.dumps(payload or {}, ensure_ascii=False, default=json_default).encode("utf-8")

        if self.dry_run:
            return {"ok": True, "dry_run": True, "rpc": function_name}

        request = urllib.request.Request(endpoint, data=data, headers=headers, method="POST")

        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                body = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"RPC {function_name} failed: HTTP {exc.code} {body}") from exc

        if not body:
            return None
        return json.loads(body)

    def upsert(self, table: str, rows: list[dict[str, Any]], on_conflict: str) -> None:
        if not rows:
            print(f"{table}: 0 filas")
            return

        total = len(rows)
        for start in range(0, total, self.batch_size):
            batch = rows[start : start + self.batch_size]
            self.request(
                "POST",
                table,
                params={"on_conflict": on_conflict},
                payload=batch,
                prefer="resolution=merge-duplicates,return=minimal",
            )
            print(f"{table}: {min(start + len(batch), total)}/{total}")

    def select_all(self, table: str, columns: str, key: str, value: str | None = None) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        offset = 0
        while True:
            params: dict[str, Any] = {
                "select": columns,
                "limit": self.batch_size,
                "offset": offset,
            }
            if value is not None:
                params[key] = f"eq.{value}"

            chunk = self.request("GET", table, params=params) or []
            rows.extend(chunk)

            if len(chunk) < self.batch_size:
                return rows
            offset += self.batch_size


def main() -> None:
    args = parse_args()
    workbook_path = Path(args.excel).expanduser().resolve()

    if not workbook_path.exists():
        raise SystemExit(f"No existe el archivo: {workbook_path}")

    url = args.url or os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL")
    key = args.service_role_key or os.getenv("SUPABASE_SERVICE_ROLE_KEY")

    if args.dry_run and (not url or not key):
        url = "https://dry-run.supabase.co"
        key = "dry-run"

    if not url or not key:
        raise SystemExit(
            "Faltan credenciales. Usa SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY "
            "o pasa --url y --service-role-key."
        )

    client = SupabaseRest(url=url, key=key, dry_run=args.dry_run, batch_size=args.batch_size)

    started = time.time()
    print(f"Leyendo {workbook_path}")
    data = load_workbook(workbook_path)

    print("Preparando catalogos")
    providers = build_providers(data)
    client.upsert("proveedores", providers, "nombre")
    provider_ids = (
        {row["nombre"]: stable_uuid("proveedor", row["nombre"]) for row in providers}
        if args.dry_run
        else fetch_id_map(client, "proveedores", "id,nombre", "nombre")
    )

    solicitantes = build_solicitantes(data["pedidos"])
    client.upsert("solicitantes", solicitantes, "codigo_solicitante")

    materials = build_materials(data["materiales"])
    client.upsert("material_catalogo", materials, "codigo_material")
    material_codes = {row["codigo_material"] for row in materials}

    print("Preparando pedidos")
    pedidos = build_pedidos(data["pedidos"], provider_ids)
    client.upsert("pedidos_erp", pedidos, "numero_pedido")
    pedido_ids = (
        {row["numero_pedido"]: stable_uuid("pedido", row["numero_pedido"]) for row in pedidos}
        if args.dry_run
        else fetch_id_map(client, "pedidos_erp", "id,numero_pedido", "numero_pedido")
    )

    print("Preparando detalle")
    lineas, line_errors = build_lineas(data["detalle"], pedido_ids, material_codes)
    client.upsert("pedido_lineas", lineas, "linea_key")

    print("Preparando gestiones")
    gestiones = build_gestiones(data["respuestas"], pedido_ids)
    client.upsert("gestiones_pedido", gestiones, "respuesta_id")

    print("Preparando solicitudes")
    solicitudes = build_solicitudes(data["solicitudes"], pedido_ids)
    client.upsert("solicitudes_gestion", solicitudes, "solicitud_id")

    print("Preparando notas de credito")
    notas = build_notas_credito(data["solicitudes_nc"], pedido_ids, provider_ids)
    client.upsert("notas_credito", notas, "nc_id")

    respuesta_to_nc = {
        clean_id(row.get("respuesta_id")): clean_id(row.get("nc_id"))
        for row in data["solicitudes_nc"].to_dict("records")
        if clean_id(row.get("respuesta_id")) and clean_id(row.get("nc_id"))
    }
    nc_lineas = build_nc_lineas(data["respuesta_nc_detalle"], respuesta_to_nc, material_codes)
    client.upsert("nota_credito_lineas", nc_lineas, "linea_id")

    print("Preparando bitacoras y consolidado")
    sync_runs = build_sync_runs(data["sync_log"])
    client.upsert("sync_runs", sync_runs, "fecha_hora,estado")

    seguimiento = build_seguimiento_proveedor(data["seguimiento"], provider_ids)
    client.upsert("seguimiento_proveedor_fuente", seguimiento, "proveedor_nombre")

    consolidado = build_consolidado_nc(data["consolidado_nc"])
    client.upsert("consolidado_nc_fuente", consolidado, "key_consolidado")

    errors = build_import_errors(
        data,
        line_errors,
        pedidos,
        lineas,
        gestiones,
        solicitudes,
        notas,
        nc_lineas,
        sync_runs,
        material_codes,
    )
    client.upsert("import_errores_2_0", errors, "id")

    print("Sincronizando prototipo original")
    prototype_sync = client.rpc("refrescar_prototipo_desde_erp_2_0")
    print(f"prototipo_disensa_prioridad: {json.dumps(prototype_sync, ensure_ascii=False)}")

    elapsed = round(time.time() - started, 1)
    print(
        json.dumps(
            {
                "ok": True,
                "dry_run": args.dry_run,
                "segundos": elapsed,
                "proveedores": len(providers),
                "solicitantes": len(solicitantes),
                "materiales": len(materials),
                "pedidos": len(pedidos),
                "lineas": len(lineas),
                "gestiones": len(gestiones),
                "solicitudes": len(solicitudes),
                "notas_credito": len(notas),
                "nota_credito_lineas": len(nc_lineas),
                "errores_importacion": len(errors),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Importa el Excel de Seguimiento de Pedidos a Supabase 2.0.")
    parser.add_argument("excel", help="Ruta al archivo .xlsx")
    parser.add_argument("--url", help="URL de la nueva Supabase")
    parser.add_argument("--service-role-key", help="Service role key de la nueva Supabase")
    parser.add_argument("--batch-size", type=int, default=1000)
    parser.add_argument("--dry-run", action="store_true", help="Lee y transforma sin escribir en Supabase")
    return parser.parse_args()


def load_workbook(path: Path) -> dict[str, pd.DataFrame]:
    return {
        "pedidos": read_sheet(path, "Pedidos_AppSheet", PEDIDOS_COLS),
        "detalle": read_sheet(path, "Detalle_Pedidos_AppSheet", DETALLE_COLS),
        "sync_log": read_sheet(path, "SYNC_LOG", SYNC_COLS),
        "respuestas": read_sheet(path, "Respuesta Pedidos_AppSheet", RESPUESTAS_COLS),
        "solicitudes": read_sheet(path, "Solicitudes", SOLICITUDES_COLS),
        "respuesta_nc_detalle": read_sheet(path, "Respuesta_NC_Detalle", NC_DETALLE_COLS),
        "solicitudes_nc": read_sheet(path, "Solicitudes_NC", SOLICITUDES_NC_COLS),
        "consolidado_nc": read_sheet(path, "Consolidado NC", CONSOLIDADO_NC_COLS),
        "materiales": read_sheet(path, "MaterialesSum", MATERIALES_COLS),
        "seguimiento": read_sheet(path, "Seguimiento de pedidos ", SEGUIMIENTO_COLS),
        "formulario": read_sheet(path, "Respuestas de formulario 1", FORMULARIO_COLS),
    }


def read_sheet(path: Path, sheet: str, columns: list[str]) -> pd.DataFrame:
    df = pd.read_excel(path, sheet_name=sheet, dtype=object)
    df = df.dropna(axis=0, how="all").dropna(axis=1, how="all")
    assigned = columns[: len(df.columns)]
    df = df.iloc[:, : len(assigned)].copy()
    df.columns = assigned
    return df


def build_providers(data: dict[str, pd.DataFrame]) -> list[dict[str, Any]]:
    contacts: dict[str, dict[str, str | None]] = {}

    for row in data["formulario"].to_dict("records"):
        name = clean_text(row.get("proveedor"))
        if not name:
            continue
        contacts[name] = {
            "contacto_email": clean_text(row.get("correo_contacto")) or clean_text(row.get("correo_contacto_2")),
            "contacto_telefono": clean_id(row.get("celular")),
        }

    names: set[str] = set()
    for sheet, col in [
        ("pedidos", "proveedor"),
        ("respuestas", "proveedor"),
        ("respuestas", "proveedor_login"),
        ("solicitudes_nc", "proveedor"),
        ("consolidado_nc", "proveedor"),
        ("seguimiento", "proveedor"),
        ("formulario", "proveedor"),
    ]:
        names.update(clean_text(value) for value in data[sheet][col].dropna().tolist())

    rows = []
    for name in sorted(value for value in names if value):
        contact = contacts.get(name, {})
        rows.append(
            {
                "nombre": name,
                "contacto_email": contact.get("contacto_email"),
                "contacto_telefono": contact.get("contacto_telefono"),
            }
        )
    return rows


def build_solicitantes(pedidos: pd.DataFrame) -> list[dict[str, Any]]:
    solicitantes: dict[str, str] = {}
    for row in pedidos.to_dict("records"):
        code = clean_id(row.get("codigo_solicitante"))
        name = clean_text(row.get("solicitante_nombre"))
        if code and name:
            solicitantes[code] = name

    return [
        {"codigo_solicitante": code, "nombre": name}
        for code, name in sorted(solicitantes.items())
    ]


def build_materials(materiales: pd.DataFrame) -> list[dict[str, Any]]:
    rows: dict[str, dict[str, Any]] = {}
    for row in materiales.to_dict("records"):
        code = clean_id(row.get("codigo_material"))
        name = clean_text(row.get("nombre_material"))
        if not code or not name:
            continue
        rows[code] = {
            "codigo_material": code,
            "nombre_material": name,
            "numero_fb": clean_text(row.get("numero_fb")),
        }
    return [rows[key] for key in sorted(rows)]


def build_pedidos(pedidos: pd.DataFrame, provider_ids: dict[str, str]) -> list[dict[str, Any]]:
    rows = []
    for row in pedidos.to_dict("records"):
        number = clean_id(row.get("numero_pedido"))
        if not number:
            continue
        status = clean_text(row.get("status_erp")) or "Sin status"
        rows.append(
            {
                "numero_pedido": number,
                "orden_compra": clean_id(row.get("orden_compra")),
                "numero_factura": clean_text(row.get("numero_factura")),
                "codigo_solicitante": clean_id(row.get("codigo_solicitante")),
                "proveedor_id": provider_ids.get(clean_text(row.get("proveedor"))),
                "incoterm": clean_text(row.get("incoterm")),
                "fecha_pedido": to_date(row.get("fecha_pedido")),
                "valor_pedido": to_number(row.get("valor_pedido")),
                "valor_facturado": to_number(row.get("valor_facturado")),
                "valor_pendiente": to_number(row.get("valor_pendiente")),
                "status_erp": status,
                "estado_operativo": estado_desde_status(status),
                "motivo_pedido": clean_text(row.get("motivo_pedido")),
                "condicion_pago": to_number(row.get("condicion_pago")),
                "fecha_a_procesar_nc": to_date(row.get("fecha_a_procesar_nc")),
                "fecha_objetivo": to_date(row.get("fecha_a_procesar_nc")) or to_date(row.get("fecha_pedido")),
            }
        )
    return rows


def build_lineas(
    detalle: pd.DataFrame,
    pedido_ids: dict[str, str],
    material_codes: set[str],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    rows = []
    errors = []
    for index, row in enumerate(detalle.to_dict("records"), start=1):
        pedido_num = clean_id(row.get("documento_ventas"))
        pedido_id = pedido_ids.get(pedido_num)
        material = clean_id(row.get("codigo_material"))
        if not pedido_id:
            errors.append({"entidad": "pedido_lineas", "llave": pedido_num, "mensaje": "Linea sin pedido de cabecera"})
            continue
        if material and material not in material_codes:
            errors.append({"entidad": "pedido_lineas", "llave": material, "mensaje": "Material de linea no existe en catalogo"})

        line_key = "|".join(
            [
                pedido_num,
                clean_id(row.get("documento_compras")) or "",
                material or "",
                str(index),
            ]
        )

        rows.append(
            {
                "linea_key": line_key,
                "pedido_id": pedido_id,
                "documento_compras": clean_id(row.get("documento_compras")),
                "documento_ventas": pedido_num,
                "codigo_material": material if material in material_codes else None,
                "nombre_material_snapshot": clean_text(row.get("nombre_material")) or "Sin material",
                "cantidad_pedido": to_number(row.get("cantidad_pedido")),
                "cantidad_pendiente": max(0, to_number(row.get("cantidad_pendiente"))),
                "valor_neto": to_number(row.get("valor_neto")),
                "motivo_pedido": clean_text(row.get("motivo_pedido")),
                "condicion_pago": to_number(row.get("condicion_pago")),
                "fecha_a_procesar_nc": to_date(row.get("fecha_a_procesar_nc")),
            }
        )
    return rows, errors


def build_gestiones(respuestas: pd.DataFrame, pedido_ids: dict[str, str]) -> list[dict[str, Any]]:
    rows = []
    for row in respuestas.to_dict("records"):
        respuesta_id = clean_id(row.get("respuesta_id"))
        if not respuesta_id:
            continue
        status = clean_text(row.get("status_gestion")) or "Sin gestion"
        motivo = clean_text(row.get("motivo_gestion"))
        numero_pedido = clean_id(row.get("numero_pedido"))
        rows.append(
            {
                "respuesta_id": respuesta_id,
                "pedido_id": pedido_ids.get(numero_pedido),
                "numero_pedido": numero_pedido,
                "tipo_entrega": clean_text(row.get("tipo_entrega")),
                "fecha_ultima_gestion": to_datetime(row.get("fecha_ultima_gestion")),
                "status_gestion": status,
                "motivo_gestion": motivo,
                "comentario": clean_text(row.get("comentario")),
                "fecha_tentativa_entrega": to_date(row.get("fecha_tentativa_entrega")),
                "respondido_por": clean_text(row.get("respondido_por_email")),
                "proveedor_login": clean_text(row.get("proveedor_login")),
                "numero_interno_producto": clean_text(row.get("numero_interno_producto")),
                "accion_derivada": accion_desde_status(status),
                "condicion_derivada": condicion_desde_motivo(motivo, status),
            }
        )
    return rows


def build_solicitudes(solicitudes: pd.DataFrame, pedido_ids: dict[str, str]) -> list[dict[str, Any]]:
    rows = []
    for row in solicitudes.to_dict("records"):
        solicitud_id = clean_id(row.get("solicitud_id"))
        if not solicitud_id:
            continue
        numero_pedido = clean_id(row.get("numero_pedido"))
        rows.append(
            {
                "solicitud_id": solicitud_id,
                "pedido_id": pedido_ids.get(numero_pedido),
                "numero_pedido": numero_pedido,
                "tipo": clean_text(row.get("tipo")) or "GESTION",
                "mensaje": clean_text(row.get("mensaje")) or "Sin mensaje",
                "estado": clean_text(row.get("estado")) or "PENDIENTE",
                "fecha_solicitud": to_datetime(row.get("fecha_solicitud")),
                "solicitado_por": clean_text(row.get("solicitado_por")),
                "fecha_atendido": to_datetime(row.get("fecha_atendido")),
                "atendido_por": clean_text(row.get("atendido_por")),
                "archivo_guia": clean_text(row.get("archivo_guia")),
            }
        )
    return rows


def build_notas_credito(
    solicitudes_nc: pd.DataFrame,
    pedido_ids: dict[str, str],
    provider_ids: dict[str, str],
) -> list[dict[str, Any]]:
    rows = []
    for row in solicitudes_nc.to_dict("records"):
        nc_id = clean_id(row.get("nc_id"))
        if not nc_id:
            continue
        numero_pedido = clean_id(row.get("numero_pedido"))
        rows.append(
            {
                "nc_id": nc_id,
                "respuesta_id": clean_id(row.get("respuesta_id")),
                "pedido_id": pedido_ids.get(numero_pedido),
                "numero_pedido": numero_pedido,
                "proveedor_id": provider_ids.get(clean_text(row.get("proveedor"))),
                "motivo_nc": clean_text(row.get("motivo_nc")) or "NC",
                "motivo_gestion": clean_text(row.get("motivo_gestion")),
                "comentario": clean_text(row.get("comentario")),
                "estado_nc": clean_text(row.get("estado_nc")) or "PENDIENTE",
                "fecha_creacion": to_datetime(row.get("fecha_creacion")),
                "creado_por": clean_text(row.get("creado_por")),
                "fecha_resuelto": to_datetime(row.get("fecha_resuelto")),
                "resuelto_por": clean_text(row.get("resuelto_por")),
                "comentario_equipo_nc": clean_text(row.get("comentario_equipo_nc")),
            }
        )
    return rows


def build_nc_lineas(
    nc_detalle: pd.DataFrame,
    respuesta_to_nc: dict[str, str],
    material_codes: set[str],
) -> list[dict[str, Any]]:
    rows = []
    for row in nc_detalle.to_dict("records"):
        line_id = clean_id(row.get("linea_id"))
        if not line_id:
            continue
        respuesta_id = clean_id(row.get("respuesta_id"))
        material = clean_id(row.get("codigo_material"))
        rows.append(
            {
                "linea_id": line_id,
                "nc_id": respuesta_to_nc.get(respuesta_id),
                "respuesta_id": respuesta_id,
                "codigo_material": material if material in material_codes else None,
                "nombre_material_snapshot": clean_text(row.get("nombre_material")) or "Sin material",
                "cantidad_pendiente": to_number(row.get("cantidad_pendiente")),
                "cantidad_nc": to_number(row.get("cantidad_nc")),
                "numero_fb": clean_text(row.get("numero_fb")),
            }
        )
    return rows


def build_sync_runs(sync_log: pd.DataFrame) -> list[dict[str, Any]]:
    rows = []
    for row in sync_log.to_dict("records"):
        fecha = to_datetime(row.get("fecha_hora"))
        estado = clean_text(row.get("estado"))
        if not fecha or not estado:
            continue
        rows.append(
            {
                "fecha_hora": fecha,
                "estado": estado,
                "pedidos_actualizados": int(to_number(row.get("pedidos_actualizados"))),
                "detalle_actualizado": int(to_number(row.get("detalle_actualizado"))),
                "usuario": clean_text(row.get("usuario")),
                "error": clean_text(row.get("error")),
            }
        )
    return rows


def build_seguimiento_proveedor(
    seguimiento: pd.DataFrame,
    provider_ids: dict[str, str],
) -> list[dict[str, Any]]:
    rows = []
    for row in seguimiento.to_dict("records"):
        provider = clean_text(row.get("proveedor"))
        if not provider:
            continue
        total = int(to_number(row.get("pedidos_totales")))
        responded = int(to_number(row.get("pedidos_respondidos")))
        pending = max(0, total - responded)
        rate = round((responded / total) * 100, 2) if total else 0
        rows.append(
            {
                "proveedor_nombre": provider,
                "proveedor_id": provider_ids.get(provider),
                "pedidos_totales": total,
                "pedidos_respondidos": responded,
                "pedidos_pendientes": pending,
                "tasa_respuesta": rate,
            }
        )
    return rows


def build_consolidado_nc(consolidado: pd.DataFrame) -> list[dict[str, Any]]:
    rows = []
    for row in consolidado.to_dict("records"):
        key = clean_text(row.get("key_consolidado"))
        if not key:
            continue
        rows.append(
            {
                "key_consolidado": key,
                "nc_id": clean_id(row.get("nc_id")),
                "respuesta_id": clean_id(row.get("respuesta_id")),
                "numero_pedido": clean_id(row.get("numero_pedido")),
                "proveedor_nombre": clean_text(row.get("proveedor")),
                "motivo_nc": clean_text(row.get("motivo_nc")),
                "motivo_gestion": clean_text(row.get("motivo_gestion")),
                "estado_nc": clean_text(row.get("estado_nc")),
                "fecha_creacion": to_datetime(row.get("fecha_creacion")),
                "creado_por": clean_text(row.get("creado_por")),
                "fecha_resuelto": to_datetime(row.get("fecha_resuelto")),
                "resuelto_por": clean_text(row.get("resuelto_por")),
                "comentario": clean_text(row.get("comentario")),
                "comentario_equipo_nc": clean_text(row.get("comentario_equipo_nc")),
                "codigo_material": clean_id(row.get("codigo_material")),
                "nombre_material": clean_text(row.get("nombre_material")),
                "cantidad_pendiente": to_number(row.get("cantidad_pendiente")),
                "cantidad_nc": to_number(row.get("cantidad_nc")),
                "numero_fb": clean_text(row.get("numero_fb")),
                "motivo_pedido": clean_text(row.get("motivo_pedido")),
                "condicion_pago": to_number(row.get("condicion_pago")),
                "fecha_a_procesar_nc": to_date(row.get("fecha_a_procesar_nc")),
                "numero_factura": clean_text(row.get("numero_factura")),
                "codigo_solicitante": clean_id(row.get("codigo_solicitante")),
                "solicitante_nombre": clean_text(row.get("solicitante_nombre")),
            }
        )
    return rows


def build_import_errors(
    data: dict[str, pd.DataFrame],
    line_errors: list[dict[str, Any]],
    pedidos: list[dict[str, Any]],
    lineas: list[dict[str, Any]],
    gestiones: list[dict[str, Any]],
    solicitudes: list[dict[str, Any]],
    notas: list[dict[str, Any]],
    nc_lineas: list[dict[str, Any]],
    sync_runs: list[dict[str, Any]],
    material_codes: set[str],
) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    pedidos_nums = {pedido["numero_pedido"] for pedido in pedidos}
    respuestas_ids = {gestion["respuesta_id"] for gestion in gestiones}
    notas_ids = {nota["nc_id"] for nota in notas}

    def add_error(
        entidad: str,
        llave: Any,
        mensaje: str,
        *,
        severidad: str = "media",
        detalle: dict[str, Any] | None = None,
    ) -> None:
        clean_key = clean_id(llave) or clean_text(llave)
        detail = detalle or {}
        errors.append(
            {
                "id": stable_uuid(entidad, clean_key, mensaje, json.dumps(detail, sort_keys=True, default=str)),
                "origen": "Seguimiento de Pedidos Ecuador.xlsx",
                "entidad": entidad,
                "llave": clean_key,
                "severidad": severidad,
                "mensaje": mensaje,
                "detalle": detail,
            }
        )

    for error in line_errors:
        add_error(
            error["entidad"],
            error.get("llave"),
            error["mensaje"],
            severidad="media",
        )

    pedidos_sin_linea = pedidos_nums - {line["documento_ventas"] for line in lineas}
    for pedido in sorted(pedidos_sin_linea):
        add_error(
            "pedidos_erp",
            pedido,
            "Pedido sin lineas de detalle",
            severidad="baja",
            detalle={"materiales_catalogo": len(material_codes)},
        )

    for gestion in gestiones:
        if gestion.get("numero_pedido") and not gestion.get("pedido_id"):
            add_error(
                "gestiones_pedido",
                gestion.get("respuesta_id"),
                "Gestion sin pedido de cabecera",
                severidad="media",
                detalle={"numero_pedido": gestion.get("numero_pedido")},
            )

    for solicitud in solicitudes:
        if solicitud.get("numero_pedido") and not solicitud.get("pedido_id"):
            add_error(
                "solicitudes_gestion",
                solicitud.get("solicitud_id"),
                "Solicitud sin pedido de cabecera",
                severidad="media",
                detalle={"numero_pedido": solicitud.get("numero_pedido")},
            )

    for nota in notas:
        if nota.get("numero_pedido") and not nota.get("pedido_id"):
            add_error(
                "notas_credito",
                nota.get("nc_id"),
                "Nota de credito sin pedido de cabecera",
                severidad="media",
                detalle={"numero_pedido": nota.get("numero_pedido")},
            )

        respuesta_id = clean_id(nota.get("respuesta_id"))
        if respuesta_id and respuesta_id not in respuestas_ids:
            add_error(
                "notas_credito",
                nota.get("nc_id"),
                "Nota de credito referencia una gestion inexistente",
                severidad="media",
                detalle={"respuesta_id": respuesta_id},
            )

    for line in nc_lineas:
        respuesta_id = clean_id(line.get("respuesta_id"))
        if respuesta_id and respuesta_id not in respuestas_ids:
            add_error(
                "nota_credito_lineas",
                line.get("linea_id"),
                "Linea NC referencia una gestion inexistente",
                severidad="media",
                detalle={"respuesta_id": respuesta_id},
            )

        nc_id = clean_id(line.get("nc_id"))
        if nc_id and nc_id not in notas_ids:
            add_error(
                "nota_credito_lineas",
                line.get("linea_id"),
                "Linea NC referencia una nota de credito inexistente",
                severidad="media",
                detalle={"nc_id": nc_id},
            )

    for row in data["respuesta_nc_detalle"].to_dict("records"):
        material = clean_id(row.get("codigo_material"))
        if material and material not in material_codes:
            add_error(
                "nota_credito_lineas",
                row.get("linea_id"),
                "Material de linea NC no existe en catalogo",
                severidad="media",
                detalle={"codigo_material": material},
            )

    for row in data["consolidado_nc"].to_dict("records"):
        nc_id = clean_id(row.get("nc_id"))
        if nc_id and nc_id not in notas_ids:
            add_error(
                "consolidado_nc_fuente",
                row.get("key_consolidado"),
                "Consolidado NC referencia una nota no cargada",
                severidad="media",
                detalle={"nc_id": nc_id},
            )

        respuesta_id = clean_id(row.get("respuesta_id"))
        if respuesta_id and respuesta_id not in respuestas_ids:
            add_error(
                "consolidado_nc_fuente",
                row.get("key_consolidado"),
                "Consolidado NC referencia una gestion inexistente",
                severidad="media",
                detalle={"respuesta_id": respuesta_id},
            )

        material = clean_id(row.get("codigo_material"))
        if material and material not in material_codes:
            add_error(
                "consolidado_nc_fuente",
                row.get("key_consolidado"),
                "Consolidado NC contiene material fuera de catalogo",
                severidad="media",
                detalle={"codigo_material": material},
            )

    for run in sync_runs:
        if clean_text(run.get("estado")).upper() not in {"OK", "TRIGGERS INSTALADOS"}:
            add_error(
                "sync_runs",
                run.get("fecha_hora"),
                "Ejecucion de sincronizacion con error",
                severidad="alta",
                detalle={
                    "estado": run.get("estado"),
                    "error": run.get("error"),
                },
            )

    return dedupe_errors(errors)


def dedupe_errors(errors: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: dict[str, dict[str, Any]] = {}
    for error in errors:
        deduped[error["id"]] = error
    return list(deduped.values())


def fetch_id_map(client: SupabaseRest, table: str, columns: str, key_column: str) -> dict[str, str]:
    if client.dry_run:
        return {}
    rows = client.select_all(table, columns, key_column)
    return {clean_text(row.get(key_column)): row["id"] for row in rows if clean_text(row.get(key_column))}


def estado_desde_status(status: str) -> str:
    text = normalize(status)
    if "entregado y facturado" in text or "ajustado" in text:
        return "entregado"
    if "parcialmente entregado" in text or "parcialmente retirado" in text:
        return "en_despacho"
    if "pendiente por retiro" in text:
        return "aprobado"
    if "nota credito sin confirmar" in text or "nota credito pendiente" in text:
        return "en_revision"
    if "anulado" in text:
        return "cancelado"
    return "pendiente"


def accion_desde_status(status: str) -> str:
    text = normalize(status)
    if "proceder con nc" in text or "nota credito" in text:
        return "nota_credito"
    if "produccion" in text or "stock" in text:
        return "esperar_pedido"
    return "despachar"


def condicion_desde_motivo(motivo: str | None, status: str | None) -> str:
    text = normalize(f"{motivo or ''} {status or ''}")
    if "falta de stock" in text or "produccion" in text:
        return "no_planificable"
    if "no cumple minimo" in text or "condiciones comerciales" in text:
        return "restrictivo"
    if "despacho" in text or "coordinacion" in text:
        return "urgente_despacho"
    return "normal"


def normalize(value: Any) -> str:
    return clean_text(value).lower()


def clean_text(value: Any) -> str:
    if value is None or pd.isna(value):
        return ""
    text = str(value).replace("\xa0", " ").strip()
    text = re.sub(r"\s+", " ", text)
    if text.lower() in {"nan", "nat", "none"}:
        return ""
    return text


def clean_id(value: Any) -> str:
    if value is None or pd.isna(value):
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, int):
        return str(value)
    text = clean_text(value)
    if re.fullmatch(r"\d+\.0", text):
        return text[:-2]
    return text


def to_number(value: Any) -> float:
    if value is None or pd.isna(value):
        return 0.0
    try:
        return float(Decimal(str(value).replace(",", "").strip()))
    except (InvalidOperation, ValueError):
        return 0.0


def to_date(value: Any) -> str | None:
    parsed = parse_datetime(value)
    return parsed.date().isoformat() if parsed else None


def to_datetime(value: Any) -> str | None:
    parsed = parse_datetime(value)
    return parsed.isoformat() if parsed else None


def parse_datetime(value: Any) -> datetime | None:
    if value is None or pd.isna(value):
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day)
    text = clean_text(value)
    if not text:
        return None
    parsed = pd.to_datetime(text, errors="coerce")
    if pd.isna(parsed):
        return None
    return parsed.to_pydatetime().replace(tzinfo=None)


def stable_uuid(*parts: Any) -> str:
    import hashlib
    import uuid

    digest = hashlib.md5("|".join(clean_text(part) for part in parts).encode("utf-8")).hexdigest()
    return str(uuid.UUID(digest))


def json_default(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    raise TypeError(f"Object of type {type(value)!r} is not JSON serializable")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit("Importacion cancelada.")
