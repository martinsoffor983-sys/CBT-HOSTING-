/**
 * SUN CBT Central Time Synchronization & Nigeria (Africa/Lagos) Timezone Utility
 * 
 * Sports University of Nigeria (SUN) operates strictly under Nigeria Standard Time
 * (West Africa Time - WAT, UTC+1, with no daylight saving time shifts).
 */

export const LAGOS_TIMEZONE = 'Africa/Lagos';
export const LAGOS_UTC_OFFSET_MS = 1 * 60 * 60 * 1000; // UTC+1 (3600000 ms)

/**
 * Safely parses any exam date/time representation into exact Unix epoch milliseconds (UTC),
 * correctly interpreting local Nigeria (Africa/Lagos) time inputs.
 * 
 * Supports:
 * - HTML5 datetime-local: "YYYY-MM-DDTHH:mm" or "YYYY-MM-DDTHH:mm:ss" -> Interpreted as Africa/Lagos (UTC+1)
 * - Space-delimited strings: "YYYY-MM-DD HH:mm" -> Interpreted as Africa/Lagos (UTC+1)
 * - Date-only strings: "YYYY-MM-DD" -> Interpreted as start of day (00:00:00) in Africa/Lagos
 * - ISO strings with UTC 'Z' or timezone offset (+01:00, etc.) -> Parsed with standard ISO precision
 * - Raw epoch timestamps (numbers or numeric strings)
 */
export function parseLagosExamTime(dateInput?: string | number | null): number | null {
  if (dateInput === null || dateInput === undefined) return null;

  if (typeof dateInput === 'number') {
    return isNaN(dateInput) ? null : dateInput;
  }

  const str = String(dateInput).trim();
  if (!str) return null;

  // 1. Raw numeric timestamp string (e.g. "1793869200000" or "1793869200")
  if (/^\d{10,13}$/.test(str)) {
    const num = Number(str);
    if (isNaN(num)) return null;
    return str.length === 10 ? num * 1000 : num;
  }

  // 2. Already contains explicit ISO UTC 'Z' or explicit timezone offset (+HH:MM, -HH:MM)
  if (/Z$/i.test(str) || /[+-]\d{2}:?\d{2}$/.test(str)) {
    const ms = new Date(str).getTime();
    return isNaN(ms) ? null : ms;
  }

  // 3. Match YYYY-MM-DDTHH:mm, YYYY-MM-DD HH:mm (with optional :ss or .sss)
  const dtMatch = str.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?(?:\.\d+)?$/);
  if (dtMatch) {
    const [, ymd, hm, s] = dtMatch;
    const sec = s ? `:${s}` : ':00';
    // Africa/Lagos is strictly UTC+1 (+01:00) all year round
    const lagosIso = `${ymd}T${hm}${sec}+01:00`;
    const ms = new Date(lagosIso).getTime();
    return isNaN(ms) ? null : ms;
  }

  // 4. Match Date only: YYYY-MM-DD -> Start of day in Lagos
  const dateOnlyMatch = str.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (dateOnlyMatch) {
    const lagosIso = `${dateOnlyMatch[1]}T00:00:00+01:00`;
    const ms = new Date(lagosIso).getTime();
    return isNaN(ms) ? null : ms;
  }

  // Fallback to native Date parser
  const fallback = new Date(str).getTime();
  return isNaN(fallback) ? null : fallback;
}

/**
 * Formats epoch milliseconds into a human-readable string in Africa/Lagos time.
 * e.g. "Nov 5, 2026 at 10:00 AM (WAT)"
 */
