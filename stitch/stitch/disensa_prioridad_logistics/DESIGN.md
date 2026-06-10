---
name: Disensa Prioridad Logistics
colors:
  surface: '#fff8f6'
  surface-dim: '#f0d4ca'
  surface-bright: '#fff8f6'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#fff1ec'
  surface-container: '#ffe9e1'
  surface-container-high: '#fee2d8'
  surface-container-highest: '#f8ddd2'
  on-surface: '#261812'
  on-surface-variant: '#5a4136'
  inverse-surface: '#3d2d26'
  inverse-on-surface: '#ffede7'
  outline: '#8e7164'
  outline-variant: '#e3bfb1'
  surface-tint: '#a33e00'
  primary: '#a33e00'
  on-primary: '#ffffff'
  primary-container: '#ff6600'
  on-primary-container: '#561d00'
  inverse-primary: '#ffb596'
  secondary: '#565e74'
  on-secondary: '#ffffff'
  secondary-container: '#dae2fd'
  on-secondary-container: '#5c647a'
  tertiary: '#0062a1'
  on-tertiary: '#ffffff'
  tertiary-container: '#009cfc'
  on-tertiary-container: '#003155'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdbcd'
  primary-fixed-dim: '#ffb596'
  on-primary-fixed: '#360f00'
  on-primary-fixed-variant: '#7c2e00'
  secondary-fixed: '#dae2fd'
  secondary-fixed-dim: '#bec6e0'
  on-secondary-fixed: '#131b2e'
  on-secondary-fixed-variant: '#3f465c'
  tertiary-fixed: '#d0e4ff'
  tertiary-fixed-dim: '#9ccaff'
  on-tertiary-fixed: '#001d35'
  on-tertiary-fixed-variant: '#00497b'
  background: '#fff8f6'
  on-background: '#261812'
  surface-variant: '#f8ddd2'
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
  data-mono:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  sidebar_width: 260px
  container_padding: 24px
  grid_gutter: 16px
  stack_sm: 8px
  stack_md: 16px
  table_cell_padding: 12px 16px
---

## Brand & Style

The design system is engineered for high-utility construction logistics and supply chain management. It prioritizes operational efficiency, data density, and long-session comfort for professional dispatchers and warehouse managers.

The aesthetic follows a **Modern Corporate** approach with a focus on **Information Design**. It eliminates decorative elements in favor of a rigid grid, clear typographic hierarchy, and intentional use of color to signal system status. The interface is professional, reliable, and grounded, evoking the precision required for heavy-duty logistics.

## Colors

This color palette is designed for high legibility and semantic clarity.

- **Primary Action**: Brand Orange (#FF6600) is reserved exclusively for primary calls to action, active navigation states, and essential interaction points.
- **Neutral Scale**: Utilizes a Slate-based system for depth. Slate-900 for headings ensures high contrast, while Slate-50 and Slate-100 provide logical separation for background surfaces and containers without relying on heavy borders.
- **Functional System**: A "Traffic Light" system is used for logistics status tracking. These colors must be used consistently across table row indicators, KPI trend lines, and status badges to allow for rapid visual scanning of supply chain health.

## Typography

The typography system uses **Inter** to ensure maximum legibility at small sizes, which is critical for data-heavy logistics tables.

- **Data Optimization**: For numerical values in tables and KPI cards, use tabular figures (`tnum`) to ensure numbers align vertically for easier comparison.
- **Hierarchy**: Headlines are kept compact (max 24px) to preserve vertical screen real estate. 
- **Labels**: Use `label-md` for table headers and section descriptors to create a clear visual distinction from interactive data points.

## Layout & Spacing

The design system employs a **Fixed Sidebar + Fluid Content** layout model. 

- **Sidebar**: A permanent 260px left-hand navigation allows for quick switching between Logistics, Inventory, and Fleet Management.
- **The Grid**: Uses a 12-column fluid system for the main content area. Content is housed in "Surface" containers that span the necessary column count.
- **Density**: Spacing is tight (8px/16px increments) to minimize scrolling. Table rows should maintain a standard height to maximize the amount of visible data "above the fold."
- **Breakpoints**: 
  - **Desktop (1440px+)**: Full sidebar and multi-column KPI grids.
  - **Tablet (1024px)**: Sidebar collapses to icon-only rail; detail views transition to full-screen overlays.

## Elevation & Depth

To maintain the professional and organized feel, elevation is used sparingly:

- **Flat Base**: The main application background uses Slate-50.
- **Layer 1 (Surfaces)**: Cards, table containers, and white sections use a `1px` border in Slate-200. No shadow is applied to standard containers.
- **Layer 2 (Interactive/Floating)**: Side panels for detail views and dropdown menus use a subtle, diffused shadow (0px 4px 12px rgba(15, 23, 42, 0.08)) to indicate they are positioned above the primary grid.
- **Row Hover**: Interactive table rows should use a Slate-50 background tint on hover rather than an elevation change to maintain the "flat" professional aesthetic.

## Shapes

The design system uses a **Soft** shape language.

- **Standard Elements**: Buttons, input fields, and small cards use a 4px (0.25rem) radius.
- **Containers**: Larger surface areas like data tables and side panels use an 8px (0.5rem) radius to soften the enterprise UI without appearing overly consumer-focused.
- **Indicators**: Status badges and notification dots use a full pill-shape (999px) for immediate recognition.

## Components

- **Data Tables**: The core of the system. Use `body-sm` for row content. Every row must include a 4px vertical status "accent" on the far left to indicate health (Critical/Risk/Healthy).
- **KPI Cards**: Feature a `headline-md` value, a `label-md` title, and a small Sparkline or percentage change indicator in the footer.
- **Action Buttons**: Primary buttons use the Brand Orange background with white text. Secondary buttons use a Slate-100 background or a Slate-200 outline. Icons should be 18px and placed to the left of the label.
- **Input Fields**: Use a Slate-200 border that shifts to Brand Orange on focus. Labels must always be visible (no floating labels) to ensure clarity during fast data entry.
- **Side Panels**: Used for "Deep Dive" views of logistics orders. These slide from the right, covering 40% of the screen, and must include a clear "Close" action and a header with the primary ID (e.g., Order #4592).
- **Status Badges**: Small, high-contrast pills. For "Critical" status, use a Red-100 background with Red-700 text to ensure readability while maintaining the color system.