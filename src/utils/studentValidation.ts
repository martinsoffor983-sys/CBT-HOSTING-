/**
 * SUN CBT Student Validation & Normalization Utility
 * Enforces strict university standards for matriculation numbers and candidate details.
 */

export const STRICT_MATRIC_REGEX = /^(?:[0-9]{10}|DE[0-9]{10})$/;

export interface MatricValidationResult {
  isValid: boolean;
  normalized: string;
  format?: 'Format 1' | 'Format 2' | 'Format A' | 'Format B';
  error?: string;
}

/**
 * Validates candidate matriculation number according to exact university formats:
 * - Format 1: Exactly 10 numeric digits (e.g. 2026201120)
 * - Format 2: 'DE' followed by exactly 10 numeric digits (e.g. DE2026201120)
 *
 * Rules:
 * - Equivalent to: ^(?:[0-9]{10}|DE[0-9]{10})$
 * - Automatically converts lowercase letters to uppercase (e.g. de2026201120 -> DE2026201120).
 * - Rejects spaces, hyphens, symbols, slashes, and unsupported prefixes.
 * - Rejects matriculation numbers shorter or longer than the specified formats.
 */
export function validateMatricNumber(rawMatric: string | undefined | null): MatricValidationResult {
  if (!rawMatric || typeof rawMatric !== 'string') {
    return {
      isValid: false,
      normalized: '',
      error: 'Matriculation Number is required.'
    };
  }

  const trimmed = rawMatric.trim();
  if (!trimmed) {
    return {
      isValid: false,
      normalized: '',
      error: 'Matriculation Number cannot be empty.'
    };
  }

  // Convert lowercase letters to uppercase
  const normalized = trimmed.toUpperCase();

  // Reject internal spaces
  if (/\s/.test(normalized)) {
    return {
      isValid: false,
      normalized,
      error: 'Matriculation Number must not contain spaces.'
    };
  }

  // Reject hyphens
  if (/-/.test(normalized)) {
    return {
      isValid: false,
      normalized,
      error: 'Matriculation Number must not contain hyphens.'
    };
  }

  // Reject special characters, slashes, punctuation, symbols
  if (/[^A-Z0-9]/.test(normalized)) {
    return {
      isValid: false,
      normalized,
      error: 'Matriculation Number must not contain symbols, slashes, or special characters.'
    };
  }

  // Check Format 1: exactly 10 numeric digits
  if (/^[0-9]{10}$/.test(normalized)) {
    return {
      isValid: true,
      normalized,
      format: 'Format 1'
    };
  }

  // Check Format 2: 'DE' followed by exactly 10 numeric digits
  if (/^DE[0-9]{10}$/.test(normalized)) {
    return {
      isValid: true,
      normalized,
      format: 'Format 2'
    };
  }

  // Provide helpful, specific feedback on why validation failed
  if (/^DE/i.test(normalized)) {
    const digitsPart = normalized.substring(2);
    if (!/^\d+$/.test(digitsPart)) {
      return {
        isValid: false,
        normalized,
        error: "Direct Entry format (Format 2) requires 'DE' followed by digits only."
      };
    }
    return {
      isValid: false,
      normalized,
      error: `Direct Entry format (Format 2) requires 'DE' followed by exactly 10 digits (got ${digitsPart.length}). Example: DE2026201120.`
    };
  }

  if (/^\d+$/.test(normalized)) {
    return {
      isValid: false,
      normalized,
      error: `Standard format (Format 1) requires exactly 10 digits (got ${normalized.length}). Example: 2026201120.`
    };
  }

  // Unsupported prefix or alphanumeric pattern
  return {
    isValid: false,
    normalized,
    error: 'Invalid Matriculation Number format. Accepted formats: exactly 10 digits (Format 1: e.g. 2026201120) or DE followed by 10 digits (Format 2: e.g. DE2026201120).'
  };
}

/**
 * Automatically capitalizes names and textual personal information:
 * - Trims leading/trailing spaces
 * - Collapses multiple spaces
 * - Capitalizes each word (e.g. "John Doe", "Anatomy")
 * - Preserves legitimate hyphens (e.g. "Mary-Jane", "Abdul-Rahman")
 * - Preserves legitimate apostrophes (e.g. "O'Connor", "D'Angelo")
 */
