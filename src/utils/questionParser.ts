import { Question } from '../types';

export interface ParsedQuestionDraft {
  id: string;
  originalNumber?: number;
  questionText: string;
  options: [string, string, string, string];
  correctAnswer: number; // 0=A, 1=B, 2=C, 3=D, -1=missing
  explanation?: string;
  errors: string[];
  isValid: boolean;
}

export interface ParseResult {
  questions: ParsedQuestionDraft[];
  totalParsed: number;
  validCount: number;
  errorCount: number;
}

export interface DuplicatePair {
  id: string;
  q1Index: number;
  q2Index: number;
  q1Number: number;
  q2Number: number;
  q1Text: string;
  q2Text: string;
  similarity: number; // 0 - 100%
  type: 'exact' | 'similar';
  dismissed?: boolean;
}

/**
 * Robust Client-Side Parser for examination questions.
 * Handles diverse numbering styles (1., 1), Question 1., Q1.)
 * and answer keys (Answer: A, Correct Answer: A, Ans: A, *A, etc.).
 */
export function parseBulkQuestions(rawText: string): ParseResult {
  const cleanInput = rawText.trim();
  if (!cleanInput) {
    return { questions: [], totalParsed: 0, validCount: 0, errorCount: 0 };
  }

  // Regex to split text into question blocks based on standard question headings
  // Supports: "1.", "1)", "1 -", "Question 1:", "Question 1.", "Q1.", "Q1:"
  const questionSplitter = /(?:^|\n)(?=(?:\s*(?:Question|Q)\s*\d+[\.:\)\-]\s*|\s*\d+[\.:\)\-]\s+))/i;
  
  let rawBlocks = cleanInput.split(questionSplitter).map((b) => b.trim()).filter(Boolean);

  // Fallback: If split produced only 1 block, check if questions are separated by double blank lines
  if (rawBlocks.length <= 1 && cleanInput.includes('\n\n')) {
    const doubleNewlineBlocks = cleanInput.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
    if (doubleNewlineBlocks.length > 1) {
      rawBlocks = doubleNewlineBlocks;
    }
  }

  const parsedList: ParsedQuestionDraft[] = [];

  rawBlocks.forEach((block, index) => {
    const errors: string[] = [];
    const questionNumber = index + 1;

    // Detect question number and remove heading prefix from stem
    let stem = block;
    const headingMatch = stem.match(/^(?:(?:Question|Q)\s*(\d+)[\.:\)\-]\s*|(\d+)[\.:\)\-]\s*)/i);
    let originalNumber = questionNumber;
    if (headingMatch) {
      originalNumber = parseInt(headingMatch[1] || headingMatch[2], 10) || questionNumber;
      stem = stem.replace(/^(?:(?:Question|Q)\s*\d+[\.:\)\-]\s*|\d+[\.:\)\-]\s*)/i, '').trim();
    }

    // Extract options A, B, C, D
    // Handles formats like:
    // A. Option text
    // A) Option text
    // (A) Option text
    // [A] Option text
    // *A. Option text (marked with asterisk)
    const optRegexA = /(?:^|\n)\s*(?:\*?\s*[A\(\[]\s*[\.\)]|\*?\s*A[\.\:\)\-]\s*)\s*([^\n]+)/i;
    const optRegexB = /(?:^|\n)\s*(?:\*?\s*[B\(\[]\s*[\.\)]|\*?\s*B[\.\:\)\-]\s*)\s*([^\n]+)/i;
    const optRegexC = /(?:^|\n)\s*(?:\*?\s*[C\(\[]\s*[\.\)]|\*?\s*C[\.\:\)\-]\s*)\s*([^\n]+)/i;
    const optRegexD = /(?:^|\n)\s*(?:\*?\s*[D\(\[]\s*[\.\)]|\*?\s*D[\.\:\)\-]\s*)\s*([^\n]+)/i;

    const matchA = block.match(optRegexA);
    const matchB = block.match(optRegexB);
    const matchC = block.match(optRegexC);
    const matchD = block.match(optRegexD);

    // Isolate question stem by finding the index of the first option (Option A)
    const firstOptionIdx = block.search(/(?:^|\n)\s*(?:\*?\s*[A\(\[]\s*[\.\)]|\*?\s*A[\.\:\)\-]\s*)/i);
    if (firstOptionIdx > 0) {
      stem = block.substring(0, firstOptionIdx)
        .replace(/^(?:(?:Question|Q)\s*\d+[\.:\)\-]\s*|\d+[\.:\)\-]\s*)/i, '')
        .trim();
    }

    // Determine correct answer
    // Checks for explicit line: "Answer: A", "Correct Answer: B", "Ans: C", "Key: D"
    let correctAnswer = -1;
    const ansKeyMatch = block.match(/(?:Correct\s*Answer|Answer|Ans|Key)\s*[:=\-]?\s*[\(\[]?\s*([A-D])/i);
    if (ansKeyMatch) {
      const letter = ansKeyMatch[1].toUpperCase();
      correctAnswer = letter === 'A' ? 0 : letter === 'B' ? 1 : letter === 'C' ? 2 : 3;
    } else {
      // Check for asterisk or checkbox indicator on options e.g. "*A.", "*B."
      if (/(?:^|\n)\s*\*\s*A[\.\)]/i.test(block) || /(?:^|\n)\s*\[[xX]\]\s*A/i.test(block)) {
        correctAnswer = 0;
      } else if (/(?:^|\n)\s*\*\s*B[\.\)]/i.test(block) || /(?:^|\n)\s*\[[xX]\]\s*B/i.test(block)) {
        correctAnswer = 1;
      } else if (/(?:^|\n)\s*\*\s*C[\.\)]/i.test(block) || /(?:^|\n)\s*\[[xX]\]\s*C/i.test(block)) {
        correctAnswer = 2;
      } else if (/(?:^|\n)\s*\*\s*D[\.\)]/i.test(block) || /(?:^|\n)\s*\[[xX]\]\s*D/i.test(block)) {
        correctAnswer = 3;
      }
    }

    // Clean option texts and remove trailing "Answer: ..." line if captured
    const cleanOpt = (opt: string | undefined): string => {
      if (!opt) return '';
      return opt
        .replace(/(?:Correct\s*Answer|Answer|Ans|Key)\s*[:=\-]?\s*[A-D].*$/i, '')
        .trim();
    };

    const optA = cleanOpt(matchA?.[1]);
    const optB = cleanOpt(matchB?.[1]);
    const optC = cleanOpt(matchC?.[1]);
    const optD = cleanOpt(matchD?.[1]);

    // Validation checks
    if (!stem || stem.length < 3) {
      errors.push('Question text is missing or too short.');
    }
    if (!optA) errors.push('Option A is missing.');
    if (!optB) errors.push('Option B is missing.');
    if (!optC) errors.push('Option C is missing.');
    if (!optD) errors.push('Option D is missing.');

    if (correctAnswer === -1) {
      errors.push('Correct answer not detected (e.g., "Answer: A").');
    }

    parsedList.push({
      id: `q_${Date.now()}_${index}_${Math.random().toString(36).substring(2, 6)}`,
      originalNumber,
      questionText: stem || `Question ${index + 1}`,
      options: [optA || '', optB || '', optC || '', optD || ''],
      correctAnswer: correctAnswer >= 0 ? correctAnswer : 0,
      errors,
      isValid: errors.length === 0
    });
  });

  const validCount = parsedList.filter((q) => q.isValid).length;
  const errorCount = parsedList.length - validCount;

  return {
    questions: parsedList,
    totalParsed: parsedList.length,
    validCount,
    errorCount
  };
}

