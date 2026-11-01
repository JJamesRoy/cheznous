import { DomainError } from "./errors";

/**
 * Dates civiles `YYYY-MM-DD` et mois `YYYY-MM`. Toute l'arithmétique passe par des
 * jours « epoch » calculés en UTC (Date.UTC) — jamais par l'heure locale.
 */
export type CivilDate = string;
export type CivilMonth = string;

const MS_PER_DAY = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;
const MIN_YEAR = 1000;
const MAX_YEAR = 9999;

function invalidDate(input: unknown): DomainError {
  return new DomainError("INVALID_DATE", "Date invalide. Utilise le format AAAA-MM-JJ.", { input });
}
function invalidMonth(input: unknown): DomainError {
  return new DomainError("INVALID_MONTH", "Mois invalide. Utilise le format AAAA-MM.", { input });
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}
function dim(y: number, m: number): number {
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

/** Composantes d'une date civile validée. */
export function dateParts(d: string): { year: number; month: number; day: number } {
  const m = typeof d === "string" ? DATE_RE.exec(d) : null;
  if (!m) throw invalidDate(d);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12 || day < 1 || day > dim(year, month)) {
    throw invalidDate(d);
  }
  return { year, month, day };
}

/** Valide une date civile réelle (ex. refuse 2026-02-30) et la retourne. */
export function parseDate(s: string): CivilDate {
  dateParts(s);
  return s;
}

export function isValidDate(s: unknown): s is CivilDate {
  try {
    dateParts(s as string);
    return true;
  } catch {
    return false;
  }
}

function monthParts(month: string): { year: number; month: number } {
  const m = typeof month === "string" ? MONTH_RE.exec(month) : null;
  if (!m) throw invalidMonth(month);
  const year = Number(m[1]);
  const mo = Number(m[2]);
  if (year < MIN_YEAR || year > MAX_YEAR || mo < 1 || mo > 12) throw invalidMonth(month);
  return { year, month: mo };
}

/** Valide un mois `YYYY-MM` et le retourne. */
export function parseMonth(s: string): CivilMonth {
  monthParts(s);
  return s;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

function fmt(year: number, month: number, day: number): CivilDate {
  if (year < MIN_YEAR || year > MAX_YEAR) {
    throw new DomainError("DATE_OUT_OF_RANGE", "Cette date est hors de la plage permise.", { year });
  }
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** Jours depuis 1970-01-01 (UTC). */
export function toEpochDay(d: CivilDate): number {
  const { year, month, day } = dateParts(d);
  return Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

export function fromEpochDay(n: number): CivilDate {
  const t = new Date(n * MS_PER_DAY);
  return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function addDays(d: CivilDate, n: number): CivilDate {
  if (!Number.isSafeInteger(n)) throw new DomainError("INVALID_NUMBER", "Nombre de jours invalide.", { n });
  return fromEpochDay(toEpochDay(d) + n);
}

/** b − a, en jours. */
export function diffDays(a: CivilDate, b: CivilDate): number {
  return toEpochDay(b) - toEpochDay(a);
}

/** 0 = dimanche … 6 = samedi. */
export function dayOfWeek(d: CivilDate): number {
  return (((toEpochDay(d) + 4) % 7) + 7) % 7; // 1970-01-01 était un jeudi
}

/** Nombre de jours du mois (`YYYY-MM` ou une date `YYYY-MM-DD`). */
export function daysInMonth(month: string): number {
  const { year, month: m } = month.length === 10 ? dateParts(month) : monthParts(month);
  return dim(year, m);
}

/**
 * Ajoute n mois en ramenant au dernier jour du mois au besoin. `anchorDay` (1–31)
 * permet de garder le jour d'origine sur une série : 01-31 → 02-28 → 03-31 si on
 * calcule chaque terme depuis l'ancre (pas de dérive).
 */
export function addMonthsClamped(d: CivilDate, n: number, anchorDay?: number): CivilDate {
  if (!Number.isSafeInteger(n)) throw new DomainError("INVALID_NUMBER", "Nombre de mois invalide.", { n });
  const { year, month, day } = dateParts(d);
  const want = anchorDay ?? day;
  if (!Number.isInteger(want) || want < 1 || want > 31) {
    throw new DomainError("INVALID_NUMBER", "Jour d'ancrage invalide.", { anchorDay });
  }
  const idx = year * 12 + (month - 1) + n;
  const y = Math.floor(idx / 12);
  const m = idx - y * 12 + 1;
  return fmt(y, m, Math.min(want, dim(y, m)));
}

export function monthOf(d: CivilDate): CivilMonth {
  dateParts(d);
  return d.slice(0, 7);
}

/** Ajoute n mois à un mois `YYYY-MM`. */
export function addMonths(month: CivilMonth, n: number): CivilMonth {
  return monthOf(addMonthsClamped(`${parseMonth(month)}-01`, n));
}

/** Nombre de mois de a à b (b − a), pour des mois `YYYY-MM`. */
export function diffMonths(a: CivilMonth, b: CivilMonth): number {
  const pa = monthParts(a);
  const pb = monthParts(b);
  return pb.year * 12 + pb.month - (pa.year * 12 + pa.month);
}

/** [1er du mois, 1er du mois suivant). */
export function monthRange(month: CivilMonth): { start: CivilDate; endExclusive: CivilDate } {
  const start = `${parseMonth(month)}-01`;
  return { start, endExclusive: addMonthsClamped(start, 1) };
}

/** Semaine contenant d; weekStart 0 = dimanche, 1 = lundi. */
export function weekRange(d: CivilDate, weekStart = 0): { start: CivilDate; endExclusive: CivilDate } {
  if (!Number.isInteger(weekStart) || weekStart < 0 || weekStart > 6) {
    throw new DomainError("INVALID_NUMBER", "Premier jour de semaine invalide.", { weekStart });
  }
  const back = (dayOfWeek(d) - weekStart + 7) % 7;
  const start = addDays(d, -back);
  return { start, endExclusive: addDays(start, 7) };
}

export function compareDates(a: CivilDate, b: CivilDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
export const minDate = (a: CivilDate, b: CivilDate) => (a <= b ? a : b);
export const maxDate = (a: CivilDate, b: CivilDate) => (a >= b ? a : b);

// ---------------------------------------------------------------------------
// « Aujourd'hui » dans un fuseau

const partsFormatters = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsFormatters.get(timeZone);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      });
    } catch {
      throw new DomainError("INVALID_TIMEZONE", "Fuseau horaire inconnu.", { timeZone });
    }
    partsFormatters.set(timeZone, f);
  }
  return f;
}

