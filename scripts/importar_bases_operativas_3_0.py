from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

import pandas as pd


FUENTE_PENDIENTES = "BASE_PENDIENTES_BODEGA_A_FQ_EDITADO.xlsx"
FUENTE_INVENTARIO = "INVENTARIO_03-06-2026_EDITADO.xlsx"
FUENTE_TRANSITO = "TRANSITO_ejemplo_EDITADO.xlsx"
FUENTE_OC = "OC_PENDIENTES_SUM_A_BOG_EDITADO.xlsx"
FUENTE_CATALOGO = "BASE.xlsx"
EXCEL_EPOCH = datetime(1899, 12, 30, tzinfo=timezone.utc)


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
            with urllib.request.urlopen(request, timeout=300) as response:
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


def json_default(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    raise TypeError(f"No se puede serializar {type(value)!r}")


def main() -> None:
    args = parse_args()
    paths = {
        "pendientes": resolve_path(args.pendientes, FUENTE_PENDIENTES),
        "inventario": resolve_path(args.inventario, FUENTE_INVENTARIO),
        "transito": resolve_path(args.transito, FUENTE_TRANSITO),
        "oc": resolve_path(args.oc_pendientes, FUENTE_OC),
    }
    catalogo_path = None if args.sin_catalogo_materiales else resolve_optional_path(
        args.catalogo_materiales,
        FUENTE_CATALOGO,
    )
    if catalogo_path:
        paths["catalogo"] = catalogo_path

    for nombre, path in paths.items():
        if not path.exists():
            raise SystemExit(f"No existe el archivo de {nombre}: {path}")

    url = args.url or os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL")
    key = (
        args.service_role_key
        or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        or os.getenv("SUPABASE_SECRET_KEY")
    )

    if args.dry_run and (not url or not key):
        url = "https://dry-run.supabase.co"
        key = "dry-run"

    if not url or not key:
        raise SystemExit(
            "Faltan credenciales. Usa SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY "
            "o pasa --url y --service-role-key."
        )

    started = time.time()
    print("Leyendo bases operativas 3.0")
    data = {nombre: read_excel(path) for nombre, path in paths.items()}

    client = SupabaseRest(url=url, key=key, dry_run=args.dry_run, batch_size=args.batch_size)

    if not args.no_clean:
        print("Limpiando importacion operativa anterior")
        print(client.rpc("limpiar_bases_operativas_3_0"))

    print("Preparando catalogos")
    centros = build_centros(data)
    clientes = build_clientes(data["pendientes"])
    proveedores = build_proveedores(data)
    materiales = build_materiales(data)

    client.upsert("centros_bodega", centros, "centro_codigo")
    client.upsert("clientes_franquiciado", clientes, "codigo_cliente")
    client.upsert("proveedores_operativos", proveedores, "codigo_proveedor")
    try:
        client.upsert("material_catalogo", materiales, "codigo_material")
    except RuntimeError as exc:
        if "catalogo" in data and "material_catalogo" in str(exc):
            raise SystemExit(
                "Supabase aun no tiene las columnas del catalogo maestro. "
                "Ejecuta primero supabase/13_catalogo_maestro_base_materiales.sql "
                "en SQL Editor y vuelve a correr la importacion.\n"
                f"Detalle tecnico: {exc}"
            ) from exc
        raise

    print("Preparando movimientos operativos")
    inventario = build_inventario(data["inventario"])
    pendientes = build_pendientes(data["pendientes"])
    transito = build_transito(data["transito"])
    oc_pendientes = build_oc_pendientes(data["oc"])

    client.upsert("inventario_bodega", inventario, "centro_codigo,codigo_material")
    client.upsert("pedidos_bodega_fq", pendientes, "pedido_key")
    client.upsert("transito_bodega", transito, "transito_linea_key")
    client.upsert("oc_pendientes_bodega", oc_pendientes, "oc_linea_key")

    print("Sincronizando con tablas visibles del prototipo")
    try:
        refresh_result = client.rpc("refrescar_prototipo_bodega_fq")
    except RuntimeError as exc:
        message = str(exc)
        if "57014" in message or "statement timeout" in message:
            raise SystemExit(
                "Las bases operativas ya fueron cargadas, pero Supabase corto el refresco "
                "de las tablas visibles por tiempo de ejecucion.\n"
                "Ejecuta supabase/14_refresco_prototipo_bodega_fq_timeout.sql en SQL Editor "
                "y luego corre: select public.refrescar_prototipo_bodega_fq();\n"
                f"Detalle tecnico: {exc}"
            ) from exc
        raise

    summary = {
        "ok": True,
        "dry_run": args.dry_run,
        "segundos": round(time.time() - started, 2),
        "centros": len(centros),
        "clientes": len(clientes),
        "proveedores": len(proveedores),
        "materiales_catalogo": len(materiales),
        "filas_catalogo_maestro": len(data["catalogo"]) if "catalogo" in data else 0,
        "inventario_bodega": len(inventario),
        "pedidos_bodega_fq": len(pendientes),
        "transito_bodega": len(transito),
        "oc_pendientes_bodega": len(oc_pendientes),
        "refresco_prototipo": refresh_result,
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2, default=json_default))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Importa las bases operativas Bodega-FQ, inventario, transito y OC a Supabase."
    )
    parser.add_argument("--pendientes", help=f"Ruta de {FUENTE_PENDIENTES}")
    parser.add_argument("--inventario", help=f"Ruta de {FUENTE_INVENTARIO}")
    parser.add_argument("--transito", help=f"Ruta de {FUENTE_TRANSITO}")
    parser.add_argument("--oc-pendientes", help=f"Ruta de {FUENTE_OC}")
    parser.add_argument(
        "--catalogo-materiales",
        help=(
            f"Ruta del catalogo maestro de materiales ({FUENTE_CATALOGO}). "
            "Si no se indica, se usa el archivo de Downloads cuando existe."
        ),
    )
    parser.add_argument(
        "--sin-catalogo-materiales",
        action="store_true",
        help="Omite BASE.xlsx aunque exista en Downloads.",
    )
    parser.add_argument("--url", help="URL del proyecto Supabase.")
    parser.add_argument("--service-role-key", help="Secret/service role key de Supabase.")
    parser.add_argument("--batch-size", type=int, default=1000, help="Filas por lote REST.")
    parser.add_argument("--dry-run", action="store_true", help="Lee y prepara datos sin escribir en Supabase.")
    parser.add_argument(
        "--no-clean",
        action="store_true",
        help="No llama limpiar_bases_operativas_3_0 antes de importar.",
    )
    return parser.parse_args()