export function capitalizeProper(text: string | undefined | null): string {
  if (!text || typeof text !== 'string') return '';

  // Normalize curly apostrophes to standard single quotes
  const normalizedApostrophes = text.replace(/[\u2018\u2019]/g, "'");

  // Remove leading and trailing spaces, collapse multiple spaces to a single space
  const collapsed = normalizedApostrophes.trim().replace(/\s+/g, ' ');
  if (!collapsed) return '';

  return collapsed
    .split(' ')
    .map((word) => {
      // Split on hyphens to handle hyphenated names like "Mary-Jane"
      return word
        .split('-')
        .map((part) => {
          // Split on apostrophes to handle names like "O'Connor", "D'Angelo"
          return part
            .split("'")
            .map((subPart) => {
              if (!subPart) return '';
              return subPart.charAt(0).toUpperCase() + subPart.slice(1).toLowerCase();
            })
            .join("'");
        })
        .join('-');
    })
    .join(' ');
}

/**
 * Normalizes candidate record fields consistently:
 * - full name: title-cased
 * - department: title-cased
 * - matric number: normalized & capitalized
 */
export function normalizeStudentData(data: {
  fullName?: string;
  matricNumber?: string;
  department?: string;
  gender?: string;
}) {
  const matricValidation = validateMatricNumber(data.matricNumber);
  return {
    fullName: capitalizeProper(data.fullName),
    matricNumber: matricValidation.normalized,
    department: capitalizeProper(data.department),
    gender: data.gender === 'F' ? 'F' : data.gender === 'M' ? 'M' : (data.gender || 'Not recorded'),
    matricValidation
  };
}

/**
 * Detects duplicate matriculation numbers within a candidate batch / roster
 * before importing or saving.
 */
export function detectBatchMatricDuplicates(
  items: Array<{ matricNumber: string; [key: string]: any }>
): {
  hasDuplicates: boolean;
  duplicateMatrics: string[];
  errorMessage?: string;
} {
  const seen = new Set<string>();
  const duplicateSet = new Set<string>();

  for (const item of items) {
    const raw = item.matricNumber;
    const clean = (raw || '').trim().toUpperCase();
    if (!clean) continue;

    if (seen.has(clean)) {
      duplicateSet.add(clean);
    } else {
      seen.add(clean);
    }
  }

  const duplicateMatrics = Array.from(duplicateSet);
  const hasDuplicates = duplicateMatrics.length > 0;

  return {
    hasDuplicates,
    duplicateMatrics,
    errorMessage: hasDuplicates
      ? `Duplicate matriculation number(s) detected in batch: ${duplicateMatrics.join(', ')}. Each candidate must have a unique matriculation number.`
      : undefined
  };
}

/**
 * Evaluates whether a candidate's answer choice matches the correct answer.
 * Handles standard A-D (indices 0-3), True/False (indices 0=True, 1=False),
 * and string or text comparisons.
 */
export function isAnswerCorrect(
  choice: any,
  correctAnswer: any,
  options?: any[]
): boolean {
  if (choice === undefined || choice === null) return false;
  if (Number(choice) === Number(correctAnswer)) return true;

  const choiceStr = String(choice).trim().toLowerCase();
  const correctIdx = Number(correctAnswer);

  if (options && options[correctIdx] !== undefined) {
    const expectedText = String(options[correctIdx]).trim().toLowerCase();
    if (choiceStr === expectedText) return true;
  }

  if ((choiceStr === 'true' && correctIdx === 0) || (choiceStr === 'false' && correctIdx === 1)) {
    return true;
  }

  return false;
}

export interface CandidateBatchValidationReport {
  valid: boolean;
  summary: {
    total: number;
    validCount: number;
    rejectedCount: number;
  };
  validCandidates: Array<{
    matricNumber: string;
    fullName: string;
    department: string;
    gender: 'M' | 'F' | 'Not recorded';
  }>;
  rejectedEntries: {
    inBatchDuplicates: string[];
    alreadyRegistered: string[];
    invalidFormats: Array<{
      row: number;
      matricNumber: string;
      error: string;
    }>;
  };
  reportMessage: string;
}