export interface NowParts {
  date: CivilDate;
  hour: number;
  minute: number;
  second: number;
}

export function nowPartsIn(timeZone: string, now: Date = new Date()): NowParts {
  const parts = partsFormatter(timeZone).formatToParts(now);
  const get = (t: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === t)?.value);
  return {
    date: fmt(get("year"), get("month"), get("day")),
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

/** Date civile d'aujourd'hui dans le fuseau donné (ex. America/Toronto). */
export function todayIn(timeZone: string, now: Date = new Date()): CivilDate {
  return nowPartsIn(timeZone, now).date;
}

// ---------------------------------------------------------------------------
// Affichage (fr-CA)

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function frFormatter(key: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("fr-CA", { ...opts, timeZone: "UTC" });
    fmtCache.set(key, f);
  }
  return f;
}
const asUtc = (d: CivilDate) => new Date(toEpochDay(d) * MS_PER_DAY);

/** "1 nov. 2026" */
export function formatDateFr(d: CivilDate): string {
  return frFormatter("dmy", { day: "numeric", month: "short", year: "numeric" }).format(asUtc(d));
}
/** "1 nov." */
export function formatDateShortFr(d: CivilDate): string {
  return frFormatter("dm", { day: "numeric", month: "short" }).format(asUtc(d));
}
/** "novembre 2026" */
export function formatMonthFr(month: CivilMonth): string {
  return frFormatter("my", { month: "long", year: "numeric" }).format(asUtc(`${parseMonth(month)}-01`));
}
/** "dimanche 1 novembre" */
export function formatWeekdayFr(d: CivilDate): string {
  return frFormatter("wdm", { weekday: "long", day: "numeric", month: "long" }).format(asUtc(d));
}

/** "aujourd'hui", "demain", "hier", "dans 3 jours", "il y a 2 jours". */
export function relativeDayFr(d: CivilDate, today: CivilDate): string {
  const n = diffDays(today, d);
  if (n === 0) return "aujourd'hui";
  if (n === 1) return "demain";
  if (n === -1) return "hier";
  return n > 0 ? `dans ${n} jours` : `il y a ${-n} jours`;
}