def resolve_path(value: str | None, default_name: str) -> Path:
    if value:
        return Path(value).expanduser().resolve()
    return (Path.home() / "Downloads" / default_name).resolve()


def resolve_optional_path(value: str | None, default_name: str) -> Path | None:
    if value:
        path = Path(value).expanduser().resolve()
        if not path.exists():
            raise SystemExit(f"No existe el archivo de catalogo maestro: {path}")
        return path

    path = (Path.home() / "Downloads" / default_name).resolve()
    return path if path.exists() else None


def read_excel(path: Path) -> pd.DataFrame:
    print(f"- {path}")
    df = pd.read_excel(path, sheet_name=0, dtype=object)
    df = df.rename(columns={column: normalize_column(column) for column in df.columns})
    df = df.dropna(how="all").reset_index(drop=True)
    return df


def normalize_column(value: Any) -> str:
    text = repair_text(str(value)).lower()
    text = strip_accents(text)
    text = re.sub(r"[^a-z0-9]+", "_", text)
    return text.strip("_")


def strip_accents(value: str) -> str:
    return "".join(
        char for char in unicodedata.normalize("NFKD", value) if not unicodedata.combining(char)
    )


def repair_text(value: Any) -> str:
    if value is None:
        return ""

    text = str(value).strip()
    if not text or text.lower() in {"nan", "nat", "none"}:
        return ""

    repaired = text
    try:
        candidate = text.encode("latin1").decode("utf-8")
        if mojibake_score(candidate) < mojibake_score(text):
            repaired = candidate
    except (UnicodeEncodeError, UnicodeDecodeError):
        repaired = text

    return re.sub(r"\s+", " ", repaired).strip()


def mojibake_score(value: str) -> int:
    return sum(value.count(token) for token in ("Ã", "Â", "�", "¤", "±"))


def is_blank(value: Any) -> bool:
    if value is None:
        return True
    try:
        return bool(pd.isna(value))
    except (TypeError, ValueError):
        return False


