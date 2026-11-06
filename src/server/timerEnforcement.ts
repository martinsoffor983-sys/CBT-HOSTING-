import { Firestore, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { parseLagosExamTime, formatLagosDateTime } from './timeUtils.ts';

export interface ActiveSessionTracker {
  sessionId: string;
  examId: string;
  matricNumber: string;
  fullName: string;
  department: string;
  startedAt: number; // epoch ms
  durationMinutes: number;
  individualExpiresAt: number; // epoch ms from duration
  closingTimeMs?: number | null; // epoch ms from scheduled closing time
  effectiveExpiresAt: number; // epoch ms: strictly Math.min(individualExpiresAt, closingTimeMs || individualExpiresAt)
  answers: Record<string, number>;
  status: 'in_progress' | 'submitted';
  courseCode?: string;
  courseTitle?: string;
  batch?: string;
}

export class TimerEnforcementManager {
  private activeSessions: Map<string, ActiveSessionTracker> = new Map();
  private sweeperInterval: NodeJS.Timeout | null = null;
  private db: Firestore;

  constructor(db: Firestore) {
    this.db = db;
    this.startSweeper(2000); // Check every 2 seconds for instant enforcement
  }

  /**
   * Register or restore a student's live examination session with strict closing time enforcement
   */
  public registerSession(sessionData: {
    sessionId: string;
    examId: string;
    matricNumber: string;
    fullName: string;
    department: string;
    startedAtIso: string;
    durationMinutes: number;
    closingTimeIso?: string | null;
    closingTimeMs?: number | null;
    courseCode?: string;
    courseTitle?: string;
    batch?: string;
    existingAnswers?: Record<string, number>;
  }): ActiveSessionTracker {
    const startedAt = new Date(sessionData.startedAtIso).getTime();
    const individualExpiresAt = startedAt + sessionData.durationMinutes * 60 * 1000;

    let closingTimeMs: number | null = null;
    if (typeof sessionData.closingTimeMs === 'number' && !isNaN(sessionData.closingTimeMs)) {
      closingTimeMs = sessionData.closingTimeMs;
    } else if (sessionData.closingTimeIso) {
      closingTimeMs = parseLagosExamTime(sessionData.closingTimeIso);
    }

    // CRITICAL: Official closing time strictly takes priority over individual timer
    const effectiveExpiresAt =
      closingTimeMs && !isNaN(closingTimeMs)
        ? Math.min(individualExpiresAt, closingTimeMs)
        : individualExpiresAt;

    const tracker: ActiveSessionTracker = {
      sessionId: sessionData.sessionId,
      examId: sessionData.examId,
      matricNumber: sessionData.matricNumber,
      fullName: sessionData.fullName,
      department: sessionData.department,
      startedAt,
      durationMinutes: sessionData.durationMinutes,
      individualExpiresAt,
      closingTimeMs,
      effectiveExpiresAt,
      answers: sessionData.existingAnswers || {},
      status: 'in_progress',
      courseCode: sessionData.courseCode,
      courseTitle: sessionData.courseTitle,
      batch: sessionData.batch || 'Batch A'
    };

    this.activeSessions.set(sessionData.sessionId, tracker);
    const isClosingTimeCapped = closingTimeMs && effectiveExpiresAt === closingTimeMs;
    console.log(
      `[Timer Enforcement] Session registered for ${tracker.matricNumber} (${tracker.fullName}). Duration: ${tracker.durationMinutes}m. Individual expires at: ${new Date(individualExpiresAt).toLocaleTimeString()}. Closing time: ${closingTimeMs ? new Date(closingTimeMs).toLocaleTimeString() : 'None'}. Effective expiry: ${new Date(effectiveExpiresAt).toLocaleTimeString()}${isClosingTimeCapped ? ' [CAPPED BY CLOSING TIME]' : ''}`
    );

    return tracker;
  }

  /**
   * Update student's answers in real time during exam
   */
  public updateAnswers(sessionId: string, answers: Record<string, number>): boolean {
    const session = this.activeSessions.get(sessionId);
    if (!session || session.status !== 'in_progress') return false;

    session.answers = { ...session.answers, ...answers };
    return true;
  }

  /**
   * Get server-authoritative remaining time considering closing time priority
   */
  public getRemainingTime(sessionId: string): {
    remainingSeconds: number;
    isExpired: boolean;
    serverTime: number;
    status: string;
    isClosingTimeEnforced?: boolean;
    closingTimeMs?: number | null;
    effectiveExpiresAt?: number;
  } {
    const session = this.activeSessions.get(sessionId);
    const now = Date.now();

    if (!session) {
      return {
        remainingSeconds: 0,
        isExpired: false,
        serverTime: now,
        status: 'not_found'
      };
    }

    if (session.status === 'submitted') {
      return {
        remainingSeconds: 0,
        isExpired: true,
        serverTime: now,
        status: 'submitted',
        isClosingTimeEnforced: Boolean(session.closingTimeMs && session.effectiveExpiresAt === session.closingTimeMs)
      };
    }

    const remainingMs = session.effectiveExpiresAt - now;
    const remainingSeconds = Math.max(0, Math.floor(remainingMs / 1000));
    const isExpired = remainingMs <= 0 || (session.closingTimeMs != null && now >= session.closingTimeMs);
    const isClosingTimeEnforced = Boolean(
      session.closingTimeMs && session.effectiveExpiresAt === session.closingTimeMs
    );

    return {
      remainingSeconds,
      isExpired,
      serverTime: now,
      status: session.status,
      isClosingTimeEnforced,
      closingTimeMs: session.closingTimeMs,
      effectiveExpiresAt: session.effectiveExpiresAt
    };
  }

  /**
   * Mark session finalized (regular student submission)
   */
  public markCompleted(sessionId: string): void {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.status = 'submitted';
    }
  }

  /**
   * Automatically grades and submits the exam when time expires or official closing time arrives
   */
  public async executeAutoSubmission(session: ActiveSessionTracker): Promise<any> {
    if (session.status === 'submitted') return null;
    session.status = 'submitted';

    const now = Date.now();
    const isClosingTimeTrigger = session.closingTimeMs != null && now >= session.closingTimeMs;

    try {
      console.log(
        `[Timer Enforcement] TRIGGERING AUTO-SUBMISSION for candidate ${session.matricNumber} (${session.fullName}) on exam ${session.examId}. Cause: ${isClosingTimeTrigger ? 'OFFICIAL CLOSING TIME REACHED' : 'INDIVIDUAL DURATION EXPIRED'}`
      );

      // 1. Fetch exam with answer keys
      const examDoc = await getDoc(doc(this.db, 'exams', session.examId));
      if (!examDoc.exists()) {
        console.error(`[Timer Enforcement] Exam ${session.examId} not found during auto-submit.`);
        return null;
      }
      const examData = examDoc.data();

      // 2. Grade saved answers
      const questions = Array.isArray(examData.questions) ? examData.questions : [];
      let score = 0;
      const totalQuestions = questions.length;

      questions.forEach((q: any, idx: number) => {
        const qKey = q.id || `q_${idx}`;
        const candidateChoice = session.answers[qKey];
        if (candidateChoice !== undefined && Number(candidateChoice) === Number(q.correctAnswer)) {
          score += 1;
        }
      });

      const percentage = totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 0;
      const submissionId = `sub_${session.examId}_${session.matricNumber.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`;
      const submissionReceipt = `SUN-CBT-AUTO-${Math.random().toString(36).substring(2, 7).toUpperCase()}-${Date.now().toString().slice(-4)}`;
      const submittedAt = new Date().toISOString();

      // 3. Write submission to Firestore
      await setDoc(doc(this.db, 'submissions', submissionId), {
        examId: session.examId,
        lecturerId: examData.lecturerId || 'central_examiner',
        fullName: session.fullName,
        matricNumber: session.matricNumber,
        department: session.department,
        courseCode: examData.courseCode || session.courseCode || '',
        courseTitle: examData.courseTitle || session.courseTitle || '',
        score,
        totalQuestions,
        percentage,
        submittedAt,
        submissionReceipt,
        batch: session.batch || 'Batch A',
        answers: session.answers,
        submissionType: isClosingTimeTrigger ? 'auto_closing_time' : 'auto_timer'
      });

      // 4. Update session status in Firestore
      try {
        await updateDoc(doc(this.db, 'exam_sessions', session.sessionId), {
          status: 'submitted',
          answers: session.answers,
          autoSubmittedAt: submittedAt,
          autoSubmitReason: isClosingTimeTrigger ? 'closing_time_elapsed' : 'duration_elapsed'
        });
      } catch (err) {
        console.warn('[Timer Enforcement] Could not update session doc:', err);
      }

      console.log(
        `[Timer Enforcement] AUTO-SUBMIT COMPLETED for ${session.matricNumber}. Score: ${score}/${totalQuestions} (${percentage}%). Receipt: ${submissionReceipt}`
      );

      return {
        success: true,
        submissionReceipt,
        submittedAt,
        fullName: session.fullName,
        matricNumber: session.matricNumber,
        courseCode: examData.courseCode,
        courseTitle: examData.courseTitle,
        totalQuestions,
        autoSubmitted: true,
        cause: isClosingTimeTrigger ? 'closing_time' : 'timer'
      };
    } catch (err) {
      console.error('[Timer Enforcement] Error during auto-submission:', err);
      return null;
    }
  }

  /**
   * Background sweeper checking for expired sessions and closing time
   */
  private startSweeper(intervalMs: number): void {
    this.sweeperInterval = setInterval(async () => {
      const now = Date.now();
      for (const [sessionId, session] of this.activeSessions.entries()) {
        if (session.status === 'in_progress') {
          const isExpired =
            now >= session.effectiveExpiresAt ||
            (session.closingTimeMs != null && now >= session.closingTimeMs);

          if (isExpired) {
            console.log(
              `[Timer Enforcement Sweeper] Detected expired timer for session: ${sessionId} (Effective expiry was ${new Date(session.effectiveExpiresAt).toLocaleTimeString()})`
            );
            await this.executeAutoSubmission(session);
          }
        }
      }
    }, intervalMs);
  }

  public getSession(sessionId: string): ActiveSessionTracker | undefined {
    return this.activeSessions.get(sessionId);
  }

  public destroy(): void {
    if (this.sweeperInterval) {
      clearInterval(this.sweeperInterval);
    }
  }
}
