# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is a personal portfolio website built with **Astro** and **Tailwind CSS**. The site displays a professional resume/portfolio for Buckley Robinson, a Staff Full-Stack Engineer with 20+ years of experience.

## Essential Commands

```bash
# Development server with hot reload
npm run dev

# Production build
npm run build

# Preview production build locally
npm run preview

# Direct Astro CLI access
npm run astro
```

## Architecture

### Content Strategy

The resume content exists in **two formats**:

1. **TypeScript data object** (`src/data/resume.ts`) - Structured data with profile info, summary, and detailed work experience
2. **Markdown file** (`src/pages/resume.md`) - Prose-style resume content

The site currently uses the **markdown version** via `ResumeMd.astro` component (see `src/pages/index.astro:9`). The older structured approach using `Resume.astro` is commented out but retained.

### Component Structure

- **`Layout.astro`** - Base HTML wrapper with metadata, fonts (Inter), and body wrapper
- **`ResumeMd.astro`** - Current active component that imports markdown content from `src/pages/resume.md`, combines it with profile data from `resume.ts`, and applies custom styling via scoped CSS
- **`Resume.astro`** - Legacy component that renders from structured `resume.ts` data object (currently unused but available)
- **`Welcome.astro`** - Unused component, appears to be from Astro starter template

### Styling Approach

- **Design System**: HSL-based CSS variables in `Layout.astro` for colors (background, foreground, accent, etc.)
- **Typography**: Inter (sans-serif) for body text, Lora (serif) for headings
- **Tailwind CSS** configured via `tailwind.config.mjs` with custom theme extensions and `@tailwindcss/typography` plugin
- **ResumeMd component** uses scoped CSS with `:global()` selectors to style markdown-generated HTML elements
- **Color Palette**: Muted grays with blue accent (#0066cc equivalent) for links, creating a "reads like paper" aesthetic

## Key Files

- **`src/pages/index.astro`** - Main entry point, currently renders `ResumeMd` component
- **`src/pages/resume.md`** - Markdown source for resume content (imported dynamically)
- **`src/data/resume.ts`** - Structured TypeScript data for profile info and contact links
- **`src/components/ResumeMd.astro`** - Active component rendering markdown content with profile header
- **`src/components/Resume.astro`** - Alternative structured data renderer (inactive)
- **`astro.config.mjs`** - Astro configuration with Tailwind integration
- **`tailwind.config.mjs`** - Tailwind configuration with typography plugin

## Content Updates

### To update resume content:

1. **Markdown approach (current)**: Edit `src/pages/resume.md`
2. **Structured approach (alternative)**: Edit `src/data/resume.ts` and uncomment `Resume.astro` in `index.astro`

### To update profile/contact info:

Edit `src/data/resume.ts` - this data is used by both component approaches for the header section.

## Design Notes

- The site uses a **clean, professional aesthetic** with gray tones and blue accent colors
- Profile image is displayed as a circular avatar (128px) in the header
- Markdown content is constrained to 800px width for readability
- Responsive design via Tailwind utilities
