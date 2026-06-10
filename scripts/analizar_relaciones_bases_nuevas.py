from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pandas as pd


FILES = {
    "pendientes": Path(r"C:\Users\Joel\Downloads\BASE_PENDIENTES_BODEGA_A_FQ_EDITADO.xlsx"),
    "inventario": Path(r"C:\Users\Joel\Downloads\INVENTARIO_03-06-2026_EDITADO.xlsx"),
    "transito": Path(r"C:\Users\Joel\Downloads\TRANSITO_ejemplo_EDITADO.xlsx"),
    "oc": Path(r"C:\Users\Joel\Downloads\OC_PENDIENTES_SUM_A_BOG_EDITADO.xlsx"),
}

OUTPUT_DIR = Path(".codex-analysis")
OUTPUT_JSON = OUTPUT_DIR / "relaciones_bases_nuevas.json"
OUTPUT_MD = OUTPUT_DIR / "relaciones_bases_nuevas.md"


def normalizar_columna(nombre: Any) -> str:
    texto = str(nombre or "").strip().lower()
    for a, b in {"á": "a", "é": "e", "í": "i", "ó": "o", "ú": "u", "ñ": "n"}.items():
        texto = texto.replace(a, b)
    import re

    return re.sub(r"[^a-z0-9]+", "_", texto).strip("_")


def read_excel(key: str) -> pd.DataFrame:
    df = pd.read_excel(FILES[key])
    df = df.dropna(how="all")
    df.columns = [normalizar_columna(c) for c in df.columns]
    df = df.loc[:, ~pd.Index(df.columns).duplicated()]
    return df


def texto(valor: Any) -> str:
    if pd.isna(valor):
        return ""
    if isinstance(valor, float) and valor.is_integer():
        return str(int(valor))
    return str(valor).strip()


def codigo_set(df: pd.DataFrame, col: str) -> set[str]:
    return set(df[col].dropna().map(texto).str.upper())


def pct(num: int, den: int) -> float:
    return round((num / den) * 100, 2) if den else 0.0


def interseccion(nombre_a: str, set_a: set[str], nombre_b: str, set_b: set[str]) -> dict[str, Any]:
    inter = set_a & set_b
    return {
        "a": nombre_a,
        "b": nombre_b,
        "unicos_a": len(set_a),
        "unicos_b": len(set_b),
        "coinciden": len(inter),
        "pct_a": pct(len(inter), len(set_a)),
        "pct_b": pct(len(inter), len(set_b)),
        "ejemplos": sorted(inter)[:15],
    }


def split_proveedor(valor: Any) -> tuple[str, str]:
    raw = texto(valor)
    if not raw:
        return "", ""
    parts = raw.split(maxsplit=1)
    if parts and parts[0].isdigit():
        return parts[0], parts[1].strip() if len(parts) > 1 else ""
    return "", raw


