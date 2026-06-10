import { useId, useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import type { Material } from '../types/material'

const MAX_OPCIONES_VISIBLES = 80

type MaterialSearchSelectProps = {
  label: string
  materiales: Material[]
  value: string
  onChange: (materialId: string) => void
  placeholder?: string
  emptyLabel?: string
  disabled?: boolean
}

export default function MaterialSearchSelect({
  disabled,
  emptyLabel = 'Sin material seleccionado',
  label,
  materiales,
  onChange,
  placeholder = 'Buscar material',
  value,
}: MaterialSearchSelectProps) {
  const listId = useId()
  const [busqueda, setBusqueda] = useState('')
  const [abierto, setAbierto] = useState(false)

  const materialSeleccionado = useMemo(
    () => materiales.find((material) => material.id === value) || null,
    [materiales, value]
  )

  const valorVisible = abierto
    ? busqueda
    : materialSeleccionado
      ? etiquetaMaterial(materialSeleccionado)
      : ''

  const opciones = useMemo(() => {
    const texto = normalizarTexto(busqueda)
    const tokens = texto.split(' ').filter(Boolean)

    const filtrados = tokens.length
      ? materiales.filter((material) =>
          tokens.every((token) => textoMaterial(material).includes(token))
        )
      : materiales

    const visibles = filtrados.slice(0, MAX_OPCIONES_VISIBLES)

    if (
      materialSeleccionado &&
      !visibles.some((material) => material.id === materialSeleccionado.id) &&
      (!tokens.length || tokens.every((token) => textoMaterial(materialSeleccionado).includes(token)))
    ) {
      return [materialSeleccionado, ...visibles.slice(0, MAX_OPCIONES_VISIBLES - 1)]
    }

    return visibles
  }, [busqueda, materialSeleccionado, materiales])

  function cambiarBusqueda(texto: string) {
    setBusqueda(texto)
    setAbierto(true)

    if (value && normalizarTexto(texto) !== normalizarTexto(etiquetaMaterial(materialSeleccionado))) {
      onChange('')
    }
  }

  function seleccionarMaterial(material: Material) {
    onChange(material.id)
    setBusqueda(etiquetaMaterial(material))
    setAbierto(false)
  }

  function limpiarSeleccion() {
    onChange('')
    setBusqueda('')
    setAbierto(true)
  }

  return (
    <label className="relative block text-sm font-medium text-slate-700">
      {label}
      <div className="relative mt-1">
        <Search
          size={17}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
        />
        <input
          role="combobox"
          aria-controls={listId}
          aria-expanded={abierto}
          disabled={disabled}
          value={valorVisible}
          onBlur={() => window.setTimeout(() => setAbierto(false), 120)}
          onChange={(event) => cambiarBusqueda(event.target.value)}
          onFocus={() => {
            setBusqueda(materialSeleccionado ? etiquetaMaterial(materialSeleccionado) : '')
            setAbierto(true)
          }}
          className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-10 pr-10 outline-none focus:ring-2 focus:ring-orange-500 disabled:bg-slate-100 disabled:text-slate-500"
          placeholder={placeholder}
        />
        {value && !disabled && (
          <button
            type="button"
            aria-label="Limpiar material"
            onMouseDown={(event) => event.preventDefault()}
            onClick={limpiarSeleccion}
            className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={15} />
          </button>
        )}
      </div>

      {abierto && !disabled && (
        <div
          id={listId}
          role="listbox"
          className="absolute z-40 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-xl"
        >
          {opciones.map((material) => (
            <button
              key={material.id}
              type="button"
              role="option"
              aria-selected={material.id === value}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => seleccionarMaterial(material)}
              className={`block w-full px-3 py-2 text-left hover:bg-orange-50 ${
                material.id === value ? 'bg-orange-100 text-orange-900' : 'text-slate-700'
              }`}
            >
              <span className="block truncate font-semibold">{material.nombre}</span>
              <span className="mt-0.5 block truncate text-xs text-slate-500">
                {[
                  material.codigo_material,
                  material.categoria,
                  `stock ${material.stock_actual}`,
                  material.unidad_medida,
                ]
                  .filter(Boolean)
                  .join(' - ')}
              </span>
            </button>
          ))}

          {opciones.length === 0 && (
            <div className="px-3 py-3 text-sm text-slate-500">{emptyLabel}</div>
          )}
        </div>
      )}
    </label>
  )
}

function etiquetaMaterial(material: Material | null) {
  if (!material) return ''
  return `${material.nombre} - stock ${material.stock_actual}`
}

function textoMaterial(material: Material) {
  return normalizarTexto(
    [
      material.nombre,
      material.codigo_material || '',
      material.categoria,
      material.unidad_medida,
      String(material.stock_actual),
    ].join(' ')
  )
}

function normalizarTexto(texto?: string | null) {
  return (texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}