/**
 * Validates a batch of candidate records, detects in-batch duplicates,
 * checks against already registered candidates, rejects invalid or duplicate records,
 * and produces an itemized report of rejected entries.
 */
export function validateAndReportCandidateBatch(
  candidates: Array<{ matricNumber: string; fullName?: string; department?: string; gender?: any }>,
  existingMatricsSet?: Set<string>
): CandidateBatchValidationReport {
  const seenInBatch = new Set<string>();
  const inBatchDuplicateSet = new Set<string>();
  const alreadyRegisteredSet = new Set<string>();
  const invalidFormats: Array<{ row: number; matricNumber: string; error: string }> = [];
  const validCandidates: CandidateBatchValidationReport['validCandidates'] = [];

  const existingNormSet = new Set<string>();
  if (existingMatricsSet) {
    existingMatricsSet.forEach(m => existingNormSet.add(m.trim().toUpperCase()));
  }

  candidates.forEach((c, idx) => {
    const rowNum = idx + 1;
    const rawMatric = c.matricNumber || '';
    const matricVal = validateMatricNumber(rawMatric);

    if (!matricVal.isValid) {
      invalidFormats.push({
        row: rowNum,
        matricNumber: rawMatric,
        error: matricVal.error || 'Invalid format'
      });
      return;
    }

    const normMatric = matricVal.normalized;

    // Check if duplicate within this batch
    if (seenInBatch.has(normMatric)) {
      inBatchDuplicateSet.add(normMatric);
      return;
    }
    seenInBatch.add(normMatric);

    // Check if already registered in target examination
    if (existingNormSet.has(normMatric)) {
      alreadyRegisteredSet.add(normMatric);
      return;
    }

    // Valid entry
    const rawSex = c.gender ? String(c.gender).trim().toUpperCase() : '';
    const cleanSex: 'M' | 'F' | 'Not recorded' =
      rawSex === 'M' || rawSex === 'MALE'
        ? 'M'
        : rawSex === 'F' || rawSex === 'FEMALE'
        ? 'F'
        : 'Not recorded';

    validCandidates.push({
      matricNumber: normMatric,
      fullName: capitalizeProper(c.fullName),
      department: capitalizeProper(c.department),
      gender: cleanSex
    });
  });

  const inBatchDuplicates = Array.from(inBatchDuplicateSet);
  const alreadyRegistered = Array.from(alreadyRegisteredSet);
  const rejectedCount = inBatchDuplicates.length + alreadyRegistered.length + invalidFormats.length;
  const total = candidates.length;
  const validCount = validCandidates.length;

  const messages: string[] = [];
  if (validCount > 0 && rejectedCount === 0) {
    messages.push(`All ${validCount} candidate record(s) successfully verified.`);
  } else {
    messages.push(`Batch verification summary: ${validCount} valid, ${rejectedCount} rejected out of ${total} record(s).`);
  }

  if (inBatchDuplicates.length > 0) {
    messages.push(`• In-batch duplicates (${inBatchDuplicates.length}): ${inBatchDuplicates.join(', ')}`);
  }
  if (alreadyRegistered.length > 0) {
    messages.push(`• Already registered in this examination (${alreadyRegistered.length}): ${alreadyRegistered.join(', ')}`);
  }
  if (invalidFormats.length > 0) {
    const sample = invalidFormats.slice(0, 3).map(f => `Row ${f.row} ('${f.matricNumber || 'empty'}'): ${f.error}`).join('; ');
    messages.push(`• Invalid matriculation formats (${invalidFormats.length}): ${sample}${invalidFormats.length > 3 ? ` and ${invalidFormats.length - 3} more` : ''}`);
  }

  return {
    valid: rejectedCount === 0,
    summary: {
      total,
      validCount,
      rejectedCount
    },
    validCandidates,
    rejectedEntries: {
      inBatchDuplicates,
      alreadyRegistered,
      invalidFormats
    },
    reportMessage: messages.join('\n')
  };
}
