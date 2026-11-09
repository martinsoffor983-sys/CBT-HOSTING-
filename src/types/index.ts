export interface Question {
  id: string;
  questionText: string;
  options: [string, string, string, string] | string[];
  correctAnswer: number; // 0: A (or True), 1: B (or False), 2: C, 3: D
  explanation?: string;
  _cachedMcqOptions?: string[];
}

export interface RegisteredCandidate {
  matricNumber: string;
  fullName: string;
  department: string;
  gender?: 'M' | 'F' | string;
  registeredAt?: string;
  addedAt?: string;
}

export interface Exam {
  id: string;
  lecturerId: string;
  lecturerEmail: string;
  lecturerName?: string;
  courseCode: string;
  courseTitle: string;
  department: string;
  durationMinutes: number;
  startDate: string;
  endDate: string;
  instructions: string;
  status: 'draft' | 'published' | 'closed';
  questionsCount: number;
  targetQuestionsCount?: number;
  questions?: Question[];
  randomizationEnabled?: boolean;
  batches?: Record<string, { name: string; questionIds: string[] }>;
  registeredCandidates?: RegisteredCandidate[];
  createdAt: string;
  updatedAt: string;
}

export interface PublicExam {
  id: string;
  courseCode: string;
  courseTitle: string;
  department: string;
  lecturerName?: string;
  durationMinutes: number;
  startDate: string;
  endDate: string;
  instructions: string;
  status: 'draft' | 'published' | 'closed';
  questionsCount: number;
  targetQuestionsCount?: number;
  randomizationEnabled?: boolean;
  isClosed?: boolean;
  notYetOpen?: boolean;
  serverTime?: number;
}

export interface SanitizedQuestion {
  id: string;
  questionText: string;
  options: [string, string, string, string] | string[];
}

export interface StudentInfo {
  fullName: string;
  department: string;
  matricNumber: string;
  gender?: 'M' | 'F' | string;
}

export interface QuestionSnapshot {
  id: string;
  questionNumber: number;
  questionText: string;
  options: string[];
  correctAnswer: number;
  isTrueFalse?: boolean;
}

export interface Submission {
  id: string;
  examId: string;
  lecturerId: string;
  lecturerName?: string;
  fullName: string;
  matricNumber: string;
  department: string;
  gender?: string;
  courseCode: string;
  courseTitle?: string;
  score: number;
  totalQuestions: number;
  percentage: number;
  submittedAt: string;
  submissionReceipt: string;
  batch?: string;
  answers?: Record<string, number>;
  questionSnapshot?: QuestionSnapshot[];
  attemptedCount?: number;
  unansweredCount?: number;
  correctCount?: number;
  incorrectCount?: number;
}

export interface ExamSessionData {
  sessionId: string;
  startedAt: string;
  durationMinutes: number;
  remainingSeconds: number;
  questions: SanitizedQuestion[];
  exam: PublicExam;
  batch?: string;
}

export interface AttendanceRecord {
  id: string;
  examId: string;
  courseCode: string;
  courseTitle: string;
  matricNumber: string;
  fullName: string;
  department: string;
  gender: 'M' | 'F' | string;
  signInTime: string | null;
  signedInBy: string | null;
  signOutTime: string | null;
  signedOutBy: string | null;
  status: 'absent' | 'signed_in' | 'signed_out';
  submissionStatus?: 'not_started' | 'in_progress' | 'submitted';
  submittedAt?: string | null;
  submissionReceipt?: string | null;
  notes?: string;
  updatedAt: string;
  createdAt: string;
}

export const SUN_DEPARTMENTS = [
  'All Departments',
  'Human Kinetics & Sports Science',
  'Sports Management',
  'Physiotherapy',
  'Sports Coaching & Performance',
  'Physical & Health Education',
  'Sports Marketing & Journalism',
  'Sports Psychology',
  'Computer Science & Sports Analytics',
  'Nutritional Science & Dietetics',
  'Sports Medicine & Rehabilitation'
] as const;
