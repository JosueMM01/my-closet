# ADR-001: Next.js App Router como base de la app y del backend

## Status
Accepted

## Context
My Closet necesita una arquitectura moderna para una PWA offline-first con
backend ligero (auth, sync, imágenes) y preparación para despliegue en Vercel
futuro. Libre Closet usa NestJS + HTMX; es referencia funcional, no de stack.

## Decision
Usar **Next.js 16 (App Router) + React 19 + TypeScript estricto**, con route
handlers para la API (`src/app/api/**`), componentes cliente para la UI
offline-first y `next start`/Vercel para servir. No se usa Pages Router.

## Consequences
- Un solo framework para UI y API; despliegue trivial en Vercel.
- La UI es mayormente `'use client'` porque lee IndexedDB (no hay datos en
  el servidor para el render inicial).
- Las rutas API corren en runtime `nodejs` (mejor-sqlite3, crypto).
- Se depende del ecosistema Next (fonts, metadata, headers) — aceptado.