def main() -> None:
    OUTPUT_DIR.mkdir(exist_ok=True)
    pendientes = read_excel("pendientes")
    inventario = read_excel("inventario")
    transito = read_excel("transito")
    oc = read_excel("oc")

    sets = {
        "pendientes.cod_holcim": codigo_set(pendientes, "cod_holcim"),
        "inventario.material": codigo_set(inventario, "material"),
        "transito.material": codigo_set(transito, "material"),
        "oc.material": codigo_set(oc, "material"),
    }

    material_rel = [
        interseccion(a, sets[a], b, sets[b])
        for i, a in enumerate(sets)
        for b in list(sets)[i + 1 :]
    ]

    oc_pendientes = codigo_set(pendientes[pendientes["oc"].notna()], "oc")
    oc_transito = codigo_set(transito, "documento_compras")
    oc_oc = codigo_set(oc, "documento_compras")
    oc_rel = [
        interseccion("pendientes.oc", oc_pendientes, "transito.documento_compras", oc_transito),
        interseccion("pendientes.oc", oc_pendientes, "oc.documento_compras", oc_oc),
        interseccion("transito.documento_compras", oc_transito, "oc.documento_compras", oc_oc),
    ]

    transito_key_cols = [
        "centro",
        "documento_compras",
        "fecha_documento",
        "material",
        "texto_breve",
        "cantidad_de_pedido",
        "por_entregar_cantidad",
        "valor_neto_de_orden",
        "nombre_del_proveedor",
    ]
    transito_keys = transito[transito_key_cols].astype(str).agg("|".join, axis=1)
    oc_keys = oc[transito_key_cols].astype(str).agg("|".join, axis=1)
    transito_oc_exact = {
        "filas_transito": len(transito),
        "filas_oc": len(oc),
        "filas_exactas_compartidas": len(set(transito_keys) & set(oc_keys)),
        "pct_transito": pct(len(set(transito_keys) & set(oc_keys)), len(set(transito_keys))),
        "pct_oc": pct(len(set(transito_keys) & set(oc_keys)), len(set(oc_keys))),
    }

    inventario_agg = (
        inventario.groupby("material", dropna=False)
        .agg(
            descripcion=("texto_breve_de_material", "first"),
            centro=("centro", "first"),
            stock_libre=("stock_libre_utilizacion", "sum"),
            stock_disponible=("stock_disponible", "sum"),
            bloqueado=("bloqueado", "sum"),
            comprometido_venta=("compr_ped_vta", "sum"),
            entrante_oc=("stock_en_curso_ped", "sum"),
        )
        .reset_index()
    )
    transito_agg = (
        transito.groupby("material", dropna=False)
        .agg(
            transito_cantidad=("por_entregar_cantidad", "sum"),
            transito_valor=("valor_neto_de_orden", "sum"),
            transito_ocs=("documento_compras", "nunique"),
        )
        .reset_index()
    )
    pendientes_agg = (
        pendientes.groupby("cod_holcim", dropna=False)
        .agg(
            pendiente_bodega_fq=("cantidad", "sum"),
            pedidos_bodega_fq=("cod_pedido", "nunique"),
            casos=("validacion_y_aux", "nunique"),
        )
        .reset_index()
        .rename(columns={"cod_holcim": "material"})
    )
    cobertura = (
        pendientes_agg.merge(inventario_agg, on="material", how="left")
        .merge(transito_agg, on="material", how="left")
    )
    cobertura["stock_disponible"] = cobertura["stock_disponible"].fillna(0)
    cobertura["transito_cantidad"] = cobertura["transito_cantidad"].fillna(0)
    cobertura["cobertura_total"] = cobertura["stock_disponible"] + cobertura["transito_cantidad"]
    cobertura["faltante"] = (cobertura["pendiente_bodega_fq"] - cobertura["cobertura_total"]).clip(lower=0)
    cobertura["estado_cobertura"] = cobertura.apply(
        lambda row: "cubierto"
        if row["stock_disponible"] >= row["pendiente_bodega_fq"]
        else "cubierto_con_transito"
        if row["cobertura_total"] >= row["pendiente_bodega_fq"]
        else "faltante",
        axis=1,
    )
    cobertura_resumen = cobertura["estado_cobertura"].value_counts().to_dict()

    proveedores_transito = transito["nombre_del_proveedor"].map(split_proveedor)
    proveedor_resumen = {
        "proveedores_unicos_transito": int(pd.Series([p[0] or p[1] for p in proveedores_transito]).nunique()),
        "ejemplos": [
            {"codigo": codigo, "nombre": nombre}
            for codigo, nombre in list(dict.fromkeys(proveedores_transito.tolist()).keys())[:10]
        ],
    }

    payload = {
        "material_rel": material_rel,
        "oc_rel": oc_rel,
        "transito_oc_exact": transito_oc_exact,
        "cobertura_resumen": cobertura_resumen,
        "cobertura_top_faltantes": cobertura.sort_values("faltante", ascending=False)
        .head(20)
        .fillna("")
        .to_dict(orient="records"),
        "proveedor_resumen": proveedor_resumen,
    }
    OUTPUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2, default=str), encoding="utf-8")

    lines = ["# Relaciones entre nuevas bases", ""]
    lines.append("## Relacion por material")
    lines.append("| Fuente A | Fuente B | Unicos A | Unicos B | Coinciden | % A | % B | Ejemplos |")
    lines.append("|---|---|---:|---:|---:|---:|---:|---|")
    for item in material_rel:
        lines.append(
            f"| {item['a']} | {item['b']} | {item['unicos_a']} | {item['unicos_b']} | {item['coinciden']} | "
            f"{item['pct_a']} | {item['pct_b']} | {', '.join(item['ejemplos'][:8])} |"
        )
    lines.append("")
    lines.append("## Relacion por OC")
    lines.append("| Fuente A | Fuente B | Unicos A | Unicos B | Coinciden | % A | % B | Ejemplos |")
    lines.append("|---|---|---:|---:|---:|---:|---:|---|")
    for item in oc_rel:
        lines.append(
            f"| {item['a']} | {item['b']} | {item['unicos_a']} | {item['unicos_b']} | {item['coinciden']} | "
            f"{item['pct_a']} | {item['pct_b']} | {', '.join(item['ejemplos'][:8])} |"
        )
    lines.append("")
    lines.append("## Transito vs OC pendientes")
    lines.append(json.dumps(transito_oc_exact, ensure_ascii=False, indent=2))
    lines.append("")
    lines.append("## Cobertura de pendientes bodega -> franquiciado")
    lines.append(json.dumps(cobertura_resumen, ensure_ascii=False, indent=2))
    lines.append("")
    lines.append("| Material | Pendiente Bodega-FQ | Stock Disponible | Transito | Faltante | Estado |")
    lines.append("|---|---:|---:|---:|---:|---|")
    for row in payload["cobertura_top_faltantes"][:15]:
        lines.append(
            f"| {texto(row['material'])} | {row['pendiente_bodega_fq']} | {row['stock_disponible']} | "
            f"{row['transito_cantidad']} | {row['faltante']} | {row['estado_cobertura']} |"
        )
    lines.append("")
    lines.append("## Proveedores")
    lines.append(json.dumps(proveedor_resumen, ensure_ascii=False, indent=2))
    OUTPUT_MD.write_text("\n".join(lines), encoding="utf-8")
    print(json.dumps(payload, ensure_ascii=False, indent=2, default=str)[:14000])


if __name__ == "__main__":
    main()
