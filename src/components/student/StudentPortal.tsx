import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Clock,
  CheckCircle,
  CheckCircle2,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Flag,
  Send,
  ShieldAlert,
  ShieldCheck,
  GraduationCap,
  ArrowRight,
  FileText,
  User,
  Hash,
  Building,
  HelpCircle,
  Copy,
  Check,
  Sparkles,
  Award,
  BarChart3,
  UserCheck
} from 'lucide-react';
import { PublicExam, SanitizedQuestion, StudentInfo } from '../../types';
import { formatLagosDateTime, formatLagosTime, formatLagosDate, parseLagosExamTime } from '../../utils/timeUtils';
import { validateMatricNumber, capitalizeProper, normalizeStudentData } from '../../utils/studentValidation';

interface StudentPortalProps {
  initialExamId?: string | null;
  onExamActiveChange?: (isActive: boolean) => void;
}

export const StudentPortal: React.FC<StudentPortalProps> = ({
  initialExamId,
  onExamActiveChange
}) => {
  // Navigation workflow: 1: 'info' -> 2: 'instructions' -> 3: 'exam' -> 4: 'submitted'
  const [step, setStep] = useState<'select' | 'info' | 'instructions' | 'exam' | 'submitted'>(
    initialExamId ? 'info' : 'select'
  );

  const [examIdInput, setExamIdInput] = useState(initialExamId || '');
  const [exam, setExam] = useState<PublicExam | null>(null);
  const [loadingExam, setLoadingExam] = useState(false);
  const [examError, setExamError] = useState<string | null>(null);

  const [studentInfo, setStudentInfo] = useState<StudentInfo>({
    fullName: '',
    department: '',
    matricNumber: '',
    gender: ''
  });
  const [matricLiveMsg, setMatricLiveMsg] = useState<{ text: string; isError: boolean } | null>(null);

  // Active Exam Session Data
  const [sessionId, setSessionId] = useState<string>('');
  const [questions, setQuestions] = useState<SanitizedQuestion[]>([]);
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [flagged, setFlagged] = useState<Record<string, boolean>>({});
  const currentQuestion = questions[currentQIndex];

  // Countdown Timer
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitModalOpen, setSubmitModalOpen] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Submission Result Receipt (No scores/answers)
  const [submissionReceipt, setSubmissionReceipt] = useState<{
    receipt: string;
    submittedAt: string;
    fullName: string;
    matricNumber: string;
    courseCode: string;
    courseTitle: string;
    lecturerName?: string;
    totalQuestions: number;
  } | null>(null);

  const [availableExams, setAvailableExams] = useState<PublicExam[]>([]);
  const [loadingAvailable, setLoadingAvailable] = useState(false);

  useEffect(() => {
    if (step === 'select') {
      fetchAvailableExams();
    }
  }, [step]);

  // Session Restore & Refresh Resilience Check on Mount
  useEffect(() => {
    const resumeSessionIfActive = async () => {
      try {
        const stored = localStorage.getItem('sun_cbt_session');
        if (!stored) return;
        const parsed = JSON.parse(stored);
        if (!parsed?.sessionId) return;

        // Verify remaining server time
        const res = await fetch(`/api/session-time/${parsed.sessionId}`);
        const data = await res.json();

        // Rule 5: If a student loses network access and returns after closing time, do not allow reopening
        if (data.status === 'not_found' || data.isExpired || data.status === 'closed' || data.status === 'submitted') {
          if (data.isExpired || data.status === 'closed') {
            await fetch('/api/auto-submit', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                sessionId: parsed.sessionId,
                examId: parsed.exam?.id,
                matricNumber: parsed.studentInfo?.matricNumber,
                answers: parsed.answers || {}
              })
            }).catch(() => {});
          }
          localStorage.removeItem('sun_cbt_session');
          onExamActiveChange?.(false);
          setExam(parsed.exam || null);
          setExamError('This examination has ended. Access is no longer available.');
          setStep('select');
          return;
        }

        if (typeof data.remainingSeconds === 'number' && data.remainingSeconds > 0) {
          setSessionId(parsed.sessionId);
          setExam(parsed.exam);
          setStudentInfo(parsed.studentInfo);
          setQuestions(parsed.questions || []);
          setAnswers(parsed.answers || {});
          setFlagged(parsed.flagged || {});
          setRemainingSeconds(data.remainingSeconds);
          setStep('exam');
          onExamActiveChange?.(true);
        }
      } catch (err) {
        console.warn('CBT session resume warning:', err);
      }
    };

    resumeSessionIfActive();
  }, []);

  const fetchAvailableExams = async () => {
    setLoadingAvailable(true);
    try {
      const res = await fetch('/api/exams-public');
      const data = await res.json();
      if (res.ok && Array.isArray(data.exams)) {
        setAvailableExams(data.exams);
      }
    } catch (err) {
      console.warn('Could not fetch public exams:', err);
    } finally {
      setLoadingAvailable(false);
    }
  };

  // Keyboard navigation for exam mode (Left/Right arrows, 1-4 for options)
  useEffect(() => {
    if (step !== 'exam' || !currentQuestion) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is focused on an input
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;

      if (e.key === 'ArrowRight' || e.key === 'n') {
        setCurrentQIndex((prev) => Math.min(questions.length - 1, prev + 1));
      } else if (e.key === 'ArrowLeft' || e.key === 'p') {
        setCurrentQIndex((prev) => Math.max(0, prev - 1));
      } else if (['1', 'a', 'A', 't', 'T'].includes(e.key)) {
        if (currentQuestion.options && currentQuestion.options[0]) {
          const next = { ...answers, [currentQuestion.id]: 0 };
          setAnswers(next);
          saveProgressToServer(next);
        }
      } else if (['2', 'b', 'B', 'f', 'F'].includes(e.key)) {
        if (currentQuestion.options && currentQuestion.options[1]) {
          const next = { ...answers, [currentQuestion.id]: 1 };
          setAnswers(next);
          saveProgressToServer(next);
        }
      } else if (['3', 'c', 'C'].includes(e.key)) {
        if (currentQuestion.options && currentQuestion.options[2]) {
          const next = { ...answers, [currentQuestion.id]: 2 };
          setAnswers(next);
          saveProgressToServer(next);
        }
      } else if (['4', 'd', 'D'].includes(e.key)) {
        if (currentQuestion.options && currentQuestion.options[3]) {
          const next = { ...answers, [currentQuestion.id]: 3 };
          setAnswers(next);
          saveProgressToServer(next);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [step, currentQuestion, questions.length]);

  // Load Exam Meta when examId is provided
  // Auto-resolve Exam ID if provided via URL parameter (?examId=...) on initial load
  useEffect(() => {
    if (initialExamId && initialExamId.trim()) {
      setExamIdInput(initialExamId.trim());
      loadExamInfo(initialExamId.trim());
    }
  }, [initialExamId]);

  const loadExamInfo = async (id: string) => {
    const cleanId = id.trim();
    if (!cleanId) {
      setExamError('Invalid Exam ID. Please check the ID provided by your lecturer.');
      return;
    }
    setLoadingExam(true);
    setExamError(null);
    try {
      const res = await fetch(`/api/exam-public/${encodeURIComponent(cleanId)}`);
      let data: any = null;
      const contentType = res.headers.get('content-type') || '';
      
      if (contentType.includes('application/json')) {
        data = await res.json();
      } else {
        await res.text();
        throw new Error('Invalid Exam ID. Please check the ID provided by your lecturer.');
      }

      if (!res.ok || !data || data.error || !data.courseCode) {
        throw new Error(data?.error || 'Invalid Exam ID. Please check the ID provided by your lecturer.');
      }

      setExam(data);
      setStep('info');
    } catch (err: any) {
      const rawMessage = err?.message || '';
      // Rule 7: Show exact clear message when an examination has closed
      if (rawMessage === 'This examination has ended. Access is no longer available.') {
        setExamError('This examination has ended. Access is no longer available.');
      } else if (rawMessage.includes('is scheduled to open at') || rawMessage.includes('already submitted')) {
        setExamError(rawMessage);
      } else if (
        !rawMessage ||
        rawMessage.includes('Unexpected token') ||
        rawMessage.includes('JSON') ||
        rawMessage.includes('html') ||
        rawMessage.includes('doctype') ||
        rawMessage.includes('not found') ||
        rawMessage.includes('Invalid')
      ) {
        setExamError('Invalid Exam ID. Please check the ID provided by your lecturer.');
      } else {
        setExamError(rawMessage);
      }
      setExam(null);
    } finally {
      setLoadingExam(false);
    }
  };

  // Timer countdown loop
  useEffect(() => {
    if (step === 'exam' && remainingSeconds > 0) {
      timerRef.current = setInterval(() => {
        setRemainingSeconds((prev) => {
          if (prev <= 1) {
            clearInterval(timerRef.current!);
            handleAutoSubmit();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [step]);

  // Synchronize latest answers in ref for accurate background intervals
  const answersRef = useRef(answers);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  // Regular continuous background auto-saving of candidate answers every 7 seconds
  useEffect(() => {
    if (step !== 'exam' || !sessionId || !exam) return;

    const autoSaveInterval = setInterval(() => {
      saveProgressToServer(answersRef.current);
    }, 7000);

    return () => clearInterval(autoSaveInterval);
  }, [step, sessionId, exam]);

  // Server-side Progress Auto-save & Timer Verification
  const saveProgressToServer = async (updatedAnswers: Record<string, number>) => {
    if (!sessionId || !exam) return;

    // Cache locally immediately for zero data loss on refresh
    try {
      const stored = localStorage.getItem('sun_cbt_session');
      if (stored) {
        const parsed = JSON.parse(stored);
        parsed.answers = updatedAnswers;
        localStorage.setItem('sun_cbt_session', JSON.stringify(parsed));
      }
    } catch {}

    try {
      const res = await fetch('/api/save-progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          examId: exam.id,
          matricNumber: studentInfo.matricNumber,
          answers: updatedAnswers
        })
      });
      const data = await res.json();
      if (data.isExpired) {
        try {
          localStorage.removeItem('sun_cbt_session');
        } catch {}
        onExamActiveChange?.(false);

        if (data.submissionReceipt) {
          setSubmissionReceipt({
            receipt: data.submissionReceipt,
            submittedAt: data.submittedAt || new Date().toISOString(),
            fullName: data.fullName || studentInfo.fullName,
            matricNumber: data.matricNumber || studentInfo.matricNumber,
            courseCode: data.courseCode || exam.courseCode,
            courseTitle: data.courseTitle || exam.courseTitle,
            lecturerName: data.lecturerName || exam.lecturerName || 'Not specified',
            totalQuestions: data.totalQuestions || questions.length
          });
        }
        setStep('submitted');
      } else if (typeof data.remainingSeconds === 'number') {
        setRemainingSeconds(data.remainingSeconds);
      }
    } catch (err) {
      console.warn('Progress sync warning:', err);
    }
  };

  // Periodic Server-authoritative Time Synchronization (every 12 seconds)
  useEffect(() => {
    if (step !== 'exam' || !sessionId) return;

    const syncInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/session-time/${sessionId}`);
        const data = await res.json();
        if (data.isExpired) {
          clearInterval(syncInterval);
          handleAutoSubmit();
        } else if (typeof data.remainingSeconds === 'number') {
          setRemainingSeconds(data.remainingSeconds);
        }
      } catch (err) {
        console.warn('Server time sync warning:', err);
      }
    }, 12000); // Sync every 12 seconds

    return () => clearInterval(syncInterval);
  }, [step, sessionId]);

  // Handle student starting exam
  const handleStartExam = async () => {
    if (!exam) return;
    setExamError(null);
    setLoadingExam(true);

    try {
      const res = await fetch('/api/start-exam', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          examId: exam.id,
          fullName: studentInfo.fullName,
          matricNumber: studentInfo.matricNumber,
          department: studentInfo.department,
          gender: studentInfo.gender
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to start examination session.');
      }

      setSessionId(data.sessionId);
      setQuestions(data.questions);
      setRemainingSeconds(data.remainingSeconds);
      const resumedAnswers = data.existingAnswers || {};
      setAnswers(resumedAnswers);
      setStep('exam');
      setCurrentQIndex(0);
      onExamActiveChange?.(true);

      // Save initial session snapshot to localStorage for instant reload resume
      try {
        localStorage.setItem(
          'sun_cbt_session',
          JSON.stringify({
            sessionId: data.sessionId,
            exam: data.exam || exam,
            studentInfo,
            questions: data.questions,
            answers: resumedAnswers,
            flagged: {}
          })
        );
      } catch {}
    } catch (err: any) {
      setExamError(err?.message || 'Failed to start examination.');
    } finally {
      setLoadingExam(false);
    }
  };

  // Auto-submit on server timer expiry
  const handleAutoSubmit = async () => {
    if (!exam || step !== 'exam') return;
    setIsSubmitting(true);
    setSubmitModalOpen(false);

    try {
      const res = await fetch('/api/auto-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          examId: exam.id,
          matricNumber: studentInfo.matricNumber,
          answers
        })
      });

      const data = await res.json();
      try {
        localStorage.removeItem('sun_cbt_session');
      } catch {}
      onExamActiveChange?.(false);

      if (data.submissionReceipt) {
        setSubmissionReceipt({
          receipt: data.submissionReceipt,
          submittedAt: data.submittedAt,
          fullName: data.fullName || studentInfo.fullName,
          matricNumber: data.matricNumber || studentInfo.matricNumber,
          courseCode: data.courseCode || exam.courseCode,
          courseTitle: data.courseTitle || exam.courseTitle,
          lecturerName: data.lecturerName || exam.lecturerName || 'Not specified',
          totalQuestions: data.totalQuestions || questions.length
        });
        setStep('submitted');
      } else {
        await finalizeSubmission();
      }
    } catch (err) {
      console.error('Auto-submit error:', err);
      await finalizeSubmission();
    } finally {
      setIsSubmitting(false);
    }
  };

  // Student submits examination
  const finalizeSubmission = async () => {
    if (!exam) return;
    setIsSubmitting(true);
    setSubmitModalOpen(false);

    try {
      const res = await fetch('/api/submit-exam', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          examId: exam.id,
          sessionId,
          fullName: studentInfo.fullName,
          matricNumber: studentInfo.matricNumber,
          department: studentInfo.department,
          gender: studentInfo.gender,
          answers
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit examination.');
      }

      try {
        localStorage.removeItem('sun_cbt_session');
      } catch {}
      onExamActiveChange?.(false);

      setSubmissionReceipt({
        receipt: data.submissionReceipt,
        submittedAt: data.submittedAt,
        fullName: data.fullName,
        matricNumber: data.matricNumber,
        courseCode: data.courseCode,
        courseTitle: data.courseTitle,
        lecturerName: data.lecturerName || exam.lecturerName || 'Not specified',
        totalQuestions: data.totalQuestions
      });

      setStep('submitted');
    } catch (err: any) {
      alert(`Submission Error: ${err?.message || 'Could not record examination.'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Format seconds to mm:ss
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const answeredCount = Object.keys(answers).length;
  const flaggedCount = Object.values(flagged).filter(Boolean).length;
  const unansweredCount = Math.max(0, questions.length - answeredCount);
  const progressPercent = questions.length > 0 ? Math.round((answeredCount / questions.length) * 100) : 0;

  const jumpToNextUnanswered = () => {
    if (questions.length === 0) return;
    for (let i = currentQIndex + 1; i < questions.length; i++) {
      if (answers[questions[i].id] === undefined) {
        setCurrentQIndex(i);
        return;
      }
    }
    for (let i = 0; i <= currentQIndex; i++) {
      if (answers[questions[i].id] === undefined) {
        setCurrentQIndex(i);
        return;
      }
    }
  };
  if (step === 'select') {
    return (
      <div className="max-w-lg mx-auto my-12 px-4">
        <div className="bg-[#061C13] rounded-3xl shadow-2xl border border-[#D6BF62]/30 overflow-hidden text-center">
          <div className="bg-gradient-to-b from-[#0A2419] to-[#061C13] p-8 border-b border-[#D6BF62]/30">
            <div className="w-20 h-24 mx-auto mb-3 bg-[#030515]/60 rounded-2xl p-2.5 flex items-center justify-center border border-[#D6BF62]/30 shadow-inner">
              <img
                src="/assets/aistudio/IMG-20261104-WA0018_41e50466.jpg"
                alt="SUN Crest"
                className="w-full h-full object-contain"
              />
            </div>
            <h1 className="text-2xl font-black tracking-tight text-[#F0F9F3]">Student Examination Access</h1>
            <p className="text-xs text-[#D6BF62] font-bold uppercase tracking-widest mt-1.5">
              Citadel for Champions
            </p>
          </div>

          <div className="p-6 sm:p-8 space-y-6">
            <p className="text-xs text-[#ADCDBA] leading-relaxed">
              Enter the unique Exam ID provided by your course lecturer or click on any active university examination listed below to begin.
            </p>

            {examError && (
              <div className="p-3.5 bg-[#2A0808] border border-red-500/40 rounded-xl text-red-200 text-xs flex items-center gap-2 text-left">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                <span>{examError}</span>
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (examIdInput.trim()) loadExamInfo(examIdInput.trim());
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[#ADCDBA] mb-1.5 text-left">
                  Exam ID <span className="text-[#D6BF62]">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. exam_sun_1793819880653"
                  value={examIdInput}
                  onChange={(e) => setExamIdInput(e.target.value)}
                  className="w-full px-4 py-3.5 bg-[#0A2419] border border-[#789981]/40 rounded-xl text-sm font-mono font-bold text-[#F0F9F3] placeholder-[#789981]/70 focus:outline-none focus:border-[#D6BF62] focus:ring-1 focus:ring-[#D6BF62] transition"
                />
                <p className="text-[11px] text-[#789981] mt-1 text-left">
                  Enter the unique Exam ID provided by your lecturer.
                </p>
              </div>

              <button
                type="submit"
                disabled={loadingExam || !examIdInput.trim()}
                className="w-full py-3.5 bg-[#0E623B] hover:bg-[#127949] border border-[#D6BF62] text-[#F0F9F3] font-extrabold rounded-xl text-sm shadow-lg hover:shadow-[#0E623B]/30 transition disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer active:scale-95"
              >
                {loadingExam ? (
                  <div className="w-5 h-5 border-2 border-[#F0F9F3] border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <span>Access Examination</span>
                    <ArrowRight className="w-4 h-4 text-[#D6BF62]" />
                  </>
                )}
              </button>
            </form>

            {/* Available Published Examinations List */}
            {availableExams.length > 0 && (
              <div className="pt-6 border-t border-[#789981]/20 text-left space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#ADCDBA]">
                    Active University Examinations ({availableExams.length})
                  </h3>
                  <span className="text-[10px] bg-[#0E623B] border border-[#D6BF62]/40 text-[#D6BF62] font-extrabold px-2 py-0.5 rounded-full">
                    Live
                  </span>
                </div>

                <div className="space-y-2.5 max-h-60 overflow-y-auto">
                  {availableExams.map((pubExam) => (
                    <div
                      key={pubExam.id}
                      onClick={() => {
                        if (pubExam.isClosed) {
                          setExamError('This examination has ended. Access is no longer available.');
                          return;
                        }
                        if (pubExam.notYetOpen) {
                          setExamError('This examination is not open yet.');
                          return;
                        }
                        setExamIdInput(pubExam.id);
                        loadExamInfo(pubExam.id);
                      }}
                      className={`p-3.5 rounded-2xl border ${pubExam.isClosed ? 'border-red-900/40 bg-[#160a0a] opacity-80 cursor-not-allowed' : pubExam.notYetOpen ? 'border-yellow-900/40 bg-[#14120a] cursor-not-allowed' : 'border-[#789981]/30 bg-[#0A2419] hover:border-[#D6BF62] hover:bg-[#0E3324] cursor-pointer'} transition flex items-center justify-between gap-3 group`}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-xs text-[#D6BF62] bg-[#030515] px-2 py-0.5 rounded border border-[#789981]/30">
                            {pubExam.courseCode}
                          </span>
                          <span className="text-[11px] text-[#ADCDBA] font-medium">
                            {pubExam.department}
                          </span>
                        </div>
                        <p className="text-xs font-bold text-[#F0F9F3] mt-1 line-clamp-1 group-hover:text-[#D6BF62] transition">
                          {pubExam.courseTitle}
                        </p>
                        <p className="text-[10px] text-[#ADCDBA] mt-0.5">
                          Lecturer: <strong className="text-[#D6BF62]">{pubExam.lecturerName || 'Not specified'}</strong>
                        </p>
                        <p className="text-[10px] text-[#789981] mt-0.5">
                          {pubExam.durationMinutes} Mins • {pubExam.questionsCount} Questions
                          {pubExam.startDate && pubExam.endDate ? ` • ${formatLagosDate(pubExam.startDate)} (${formatLagosTime(pubExam.startDate)} – ${formatLagosTime(pubExam.endDate)})` : ''}
                        </p>
                      </div>

                      <button
                        type="button"
                        disabled={pubExam.isClosed || pubExam.notYetOpen}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (pubExam.isClosed) {
                            setExamError('This examination has ended. Access is no longer available.');
                            return;
                          }
                          if (pubExam.notYetOpen) {
                            setExamError('This examination is not open yet.');
                            return;
                          }
                          setExamIdInput(pubExam.id);
                          loadExamInfo(pubExam.id);
                        }}
                        className={`px-3.5 py-2 ${pubExam.isClosed ? 'bg-red-950/60 border border-red-500/40 text-red-300' : pubExam.notYetOpen ? 'bg-yellow-950/60 border border-yellow-500/40 text-yellow-300' : 'bg-[#0E623B] hover:bg-[#127949] border border-[#D6BF62]/60 text-[#F0F9F3]'} text-xs font-bold rounded-xl transition shrink-0`}
                      >
                        {pubExam.isClosed ? 'Ended' : pubExam.notYetOpen ? 'Upcoming' : 'Access Examination'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // STAGE 1: Student Registration Form
  // ==========================================
  if (step === 'info') {
    return (
      <div className="max-w-xl mx-auto my-8 px-4">
        <div className="bg-[#061C13] rounded-3xl shadow-2xl border border-[#D6BF62]/30 overflow-hidden">
          {/* Header Banner */}
          <div className="bg-gradient-to-b from-[#0A2419] to-[#061C13] p-6 text-white border-b border-[#D6BF62]/30">
            <div className="flex items-center gap-4">
              <div className="w-14 h-16 bg-[#030515]/60 rounded-xl p-2 flex items-center justify-center border border-[#D6BF62]/30 shadow-inner">
                <img
                  src="/assets/aistudio/IMG-20261104-WA0018_41e50466.jpg"
                  alt="SUN Crest"
                  className="w-full h-full object-contain"
                />
              </div>
              <div>
                <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-[#D6BF62]/20 border border-[#D6BF62]/40 text-[#D6BF62] uppercase tracking-wider">
                  Stage 1: Student Registration
                </span>
                <h2 className="text-xl font-black mt-1 text-[#F0F9F3]">{exam?.courseCode}</h2>
                <p className="text-xs text-[#ADCDBA] line-clamp-1">{exam?.courseTitle}</p>
              </div>
            </div>
          </div>

          <div className="p-6 sm:p-8 space-y-6">
            {/* Stage Indicator */}
            <div className="flex items-center justify-between text-xs font-bold text-[#789981] pb-2 border-b border-[#789981]/20">
              <span className="text-[#D6BF62]">1. Registration Form</span>
              <span>2. Instructions</span>
              <span>3. Examination</span>
              <span>4. Confirmation</span>
            </div>

            <div className="bg-[#0A2419] border border-[#789981]/30 rounded-2xl p-4 text-xs text-[#ADCDBA] space-y-1">
              <p className="font-bold text-sm text-[#F0F9F3]">Candidate Information Verification</p>
              <p>
                Please verify the course details and enter your official student credentials. No password or student account is required.
              </p>
            </div>

            {examError && (
              <div className="p-3.5 bg-[#2A0808] border border-red-500/40 rounded-xl text-red-200 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                <span>{examError}</span>
              </div>
            )}

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  !studentInfo.fullName.trim() ||
                  !studentInfo.matricNumber.trim() ||
                  !studentInfo.department.trim() ||
                  !studentInfo.gender
                ) {
                  setExamError('Please fill in all compulsory fields including your gender (M/F).');
                  return;
                }

                // Strict Matriculation Number Validation (Format 1: 10 digits; Format 2: DE + 10 digits)
                const matricCheck = validateMatricNumber(studentInfo.matricNumber);
                if (!matricCheck.isValid) {
                  setExamError(matricCheck.error || 'Invalid Matriculation Number format.');
                  setMatricLiveMsg({ text: matricCheck.error || 'Invalid Matriculation Number format.', isError: true });
                  return;
                }

                // Automatic Capitalization & Normalization of student details
                const normalizedFullName = capitalizeProper(studentInfo.fullName);
                const normalizedDepartment = capitalizeProper(studentInfo.department);
                const normalizedInfo = {
                  ...studentInfo,
                  fullName: normalizedFullName,
                  matricNumber: matricCheck.normalized,
                  department: normalizedDepartment
                };
                setStudentInfo(normalizedInfo);

                setLoadingExam(true);
                setExamError(null);
                try {
                  const vRes = await fetch('/api/verify-candidate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      examId: exam?.id,
                      matricNumber: matricCheck.normalized,
                      fullName: normalizedFullName,
                      department: normalizedDepartment,
                      gender: studentInfo.gender
                    })
                  });
                  const vData = await vRes.json();
                  if (!vRes.ok) {
                    throw new Error(vData.error || 'Failed to verify candidate eligibility.');
                  }
                  setStep('instructions');
                } catch (vErr: any) {
                  setExamError(vErr?.message || 'Verification failed. Please contact your lecturer.');
                } finally {
                  setLoadingExam(false);
                }
              }}
              className="space-y-4"
            >
              {/* Course Information & Publication Details Display Fields */}
              <div className="p-4 bg-[#0A2419] rounded-2xl border border-[#789981]/30 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[#789981] mb-0.5">
                      Course Code
                    </label>
                    <p className="text-sm font-black font-mono text-[#D6BF62]">{exam?.courseCode}</p>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[#789981] mb-0.5">
                      Course Title
                    </label>
                    <p className="text-xs font-bold text-[#F0F9F3] line-clamp-2">{exam?.courseTitle}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-[#789981]/20 text-xs">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[#789981] mb-0.5">
                      Course Lecturer
                    </label>
                    <p className="text-xs font-bold text-[#D6BF62]">{exam?.lecturerName || 'Not specified'}</p>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[#789981] mb-0.5">
                      Department
                    </label>
                    <p className="text-xs font-medium text-[#ADCDBA]">{exam?.department}</p>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[#789981] mb-0.5">
                      Duration
                    </label>
                    <p className="text-xs font-bold text-[#F0F9F3]">{exam?.durationMinutes} Minutes</p>
                  </div>
                </div>

                {exam?.startDate && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-[#789981]/20 text-xs">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-[#789981] mb-0.5">
                        Examination Date
                      </label>
                      <p className="text-xs font-bold text-[#F0F9F3]">{formatLagosDate(exam.startDate)}</p>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-[#789981] mb-0.5">
                        Starting Time
                      </label>
                      <p className="text-xs font-bold text-[#10B981]">{formatLagosTime(exam.startDate)} (WAT)</p>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-[#789981] mb-0.5">
                        Closing Time
                      </label>
                      <p className="text-xs font-bold text-amber-400">{formatLagosTime(exam.endDate)} (WAT)</p>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[#ADCDBA] mb-1.5 flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-[#789981]" />
                  Full Name <span className="text-[#D6BF62]">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. John Doe"
                  value={studentInfo.fullName}
                  onChange={(e) => setStudentInfo({ ...studentInfo, fullName: e.target.value })}
                  onBlur={(e) => setStudentInfo({ ...studentInfo, fullName: capitalizeProper(e.target.value) })}
                  className="w-full px-4 py-2.5 bg-[#0A2419] border border-[#789981]/40 rounded-xl text-sm font-medium text-[#F0F9F3] placeholder-[#789981]/70 focus:outline-none focus:border-[#D6BF62] focus:ring-1 focus:ring-[#D6BF62] transition"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-bold uppercase tracking-wider text-[#ADCDBA] flex items-center gap-1.5">
                    <Hash className="w-3.5 h-3.5 text-[#789981]" />
                    Matriculation Number <span className="text-[#D6BF62]">*</span>
                  </label>
                  {studentInfo.matricNumber.trim() && (
                    <span className="text-[10px] font-mono text-[#789981]">
                      {studentInfo.matricNumber.length} chars
                    </span>
                  )}
                </div>
                <input
                  type="text"
                  required
                  placeholder="e.g. 2026201120 or DE2026201120"
                  value={studentInfo.matricNumber}
                  onChange={(e) => {
                    const upper = e.target.value.toUpperCase();
                    setStudentInfo(prev => ({ ...prev, matricNumber: upper }));

                    if (!upper.trim()) {
                      setMatricLiveMsg(null);
                      setExamError(null);
                      return;
                    }

                    if (/\s/.test(upper)) {
                      setMatricLiveMsg({ text: 'Matriculation number must not contain spaces.', isError: true });
                      return;
                    }

                    if (/-/.test(upper)) {
                      setMatricLiveMsg({ text: 'Matriculation number must not contain hyphens.', isError: true });
                      return;
                    }

                    if (/[^A-Z0-9]/.test(upper)) {
                      setMatricLiveMsg({ text: 'Symbols, slashes and special characters are not permitted.', isError: true });
                      return;
                    }

                    if (/^[A-Z]/.test(upper)) {
                      if (!upper.startsWith('DE')) {
                        setMatricLiveMsg({ text: "Unsupported prefix. Only 'DE' (Direct Entry) is accepted as an alphabetic prefix.", isError: true });
                        return;
                      }
                      const digits = upper.substring(2);
                      if (digits && !/^\d+$/.test(digits)) {
                        setMatricLiveMsg({ text: "'DE' must be followed by numeric digits only.", isError: true });
                        return;
                      }
                      if (digits.length > 10) {
                        setMatricLiveMsg({ text: `Too long: Format 2 requires DE followed by exactly 10 digits (currently ${digits.length}).`, isError: true });
                        return;
                      }
                      if (digits.length === 10) {
                        setMatricLiveMsg({ text: '✓ Format 2 accepted (Direct Entry DE + 10 digits)', isError: false });
                        setExamError(null);
                        return;
                      }
                      setMatricLiveMsg({ text: `Format 2 (Direct Entry): Requires 10 digits after DE (currently ${digits.length}/10).`, isError: true });
                      return;
                    }

                    if (/^\d+$/.test(upper)) {
                      if (upper.length > 10) {
                        setMatricLiveMsg({ text: `Too long: Format 1 requires exactly 10 digits (currently ${upper.length}).`, isError: true });
                        return;
                      }
                      if (upper.length === 10) {
                        setMatricLiveMsg({ text: '✓ Format 1 accepted (10 numeric digits)', isError: false });
                        setExamError(null);
                        return;
                      }
                      setMatricLiveMsg({ text: `Format 1: Requires exactly 10 digits (currently ${upper.length}/10).`, isError: true });
                      return;
                    }

                    const check = validateMatricNumber(upper);
                    if (!check.isValid) {
                      setMatricLiveMsg({ text: check.error || 'Invalid matriculation format.', isError: true });
                    } else {
                      setMatricLiveMsg({ text: `✓ ${check.format} accepted`, isError: false });
                      setExamError(null);
                    }
                  }}
                  onBlur={() => {
                    if (studentInfo.matricNumber.trim()) {
                      const v = validateMatricNumber(studentInfo.matricNumber);
                      if (!v.isValid) {
                        setMatricLiveMsg({ text: v.error || 'Invalid matriculation format.', isError: true });
                        setExamError(v.error || 'Invalid matriculation number format.');
                      } else {
                        setMatricLiveMsg({ text: `✓ ${v.format} accepted`, isError: false });
                        setExamError(null);
                        setStudentInfo(prev => ({ ...prev, matricNumber: v.normalized }));
                      }
                    }
                  }}
                  className={`w-full px-4 py-2.5 bg-[#0A2419] border rounded-xl text-sm font-mono font-bold text-[#D6BF62] placeholder-[#789981]/70 focus:outline-none transition ${
                    matricLiveMsg?.isError
                      ? 'border-red-500/60 focus:border-red-400 focus:ring-1 focus:ring-red-400'
                      : matricLiveMsg && !matricLiveMsg.isError
                      ? 'border-emerald-500/60 focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400'
                      : 'border-[#789981]/40 focus:border-[#D6BF62] focus:ring-1 focus:ring-[#D6BF62]'
                  }`}
                />

                {matricLiveMsg && (
                  <p className={`text-[11px] font-semibold mt-1.5 flex items-center gap-1.5 ${
                    matricLiveMsg.isError ? 'text-red-400' : 'text-emerald-400'
                  }`}>
                    {matricLiveMsg.isError ? (
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    )}
                    <span>{matricLiveMsg.text}</span>
                  </p>
                )}

                <p className="text-[10px] text-[#789981] mt-1">
                  Accepted formats: 10 digits (Format 1: e.g. 2026201120) or Direct Entry DE + 10 digits (Format 2: e.g. DE2026201120).
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[#ADCDBA] mb-1.5 flex items-center gap-1.5">
                  <Building className="w-3.5 h-3.5 text-[#789981]" />
                  Department <span className="text-[#D6BF62]">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Anatomy or Nursing"
                  value={studentInfo.department}
                  onChange={(e) => setStudentInfo({ ...studentInfo, department: e.target.value })}
                  onBlur={(e) => setStudentInfo({ ...studentInfo, department: capitalizeProper(e.target.value) })}
                  className="w-full px-4 py-2.5 bg-[#0A2419] border border-[#789981]/40 rounded-xl text-sm font-medium text-[#F0F9F3] placeholder-[#789981]/70 focus:outline-none focus:border-[#D6BF62] focus:ring-1 focus:ring-[#D6BF62] transition"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[#ADCDBA] mb-1.5 flex items-center gap-1.5">
                  <UserCheck className="w-3.5 h-3.5 text-[#789981]" />
                  Gender <span className="text-[#D6BF62]">*</span>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label
                    onClick={() => setStudentInfo({ ...studentInfo, gender: 'M' })}
                    className={`flex items-center justify-center gap-2.5 py-2.5 px-4 rounded-xl text-xs font-bold border cursor-pointer transition select-none ${
                      studentInfo.gender === 'M'
                        ? 'bg-[#0E623B] border-[#D6BF62] text-[#F0F9F3] shadow-md shadow-[#0E623B]/30'
                        : 'bg-[#0A2419] border-[#789981]/40 text-[#ADCDBA] hover:border-[#D6BF62]/50 hover:text-[#F0F9F3]'
                    }`}
                  >
                    <input
                      type="radio"
                      name="gender"
                      value="M"
                      checked={studentInfo.gender === 'M'}
                      onChange={() => setStudentInfo({ ...studentInfo, gender: 'M' })}
                      className="sr-only"
                      required
                    />
                    <span
                      className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                        studentInfo.gender === 'M'
                          ? 'border-[#D6BF62] bg-[#D6BF62]'
                          : 'border-[#789981]'
                      }`}
                    >
                      {studentInfo.gender === 'M' && (
                        <span className="w-1.5 h-1.5 rounded-full bg-[#061C13]" />
                      )}
                    </span>
                    <span className="font-bold">M</span>
                  </label>

                  <label
                    onClick={() => setStudentInfo({ ...studentInfo, gender: 'F' })}
                    className={`flex items-center justify-center gap-2.5 py-2.5 px-4 rounded-xl text-xs font-bold border cursor-pointer transition select-none ${
                      studentInfo.gender === 'F'
                        ? 'bg-[#0E623B] border-[#D6BF62] text-[#F0F9F3] shadow-md shadow-[#0E623B]/30'
                        : 'bg-[#0A2419] border-[#789981]/40 text-[#ADCDBA] hover:border-[#D6BF62]/50 hover:text-[#F0F9F3]'
                    }`}
                  >
                    <input
                      type="radio"
                      name="gender"
                      value="F"
                      checked={studentInfo.gender === 'F'}
                      onChange={() => setStudentInfo({ ...studentInfo, gender: 'F' })}
                      className="sr-only"
                      required
                    />
                    <span
                      className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                        studentInfo.gender === 'F'
                          ? 'border-[#D6BF62] bg-[#D6BF62]'
                          : 'border-[#789981]'
                      }`}
                    >
                      {studentInfo.gender === 'F' && (
                        <span className="w-1.5 h-1.5 rounded-full bg-[#061C13]" />
                      )}
                    </span>
                    <span className="font-bold">F</span>
                  </label>
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setStep('select')}
                  className="px-4 py-3 bg-[#0A2419] hover:bg-[#0E3324] text-[#ADCDBA] font-bold rounded-xl text-xs border border-[#789981]/40 transition"
                >
                  Change Exam
                </button>

                <button
                  type="submit"
                  disabled={loadingExam || !validateMatricNumber(studentInfo.matricNumber).isValid || !studentInfo.gender || !studentInfo.fullName.trim() || !studentInfo.department.trim()}
                  className="flex-1 py-3 bg-[#0E623B] hover:bg-[#127949] border border-[#D6BF62] text-[#F0F9F3] font-bold rounded-xl text-sm shadow-lg hover:shadow-[#0E623B]/30 transition flex items-center justify-center gap-2 cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loadingExam ? (
                    <div className="w-4 h-4 border-2 border-[#F0F9F3] border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      <span>Continue to Instructions</span>
                      <ArrowRight className="w-4 h-4 text-[#D6BF62]" />
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // STAGE 2: Examination Instructions Page
  // ==========================================
  if (step === 'instructions') {
    return (
      <div className="max-w-2xl mx-auto my-8 px-4">
        <div className="bg-[#061C13] rounded-3xl shadow-2xl border border-[#D6BF62]/30 overflow-hidden">
          <div className="bg-gradient-to-b from-[#0A2419] to-[#061C13] p-6 sm:p-8 text-center border-b border-[#D6BF62]/30">
            <div className="w-16 h-20 mx-auto mb-3 bg-[#030515]/60 rounded-xl p-2 flex items-center justify-center border border-[#D6BF62]/30 shadow-inner">
              <img
                src="/assets/aistudio/IMG-20261104-WA0018_41e50466.jpg"
                alt="SUN Logo"
                className="w-full h-full object-contain"
              />
            </div>
            <p className="text-xs font-bold tracking-widest text-[#D6BF62] uppercase">
              Sports University of Nigeria
            </p>
            <h2 className="text-2xl font-black mt-1 text-[#F0F9F3]">{exam?.courseCode} Examination</h2>
            <p className="text-sm text-[#ADCDBA] mt-0.5">{exam?.courseTitle}</p>
          </div>

          <div className="p-6 sm:p-8 space-y-6">
            {/* Candidate Summary Card */}
            <div className="grid grid-cols-2 gap-3 p-4 bg-[#0A2419] rounded-2xl border border-[#789981]/30 text-xs">
              <div>
                <span className="text-[#789981] font-semibold uppercase text-[10px]">Candidate Name</span>
                <p className="font-bold text-[#F0F9F3] text-sm mt-0.5">{studentInfo.fullName}</p>
              </div>
              <div>
                <span className="text-[#789981] font-semibold uppercase text-[10px]">Matriculation No.</span>
                <p className="font-mono font-bold text-[#D6BF62] text-sm mt-0.5">{studentInfo.matricNumber}</p>
              </div>
              <div className="pt-2 border-t border-[#789981]/20">
                <span className="text-[#789981] font-semibold uppercase text-[10px]">Department</span>
                <p className="font-medium text-[#ADCDBA]">{studentInfo.department}</p>
              </div>
              <div className="pt-2 border-t border-[#789981]/20">
                <span className="text-[#789981] font-semibold uppercase text-[10px]">Gender</span>
                <p className="font-bold text-[#D6BF62]">{studentInfo.gender || 'Not specified'}</p>
              </div>
              <div className="pt-2 border-t border-[#789981]/20 col-span-2">
                <span className="text-[#789981] font-semibold uppercase text-[10px]">Course Lecturer</span>
                <p className="font-bold text-[#F0F9F3]">{exam?.lecturerName || 'Not specified'}</p>
              </div>
            </div>

            {/* Scheduled Availability Alert Card */}
            {exam?.endDate && (
              <div className="p-3.5 bg-[#0A2419] border border-[#D6BF62]/40 rounded-2xl flex items-center justify-between text-xs">
                <div className="flex items-center gap-2.5">
                  <Clock className="w-4 h-4 text-[#D6BF62] shrink-0" />
                  <div>
                    <span className="text-[10px] text-[#789981] font-bold uppercase tracking-wider block">Official Closing Time</span>
                    <span className="font-bold text-[#F0F9F3]">
                      {formatLagosDateTime(exam.endDate)}
                    </span>
                  </div>
                </div>
                <span className="text-[10px] bg-[#0E623B] text-[#D6BF62] font-extrabold px-2.5 py-0.5 rounded-full border border-[#D6BF62]/40 uppercase tracking-wider shrink-0">
                  Strict Enforcement
                </span>
              </div>
            )}

            {/* Exam Parameters */}
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-[#0A2419] rounded-2xl border border-[#789981]/30 text-center">
                <Clock className="w-6 h-6 text-[#D6BF62] mx-auto mb-1" />
                <span className="text-xs text-[#ADCDBA] font-semibold">Allocated Duration</span>
                <p className="text-xl font-black text-[#F0F9F3] mt-0.5">{exam?.durationMinutes} Minutes</p>
              </div>

              <div className="p-4 bg-[#0A2419] rounded-2xl border border-[#789981]/30 text-center">
                <FileText className="w-6 h-6 text-[#D6BF62] mx-auto mb-1" />
                <span className="text-xs text-[#ADCDBA] font-semibold">Total Questions</span>
                <p className="text-xl font-black text-[#F0F9F3] mt-0.5">{exam?.questionsCount} Questions</p>
              </div>
            </div>

            {/* Rules and Instructions */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#D6BF62]">
                Rules & Standard Academic Procedures
              </h3>
              <ul className="text-xs text-[#ADCDBA] space-y-2.5 list-disc pl-5 leading-relaxed">
                <li>
                  <strong className="text-[#F0F9F3]">Official Closing Time Priority:</strong> The official closing time strictly takes priority over your individual timer. Once the closing time arrives, the examination ends immediately and your saved answers are automatically submitted.
                </li>
                <li>
                  <strong className="text-[#F0F9F3]">Continuous Server-Side Timer:</strong> Your individual countdown counts down automatically. You cannot continue writing beyond the scheduled closing time.
                </li>
                <li>
                  <strong className="text-[#F0F9F3]">Automatic Submission:</strong> The examination engine continuously saves your answers in the background and automatically submits your responses if the countdown expires.
                </li>
                <li>
                  <strong className="text-[#F0F9F3]">One-Time Attempt:</strong> Students who have already submitted are strictly prohibited from writing or reopening the examination.
                </li>
                <li>
                  <strong className="text-[#F0F9F3]">Confidentiality Policy:</strong> Individual scores and results are securely recorded in the lecturer portal and are not displayed on candidate screens.
                </li>
              </ul>
            </div>

            {examError && (
              <div className="p-3.5 bg-[#2A0808] border border-red-500/40 rounded-xl text-red-200 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                <span>{examError}</span>
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setStep('info')}
                className="px-4 py-3 bg-[#0A2419] hover:bg-[#0E3324] text-[#ADCDBA] font-bold rounded-xl text-xs border border-[#789981]/40 transition"
              >
                Back
              </button>

              <button
                type="button"
                onClick={handleStartExam}
                disabled={loadingExam}
                className="flex-1 py-3.5 bg-[#0E623B] hover:bg-[#127949] border border-[#D6BF62] text-[#F0F9F3] font-extrabold rounded-xl text-sm shadow-lg hover:shadow-[#0E623B]/30 transition transform active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
              >
                {loadingExam ? (
                  <div className="w-5 h-5 border-2 border-[#F0F9F3] border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <span>Begin Examination</span>
                    <ArrowRight className="w-4 h-4 text-[#D6BF62]" />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // VIEW 4: Active Examination Interface (CBT Engine)
  // ==========================================
  if (step === 'exam') {
    const isTimeUrgent = remainingSeconds <= 300; // <= 5 mins
    const isTimeCritical = remainingSeconds <= 60; // <= 1 min

    return (
      <div className="min-h-[calc(100vh-5rem)] bg-[#030515] flex flex-col justify-between">
        {/* Fixed Top Exam Bar */}
        <div className="bg-[#061C13] border-b border-[#D6BF62]/30 shadow-md sticky top-20 z-30">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
            {/* Candidate & Course Badge */}
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#030515] text-[#D6BF62] border border-[#D6BF62]/30 font-black text-xs flex items-center justify-center shadow-inner">
                SUN
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-extrabold text-xs sm:text-sm text-[#F0F9F3]">{exam?.courseCode}</span>
                  <span className="text-[#789981] text-xs hidden sm:inline">•</span>
                  <span className="font-mono text-xs font-bold text-[#D6BF62]">{studentInfo.matricNumber}</span>
                </div>
                <p className="text-[11px] text-[#ADCDBA] line-clamp-1">{studentInfo.fullName}</p>
              </div>
            </div>

            {/* Countdown Timer */}
            <div className="flex items-center gap-3">
              <div
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl font-mono text-sm sm:text-base font-bold transition shadow-sm ${
                  isTimeCritical
                    ? 'bg-red-600 text-white animate-pulse'
                    : isTimeUrgent
                    ? 'bg-amber-500 text-white'
                    : 'bg-[#0A2419] border border-[#D6BF62]/40 text-[#D6BF62]'
                }`}
              >
                <Clock className="w-4 h-4 text-[#D6BF62]" />
                <span>{formatTime(remainingSeconds)}</span>
              </div>

              {/* Submit Button */}
              <button
                type="button"
                onClick={() => setSubmitModalOpen(true)}
                className="flex items-center gap-1.5 px-4 py-2 bg-[#0E623B] hover:bg-[#127949] border border-[#D6BF62] text-[#F0F9F3] font-extrabold text-xs rounded-xl shadow-lg hover:shadow-[#0E623B]/30 transition cursor-pointer active:scale-95"
              >
                <Send className="w-3.5 h-3.5 text-[#D6BF62]" />
                <span>Submit Exam</span>
              </button>
            </div>
          </div>
        </div>

        {/* EXAM PROGRESS TRACKER */}
        <div className="bg-[#061C13] border-b border-[#789981]/30 px-4 sm:px-6 py-2.5">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            {/* Progress summary & bar */}
            <div className="flex-1 space-y-1.5">
              <div className="flex items-center justify-between text-xs font-bold">
                <div className="flex items-center gap-2 text-[#ADCDBA]">
                  <BarChart3 className="w-4 h-4 text-[#D6BF62]" />
                  <span>Exam Progress:</span>
                  <span className="text-[#F0F9F3] font-extrabold">{answeredCount} of {questions.length} Answered</span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-black bg-[#0E623B] border border-[#D6BF62]/40 text-[#D6BF62]">
                    {progressPercent}%
                  </span>
                </div>
                <span className="font-mono text-[#789981] text-xs">
                  {unansweredCount === 0 ? '✓ All Answered' : `${unansweredCount} remaining`}
                </span>
              </div>

              {/* Visual Progress Bar */}
              <div className="w-full h-2.5 bg-[#030515] rounded-full overflow-hidden flex border border-[#789981]/20">
                <motion.div
                  className="h-full bg-gradient-to-r from-[#0E623B] via-[#10B981] to-[#D6BF62]"
                  initial={false}
                  animate={{ width: `${progressPercent}%` }}
                  transition={{ duration: 0.35, ease: 'easeOut' }}
                />
              </div>
            </div>

            {/* Quick Metrics & Jump to Next Unanswered */}
            <div className="flex items-center gap-2 justify-between sm:justify-end shrink-0">
              <div className="flex items-center gap-2.5 text-xs font-semibold px-3 py-1.5 bg-[#0A2419] rounded-xl border border-[#789981]/30">
                <span className="flex items-center gap-1 text-[#D6BF62]" title="Answered Questions">
                  <span className="w-2 h-2 rounded-full bg-[#10B981]" />
                  <span>{answeredCount} Done</span>
                </span>
                <span className="text-[#789981]">|</span>
                <span className="flex items-center gap-1 text-amber-400" title="Flagged for Review">
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  <span>{flaggedCount} Flagged</span>
                </span>
                <span className="text-[#789981]">|</span>
                <span className="flex items-center gap-1 text-[#ADCDBA]" title="Remaining Questions">
                  <span className="w-2 h-2 rounded-full bg-[#789981]" />
                  <span>{unansweredCount} Left</span>
                </span>
              </div>

              {unansweredCount > 0 && (
                <button
                  type="button"
                  onClick={jumpToNextUnanswered}
                  className="flex items-center gap-1 px-3 py-1.5 bg-[#0A2419] hover:bg-[#0E3324] text-[#D6BF62] text-xs font-bold rounded-xl border border-[#D6BF62]/40 transition active:scale-95 cursor-pointer"
                  title="Jump directly to the next unanswered question"
                >
                  <ArrowRight className="w-3.5 h-3.5 text-[#D6BF62]" />
                  <span className="hidden md:inline">Next Unanswered</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Main Examination Question Area */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 w-full flex-1">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* Question Card (Cols 1-3) */}
            <div className="lg:col-span-3 space-y-4">
              <div className="bg-[#061C13] rounded-3xl shadow-xl border border-[#789981]/30 p-6 sm:p-8 space-y-6">
                {/* Question Header & Flag Toggle */}
                <div className="flex items-center justify-between pb-4 border-b border-[#789981]/20">
                  <div className="flex items-center gap-2">
                    <span className="px-3 py-1 bg-[#0A2419] border border-[#D6BF62]/30 text-[#D6BF62] rounded-lg text-xs font-black">
                      Question {currentQIndex + 1} of {questions.length}
                    </span>
                    {answers[currentQuestion?.id] !== undefined && (
                      <span className="text-[11px] text-[#ADCDBA] font-semibold flex items-center gap-1">
                        <CheckCircle className="w-3.5 h-3.5 text-[#10B981]" /> Answered
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      const nextFlags = {
                        ...flagged,
                        [currentQuestion?.id]: !flagged[currentQuestion?.id]
                      };
                      setFlagged(nextFlags);
                      try {
                        const stored = localStorage.getItem('sun_cbt_session');
                        if (stored) {
                          const parsed = JSON.parse(stored);
                          parsed.flagged = nextFlags;
                          localStorage.setItem('sun_cbt_session', JSON.stringify(parsed));
                        }
                      } catch {}
                    }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition border cursor-pointer ${
                      flagged[currentQuestion?.id]
                        ? 'bg-amber-400/20 border-amber-400 text-amber-300'
                        : 'bg-[#0A2419] border-[#789981]/30 text-[#ADCDBA] hover:bg-[#0E3324]'
                    }`}
                  >
                    <Flag className={`w-3.5 h-3.5 ${flagged[currentQuestion?.id] ? 'fill-amber-400 text-amber-400' : ''}`} />
                    <span>{flagged[currentQuestion?.id] ? 'Flagged for Review' : 'Mark for Review'}</span>
                  </button>
                </div>

                {/* Question Stem */}
                <div className="text-base sm:text-lg font-semibold text-[#F0F9F3] leading-relaxed">
                  {currentQuestion?.questionText}
                </div>

                {/* Options Grid (Supports standard A-D and True/False questions) */}
                <div className="space-y-3 pt-2">
                  {(currentQuestion?.options || [])
                    .map((option, optIdx) => ({ option, optIdx }))
                    .filter(({ option }) => typeof option === 'string' && option.trim().length > 0)
                    .map(({ option, optIdx }) => {
                      const isSelected = answers[currentQuestion.id] === optIdx;
                      const opt0 = (currentQuestion?.options?.[0] || '').trim().toLowerCase();
                      const opt1 = (currentQuestion?.options?.[1] || '').trim().toLowerCase();
                      const isTF =
                        ((opt0 === 'true' && opt1 === 'false') || (opt0 === 'false' && opt1 === 'true')) &&
                        !currentQuestion?.options?.[2]?.trim() &&
                        !currentQuestion?.options?.[3]?.trim();
                      const letter = isTF
                        ? (option.trim().toLowerCase() === 'true' ? 'T' : 'F')
                        : String.fromCharCode(65 + optIdx);

                      return (
                        <button
                          key={optIdx}
                          type="button"
                          onClick={() => {
                            const updated = {
                              ...answers,
                              [currentQuestion.id]: optIdx
                            };
                            setAnswers(updated);
                            saveProgressToServer(updated);
                          }}
                          className={`w-full text-left p-4 rounded-2xl border transition flex items-center gap-3.5 cursor-pointer ${
                            isSelected
                              ? 'bg-[#0E623B]/30 border-2 border-[#D6BF62] shadow-lg'
                              : 'bg-[#0A2419] border-[#789981]/30 hover:border-[#D6BF62]/50 hover:bg-[#0E3324]'
                          }`}
                        >
                          <span
                            className={`w-8 h-8 rounded-xl font-bold text-xs flex items-center justify-center shrink-0 transition ${
                              isSelected
                                ? 'bg-[#D6BF62] text-[#061C13] font-black'
                                : 'bg-[#030515] text-[#789981] border border-[#789981]/30'
                            }`}
                          >
                            {letter}
                          </span>

                          <span className={`text-sm ${isSelected ? 'text-[#F0F9F3] font-bold' : 'text-[#ADCDBA]'}`}>
                            {option}
                          </span>
                        </button>
                      );
                    })}
                </div>

                {/* Question Navigation Controls */}
                <div className="flex items-center justify-between pt-6 border-t border-[#789981]/20">
                  <button
                    type="button"
                    disabled={currentQIndex === 0}
                    onClick={() => setCurrentQIndex((prev) => Math.max(0, prev - 1))}
                    className="flex items-center gap-1 px-4 py-2.5 rounded-xl border border-[#789981]/40 bg-[#0A2419] text-xs font-bold text-[#ADCDBA] hover:bg-[#0E3324] transition disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    <span>Previous</span>
                  </button>

                  {answers[currentQuestion?.id] !== undefined && (
                    <button
                      type="button"
                      onClick={() => {
                        const copy = { ...answers };
                        delete copy[currentQuestion.id];
                        setAnswers(copy);
                        saveProgressToServer(copy);
                      }}
                      className="text-xs text-[#789981] hover:text-red-400 underline font-medium cursor-pointer"
                    >
                      Clear Selection
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={currentQIndex === questions.length - 1}
                    onClick={() => setCurrentQIndex((prev) => Math.min(questions.length - 1, prev + 1))}
                    className="flex items-center gap-1 px-5 py-2.5 rounded-xl bg-[#0E623B] hover:bg-[#127949] border border-[#D6BF62] text-[#F0F9F3] text-xs font-bold transition disabled:opacity-30 disabled:cursor-not-allowed shadow-md cursor-pointer"
                  >
                    <span>Next</span>
                    <ChevronRight className="w-4 h-4 text-[#D6BF62]" />
                  </button>
                </div>
              </div>
            </div>

            {/* Question Matrix / Palette (Col 4) */}
            <div className="lg:col-span-1">
              <div className="bg-[#061C13] rounded-3xl shadow-xl border border-[#789981]/30 p-5 sticky top-40 space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-[#789981]/20">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#ADCDBA]">
                    Question Palette
                  </h4>
                  <span className="text-xs font-bold text-[#D6BF62]">
                    {answeredCount} / {questions.length} Answered
                  </span>
                </div>

                {/* Progress bar */}
                <div className="w-full bg-[#030515] rounded-full h-2 overflow-hidden border border-[#789981]/20">
                  <div
                    className="bg-gradient-to-r from-[#0E623B] to-[#D6BF62] h-2 rounded-full transition-all duration-300"
                    style={{ width: `${(answeredCount / (questions.length || 1)) * 100}%` }}
                  />
                </div>

                {/* Grid Palette */}
                <div className="grid grid-cols-5 gap-2 max-h-72 overflow-y-auto p-1">
                  {questions.map((q, idx) => {
                    const isAnswered = answers[q.id] !== undefined;
                    const isFlag = flagged[q.id];
                    const isCurrent = idx === currentQIndex;

                    return (
                      <button
                        key={q.id || idx}
                        type="button"
                        onClick={() => setCurrentQIndex(idx)}
                        className={`w-9 h-9 rounded-xl font-mono text-xs font-bold transition flex items-center justify-center relative cursor-pointer ${
                          isCurrent
                            ? 'ring-2 ring-[#D6BF62] ring-offset-2 ring-offset-[#061C13] font-black'
                            : ''
                        } ${
                          isFlag
                            ? 'bg-amber-400 text-amber-950 font-bold'
                            : isAnswered
                            ? 'bg-[#0E623B] text-[#D6BF62] border border-[#D6BF62]/40 font-bold'
                            : 'bg-[#0A2419] text-[#ADCDBA] border border-[#789981]/30 hover:bg-[#0E3324]'
                        }`}
                      >
                        {idx + 1}
                      </button>
                    );
                  })}
                </div>

                {/* Legend */}
                <div className="pt-3 border-t border-[#789981]/20 space-y-1.5 text-[11px] text-[#ADCDBA] font-medium">
                  <div className="flex items-center gap-2">
                    <span className="w-3.5 h-3.5 rounded bg-[#0E623B] border border-[#D6BF62]/40" />
                    <span>Answered ({answeredCount})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-3.5 h-3.5 rounded bg-[#0A2419] border border-[#789981]/30" />
                    <span>Unanswered ({questions.length - answeredCount})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-3.5 h-3.5 rounded bg-amber-400" />
                    <span>Flagged for Review ({Object.values(flagged).filter(Boolean).length})</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setSubmitModalOpen(true)}
                  className="w-full mt-2 py-2.5 bg-[#0E623B] hover:bg-[#127949] border border-[#D6BF62] text-[#F0F9F3] font-bold text-xs rounded-xl shadow-lg transition cursor-pointer"
                >
                  Review & Finalize Submission
                </button>
              </div>
            </div>
          </div>
        </main>

        {/* Submit Confirmation Modal */}
        {submitModalOpen && (
          <div className="fixed inset-0 z-50 bg-[#030515]/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-[#061C13] rounded-3xl max-w-md w-full p-6 sm:p-8 space-y-5 shadow-2xl border border-[#D6BF62]/40">
              <div className="w-14 h-14 rounded-2xl bg-[#0A2419] border border-[#D6BF62]/30 text-[#D6BF62] flex items-center justify-center mx-auto">
                <AlertTriangle className="w-7 h-7" />
              </div>

              <div className="text-center space-y-1.5">
                <h3 className="text-lg font-black text-[#F0F9F3]">Finalize Examination Submission?</h3>
                <p className="text-xs text-[#ADCDBA]">
                  Please review your examination status before submitting. Once submitted, your answers are sealed and cannot be reopened.
                </p>
              </div>

              <div className="p-4 bg-[#0A2419] rounded-2xl border border-[#789981]/30 space-y-2 text-xs">
                <div className="flex justify-between font-medium">
                  <span className="text-[#789981]">Questions Answered:</span>
                  <span className="font-bold text-[#D6BF62]">{answeredCount} of {questions.length}</span>
                </div>
                <div className="flex justify-between font-medium">
                  <span className="text-[#789981]">Unanswered Questions:</span>
                  <span className="font-bold text-red-400">{questions.length - answeredCount}</span>
                </div>
                <div className="flex justify-between font-medium">
                  <span className="text-[#789981]">Time Remaining:</span>
                  <span className="font-mono font-bold text-[#F0F9F3]">{formatTime(remainingSeconds)}</span>
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setSubmitModalOpen(false)}
                  className="flex-1 py-3 bg-[#0A2419] hover:bg-[#0E3324] text-[#ADCDBA] border border-[#789981]/40 font-bold text-xs rounded-xl transition cursor-pointer"
                >
                  Return to Exam
                </button>

                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={finalizeSubmission}
                  className="flex-1 py-3 bg-[#0E623B] hover:bg-[#127949] border border-[#D6BF62] text-[#F0F9F3] font-extrabold text-xs rounded-xl shadow-lg hover:shadow-[#0E623B]/30 transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isSubmitting ? (
                    <div className="w-4 h-4 border-2 border-[#F0F9F3] border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5 text-[#D6BF62]" />
                      <span>Confirm & Submit</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ==========================================
  // VIEW 5: Submission Confirmation Receipt with Framer Motion Animation
  // ==========================================
  if (step === 'submitted' && submissionReceipt) {
    // Generate celebratory confetti particles
    const confettiColors = ['#D6BF62', '#0E623B', '#10B981', '#F59E0B', '#F0F9F3'];
    const confettiPieces = Array.from({ length: 18 }, (_, i) => ({
      id: i,
      x: (i * 22) % 360 - 180,
      y: -20 - (i * 12) % 60,
      targetY: 140 + (i * 25) % 180,
      color: confettiColors[i % confettiColors.length],
      size: 6 + (i % 4) * 2,
      duration: 1.8 + (i % 5) * 0.3,
      delay: 0.1 + (i % 6) * 0.12,
      rotate: (i * 45) % 360
    }));

    return (
      <div className="max-w-xl mx-auto my-8 px-4 relative overflow-hidden">
        {/* Floating Framer Motion Confetti Burst */}
        <div className="absolute inset-0 pointer-events-none flex justify-center overflow-hidden z-20">
          {confettiPieces.map((piece) => (
            <motion.div
              key={piece.id}
              initial={{
                opacity: 1,
                x: piece.x * 0.3,
                y: piece.y,
                scale: 0.4,
                rotate: 0
              }}
              animate={{
                opacity: [1, 1, 0],
                x: [piece.x * 0.3, piece.x, piece.x * 1.2],
                y: [piece.y, piece.targetY],
                scale: [0.4, 1, 0.7],
                rotate: piece.rotate + 360
              }}
              transition={{
                duration: piece.duration,
                delay: piece.delay,
                ease: 'easeOut',
                repeat: Infinity,
                repeatDelay: 4
              }}
              style={{
                backgroundColor: piece.color,
                width: piece.size,
                height: piece.size * 0.7,
                borderRadius: piece.id % 2 === 0 ? '2px' : '9999px',
                position: 'absolute',
                top: '15%'
              }}
            />
          ))}
        </div>

        {/* Main Card Container */}
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="bg-[#061C13] rounded-3xl shadow-2xl border border-[#D6BF62]/30 overflow-hidden text-center relative z-10"
        >
          {/* Official Green & Gold Banner */}
          <div className="bg-gradient-to-b from-[#0A2419] to-[#061C13] p-8 text-white border-b border-[#D6BF62]/30 relative">
            {/* Concentric Glow Pulse Rings */}
            <div className="relative w-24 h-24 mx-auto mb-4 flex items-center justify-center">
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: [0.8, 1.35, 1.6], opacity: [0.6, 0.25, 0] }}
                transition={{ duration: 2.2, repeat: Infinity, ease: 'easeOut' }}
                className="absolute inset-0 rounded-full bg-[#D6BF62]"
              />
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: [0.9, 1.2, 1.4], opacity: [0.5, 0.2, 0] }}
                transition={{ duration: 2.2, delay: 0.4, repeat: Infinity, ease: 'easeOut' }}
                className="absolute inset-0 rounded-full bg-[#10B981]"
              />

              {/* Animated Central SVG Seal Badge */}
              <motion.div
                initial={{ scale: 0, rotate: -30 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', damping: 14, stiffness: 180, delay: 0.15 }}
                className="w-20 h-20 rounded-full bg-[#030515]/60 backdrop-blur-md border-2 border-[#D6BF62] flex items-center justify-center shadow-lg relative z-10"
              >
                <motion.svg
                  className="w-12 h-12 text-[#D6BF62]"
                  viewBox="0 0 52 52"
                  fill="none"
                >
                  {/* Outer circle animated stroke */}
                  <motion.circle
                    cx="26"
                    cy="26"
                    r="23"
                    stroke="#D6BF62"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    initial={{ pathLength: 0, rotate: -90 }}
                    animate={{ pathLength: 1, rotate: 0 }}
                    transition={{ duration: 0.7, ease: 'easeInOut' }}
                  />
                  {/* Inner checkmark animated stroke */}
                  <motion.path
                    d="M15 27l8 8 16-16"
                    stroke="#D6BF62"
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.45, delay: 0.5, ease: 'easeOut' }}
                  />
                </motion.svg>
              </motion.div>
            </div>

            {/* University Crest & Title */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, duration: 0.4 }}
              className="space-y-2 max-w-xl mx-auto"
            >
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#D6BF62]/10 border border-[#D6BF62]/30 text-[#D6BF62] text-[11px] font-extrabold uppercase tracking-widest mb-1">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Examination Completed</span>
              </div>
              <h2 className="text-xl sm:text-2xl md:text-3xl font-black tracking-tight text-[#F0F9F3] leading-snug">
                Congratulations! Your examination has been submitted successfully. Good luck.
              </h2>
              <p className="text-xs text-[#ADCDBA] font-medium">
                Sports University of Nigeria • Computer-Based Testing System
              </p>
            </motion.div>
          </div>

          <div className="p-6 sm:p-8 space-y-6">
            {/* Academic Notice Banner */}
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: 0.4 }}
              className="bg-[#0A2419] border border-[#789981]/30 rounded-2xl p-4 text-xs text-[#ADCDBA] leading-relaxed text-left flex items-start gap-3"
            >
              <ShieldCheck className="w-5 h-5 text-[#10B981] shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-sm text-[#F0F9F3] mb-0.5">
                  Institutional Evaluation Protocol
                </p>
                <p>
                  Your candidate responses have been securely recorded and transmitted to the university grading engine. In strict adherence to institutional regulations, candidate scores and answer keys are kept confidential and transmitted directly to departmental academic records.
                </p>
              </div>
            </motion.div>

            {/* Candidate Submission Summary (No Receipt or Receipt ID) */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6, duration: 0.45 }}
              className="p-5 bg-[#0A2419] rounded-2xl border border-[#789981]/30 text-left space-y-3 text-xs shadow-inner"
            >
              <div className="border-b border-[#789981]/20 pb-2">
                <span className="text-[#D6BF62] uppercase text-[10px] font-bold block tracking-wider">
                  Candidate Submission Summary
                </span>
              </div>

              {/* Candidate Info Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <span className="text-[#789981] text-xs block">Candidate Name:</span>
                  <span className="font-bold text-[#F0F9F3] text-sm">{submissionReceipt.fullName}</span>
                </div>

                <div>
                  <span className="text-[#789981] text-xs block">Matriculation No:</span>
                  <span className="font-bold text-[#D6BF62] text-sm font-mono">{submissionReceipt.matricNumber}</span>
                </div>

                <div>
                  <span className="text-[#789981] text-xs block">Course Code:</span>
                  <span className="font-bold text-[#F0F9F3] text-sm">{submissionReceipt.courseCode}</span>
                </div>

                <div>
                  <span className="text-[#789981] text-xs block">Course Lecturer:</span>
                  <span className="font-bold text-[#D6BF62] text-sm">
                    {submissionReceipt.lecturerName || exam?.lecturerName || 'Not specified'}
                  </span>
                </div>

                <div>
                  <span className="text-[#789981] text-xs block">Department:</span>
                  <span className="font-semibold text-[#ADCDBA]">
                    {studentInfo.department || exam?.department || 'All Departments'}
                  </span>
                </div>

                <div>
                  <span className="text-[#789981] text-xs block">Questions Assessed:</span>
                  <span className="font-semibold text-[#ADCDBA]">{submissionReceipt.totalQuestions} Questions</span>
                </div>
              </div>

              {submissionReceipt.courseTitle && (
                <div className="pt-2 border-t border-[#789981]/20">
                  <span className="text-[#789981] text-[11px] block">Course Title:</span>
                  <span className="font-semibold text-[#ADCDBA] text-xs line-clamp-1">
                    {submissionReceipt.courseTitle}
                  </span>
                </div>
              )}

              {/* Timestamp */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 border-t border-[#789981]/20 pt-2.5 text-[11px] text-[#789981]">
                <span>
                  Submitted At: {new Date(submissionReceipt.submittedAt).toLocaleString()}
                </span>
                <span className="flex items-center gap-1 text-[#10B981] font-semibold">
                  <ShieldCheck className="w-3.5 h-3.5 text-[#10B981]" />
                  <span>Securely Sealed</span>
                </span>
              </div>
            </motion.div>

            {/* Official University Seal Sub-badge */}
            <div className="flex items-center justify-center gap-2 text-[11px] text-[#789981] font-medium">
              <Award className="w-3.5 h-3.5 text-[#D6BF62]" />
              <span>Sports University of Nigeria • Citadel for Champions</span>
            </div>

            {/* Action Buttons */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.75, duration: 0.4 }}
              className="pt-1"
            >
              <button
                type="button"
                onClick={() => {
                  setStep('select');
                  setExam(null);
                  setSubmissionReceipt(null);
                  setAnswers({});
                }}
                className="w-full py-3.5 bg-[#0E623B] hover:bg-[#127949] border border-[#D6BF62] text-[#F0F9F3] font-bold text-sm rounded-xl shadow-lg hover:shadow-[#0E623B]/30 transition cursor-pointer active:scale-95"
              >
                Exit Examination Portal
              </button>
            </motion.div>
          </div>
        </motion.div>
      </div>
    );
  }

  return null;
};
