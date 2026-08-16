/**
 * Utilidades de fecha para el dominio (zona local del usuario).
 */

/** Fecha local a YYYY-MM-DD sin depender de toISOString (que usa UTC). */
export function toDateOnly(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function today(): string {
  return toDateOnly(new Date());
}

export function parseDateOnly(dateOnly: string): Date {
  const [y, m, d] = dateOnly.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

/** Lunes de la semana de `date` (la semana del calendario empieza lunes). */
export function startOfWeek(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  const day = copy.getDay(); // 0 domingo … 6 sábado
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(copy, diff);
}

/** Array de 7 Date (lunes→domingo) de la semana de `date`. */
export function weekDays(date: Date): Date[] {
  const monday = startOfWeek(date);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

const DAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const;

function dayLabelAt(index: number): string {
  return DAY_LABELS[index] ?? '';
}
const MONTH_LABELS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
] as const;

function monthLabel(index: number): string {
  return MONTH_LABELS[index] ?? '';
}

export function dayLabel(date: Date): string {
  return dayLabelAt((date.getDay() + 6) % 7);
}

/** "lunes, 3 de febrero" */
export function longDateLabel(dateOnlyStr: string): string {
  const date = parseDateOnly(dateOnlyStr);
  const weekday = dayLabelAt((date.getDay() + 6) % 7);
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${date.getDate()} de ${monthLabel(date.getMonth())}`;
}

/** "febrero 2026" */
export function monthYearLabel(date: Date): string {
  const label = `${monthLabel(date.getMonth())} ${date.getFullYear()}`;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** "3 feb" */
export function shortDateLabel(date: Date): string {
  const month = monthLabel(date.getMonth()).slice(0, 3);
  return `${date.getDate()} ${month}`;
}
