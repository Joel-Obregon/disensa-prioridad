from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

import pandas as pd


FILES = {
    "pendientes_bodega_fq": Path(r"C:\Users\Joel\Downloads\BASE_PENDIENTES_BODEGA_A_FQ_EDITADO.xlsx"),
    "inventario": Path(r"C:\Users\Joel\Downloads\INVENTARIO_03-06-2026_EDITADO.xlsx"),
    "transito": Path(r"C:\Users\Joel\Downloads\TRANSITO_ejemplo_EDITADO.xlsx"),
    "oc_pendientes_sum_bog": Path(r"C:\Users\Joel\Downloads\OC_PENDIENTES_SUM_A_BOG_EDITADO.xlsx"),
}

OUTPUT_DIR = Path(".codex-analysis")
OUTPUT_JSON = OUTPUT_DIR / "perfil_bases_nuevas.json"
OUTPUT_MD = OUTPUT_DIR / "perfil_bases_nuevas.md"


def normalizar_columna(nombre: Any) -> str:
    texto = str(nombre or "").strip().lower()
    reemplazos = {
        "á": "a",
        "é": "e",
        "í": "i",
        "ó": "o",
        "ú": "u",
        "ñ": "n",
    }
    for origen, destino in reemplazos.items():
        texto = texto.replace(origen, destino)
    texto = re.sub(r"[^a-z0-9]+", "_", texto)
    return texto.strip("_") or "columna_sin_nombre"


def limpiar_valor(valor: Any) -> Any:
    if pd.isna(valor):
        return None
    if hasattr(valor, "isoformat"):
        return valor.isoformat()
    if isinstance(valor, str):
        return valor.strip()
    if isinstance(valor, (int, float, bool)):
        return valor
    return str(valor)


def serie_texto(df: pd.DataFrame, columna: str) -> pd.Series:
    return df[columna].dropna().astype(str).str.strip()


def detectar_roles_columnas(columnas: list[str]) -> dict[str, list[str]]:
    roles: dict[str, list[str]] = defaultdict(list)
    patrones = {
        "material_codigo": r"(cod|codigo).*mat|material.*cod|^mat$|^sku$|articulo",
        "material_nombre": r"desc|descripcion|material|producto|nombre",
        "pedido": r"pedido|documento_ventas|doc_venta|num_pedido|orden_venta",
        "oc": r"oc|orden.*compra|pedido_compra|documento_compras|doc_compra",
        "proveedor": r"proveedor|suministrador|vendor",
        "bodega": r"bodega|centro|almacen|almacenaje|site",
        "franquiciado": r"franquiciado|cliente|solicitante|fq",
        "cantidad": r"cantidad|cant|qty|pendiente|solicitado|stock|inventario|transito",
        "fecha": r"fecha|date|fec",
        "valor": r"valor|precio|importe|costo|monto|total",
        "estado": r"estado|status|estatus|situacion",
    }

    for columna in columnas:
        for rol, patron in patrones.items():
            if re.search(patron, columna):
                roles[rol].append(columna)

    return dict(roles)


def perfilar_hoja(path: Path, sheet_name: str) -> dict[str, Any]:
    df = pd.read_excel(path, sheet_name=sheet_name)
    df = df.dropna(how="all")
    df.columns = [normalizar_columna(col) for col in df.columns]
    df = df.loc[:, ~pd.Index(df.columns).duplicated()]

    columnas = list(df.columns)
    perfil_columnas = []

    for columna in columnas:
        serie = df[columna]
        no_nulos = int(serie.notna().sum())
        unicos = int(serie.nunique(dropna=True))
        ejemplos = [limpiar_valor(v) for v in serie.dropna().head(5).tolist()]
        perfil_columnas.append(
            {
                "columna": columna,
                "dtype": str(serie.dtype),
                "no_nulos": no_nulos,
                "nulos": int(serie.isna().sum()),
                "unicos": unicos,
                "pct_unicos": round((unicos / no_nulos) * 100, 2) if no_nulos else 0,
                "ejemplos": ejemplos,
            }
        )

    muestras = [
        {col: limpiar_valor(row[col]) for col in columnas}
        for _, row in df.head(5).iterrows()
    ]

    return {
        "sheet": sheet_name,
        "filas": int(len(df)),
        "columnas_total": len(columnas),
        "columnas": columnas,
        "roles": detectar_roles_columnas(columnas),
        "perfil_columnas": perfil_columnas,
        "muestras": muestras,
    }


