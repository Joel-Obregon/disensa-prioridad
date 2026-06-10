---
name: Monochrome Precision
colors:
  surface: '#fbf8ff'
  surface-dim: '#dad9e3'
  surface-bright: '#fbf8ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f4f2fd'
  surface-container: '#eeedf7'
  surface-container-high: '#e8e7f1'
  surface-container-highest: '#e3e1ec'
  on-surface: '#1a1b22'
  on-surface-variant: '#4c4546'
  inverse-surface: '#2f3038'
  inverse-on-surface: '#f1effa'
  outline: '#7e7576'
  outline-variant: '#cfc4c5'
  surface-tint: '#5e5e5e'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#1b1b1b'
  on-primary-container: '#848484'
  inverse-primary: '#c6c6c6'
  secondary: '#a33e00'
  on-secondary: '#ffffff'
  secondary-container: '#fe6500'
  on-secondary-container: '#541d00'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#1b1b1b'
  on-tertiary-container: '#848484'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e2e2e2'
  primary-fixed-dim: '#c6c6c6'
  on-primary-fixed: '#1b1b1b'
  on-primary-fixed-variant: '#474747'
  secondary-fixed: '#ffdbcd'
  secondary-fixed-dim: '#ffb596'
  on-secondary-fixed: '#360f00'
  on-secondary-fixed-variant: '#7c2e00'
  tertiary-fixed: '#e2e2e2'
  tertiary-fixed-dim: '#c6c6c6'
  on-tertiary-fixed: '#1b1b1b'
  on-tertiary-fixed-variant: '#474747'
  background: '#fbf8ff'
  on-background: '#1a1b22'
  surface-variant: '#e3e1ec'
typography:
  headline-lg:
    fontFamily: Geist
    fontSize: 30px
    fontWeight: '600'
    lineHeight: 36px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Geist
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Geist
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: '0'
  body-lg:
    fontFamily: Geist
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: '0'
  body-md:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: '0'
  body-sm:
    fontFamily: Geist
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0.01em
  label-md:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.05em
  label-sm:
    fontFamily: Geist
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  base: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 40px
  gutter: 16px
  margin: 24px
---

## Brand & Style

This design system is engineered for high-density logistics operations where clarity and speed of information processing are paramount. The personality is authoritative, technical, and strictly functional. 

The aesthetic leverages **Technical Minimalism**—a style that prioritizes content over container. By removing saturated background tints and decorative flourishes, we create a high-contrast environment that reduces cognitive load during complex tasks. The interface should feel like a precision tool: sharp, reliable, and intentionally neutral. Visual interest is derived from meticulous alignment, crisp borders, and the strategic use of a single high-visibility accent color.

## Colors

The palette is strictly monochrome to ensure maximum legibility and professional rigor. 

- **Primary & Neutral:** We utilize a grayscale scale (Zinc/Slate) ranging from pure white to deep black. In Light Mode, the primary interface is white with black text; in Dark Mode, it is black with white text.
- **Accent:** The orange (#ff6600) is reserved exclusively for "Critical Path" actions—primary call-to-actions, urgent status alerts, or branding markers. It must never be used for decorative backgrounds or low-priority elements.
- **Semantic Logic:** Success, Warning, and Error states should rely on high-contrast iconography and the neutral scale where possible, using the accent only when immediate intervention is required.

## Typography

We use **Geist** for its mono-linear technical precision and exceptional readability in data-heavy environments. 

The type hierarchy is designed for density. Headlines use semi-bold weights with slight negative letter-spacing to remain compact and impactful. Body text is optimized for legibility at small sizes, crucial for logistics manifests and tracking tables. Labels utilize uppercase styling and increased letter-spacing to clearly differentiate metadata from primary content.

## Layout & Spacing

This design system employs a **Fixed-Fluid Hybrid Grid** based on a 4px baseline. 

- **Desktop:** 12-column grid with a max-width of 1440px for dashboard views. 16px gutters provide high density without sacrificing optical separation.
- **Tablet:** 8-column grid with 16px margins.
- **Mobile:** 4-column grid with 12px margins.

Spacing is governed by a strict 4px/8px rhythm. For logistics-heavy views (tables, lists), use "Compact" spacing (8px padding); for marketing or landing pages, use "Spacious" spacing (24px+ padding).

## Elevation & Depth

To maintain a clean, professional aesthetic, we avoid soft, diffused shadows. Depth is communicated through **Tonal Layering** and **Refined Outlines**.

1.  **Level 0 (Background):** The base canvas (Pure White or Pure Black).
2.  **Level 1 (Surface):** Subtle gray shifts (Zinc-50 or Zinc-900) define sidebar or header areas.
3.  **Level 2 (Containers):** Cards and modals are defined by 1px solid borders (`#e4e4e7` in Light, `#27272a` in Dark). 
4.  **Interaction:** Hover states should trigger a border color shift or a subtle fill change rather than an elevation increase. Use "Ghost Borders" for secondary elements to keep the interface flat and sharp.

## Shapes

The shape language is **Sharp and Modern**. We use a consistent `0.25rem` (4px) corner radius for most UI elements, including buttons, input fields, and cards. This provides a subtle nod to modern hardware aesthetics while maintaining the "industrial" feel. 

Pill shapes are prohibited except for status badges (Tags) to ensure they are instantly distinguishable from actionable buttons.

## Components

- **Buttons:**
    - *Primary:* Solid Black (Light Mode) or Solid White (Dark Mode). Text is inverted.
    - *Secondary:* 1px border with no fill.
    - *Accent:* Solid Orange (#ff6600), used only for critical path actions.
- **Input Fields:** 1px border. On focus, the border thickens or changes to the primary text color. Backgrounds remain flat.
- **Data Tables:** The core of the logistics experience. Use 1px horizontal dividers only. Remove vertical lines. Row hover should use a subtle neutral tint.
- **Chips/Badges:** Small, uppercase labels with a light neutral background. Status-specific badges (e.g., "Delayed") can use the orange accent text.
- **Checkboxes/Radios:** Sharp 4px corners. Checked state uses the primary text color (Black/White) to maintain the monochrome theme.
- **Cards:** No shadows. Defined by 1px borders and 16px internal padding.