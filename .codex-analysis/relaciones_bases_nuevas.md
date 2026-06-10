# Relaciones entre nuevas bases

## Relacion por material
| Fuente A | Fuente B | Unicos A | Unicos B | Coinciden | % A | % B | Ejemplos |
|---|---|---:|---:|---:|---:|---:|---|
| pendientes.cod_holcim | inventario.material | 55 | 2618 | 51 | 92.73 | 1.95 | 91000785, 91000786, 91000874, 91000880, 91000899, 91000903, 91000916, 91000945 |
| pendientes.cod_holcim | transito.material | 55 | 1242 | 53 | 96.36 | 4.27 | 91000785, 91000867, 91000874, 91000880, 91000899, 91000903, 91000916, 91000917 |
| pendientes.cod_holcim | oc.material | 55 | 1242 | 53 | 96.36 | 4.27 | 91000785, 91000867, 91000874, 91000880, 91000899, 91000903, 91000916, 91000917 |
| inventario.material | transito.material | 2618 | 1242 | 1128 | 43.09 | 90.82 | 91000761, 91000767, 91000768, 91000769, 91000774, 91000775, 91000776, 91000780 |
| inventario.material | oc.material | 2618 | 1242 | 1128 | 43.09 | 90.82 | 91000761, 91000767, 91000768, 91000769, 91000774, 91000775, 91000776, 91000780 |
| transito.material | oc.material | 1242 | 1242 | 1242 | 100.0 | 100.0 | 91000761, 91000767, 91000768, 91000769, 91000774, 91000775, 91000776, 91000779 |

## Relacion por OC
| Fuente A | Fuente B | Unicos A | Unicos B | Coinciden | % A | % B | Ejemplos |
|---|---|---:|---:|---:|---:|---:|---|
| pendientes.oc | transito.documento_compras | 11 | 161 | 11 | 100.0 | 6.83 | 4583454504, 4583470054, 4583470072, 4583470974, 4583471328, 4583478221, 4583479578, 4583480292 |
| pendientes.oc | oc.documento_compras | 11 | 161 | 11 | 100.0 | 6.83 | 4583454504, 4583470054, 4583470072, 4583470974, 4583471328, 4583478221, 4583479578, 4583480292 |
| transito.documento_compras | oc.documento_compras | 161 | 161 | 161 | 100.0 | 100.0 | 4583409274, 4583411959, 4583412002, 4583412731, 4583418003, 4583418006, 4583419415, 4583419416 |

## Transito vs OC pendientes
{
  "filas_transito": 5000,
  "filas_oc": 5000,
  "filas_exactas_compartidas": 4885,
  "pct_transito": 97.9,
  "pct_oc": 97.9
}

## Cobertura de pendientes bodega -> franquiciado
{
  "cubierto": 41,
  "cubierto_con_transito": 7,
  "faltante": 7
}

| Material | Pendiente Bodega-FQ | Stock Disponible | Transito | Faltante | Estado |
|---|---:|---:|---:|---:|---|
| 91011641 | 25 | 0.0 | 0.0 | 25.0 | faltante |
| 91004042 | 9 | -14.0 | 0.0 | 23.0 | faltante |
| 91003008 | 7 | -4.0 | 0.0 | 11.0 | faltante |
| 91023054 | 3 | -2.0 | 2.0 | 3.0 | faltante |
| 91035000 | 3 | 0.0 | 0.0 | 3.0 | faltante |
| 91013212 | 2 | 0.0 | 0.0 | 2.0 | faltante |
| 91004043 | 1 | 0.0 | 0.0 | 1.0 | faltante |
| 91000916 | 20 | 380.0 | 400.0 | 0.0 | cubierto |
| 91000917 | 20 | 0.0 | 200.0 | 0.0 | cubierto_con_transito |
| 91000945 | 300 | 3925.0 | 6000.0 | 0.0 | cubierto |
| 91000949 | 60 | 8660.0 | 16000.0 | 0.0 | cubierto |
| 91000960 | 400 | 5602.0 | 12000.0 | 0.0 | cubierto |
| 91000970 | 20 | 3351.0 | 5000.0 | 0.0 | cubierto |
| 91001342 | 1 | 679.0 | 0.0 | 0.0 | cubierto |
| 91001377 | 50 | 4927.0 | 15000.0 | 0.0 | cubierto |

## Proveedores
{
  "proveedores_unicos_transito": 29,
  "ejemplos": [
    {
      "codigo": "1603646",
      "nombre": "MEXICHEM ECUADOR S.A."
    },
    {
      "codigo": "1610278",
      "nombre": "PLASTICONSUMO S. A."
    },
    {
      "codigo": "1608724",
      "nombre": "F.V - AREA ANDINA S.A"
    },
    {
      "codigo": "1600118",
      "nombre": "SIKA ECUATORIANA S.A"
    },
    {
      "codigo": "1600448",
      "nombre": "INDURA ECUADOR S.A."
    },
    {
      "codigo": "1610260",
      "nombre": "ANDES CABLES TRADING S.A"
    },
    {
      "codigo": "1610232",
      "nombre": "PESCAEQUIPOS S.A."
    },
    {
      "codigo": "1601791",
      "nombre": "PINTURAS UNIDAS S. A."
    },
    {
      "codigo": "1609746",
      "nombre": "IMPORTADORA DE FERRETERI"
    },
    {
      "codigo": "1603453",
      "nombre": "FERREMUNDO S.A.S."
    }
  ]
}