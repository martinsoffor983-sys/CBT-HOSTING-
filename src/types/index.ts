export interface Question {
  id: string;
  questionText: string;
  options: [string, string, string, string];
  correctAnswer: number; // 0: A, 1: B, 2: C, 3: D
  explanation?: string;
}

export interface Exam {
  id: string;
  lecturerId: string;
  lecturerEmail: string;
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
  createdAt: string;
  updatedAt: string;
}

export interface PublicExam {
  id: string;
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
  randomizationEnabled?: boolean;
  isClosed?: boolean;
  notYetOpen?: boolean;
  serverTime?: number;
}

export interface SanitizedQuestion {
  id: string;
  questionText: string;
  options: [string, string, string, string];
}

export interface StudentInfo {
  fullName: string;
  department: string;
  matricNumber: string;
}

export interface Submission {
  id: string;
  examId: string;
  lecturerId: string;
  fullName: string;
  matricNumber: string;
  department: string;
  courseCode: string;
  courseTitle?: string;
  score: number;
  totalQuestions: number;
  percentage: number;
  submittedAt: string;
  submissionReceipt: string;
  batch?: string;
  answers?: Record<string, number>;
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