export function formatLagosDateTime(msOrDate?: number | Date | string | null): string {
  if (!msOrDate) return 'N/A';
  const ms = parseLagosExamTime(msOrDate as any);
  if (ms === null || isNaN(ms)) return 'N/A';

  const d = new Date(ms);
  const dateFormatted = new Intl.DateTimeFormat('en-US', {
    timeZone: LAGOS_TIMEZONE,
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }).format(d);

  const timeFormatted = new Intl.DateTimeFormat('en-US', {
    timeZone: LAGOS_TIMEZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(d);

  return `${dateFormatted} at ${timeFormatted} (WAT)`;
}

/**
 * Formats date portion only in Africa/Lagos
 */
export function formatLagosDate(msOrDate?: number | Date | string | null): string {
  if (!msOrDate) return 'N/A';
  const ms = parseLagosExamTime(msOrDate as any);
  if (ms === null || isNaN(ms)) return 'N/A';

  return new Intl.DateTimeFormat('en-US', {
    timeZone: LAGOS_TIMEZONE,
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }).format(new Date(ms));
}

/**
 * Formats time portion only in Africa/Lagos (e.g. "10:00 AM")
 */
export function formatLagosTime(msOrDate?: number | Date | string | null): string {
  if (!msOrDate) return 'N/A';
  const ms = parseLagosExamTime(msOrDate as any);
  if (ms === null || isNaN(ms)) return 'N/A';

  return new Intl.DateTimeFormat('en-US', {
    timeZone: LAGOS_TIMEZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(new Date(ms));
}

/**
 * Converts a Date object or current time to HTML5 datetime-local string in Africa/Lagos
 * Format: "YYYY-MM-DDTHH:mm"
 */
export function getLagosDateTimeLocalString(date: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: LAGOS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/**
 * Central access evaluator implementing:
 * RULE 1 — BEFORE OPENING: now < openingTime -> Access denied
 * RULE 2 — AT OPENING: now >= openingTime -> Access allowed
 * RULE 3 — AFTER CLOSING: now >= closingTime -> Access denied
 * 
 * Condition: Current time >= opening time AND Current time < closing time.
 */
export function evaluateExamAccess(
  exam: {
    startDate?: string | number | null;
    endDate?: string | number | null;
    status?: string;
  },
  currentMs: number = Date.now()
): {
  allowed: boolean;
  status: 'published' | 'not_yet_open' | 'closed' | 'unpublished';
  errorMessage?: string;
  openTimeMs: number | null;
  closeTimeMs: number | null;
  opensAtLagos?: string;
  closesAtLagos?: string;
} {
  const openTimeMs = parseLagosExamTime(exam.startDate);
  const closeTimeMs = parseLagosExamTime(exam.endDate);

  if (exam.status && exam.status !== 'published') {
    return {
      allowed: false,
      status: 'unpublished',
      errorMessage: 'This examination is not open for taking.',
      openTimeMs,
      closeTimeMs
    };
  }

  // RULE 3: At exact scheduled closing date and time, access must immediately stop
  if (closeTimeMs !== null && currentMs >= closeTimeMs) {
    return {
      allowed: false,
      status: 'closed',
      errorMessage: 'This examination has ended. Access is no longer available.',
      openTimeMs,
      closeTimeMs,
      closesAtLagos: formatLagosDateTime(closeTimeMs)
    };
  }

  // RULE 1: If current date/time is earlier than scheduled opening, student must not enter
  if (openTimeMs !== null && currentMs < openTimeMs) {
    return {
      allowed: false,
      status: 'not_yet_open',
      errorMessage: `This examination is scheduled to open at ${formatLagosDateTime(openTimeMs)}. Access is not yet available.`,
      openTimeMs,
      closeTimeMs,
      opensAtLagos: formatLagosDateTime(openTimeMs)
    };
  }

  // RULE 2: Current time >= opening time AND Current time < closing time
  return {
    allowed: true,
    status: 'published',
    openTimeMs,
    closeTimeMs,
    opensAtLagos: openTimeMs ? formatLagosDateTime(openTimeMs) : undefined,
    closesAtLagos: closeTimeMs ? formatLagosDateTime(closeTimeMs) : undefined
  };
}
