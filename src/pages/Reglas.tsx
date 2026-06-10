import { useEffect, useState } from 'react'
import { CheckCircle2, Settings, SlidersHorizontal } from 'lucide-react'
import { obtenerReglas } from '../services/reglasService'
import type { ReglaNegocio } from '../types/regla'

export default function Reglas() {
  const [reglas, setReglas] = useState<ReglaNegocio[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const pesoTotal = reglas.reduce((total, regla) => total + regla.peso, 0)

  useEffect(() => {
    obtenerReglas().then(({ data, error }) => {
      if (error || !data || data.length === 0) {
        setReglas([])
        setError(error ? 'No se pudieron cargar las reglas desde Supabase.' : '')
        setCargando(false)
        return
      }

      setReglas(data)
      setError('')
      setCargando(false)
    })
  }, [])

  return (
    <div className="space-y-6">
      <section className="border border-[#d8d2df] bg-white p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#a33e00]">
              <Settings size={16} />
              Motor de decision
            </div>
            <h1 className="text-3xl font-bold text-[#0f0f11]">Reglas de negocio</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              Estas reglas ordenan los pedidos automaticamente para que bodega atienda
              primero lo mas urgente.
            </p>
          </div>

          <div className="border border-[#d8d2df] border-l-4 border-l-[#a33e00] bg-[#f4f2fd] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#4c4546]">
              Configuracion activa
            </p>
            <strong className="font-tabular mt-2 block text-3xl text-[#0f0f11]">
              {reglas.length} reglas
            </strong>
            <p className="mt-1 text-sm text-slate-500">{pesoTotal} puntos de peso total</p>
          </div>
        </div>

        {error && (
          <div className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {cargando && (
          <p className="rounded-lg border border-slate-200 bg-white p-6 text-slate-500">
            Cargando reglas...
          </p>
        )}

        {!cargando && reglas.length === 0 && (
          <p className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500 lg:col-span-2">
            No hay reglas de negocio activas registradas en Supabase.
          </p>
        )}

        {reglas.map((regla) => (
          <article
            key={regla.id}
            className="border border-l-4 border-[#d8d2df] border-l-[#a33e00] bg-white p-5"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <span className="rounded-lg bg-orange-100 p-2 text-orange-700">
                  <SlidersHorizontal size={18} />
                </span>
                <div>
                  <h2 className="font-semibold text-slate-900">{regla.nombre}</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{regla.criterio}</p>
                </div>
              </div>
              <span className="shrink-0 rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-700">
                +{regla.peso}
              </span>
            </div>

            <div className="mt-4 rounded-lg bg-slate-50 px-4 py-3">
              <div className="flex gap-2">
                <CheckCircle2 size={18} className="mt-0.5 text-green-600" />
                <p className="text-sm leading-6 text-slate-700">{regla.efecto}</p>
              </div>
            </div>
          </article>
        ))}
      </section>
    </div>
  )
}