def text_value(value: Any) -> str | None:
    if is_blank(value):
        return None
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, Decimal) and value == value.to_integral_value():
        return str(int(value))

    text = repair_text(value)
    if not text:
        return None

    if re.fullmatch(r"-?\d+\.0", text):
        return text[:-2]

    return text


def number_value(value: Any, default: float = 0.0) -> float:
    if is_blank(value):
        return default
    if isinstance(value, (int, float, Decimal)) and not isinstance(value, bool):
        return float(value)

    text = text_value(value)
    if not text:
        return default

    cleaned = text.replace("$", "").replace(" ", "")
    if "," in cleaned and "." in cleaned:
        cleaned = cleaned.replace(",", "")
    elif "," in cleaned:
        cleaned = cleaned.replace(",", ".")
    cleaned = re.sub(r"[^0-9.\-]", "", cleaned)

    try:
        return float(cleaned)
    except ValueError:
        return default


def non_negative_number(value: Any, default: float = 0.0) -> float:
    return max(0.0, number_value(value, default))


def date_value(value: Any) -> str | None:
    if is_blank(value):
        return None
    if isinstance(value, (int, float, Decimal)) and not isinstance(value, bool):
        serial = float(value)
        if 1 <= serial <= 60000:
            return (EXCEL_EPOCH + timedelta(days=serial)).date().isoformat()
    if isinstance(value, pd.Timestamp):
        return value.date().isoformat()
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()

    text = text_value(value)
    if not text:
        return None
    if re.fullmatch(r"\d+(\.\d+)?", text):
        serial = float(text)
        if 1 <= serial <= 60000:
            return (EXCEL_EPOCH + timedelta(days=serial)).date().isoformat()

    parsed = pd.to_datetime(text, errors="coerce", dayfirst=True)
    if pd.isna(parsed):
        return None
    return parsed.date().isoformat()


