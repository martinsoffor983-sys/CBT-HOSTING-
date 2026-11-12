import { Firestore, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { parseLagosExamTime, formatLagosDateTime } from './timeUtils.ts';
import { isAnswerCorrect } from '../utils/studentValidation.ts';

export interface ActiveSessionTracker {
  sessionId: string;
  examId: string;
  matricNumber: string;
  fullName: string;
  department: string;
  gender?: string;
  firstStartedAt: number; // epoch ms when the student first started (strictly single attempt)
  durationMinutes: number; // e.g. 5 minutes answering duration
  totalDurationSeconds: number; // e.g. 300 seconds
  remainingSeconds: number; // actual answering seconds remaining (out of 5 minutes)
  maxRecoveryExpiresAt: number; // firstStartedAt + 40 mins (strictly fixed 40-minute recovery window)
  closingTimeMs?: number | null; // official exam scheduled closing time (WAT)
  lastActiveAtMs: number; // epoch ms of last student activity/heartbeat
  isPaused: boolean; // true if timer is paused due to network interruption
  pausedAtMs?: number | null; // epoch ms when paused
  answers: Record<string, number>;
  status: 'in_progress' | 'paused' | 'submitted';
  courseCode?: string;
  courseTitle?: string;
  batch?: string;
  attemptNumber: 1;
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
   * Register or restore a student's live examination session with network recovery & 40-minute window
   */
  public registerSession(sessionData: {
    sessionId: string;
    examId: string;
    matricNumber: string;
    fullName: string;
    department: string;
    gender?: string;
    firstStartedAtIso?: string;
    durationMinutes: number;
    remainingSeconds?: number;
    maxRecoveryExpiresAt?: number;
    closingTimeIso?: string | null;
    closingTimeMs?: number | null;
    isPaused?: boolean;
    courseCode?: string;
    courseTitle?: string;
    batch?: string;
    existingAnswers?: Record<string, number>;
  }): ActiveSessionTracker {
    const now = Date.now();
    const existing = this.activeSessions.get(sessionData.sessionId);

    // If session already in active memory, resume without resetting first start or recovery window
    if (existing) {
      if (sessionData.existingAnswers) {
        existing.answers = { ...existing.answers, ...sessionData.existingAnswers };
      }
      existing.isPaused = false;
      existing.status = 'in_progress';
      existing.lastActiveAtMs = now;
      const recoveryLeft = Math.max(0, Math.floor((existing.maxRecoveryExpiresAt - now) / 1000));
      existing.remainingSeconds = Math.min(existing.remainingSeconds, recoveryLeft);
      return existing;
    }

    const firstStartedAt = sessionData.firstStartedAtIso
      ? new Date(sessionData.firstStartedAtIso).getTime()
      : now;

    let closingTimeMs: number | null = null;
    if (typeof sessionData.closingTimeMs === 'number' && !isNaN(sessionData.closingTimeMs)) {
      closingTimeMs = sessionData.closingTimeMs;
    } else if (sessionData.closingTimeIso) {
      closingTimeMs = parseLagosExamTime(sessionData.closingTimeIso);
    }

    // 40-minute maximum recovery window measured strictly from the first examination start
    const defaultRecoveryExpiresAt = firstStartedAt + 40 * 60 * 1000;
    const maxRecoveryExpiresAt =
      sessionData.maxRecoveryExpiresAt ||
      (closingTimeMs ? Math.min(defaultRecoveryExpiresAt, closingTimeMs) : defaultRecoveryExpiresAt);

    const cleanGender = (g: any): string => {
      if (!g) return 'Not recorded';
      const s = String(g).trim().toUpperCase();
      if (s === 'M' || s === 'MALE') return 'M';
      if (s === 'F' || s === 'FEMALE') return 'F';
      return 'Not recorded';
    };

    const totalDurationSeconds = (sessionData.durationMinutes || 5) * 60;
    let initialRemainingSeconds =
      typeof sessionData.remainingSeconds === 'number'
        ? sessionData.remainingSeconds
        : totalDurationSeconds;

    // Remaining answering time cannot exceed what remains in the 40-minute recovery window
    const recoveryRemainingSec = Math.max(0, Math.floor((maxRecoveryExpiresAt - now) / 1000));
    initialRemainingSeconds = Math.min(initialRemainingSeconds, recoveryRemainingSec);

    const tracker: ActiveSessionTracker = {
      sessionId: sessionData.sessionId,
      examId: sessionData.examId,
      matricNumber: sessionData.matricNumber,
      fullName: sessionData.fullName,
      department: sessionData.department,
      gender: cleanGender(sessionData.gender),
      firstStartedAt,
      durationMinutes: sessionData.durationMinutes || 5,
      totalDurationSeconds,
      remainingSeconds: Math.max(0, initialRemainingSeconds),
      maxRecoveryExpiresAt,
      closingTimeMs,
      lastActiveAtMs: now,
      isPaused: Boolean(sessionData.isPaused),
      pausedAtMs: sessionData.isPaused ? now : null,
      answers: sessionData.existingAnswers || {},
      status: sessionData.isPaused ? 'paused' : 'in_progress',
      courseCode: sessionData.courseCode,
      courseTitle: sessionData.courseTitle,
      batch: sessionData.batch || 'Batch A',
      attemptNumber: 1
    };

    this.activeSessions.set(sessionData.sessionId, tracker);
    console.log(
      `[Timer Enforcement] Session registered for ${tracker.matricNumber} (${tracker.fullName}). Actual Duration: ${tracker.durationMinutes}m (${tracker.remainingSeconds}s remaining). 40-min Recovery expires at: ${new Date(maxRecoveryExpiresAt).toLocaleTimeString()}`
    );

    return tracker;
  }

  /**
   * Pause the 5-minute timer during network interruption, preserving candidate answers
   */
  public pauseSession(sessionId: string): boolean {
    const session = this.activeSessions.get(sessionId);
    if (!session || session.status === 'submitted') return false;

    if (!session.isPaused) {
      session.isPaused = true;
      session.status = 'paused';
      session.pausedAtMs = Date.now();
      console.log(
        `[Timer Enforcement] Timer PAUSED for candidate ${session.matricNumber}. Preserved answering time: ${session.remainingSeconds}s`
      );
    }
    return true;
  }

  /**
   * Resume an examination after network reconnection
   */
  public resumeSession(sessionId: string): ActiveSessionTracker | null {
    const session = this.activeSessions.get(sessionId);
    if (!session || session.status === 'submitted') return null;

    const now = Date.now();
    // Rule: Recovery only allowed within 40 minutes of first examination start
    if (now >= session.maxRecoveryExpiresAt || (session.closingTimeMs != null && now >= session.closingTimeMs)) {
      console.log(
        `[Timer Enforcement] Cannot resume: 40-minute recovery window expired for ${session.matricNumber}`
      );
      return null;
    }

    const recoverySecondsLeft = Math.max(0, Math.floor((session.maxRecoveryExpiresAt - now) / 1000));
    session.remainingSeconds = Math.min(session.remainingSeconds, recoverySecondsLeft);
    session.isPaused = false;
    session.status = 'in_progress';
    session.lastActiveAtMs = now;
    session.pausedAtMs = null;

    console.log(
      `[Timer Enforcement] Timer RESUMED for candidate ${session.matricNumber}. Answering time remaining: ${session.remainingSeconds}s`
    );
    return session;
  }

  /**
   * Update student's answers in real time during exam and refresh activity timestamp
   */
  public updateAnswers(
    sessionId: string,
    answers: Record<string, number>,
    clientRemainingSeconds?: number
  ): boolean {
    const session = this.activeSessions.get(sessionId);
    if (!session || session.status === 'submitted') return false;

    session.answers = { ...session.answers, ...answers };
    session.lastActiveAtMs = Date.now();

    // If client provides countdown value, synchronize monotonically without allowing increases
    if (
      typeof clientRemainingSeconds === 'number' &&
      clientRemainingSeconds >= 0 &&
      !session.isPaused
    ) {
      session.remainingSeconds = Math.min(session.remainingSeconds, clientRemainingSeconds);
    }

    return true;
  }

  /**
   * Get server-authoritative remaining time considering 5-minute duration, pause state, and 40-minute recovery limit
   */
  public getRemainingTime(sessionId: string): {
    remainingSeconds: number;
    recoverySecondsLeft: number;
    maxRecoveryExpiresAt: number;
    isPaused: boolean;
    isExpired: boolean;
    serverTime: number;
    status: string;
    isClosingTimeEnforced?: boolean;
    closingTimeMs?: number | null;
  } {
    const session = this.activeSessions.get(sessionId);
    const now = Date.now();

    if (!session) {
      return {
        remainingSeconds: 0,
        recoverySecondsLeft: 0,
        maxRecoveryExpiresAt: now,
        isPaused: false,
        isExpired: false,
        serverTime: now,
        status: 'not_found'
      };
    }

    if (session.status === 'submitted') {
      return {
        remainingSeconds: 0,
        recoverySecondsLeft: 0,
        maxRecoveryExpiresAt: session.maxRecoveryExpiresAt,
        isPaused: false,
        isExpired: true,
        serverTime: now,
        status: 'submitted',
        isClosingTimeEnforced: Boolean(session.closingTimeMs && now >= session.closingTimeMs)
      };
    }

    const recoverySecondsLeft = Math.max(0, Math.floor((session.maxRecoveryExpiresAt - now) / 1000));

    // If active and not paused, decrement based on elapsed time since last active
    if (session.status === 'in_progress' && !session.isPaused) {
      const elapsedSec = Math.max(0, Math.floor((now - session.lastActiveAtMs) / 1000));
      if (elapsedSec > 0) {
        session.remainingSeconds = Math.max(0, session.remainingSeconds - elapsedSec);
        session.lastActiveAtMs = now;
      }
    }

    // Actual answering time cannot exceed what is left in the 40-minute recovery window
    session.remainingSeconds = Math.min(session.remainingSeconds, recoverySecondsLeft);

    const isExpired =
      session.remainingSeconds <= 0 ||
      now >= session.maxRecoveryExpiresAt ||
      (session.closingTimeMs != null && now >= session.closingTimeMs);

    return {
      remainingSeconds: Math.max(0, session.remainingSeconds),
      recoverySecondsLeft,
      maxRecoveryExpiresAt: session.maxRecoveryExpiresAt,
      isPaused: session.isPaused,
      isExpired,
      serverTime: now,
      status: session.status,
      isClosingTimeEnforced: Boolean(session.closingTimeMs && now >= session.closingTimeMs),
      closingTimeMs: session.closingTimeMs
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
   * Evict all active in-memory sessions for an exam when results are deleted
   */
  public clearSessionsForExam(examId: string): number {
    let evicted = 0;
    for (const [sId, sess] of this.activeSessions.entries()) {
      if (sess.examId === examId) {
        this.activeSessions.delete(sId);
        evicted++;
      }
    }
    return evicted;
  }

  /**
   * Automatically grades and submits the exam when 5 minutes expire or 40-minute recovery window elapses
   */
  public async executeAutoSubmission(session: ActiveSessionTracker): Promise<any> {
    if (session.status === 'submitted') return null;
    session.status = 'submitted';

    const now = Date.now();
    const isRecoveryWindowTrigger = now >= session.maxRecoveryExpiresAt;
    const isClosingTimeTrigger = session.closingTimeMs != null && now >= session.closingTimeMs;

    try {
      console.log(
        `[Timer Enforcement] TRIGGERING AUTO-SUBMISSION for candidate ${session.matricNumber} (${session.fullName}) on exam ${session.examId}. Cause: ${
          isRecoveryWindowTrigger
            ? '40-MINUTE RECOVERY WINDOW ELAPSED'
            : isClosingTimeTrigger
            ? 'OFFICIAL CLOSING TIME REACHED'
            : '5-MINUTE ANSWERING DURATION ELAPSED'
        }`
      );

      // 1. Fetch exam with answer keys
      const examDoc = await getDoc(doc(this.db, 'exams', session.examId));
      if (!examDoc.exists()) {
        console.error(`[Timer Enforcement] Exam ${session.examId} not found during auto-submit.`);
        return null;
      }
      const examData = examDoc.data();

      // 2. Resolve exact question order presented to the candidate for the assigned batch
      const assignedBatch = session.batch || 'Batch A';
      const rawQuestions = Array.isArray(examData.questions) ? examData.questions : [];
      let orderedQuestions = [...rawQuestions];

      if (examData.randomizationEnabled && examData.batches && examData.batches[assignedBatch]) {
        const batchIds = examData.batches[assignedBatch].questionIds;
        if (Array.isArray(batchIds) && batchIds.length > 0) {
          const questionMap = new Map(rawQuestions.map((q: any) => [q.id, q]));
          const batchOrdered: any[] = [];
          batchIds.forEach((id: string) => {
            const q = questionMap.get(id);
            if (q) batchOrdered.push(q);
          });
          rawQuestions.forEach((q: any) => {
            if (!batchIds.includes(q.id)) batchOrdered.push(q);
          });
          orderedQuestions = batchOrdered;
        }
      }

      // Build immutable question snapshot preserving exact text, options, order and correct answers
      const questionSnapshot = orderedQuestions.map((q: any, idx: number) => ({
        id: q.id || `q_${idx}`,
        questionNumber: idx + 1,
        questionText: q.questionText || '',
        options: Array.isArray(q.options) ? q.options : [],
        correctAnswer: typeof q.correctAnswer === 'number' ? q.correctAnswer : 0,
        isTrueFalse: Boolean(
          (q.options && q.options.length === 2 && q.options[0].toLowerCase() === 'true') ||
          q.isTrueFalse
        )
      }));

      let score = 0;
      let attemptedCount = 0;
      let correctCount = 0;
      let incorrectCount = 0;
      let unansweredCount = 0;
      const totalQuestions = orderedQuestions.length;

      orderedQuestions.forEach((q: any, idx: number) => {
        const qKey = q.id || `q_${idx}`;
        const candidateChoice = session.answers[qKey];
        const isUnanswered =
          candidateChoice === undefined ||
          candidateChoice === null ||
          Number(candidateChoice) < 0 ||
          isNaN(Number(candidateChoice));
        if (isUnanswered) {
          unansweredCount += 1;
        } else {
          attemptedCount += 1;
          if (isAnswerCorrect(candidateChoice, q.correctAnswer, q.options || [])) {
            score += 1;
            correctCount += 1;
          } else {
            incorrectCount += 1;
          }
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
        lecturerName: examData.lecturerName || 'Not specified',
        fullName: session.fullName,
        matricNumber: session.matricNumber,
        department: session.department,
        gender:
          session.gender === 'M' ||
          String(session.gender).trim().toUpperCase() === 'M' ||
          String(session.gender).trim().toUpperCase() === 'MALE'
            ? 'M'
            : session.gender === 'F' ||
              String(session.gender).trim().toUpperCase() === 'F' ||
              String(session.gender).trim().toUpperCase() === 'FEMALE'
            ? 'F'
            : 'Not recorded',
        courseCode: examData.courseCode || session.courseCode || '',
        courseTitle: examData.courseTitle || session.courseTitle || '',
        score,
        totalQuestions,
        percentage,
        attemptedCount,
        unansweredCount,
        correctCount,
        incorrectCount,
        submittedAt,
        submissionReceipt,
        batch: assignedBatch,
        answers: session.answers,
        questionSnapshot,
        submissionType: isRecoveryWindowTrigger
          ? 'auto_recovery_window'
          : isClosingTimeTrigger
          ? 'auto_closing_time'
          : 'auto_timer',
        attemptNumber: 1
      });

      // 4. Update session status in Firestore
      try {
        await updateDoc(doc(this.db, 'exam_sessions', session.sessionId), {
          status: 'submitted',
          answers: session.answers,
          submittedAt,
          autoSubmittedAt: submittedAt,
          submissionReceipt,
          autoSubmitReason: isRecoveryWindowTrigger
            ? 'recovery_window_elapsed'
            : isClosingTimeTrigger
            ? 'closing_time_elapsed'
            : 'duration_elapsed'
        });
      } catch (err) {
        console.warn('[Timer Enforcement] Could not update session doc:', err);
      }

      // 5. Automatically update attendance status to signed_out upon successful submission
      try {
        const attDocId = `${session.examId}_${session.matricNumber.replace(/[^a-zA-Z0-9]/g, '_')}`;
        const attDocRef = doc(this.db, 'attendance_records', attDocId);
        const attSnap = await getDoc(attDocRef);

        if (attSnap.exists()) {
          await updateDoc(attDocRef, {
            status: 'signed_out',
            signOutTime: submittedAt,
            submissionStatus: 'submitted',
            submittedAt,
            submissionReceipt,
            updatedAt: submittedAt
          });
        } else {
          await setDoc(attDocRef, {
            examId: session.examId,
            courseCode: examData.courseCode || session.courseCode || '',
            courseTitle: examData.courseTitle || session.courseTitle || '',
            matricNumber: session.matricNumber,
            fullName: session.fullName,
            department: session.department,
            gender:
              session.gender === 'M' ||
              String(session.gender).trim().toUpperCase() === 'M' ||
              String(session.gender).trim().toUpperCase() === 'MALE'
                ? 'M'
                : session.gender === 'F' ||
                  String(session.gender).trim().toUpperCase() === 'F' ||
                  String(session.gender).trim().toUpperCase() === 'FEMALE'
                ? 'F'
                : 'Not recorded',
            signInTime: session.firstStartedAt || submittedAt,
            signOutTime: submittedAt,
            status: 'signed_out',
            submissionStatus: 'submitted',
            submittedAt,
            submissionReceipt,
            createdAt: session.firstStartedAt || submittedAt,
            updatedAt: submittedAt
          });
        }
      } catch (attErr) {
        console.warn('[Timer Enforcement] Could not update attendance to signed_out:', attErr);
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
        lecturerName: examData.lecturerName || 'Not specified',
        totalQuestions,
        autoSubmitted: true,
        cause: isRecoveryWindowTrigger
          ? 'recovery_window'
          : isClosingTimeTrigger
          ? 'closing_time'
          : 'timer'
      };
    } catch (err) {
      console.error('[Timer Enforcement] Error during auto-submission:', err);
      return null;
    }
  }

  /**
   * Background sweeper checking for expired sessions, auto-pause on network silence, and 40-minute limit
   */
  private startSweeper(intervalMs: number): void {
    this.sweeperInterval = setInterval(async () => {
      const now = Date.now();
      for (const [sessionId, session] of this.activeSessions.entries()) {
        if (session.status === 'submitted') continue;

        // 1. Strict 40-minute recovery window or scheduled exam closing time
        const isRecoveryExpired =
          now >= session.maxRecoveryExpiresAt ||
          (session.closingTimeMs != null && now >= session.closingTimeMs);

        if (isRecoveryExpired) {
          console.log(
            `[Timer Sweeper] 40-minute recovery window or closing time elapsed for ${session.matricNumber}. Auto-submitting.`
          );
          await this.executeAutoSubmission(session);
          continue;
        }

        // 2. Active answering duration management
        if (session.status === 'in_progress' && !session.isPaused) {
          // If no heartbeat for > 25 seconds, automatically pause timer to protect candidate against silent network disconnect
          const timeSinceLastActive = now - session.lastActiveAtMs;
          if (timeSinceLastActive > 25000) {
            console.log(
              `[Timer Sweeper] Auto-pausing session for ${session.matricNumber} due to network interruption/inactivity (${Math.round(timeSinceLastActive / 1000)}s silent). Preserving remaining ${session.remainingSeconds}s.`
            );
            session.isPaused = true;
            session.status = 'paused';
            session.pausedAtMs = now;
            continue;
          }

          const elapsedSec = Math.max(0, Math.floor((now - session.lastActiveAtMs) / 1000));
          if (elapsedSec > 0) {
            session.remainingSeconds = Math.max(0, session.remainingSeconds - elapsedSec);
            session.lastActiveAtMs = now;
          }

          if (session.remainingSeconds <= 0) {
            console.log(
              `[Timer Sweeper] 5-minute examination answering duration expired for ${session.matricNumber}. Auto-submitting.`
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