/**
 * Normalizes text for similarity comparison
 */
function normalizeQuestionText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Compute Jaccard word token similarity between two text strings
 */
function calculateJaccardSimilarity(text1: string, text2: string): number {
  const norm1 = normalizeQuestionText(text1);
  const norm2 = normalizeQuestionText(text2);

  if (norm1 === norm2) return 1.0;

  const words1 = new Set(norm1.split(' ').filter(Boolean));
  const words2 = new Set(norm2.split(' ').filter(Boolean));

  if (words1.size === 0 || words2.size === 0) return 0;

  const intersection = new Set([...words1].filter((x) => words2.has(x)));
  const union = new Set([...words1, ...words2]);

  return intersection.size / union.size;
}

/**
 * Detects exact duplicates and highly similar questions.
 * Threshold is set to 85% similarity.
 */
export function detectDuplicates(questions: Array<{ id: string; questionText: string }>): DuplicatePair[] {
  const pairs: DuplicatePair[] = [];
  const count = questions.length;

  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      const q1 = questions[i];
      const q2 = questions[j];
      const norm1 = normalizeQuestionText(q1.questionText);
      const norm2 = normalizeQuestionText(q2.questionText);

      if (!norm1 || !norm2) continue;

      if (norm1 === norm2) {
        pairs.push({
          id: `dup_${i}_${j}`,
          q1Index: i,
          q2Index: j,
          q1Number: i + 1,
          q2Number: j + 1,
          q1Text: q1.questionText,
          q2Text: q2.questionText,
          similarity: 100,
          type: 'exact'
        });
      } else {
        const similarity = calculateJaccardSimilarity(q1.questionText, q2.questionText);
        if (similarity >= 0.85) {
          pairs.push({
            id: `dup_${i}_${j}`,
            q1Index: i,
            q2Index: j,
            q1Number: i + 1,
            q2Number: j + 1,
            q1Text: q1.questionText,
            q2Text: q2.questionText,
            similarity: Math.round(similarity * 100),
            type: 'similar'
          });
        }
      }
    }
  }

  return pairs;
}

/**
 * Deterministic pseudo-random number generator for seeded shuffling
 */
function seededShuffle<T>(array: T[], seed: number): T[] {
  const result = [...array];
  let currentSeed = seed;

  const nextRandom = () => {
    currentSeed = (currentSeed * 9301 + 49297) % 233280;
    return currentSeed / 233280;
  };

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(nextRandom() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

export interface BatchDefinition {
  name: 'Batch A' | 'Batch B' | 'Batch C' | 'Batch D';
  questionIds: string[];
}

/**
 * Builds 4 consistent, reproducible batches for examination question randomisation.
 */
export function generateExamBatches(questions: Question[]): Record<string, BatchDefinition> {
  const baseIds = questions.map((q) => q.id);

  // Batch A: Master Order
  const batchA: BatchDefinition = {
    name: 'Batch A',
    questionIds: [...baseIds]
  };

  // Batch B: Seed 1024
  const batchB: BatchDefinition = {
    name: 'Batch B',
    questionIds: seededShuffle(baseIds, 1024 + baseIds.length)
  };

  // Batch C: Seed 2048
  const batchC: BatchDefinition = {
    name: 'Batch C',
    questionIds: seededShuffle(baseIds, 2048 + baseIds.length * 3)
  };

  // Batch D: Seed 4096
  const batchD: BatchDefinition = {
    name: 'Batch D',
    questionIds: seededShuffle(baseIds, 4096 + baseIds.length * 7)
  };

  return {
    'Batch A': batchA,
    'Batch B': batchB,
    'Batch C': batchC,
    'Batch D': batchD
  };
}