def fecha_limite_from_sla(sla: Any, fecha_base: str | None) -> str | None:
    if not fecha_base:
        return None

    try:
        base = date.fromisoformat(fecha_base)
    except ValueError:
        return None

    text = strip_accents(text_value(sla) or "").upper()
    if not text:
        return fecha_base

    if "24" in text:
        return (base + timedelta(days=1)).isoformat()
    if "48" in text:
        return (base + timedelta(days=2)).isoformat()

    weekday_map = {
        "LUNES": 0,
        "MARTES": 1,
        "MIERCOLES": 2,
        "JUEVES": 3,
        "VIERNES": 4,
        "SABADO": 5,
        "DOMINGO": 6,
    }
    target_days = [day for name, day in weekday_map.items() if name in text]
    target_weeks = [int(value) for value in re.findall(r"S([1-5])", text)]

    if not target_days:
        return fecha_base

    for offset in range(0, 91):
        candidate = base + timedelta(days=offset)
        candidate_week = ((candidate.day - 1) // 7) + 1
        if candidate.weekday() in target_days and (
            not target_weeks or candidate_week in target_weeks
        ):
            return candidate.isoformat()

    return fecha_base


def dias_entregados_value(value: Any, fecha_inicio: str | None, fecha_entrega: str | None) -> float | None:
    dias = number_value(value)
    if 0 <= dias <= 3650:
        return dias

    if fecha_inicio and fecha_entrega:
        try:
            inicio = date.fromisoformat(fecha_inicio)
            entrega = date.fromisoformat(fecha_entrega)
        except ValueError:
            return None
        return float(max(0, (entrega - inicio).days))

    return None


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def stable_hash(*parts: Any, prefix: str = "") -> str:
    raw = "|".join(text_value(part) or "" for part in parts)
    digest = hashlib.md5(raw.encode("utf-8")).hexdigest()[:16]
    return f"{prefix}{digest}" if prefix else digest


def clean_key(value: Any, fallback: str) -> str:
    text = text_value(value)
    if not text:
        return fallback
    text = re.sub(r"\s*\|\s*", "-", text)
    text = re.sub(r"[^A-Za-z0-9_.-]+", "-", text)
    return text.strip("-") or fallback


def centro_from_base(value: Any) -> str | None:
    text = text_value(value)
    if not text:
        return None
    normalized = strip_accents(repair_text(text)).lower()
    if "duran" in normalized:
        return "YDUR"
    return re.sub(r"[^A-Z0-9]+", "", text.upper())[:12] or None


def split_provider(value: Any) -> tuple[str | None, str | None]:
    text = text_value(value)
    if not text:
        return None, None

    match = re.match(r"^(\d+)\s+(.+)$", text)
    if match:
        return match.group(1), match.group(2).strip()

    if re.fullmatch(r"\d+", text):
        return text, f"Proveedor {text}"

    return stable_hash(text, prefix="PROV-"), text


def put_unique(rows: dict[str, dict[str, Any]], key: str | None, row: dict[str, Any]) -> None:
    if not key:
        return
    current = rows.get(key)
    if current is None:
        rows[key] = row
        return

    merged = current.copy()
    for field, value in row.items():
        if value not in (None, ""):
            merged[field] = value
    rows[key] = merged


def build_centros(data: dict[str, pd.DataFrame]) -> list[dict[str, Any]]:
    rows: dict[str, dict[str, Any]] = {}

    for _, row in data["inventario"].iterrows():
        code = text_value(row.get("centro"))
        put_unique(
            rows,
            code,
            {
                "centro_codigo": code,
                "nombre_centro": text_value(row.get("nombre_de_centro")),
                "sociedad": text_value(row.get("sociedad")),
                "nombre_empresa": text_value(row.get("nombre_de_la_empresa")),
                "fuente": FUENTE_INVENTARIO,
                "updated_at": now_iso(),
            },
        )

    for source_name, source_file in (("transito", FUENTE_TRANSITO), ("oc", FUENTE_OC)):
        for _, row in data[source_name].iterrows():
            code = text_value(row.get("centro"))
            put_unique(
                rows,
                code,
                {
                    "centro_codigo": code,
                    "nombre_centro": code,
                    "fuente": source_file,
                    "updated_at": now_iso(),
                },
            )

    for _, row in data["pendientes"].iterrows():
        code = centro_from_base(row.get("base"))
        put_unique(
            rows,
            code,
            {
                "centro_codigo": code,
                "nombre_centro": text_value(row.get("base")) or code,
                "fuente": FUENTE_PENDIENTES,
                "updated_at": now_iso(),
            },
        )

    return sorted(rows.values(), key=lambda item: item["centro_codigo"])


def build_clientes(df: pd.DataFrame) -> list[dict[str, Any]]:
    rows: dict[str, dict[str, Any]] = {}
    for _, row in df.iterrows():
        code = text_value(row.get("cod_cliente"))
        name = text_value(row.get("cliente"))
        if not code or not name:
            continue
        put_unique(
            rows,
            code,
            {
                "codigo_cliente": code,
                "nombre_cliente": name,
                "zona_cliente": text_value(row.get("zona_cliente")),
                "zona": text_value(row.get("zona")),
                "fuente": FUENTE_PENDIENTES,
                "updated_at": now_iso(),
            },
        )
    return sorted(rows.values(), key=lambda item: item["codigo_cliente"])


def build_proveedores(data: dict[str, pd.DataFrame]) -> list[dict[str, Any]]:
    rows: dict[str, dict[str, Any]] = {}

    if "catalogo" in data:
        for _, row in data["catalogo"].iterrows():
            code = text_value(row.get("c_fabricante"))
            name = text_value(row.get("n_fabricante"))
            if not code or not name:
                continue
            put_unique(
                rows,
                code,
                {
                    "codigo_proveedor": code,
                    "nombre_proveedor": name,
                    "fuente": FUENTE_CATALOGO,
                    "updated_at": now_iso(),
                },
            )

    for source_name, source_file in (("transito", FUENTE_TRANSITO), ("oc", FUENTE_OC)):
        for _, row in data[source_name].iterrows():
            code, name = split_provider(row.get("nombre_del_proveedor"))
            if not code or not name:
                continue
            put_unique(
                rows,
                code,
                {
                    "codigo_proveedor": code,
                    "nombre_proveedor": name,
                    "fuente": source_file,
                    "updated_at": now_iso(),
                },
            )

    for _, row in data["inventario"].iterrows():
        code = text_value(row.get("fabricante"))
        if not code or code in rows:
            continue
        put_unique(
            rows,
            code,
            {
                "codigo_proveedor": code,
                "nombre_proveedor": f"Proveedor {code}",
                "fuente": FUENTE_INVENTARIO,
                "updated_at": now_iso(),
            },
        )

    return sorted(rows.values(), key=lambda item: item["codigo_proveedor"])


def build_materiales(data: dict[str, pd.DataFrame]) -> list[dict[str, Any]]:
    rows: dict[str, dict[str, Any]] = {}
    catalogo_defaults = {
        "codigo_nuestro_material": None,
        "codigo_fabricante_nuestro": None,
        "codigo_suministrador": None,
        "nombre_suministrador": None,
        "marca_material": None,
        "catman_nombre": None,
        "catman_nuestro": None,
        "catman_categoria": None,
        "unidad_medida_base": None,
        "estado_planificacion": None,
        "min_venta": 1,
        "mult_venta": 1,
        "min_compra": 1,
        "mult_compra": 1,
        "fuente_catalogo": None,
    }

    def add_material(
        code: Any,
        name: Any,
        source: str,
        extra: dict[str, Any] | None = None,
    ) -> None:
        material_code = text_value(code)
        material_name = text_value(name)
        if not material_code:
            return
        payload = {
            "codigo_material": material_code,
            "nombre_material": material_name or f"Material {material_code}",
            "numero_fb": None,
            **catalogo_defaults,
            "updated_at": now_iso(),
        }
        if extra:
            payload.update(extra)
        put_unique(rows, material_code, payload)

    for _, row in data["transito"].iterrows():
        add_material(row.get("material"), row.get("texto_breve"), FUENTE_TRANSITO)
    for _, row in data["oc"].iterrows():
        add_material(row.get("material"), row.get("texto_breve"), FUENTE_OC)
    for _, row in data["pendientes"].iterrows():
        add_material(row.get("cod_holcim"), row.get("descripcion"), FUENTE_PENDIENTES)
    for _, row in data["inventario"].iterrows():
        add_material(row.get("material"), row.get("texto_breve_de_material"), FUENTE_INVENTARIO)
    if "catalogo" in data:
        for _, row in data["catalogo"].iterrows():
            add_material(
                row.get("cdisensa_mat"),
                row.get("n_materiales"),
                FUENTE_CATALOGO,
                {
                    "numero_fb": text_value(row.get("codnuestro_mat")),
                    "codigo_nuestro_material": text_value(row.get("codnuestro_mat")),
                    "codigo_fabricante_nuestro": text_value(row.get("codfab_nuestro")),
                    "codigo_suministrador": text_value(row.get("c_fabricante")),
                    "nombre_suministrador": text_value(row.get("n_fabricante")),
                    "marca_material": text_value(row.get("marca")),
                    "catman_nombre": text_value(row.get("catman")),
                    "catman_nuestro": text_value(row.get("catman_nuestro")),
                    "catman_categoria": text_value(row.get("categoria")),
                    "unidad_medida_base": text_value(row.get("umb_unidad_de_medida_base")) or "UN",
                    "estado_planificacion": estado_planificable_value(
                        text_value(row.get("estado_de_planificacion"))
                    ),
                    "min_venta": non_negative_number(row.get("min_vta"), 1),
                    "mult_venta": non_negative_number(row.get("mult_vta"), 1),
                    "min_compra": non_negative_number(row.get("min_cmpr"), 1),
                    "mult_compra": non_negative_number(row.get("mult_cmpr"), 1),
                    "fuente_catalogo": FUENTE_CATALOGO,
                },
            )

    return sorted(rows.values(), key=lambda item: item["codigo_material"])


def build_inventario(df: pd.DataFrame) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for _, row in df.iterrows():
        centro = text_value(row.get("centro"))
        material = text_value(row.get("material"))
        if not centro or not material:
            continue

        rows.append(
            {
                "centro_codigo": centro,
                "codigo_material": material,
                "sociedad": text_value(row.get("sociedad")),
                "nombre_empresa": text_value(row.get("nombre_de_la_empresa")),
                "nombre_centro": text_value(row.get("nombre_de_centro")),
                "tipo_material": text_value(row.get("tipo_de_material")),
                "fabricante": text_value(row.get("fabricante")),
                "unidad_medida": text_value(row.get("unidad_medida_base")) or "UN",
                "stock_libre_utilizacion": non_negative_number(row.get("stock_libre_utilizacion")),
                "bloqueado": non_negative_number(row.get("bloqueado")),
                "comprometido_ped_vta": non_negative_number(row.get("compr_ped_vta")),
                "comprometido_entregas": non_negative_number(row.get("compr_entregas")),
                "consignacion_libre": non_negative_number(row.get("consig_libre_utiliz")),
                "stock_en_curso_pedido": non_negative_number(row.get("stock_en_curso_ped")),
                "devoluciones": non_negative_number(row.get("devoluciones")),
                "stock_disponible": non_negative_number(row.get("stock_disponible")),
                "fuente": FUENTE_INVENTARIO,
                "updated_at": now_iso(),
            }
        )
    return rows


def build_pendientes(df: pd.DataFrame) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for index, row in df.iterrows():
        pedido = text_value(row.get("cod_pedido"))
        material = text_value(row.get("cod_holcim"))
        if not pedido or not material:
            continue

        fallback_key = clean_key(f"{pedido}-{material}", stable_hash("pendiente", index, pedido, material))
        cantidad = number_value(row.get("cantidad"))
        stock_disponible = number_value(row.get("stock_disponible"))
        stock_transito = number_value(row.get("stock_en_transito"))
        fecha_solicitud = date_value(row.get("fecha_solicitud"))
        fecha_reportado = date_value(row.get("fecha_reportado"))
        fecha_limite = date_value(row.get("fecha_limite")) or fecha_limite_from_sla(
            row.get("sla"),
            fecha_reportado or fecha_solicitud,
        )
        fecha_entrega = date_value(row.get("fecha_de_entrega"))
        dias_entregados = dias_entregados_value(
            row.get("dias_entregados"),
            fecha_reportado or fecha_solicitud,
            fecha_entrega,
        )

        rows.append(
            {
                "pedido_key": fallback_key,
                "validacion_bodega": text_value(row.get("validacion_bodega")),
                "lider": text_value(row.get("lider")),
                "observacion_despacho": text_value(row.get("observacion_despacho")),
                "tipo_caso": text_value(row.get("tipo_de_caso")),
                "responsable": text_value(row.get("responsable")),
                "resolucion": text_value(row.get("resolucion")),
                "estado": text_value(row.get("estado")),
                "base": text_value(row.get("base")),
                "centro_codigo": centro_from_base(row.get("base")),
                "cod_pedido": pedido,
                "zona_cliente": text_value(row.get("zona_cliente")),
                "codigo_cliente": text_value(row.get("cod_cliente")),
                "cliente": text_value(row.get("cliente")),
                "zona": text_value(row.get("zona")),
                "posicion": text_value(row.get("posicion")),
                "cod_proveedor": text_value(row.get("cod_proveedor")),
                "codigo_material": material,
                "descripcion_material": text_value(row.get("descripcion")) or f"Material {material}",
                "cantidad": cantidad,
                "unidad": text_value(row.get("unidad")) or "UN",
                "peso_kg": number_value(row.get("peso_kg")),
                "m3": number_value(row.get("m3")),
                "linea_producto": text_value(row.get("linea_de_producto")),
                "placa": text_value(row.get("placa")),
                "cod_trans": text_value(row.get("cod_trans")),
                "fecha_solicitud": fecha_solicitud,
                "fecha_limite": fecha_limite,
                "observaciones_general": text_value(row.get("observaciones_general")),
                "validacion_lizbeth_nicola": text_value(row.get("validacion_lizbeth_nicola")),
                "fecha_reportado": fecha_reportado,
                "fecha_revision": date_value(row.get("fecha_revision")),
                "fecha_entrega": fecha_entrega,
                "dias_entregados": dias_entregados,
                "sla": text_value(row.get("sla")),
                "pedidos_dp": text_value(row.get("pedidos_dp")),
                "fecha_compra": date_value(row.get("fecha_compra")),
                "stock_disponible_fuente": stock_disponible,
                "stock_en_transito_fuente": stock_transito,
                "bloqueado_fuente": number_value(row.get("bloqueado")),
                "validacion_planning": text_value(row.get("validacion_planning")),
                "validado_por": text_value(row.get("validado_por")),
                "oc": text_value(row.get("oc")),
                "fecha_oc": date_value(row.get("fecha_oc")),
                "excluidos": text_value(row.get("excluidos")),
                "fecha_cierre_bodega": date_value(row.get("fecha_de_cierre_bodega")),
                "prioridad_calculada": prioridad_local(
                    text_value(row.get("tipo_de_caso")),
                    stock_disponible,
                    fecha_limite,
                    text_value(row.get("excluidos")),
                ),
                "fuente": FUENTE_PENDIENTES,
                "updated_at": now_iso(),
            }
        )
    return rows


def prioridad_local(
    tipo_caso: str | None,
    stock_disponible: float,
    fecha_limite: str | None,
    excluidos: str | None,
) -> int:
    puntaje = days_overdue(fecha_limite) * 2
    tipo = strip_accents(tipo_caso or "").upper()

    if max(0.0, stock_disponible) == 0:
        puntaje += 30
    if "CADUCIDAD" in tipo:
        puntaje += 20
    if estado_planificable_value(excluidos) == "planificable":
        puntaje += 10

    return min(100, max(0, int(puntaje)))


def estado_planificable_value(value: str | None) -> str:
    text = strip_accents(value or "").lower().strip()
    if not text or text in {"#n/a", "n/a", "na", "nan"}:
        return "no planificable"
    if "agotar" in text:
        return "agotar stock"
    if "planificable" in text and "no plan" not in text:
        return "planificable"
    return "no planificable"


def days_overdue(value: str | None) -> int:
    if not value:
        return 0
    try:
        parsed = datetime.fromisoformat(value).date()
    except ValueError:
        return 0
    return max(0, (date.today() - parsed).days)


def days_since(value: str | None) -> int:
    if not value:
        return 0
    try:
        parsed = datetime.fromisoformat(value).date()
    except ValueError:
        return 0
    return max(0, (date.today() - parsed).days)


def build_transito(df: pd.DataFrame) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for index, row in df.iterrows():
        centro = text_value(row.get("centro"))
        documento = text_value(row.get("documento_compras"))
        material = text_value(row.get("material"))
        if not centro or not documento or not material:
            continue
        proveedor_codigo, proveedor_nombre = split_provider(row.get("nombre_del_proveedor"))
        rows.append(
            {
                "transito_linea_key": stable_hash(
                    "transito",
                    index,
                    centro,
                    documento,
                    material,
                    row.get("cantidad_de_pedido"),
                    row.get("por_entregar_cantidad"),
                    prefix="TR-",
                ),
                "centro_codigo": centro,
                "documento_compras": documento,
                "fecha_documento": date_value(row.get("fecha_documento")),
                "codigo_material": material,
                "texto_breve": text_value(row.get("texto_breve")),
                "cantidad_pedido": number_value(row.get("cantidad_de_pedido")),
                "cantidad_por_entregar": number_value(row.get("por_entregar_cantidad")),
                "valor_neto": number_value(row.get("valor_neto_de_orden")),
                "codigo_proveedor": proveedor_codigo,
                "nombre_proveedor": proveedor_nombre,
                "fuente": FUENTE_TRANSITO,
                "updated_at": now_iso(),
            }
        )
    return rows


def build_oc_pendientes(df: pd.DataFrame) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for index, row in df.iterrows():
        centro = text_value(row.get("centro"))
        documento = text_value(row.get("documento_compras"))
        material = text_value(row.get("material"))
        if not centro or not documento or not material:
            continue
        proveedor_codigo, proveedor_nombre = split_provider(row.get("nombre_del_proveedor"))
        rows.append(
            {
                "oc_linea_key": stable_hash(
                    "oc",
                    index,
                    centro,
                    documento,
                    material,
                    row.get("cantidad_de_pedido"),
                    row.get("por_entregar_cantidad"),
                    prefix="OC-",
                ),
                "centro_codigo": centro,
                "documento_compras": documento,
                "fecha_documento": date_value(row.get("fecha_documento")),
                "codigo_material": material,
                "texto_breve": text_value(row.get("texto_breve")),
                "cantidad_pedido": number_value(row.get("cantidad_de_pedido")),
                "cantidad_por_entregar": number_value(row.get("por_entregar_cantidad")),
                "valor_neto": number_value(row.get("valor_neto_de_orden")),
                "codigo_proveedor": proveedor_codigo,
                "nombre_proveedor": proveedor_nombre,
                "tipo_posicion": text_value(row.get("tipo_de_posicion")),
                "tipo_posicion_1": text_value(row.get("tipo_de_posicion_1")),
                "tipo_imputacion": text_value(row.get("tipo_de_imputacion")),
                "fuente": FUENTE_OC,
                "updated_at": now_iso(),
            }
        )
    return rows


if __name__ == "__main__":
    main()
