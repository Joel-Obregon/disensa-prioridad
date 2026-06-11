import { Moon, Sun } from 'lucide-react'
import { useTheme } from '../hooks/useTheme'

type ThemeToggleProps = {
  className?: string
}

export default function ThemeToggle({ className = '' }: ThemeToggleProps) {
  const { isDark, toggleTheme } = useTheme()

  return (
    <button
      type="button"
      aria-label={isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
      aria-pressed={isDark}
      onClick={toggleTheme}
      className={`theme-toggle relative inline-flex h-9 w-[74px] items-center rounded-full border p-1 transition-colors duration-300 ${
        isDark
          ? 'border-white/15 bg-[#23191d] shadow-[0_10px_24px_rgba(0,0,0,0.22)]'
          : 'border-[#edd8d2] bg-white shadow-[0_10px_24px_rgba(80,30,16,0.08)]'
      } ${className}`}
    >
      <span className="pointer-events-none absolute inset-0 flex items-center justify-between px-2.5">
        <Sun
          size={16}
          className={isDark ? 'text-[#8f7f7c]' : 'text-[#ed1c24]'}
          strokeWidth={2.4}
        />
        <Moon
          size={15}
          className={isDark ? 'text-white' : 'text-[#a98b82]'}
          strokeWidth={2.4}
        />
      </span>
      <span
        className={`relative z-10 h-7 w-7 rounded-full transition-transform duration-300 ease-out ${
          isDark
            ? 'translate-x-[34px] bg-[#ed1c24]'
            : 'translate-x-0 bg-[#ed1c24]'
        }`}
      />
    </button>
  )
}