def construir_overlaps(perfiles: dict[str, Any]) -> list[dict[str, Any]]:
    valores: dict[str, dict[str, set[str]]] = {}

    for archivo, info in perfiles.items():
        for hoja in info["sheets"]:
            df = pd.read_excel(FILES[archivo], sheet_name=hoja["sheet"]).dropna(how="all")
            df.columns = [normalizar_columna(col) for col in df.columns]
            df = df.loc[:, ~pd.Index(df.columns).duplicated()]
            roles = hoja["roles"]

            for rol in ["material_codigo", "pedido", "oc", "proveedor", "bodega", "franquiciado"]:
                for columna in roles.get(rol, []):
                    key = f"{archivo}.{hoja['sheet']}.{columna}"
                    vals = serie_texto(df, columna)
                    valores.setdefault(rol, {})[key] = set(vals.str.upper().head(50000).tolist())

    overlaps = []
    for rol, fuentes in valores.items():
        keys = list(fuentes.keys())
        for i, key_a in enumerate(keys):
            for key_b in keys[i + 1 :]:
                set_a = fuentes[key_a]
                set_b = fuentes[key_b]
                if not set_a or not set_b:
                    continue
                inter = set_a & set_b
                if inter:
                    overlaps.append(
                        {
                            "rol": rol,
                            "fuente_a": key_a,
                            "fuente_b": key_b,
                            "coincidencias": len(inter),
                            "pct_a": round(len(inter) / len(set_a) * 100, 2),
                            "pct_b": round(len(inter) / len(set_b) * 100, 2),
                            "ejemplos": sorted(list(inter))[:10],
                        }
                    )
    return sorted(overlaps, key=lambda x: (x["rol"], -x["coincidencias"]))


def escribir_markdown(perfiles: dict[str, Any], overlaps: list[dict[str, Any]]) -> None:
    lines = ["# Perfil de bases nuevas", ""]

    for archivo, info in perfiles.items():
        lines.append(f"## {archivo}")
        lines.append(f"Ruta: `{info['path']}`")
        lines.append("")

        for hoja in info["sheets"]:
            lines.append(f"### Hoja: {hoja['sheet']}")
            lines.append(f"- Filas: {hoja['filas']}")
            lines.append(f"- Columnas: {hoja['columnas_total']}")
            lines.append(f"- Columnas: `{', '.join(hoja['columnas'])}`")
            lines.append(f"- Roles detectados: `{json.dumps(hoja['roles'], ensure_ascii=False)}`")
            lines.append("")
            lines.append("| Columna | Tipo | No nulos | Unicos | Ejemplos |")
            lines.append("|---|---:|---:|---:|---|")
            for col in hoja["perfil_columnas"]:
                ejemplos = ", ".join(str(x) for x in col["ejemplos"][:3])
                lines.append(
                    f"| {col['columna']} | {col['dtype']} | {col['no_nulos']} | {col['unicos']} | {ejemplos} |"
                )
            lines.append("")

    lines.append("## Coincidencias entre fuentes")
    if not overlaps:
        lines.append("No se detectaron coincidencias automaticas con los nombres de columnas actuales.")
    else:
        lines.append("| Rol | Fuente A | Fuente B | Coincidencias | % A | % B | Ejemplos |")
        lines.append("|---|---|---|---:|---:|---:|---|")
        for item in overlaps[:80]:
            lines.append(
                f"| {item['rol']} | `{item['fuente_a']}` | `{item['fuente_b']}` | "
                f"{item['coincidencias']} | {item['pct_a']} | {item['pct_b']} | "
                f"{', '.join(item['ejemplos'][:5])} |"
            )

    OUTPUT_MD.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    missing = [str(path) for path in FILES.values() if not path.exists()]
    if missing:
        print("No se encontraron archivos:", json.dumps(missing, indent=2), file=sys.stderr)
        sys.exit(1)

    OUTPUT_DIR.mkdir(exist_ok=True)
    perfiles: dict[str, Any] = {}

    for nombre, path in FILES.items():
        xls = pd.ExcelFile(path)
        perfiles[nombre] = {
            "path": str(path),
            "sheet_names": xls.sheet_names,
            "sheets": [perfilar_hoja(path, sheet) for sheet in xls.sheet_names],
        }

    overlaps = construir_overlaps(perfiles)
    payload = {"files": perfiles, "overlaps": overlaps}
    OUTPUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    escribir_markdown(perfiles, overlaps)

    resumen = {
        nombre: [
            {"sheet": sheet["sheet"], "filas": sheet["filas"], "columnas": sheet["columnas_total"]}
            for sheet in info["sheets"]
        ]
        for nombre, info in perfiles.items()
    }
    print(json.dumps({"ok": True, "resumen": resumen, "overlaps": len(overlaps)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
