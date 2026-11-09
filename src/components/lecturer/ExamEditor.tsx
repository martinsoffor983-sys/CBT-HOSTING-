import React, { useState, useEffect } from 'react';
import {
  FileText,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Save,
  ArrowLeft,
  Clock,
  Calendar,
  Layers,
  HelpCircle,
  Check,
  Copy,
  ExternalLink,
  Shuffle,
  ChevronUp,
  ChevronDown,
  Sparkles,
  Eye,
  X,
  Share2,
  Users,
  UserCheck,
  Upload
} from 'lucide-react';
import { Exam, Question, RegisteredCandidate } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { doc, setDoc } from 'firebase/firestore';
import {
  parseBulkQuestions,
  detectDuplicates,
  generateExamBatches,
  DuplicatePair,
  ParsedQuestionDraft
} from '../../utils/questionParser';
import {
  getLagosDateTimeLocalString,
  parseLagosExamTime,
  formatLagosDate,
  formatLagosTime,
  formatLagosDateTime
} from '../../utils/timeUtils';
import {
  validateMatricNumber,
  capitalizeProper,
  detectBatchMatricDuplicates,
  validateAndReportCandidateBatch
} from '../../utils/studentValidation';

interface ExamEditorProps {
  initialExam?: Exam | null;
  onBack: () => void;
  onSaved: (exam: Exam) => void;
}

const RECOMMENDED_PASTE_SAMPLE = `1. Which of the following is a component of physical fitness?
   A. Flexibility
   B. Television
   C. Politics
   D. Agriculture
   Answer: A

2. What is the primary purpose of warming up before exercise?
   A. To cause fatigue
   B. To prepare the body for activity
   C. To reduce body temperature
   D. To stop blood circulation
   Answer: B

3. Which energy system is primarily active during a 100-meter sprint?
   A. Phosphagen (ATP-PCr) System
   B. Aerobic Glycolysis System
   C. Beta-Oxidation System
   D. Cori Cycle
   Answer: A

4. In sports biomechanics, Newton's Third Law of Motion states that:
   A. Objects remain at rest unless an external force acts
   B. For every action, there is an equal and opposite reaction
   C. Acceleration depends on mass and net force
   D. Velocity is constant in a vacuum
   Answer: B`;

export const ExamEditor: React.FC<ExamEditorProps> = ({ initialExam, onBack, onSaved }) => {
  const { user } = useAuth();

  // Stable Unique Examination Identifier
  const [examId] = useState<string>(
    initialExam?.id || `exam_sun_${Date.now()}`
  );

  // Copy Feedback State
  const [copiedExamId, setCopiedExamId] = useState(false);

  // Section 1: Basic Information
  const [courseCode, setCourseCode] = useState(initialExam?.courseCode || 'SPT 201');
  const [courseTitle, setCourseTitle] = useState(
    initialExam?.courseTitle || 'Foundations of Exercise Physiology & Sports Performance'
  );
  const [lecturerName, setLecturerName] = useState(initialExam?.lecturerName || '');

  // Section 2: Department Selection (Simplified: "All Departments" or "Others")
  const initialDeptIsAll = !initialExam?.department || initialExam.department === 'All Departments';
  const [departmentMode, setDepartmentMode] = useState<'all' | 'others'>(
    initialDeptIsAll ? 'all' : 'others'
  );
  const [customDepartment, setCustomDepartment] = useState(
    initialDeptIsAll ? '' : (initialExam?.department || '')
  );

  // Section 3: Duration & Availability
  const [durationMinutes, setDurationMinutes] = useState(initialExam?.durationMinutes || 45);
  const [startDate, setStartDate] = useState(
    initialExam?.startDate || getLagosDateTimeLocalString()
  );
  const [endDate, setEndDate] = useState(
    initialExam?.endDate || getLagosDateTimeLocalString(new Date(Date.now() + 14 * 24 * 3600 * 1000))
  );
  const [instructions, setInstructions] = useState(
    initialExam?.instructions ||
      '1. Read each question carefully before choosing your option.\n2. You are allowed only one submission attempt.\n3. The server countdown timer will automatically submit your exam when time expires.'
  );

  // Section 4: Bulk Pasting State
  const [pasteContent, setPasteContent] = useState('');
  const [parserFeedback, setParserFeedback] = useState<{
    total: number;
    valid: number;
    errors: number;
    message: string;
  } | null>(null);

  // Section 5: Questions & Organisation
  const [questions, setQuestions] = useState<Question[]>(
    initialExam?.questions && initialExam.questions.length > 0
      ? initialExam.questions
      : []
  );

  // Section 6: Duplicate Detection
  const [duplicatePairs, setDuplicatePairs] = useState<DuplicatePair[]>([]);
  const [dismissedPairIds, setDismissedPairIds] = useState<Set<string>>(new Set());
  const [activeComparePair, setActiveComparePair] = useState<DuplicatePair | null>(null);

  // Section 7: Randomisation & Batches
  const [randomizationEnabled, setRandomizationEnabled] = useState<boolean>(
    initialExam?.randomizationEnabled ?? true
  );

  // Save / Publish States
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<'draft' | 'published'>(
    initialExam?.status === 'published' ? 'published' : 'draft'
  );
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // Candidate Pre-Registration & Roster State
  const [registeredCandidates, setRegisteredCandidates] = useState<RegisteredCandidate[]>(
    initialExam?.registeredCandidates || []
  );
  const [candidateBatchInput, setCandidateBatchInput] = useState('');
  const [candidateBatchError, setCandidateBatchError] = useState<string | null>(null);
  const [candidateBatchSuccess, setCandidateBatchSuccess] = useState<string | null>(null);

  const handleProcessCandidateBatch = () => {
    setCandidateBatchError(null);
    setCandidateBatchSuccess(null);
    if (!candidateBatchInput.trim()) {
      setCandidateBatchError('Please paste candidate records (Format: Matric Number, Full Name, Department, Sex: M/F).');
      return;
    }

    const lines = candidateBatchInput.trim().split('\n');
    const parsedList: Array<{ matricNumber: string; fullName: string; department: string; gender?: 'M' | 'F' }> = [];

    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx].trim();
      if (!line) continue;
      const parts = line.split(/[,|\t]+/).map(p => p.trim());
      const rawMatric = parts[0] || '';
      const rawName = parts[1] || '';
      const rawDept = parts[2] || (resolvedDepartment !== 'All Departments' ? resolvedDepartment : '');
      const rawSex = parts[3] ? parts[3].toUpperCase() : '';
      const cleanSex: 'M' | 'F' | undefined = rawSex === 'M' || rawSex === 'MALE' ? 'M' : rawSex === 'F' || rawSex === 'FEMALE' ? 'F' : undefined;

      parsedList.push({
        matricNumber: rawMatric,
        fullName: capitalizeProper(rawName),
        department: capitalizeProper(rawDept),
        gender: cleanSex
      });
    }

    // Validate batch, detect in-batch duplicates, check already registered in this exam, and reject invalid/duplicates
    const existingMatrics = new Set(registeredCandidates.map(c => c.matricNumber));
    const report = validateAndReportCandidateBatch(parsedList, existingMatrics);

    if (report.summary.rejectedCount > 0) {
      setCandidateBatchError(report.reportMessage);
      if (report.validCandidates.length > 0) {
        // Do not import duplicates or invalid records; import only strictly valid candidates
        setRegisteredCandidates(prev => [...prev, ...report.validCandidates]);
        setCandidateBatchSuccess(`Imported ${report.validCandidates.length} valid candidate(s). Note: ${report.summary.rejectedCount} record(s) were rejected (see details above).`);
        setCandidateBatchInput('');
      }
      return;
    }

    setRegisteredCandidates(prev => [...prev, ...report.validCandidates]);
    setCandidateBatchSuccess(`Successfully verified and imported all ${report.validCandidates.length} candidate(s) without duplicates.`);
    setCandidateBatchInput('');
  };

  const handleRemoveCandidate = (matricNumber: string) => {
    setRegisteredCandidates(prev => prev.filter(c => c.matricNumber !== matricNumber));
  };

  // Run duplicate check whenever questions list changes
  useEffect(() => {
    if (questions.length > 1) {
      const found = detectDuplicates(questions);
      setDuplicatePairs(found);
    } else {
      setDuplicatePairs([]);
    }
  }, [questions]);

  // Handle Bulk Parse Action
  const handleParseQuestions = () => {
    if (!pasteContent.trim()) {
      alert('Please paste questions into the text editor first.');
      return;
    }

    const result = parseBulkQuestions(pasteContent);

    if (result.questions.length === 0) {
      setParserFeedback({
        total: 0,
        valid: 0,
        errors: 0,
        message: 'Could not recognise any multiple-choice questions. Please verify format (e.g., 1. Question text, A., B., C., D., Answer: A).'
      });
      return;
    }

    // Convert parsed items to questions list
    const converted: Question[] = result.questions.map((q, idx) => ({
      id: q.id || `q_${Date.now()}_${idx}`,
      questionText: q.questionText,
      options: q.options,
      correctAnswer: q.correctAnswer >= 0 && q.correctAnswer <= 3 ? q.correctAnswer : 0,
      explanation: q.errors.length > 0 ? `Flagged: ${q.errors.join('; ')}` : ''
    }));

    setQuestions((prev) => [...prev, ...converted]);

    setParserFeedback({
      total: result.totalParsed,
      valid: result.validCount,
      errors: result.errorCount,
      message:
        result.errorCount === 0
          ? `Successfully parsed and organised ${result.totalParsed} questions!`
          : `Successfully organised ${result.validCount} questions. Note: ${result.errorCount} questions have missing options or answers and require review below.`
    });

    // Clear pasted content after successful parse
    setPasteContent('');
  };

  // Question editing actions
  const handleUpdateQuestion = (index: number, updated: Partial<Question>) => {
    setQuestions((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...updated };
      return next;
    });
  };

  const handleUpdateOption = (qIndex: number, optIndex: number, value: string) => {
    setQuestions((prev) => {
      const next = [...prev];
      const newOptions = [...next[qIndex].options] as [string, string, string, string];
      newOptions[optIndex] = value;
      next[qIndex] = { ...next[qIndex], options: newOptions };
      return next;
    });
  };

  const handleDeleteQuestion = (index: number) => {
    setQuestions((prev) => prev.filter((_, i) => i !== index));
  };

  const handleMoveQuestion = (index: number, direction: 'up' | 'down') => {
    if ((direction === 'up' && index === 0) || (direction === 'down' && index === questions.length - 1)) {
      return;
    }
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    setQuestions((prev) => {
      const next = [...prev];
      const temp = next[index];
      next[index] = next[targetIdx];
      next[targetIdx] = temp;
      return next;
    });
  };

  const handleAddNewQuestion = () => {
    const newQ: Question = {
      id: `q_${Date.now()}_${questions.length + 1}`,
      questionText: `New Question ${questions.length + 1}`,
      options: ['Option A', 'Option B', 'Option C', 'Option D'],
      correctAnswer: 0
    };
    setQuestions((prev) => [...prev, newQ]);
  };

  const handleSelectAnswerOption = (
    qIndex: number,
    choice: 'A' | 'B' | 'C' | 'D' | 'True' | 'False'
  ) => {
    const currentQ = questions[qIndex];
    if (!currentQ) return;

    if (choice === 'True') {
      const currentOpts = currentQ.options;
      const opt0 = (currentOpts[0] || '').trim().toLowerCase();
      const opt1 = (currentOpts[1] || '').trim().toLowerCase();
      const isCurrentlyTF =
        opt0 === 'true' &&
        opt1 === 'false' &&
        !currentOpts[2]?.trim() &&
        !currentOpts[3]?.trim();

      const cached = isCurrentlyTF ? currentQ._cachedMcqOptions : currentOpts;

      handleUpdateQuestion(qIndex, {
        options: ['True', 'False', '', ''],
        correctAnswer: 0,
        _cachedMcqOptions: cached
      });
    } else if (choice === 'False') {
      const currentOpts = currentQ.options;
      const opt0 = (currentOpts[0] || '').trim().toLowerCase();
      const opt1 = (currentOpts[1] || '').trim().toLowerCase();
      const isCurrentlyTF =
        opt0 === 'true' &&
        opt1 === 'false' &&
        !currentOpts[2]?.trim() &&
        !currentOpts[3]?.trim();

      const cached = isCurrentlyTF ? currentQ._cachedMcqOptions : currentOpts;

      handleUpdateQuestion(qIndex, {
        options: ['True', 'False', '', ''],
        correctAnswer: 1,
        _cachedMcqOptions: cached
      });
    } else {
      const optIdx = choice === 'A' ? 0 : choice === 'B' ? 1 : choice === 'C' ? 2 : 3;
      let newOptions = [...currentQ.options];
      const opt0 = (newOptions[0] || '').trim().toLowerCase();
      const opt1 = (newOptions[1] || '').trim().toLowerCase();
      const isCurrentlyTF =
        opt0 === 'true' &&
        opt1 === 'false' &&
        !newOptions[2]?.trim() &&
        !newOptions[3]?.trim();

      if (isCurrentlyTF) {
        const cached = currentQ._cachedMcqOptions;
        if (cached && Array.isArray(cached) && cached.length >= 4) {
          newOptions = [...cached];
        } else {
          newOptions = ['Option A', 'Option B', 'Option C', 'Option D'];
        }
      }

      handleUpdateQuestion(qIndex, {
        options: newOptions as any,
        correctAnswer: optIdx
      });
    }
  };

  // Resolved Department Name
  const resolvedDepartment =
    departmentMode === 'all' ? 'All Departments' : capitalizeProper(customDepartment);

  // Validate Examination Data
  const runValidation = (isPublishing: boolean): { isValid: boolean; errors: string[] } => {
    const errs: string[] = [];

    if (!courseCode.trim()) errs.push('Course Code is required (e.g. SPT 201).');
    if (!courseTitle.trim()) errs.push('Course Title is required.');
    if (departmentMode === 'others' && !customDepartment.trim()) {
      errs.push('Please enter the specific Department name or choose "All Departments".');
    }
    if (!durationMinutes || durationMinutes <= 0) {
      errs.push('Examination duration must be at least 1 minute.');
    }

    if (isPublishing) {
      if (!lecturerName.trim()) {
        errs.push("Lecturer's Name is mandatory before publishing an examination.");
      }

      if (questions.length === 0) {
        errs.push('An examination must contain at least 1 valid question to be published.');
      }

      // Check each question
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        if (!q.questionText.trim()) {
          errs.push(`Question #${i + 1} has empty question text.`);
        }

        const isTwoOption =
          (!q.options[2] || !q.options[2].trim()) &&
          (!q.options[3] || !q.options[3].trim()) &&
          Boolean(q.options[0]?.trim()) &&
          Boolean(q.options[1]?.trim());

        if (isTwoOption) {
          if (q.correctAnswer < 0 || q.correctAnswer > 1) {
            errs.push(`Question #${i + 1} must have either True or False / Option A or B selected as the correct answer.`);
          }
        } else {
          for (let j = 0; j < 4; j++) {
            if (!q.options[j]?.trim()) {
              errs.push(`Question #${i + 1} is missing Option ${String.fromCharCode(65 + j)}.`);
            }
          }
          if (q.correctAnswer < 0 || q.correctAnswer > 3) {
            errs.push(`Question #${i + 1} does not have a valid correct answer assigned.`);
          }
        }
      }

      const startMs = parseLagosExamTime(startDate);
      const endMs = parseLagosExamTime(endDate);
      if (startMs && endMs && endMs <= startMs) {
        errs.push('Availability End Date must be after the Start Date.');
      }
    }

    return { isValid: errs.length === 0, errors: errs };
  };

  // Save Examination to Firestore (Draft or Publish)
  const handleSave = async (publishNow = false) => {
    if (!user) {
      alert('You must be signed in as the authorized lecturer to save.');
      return;
    }

    const { isValid, errors } = runValidation(publishNow);
    if (!isValid) {
      setValidationErrors(errors);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setValidationErrors([]);

    setIsSaving(true);
    const targetStatus = publishNow ? 'published' : 'draft';

    // Generate batches if randomization is enabled
    const batches = randomizationEnabled && questions.length > 0
      ? generateExamBatches(questions)
      : undefined;

    const examData: Exam = {
      id: examId,
      lecturerId: user.uid,
      lecturerEmail: user.email || 'sunsmartcbt@gmail.com',
      lecturerName: capitalizeProper(lecturerName.trim()),
      courseCode: courseCode.trim().toUpperCase(),
      courseTitle: courseTitle.trim(),
      department: resolvedDepartment,
      durationMinutes: Number(durationMinutes) || 45,
      startDate,
      endDate,
      instructions,
      status: targetStatus,
      questionsCount: questions.length,
      targetQuestionsCount: questions.length,
      questions,
      registeredCandidates,
      randomizationEnabled,
      batches,
      createdAt: initialExam?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try {
      await setDoc(doc(db, 'exams', examId), examData);
      setStatus(targetStatus);
      onSaved(examData);

      if (publishNow) {
        setPublishModalOpen(true);
      } else {
        setSaveSuccessMessage(
          `Draft saved successfully! You can leave this page and return at any time to continue editing (Exam ID: ${examId}).`
        );
        setTimeout(() => setSaveSuccessMessage(null), 6000);
      }
    } catch (err: any) {
      console.error('Save exam error:', err);
      handleFirestoreError(err, OperationType.WRITE, `exams/${examId}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Active duplicate pairs excluding dismissed ones
  const activeDuplicatePairs = duplicatePairs.filter(
    (p) => !dismissedPairIds.has(p.id)
  );

  return (
    <div className="max-w-5xl mx-auto pb-24 px-4 sm:px-6">
      {/* Top Header & Actions Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 my-6">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm font-semibold text-[#ADCDBA] hover:text-[#F0F9F3] transition cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4 text-[#D6BF62]" />
          <span>Back to Examinations</span>
        </button>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          <button
            onClick={() => handleSave(false)}
            disabled={isSaving}
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2.5 bg-[#0A2419] hover:bg-[#0E3324] text-[#ADCDBA] font-bold text-xs sm:text-sm rounded-xl border border-[#789981]/40 shadow-sm transition disabled:opacity-50 cursor-pointer"
          >
            <Save className="w-4 h-4 text-[#789981]" />
            <span>{isSaving ? 'Saving Draft...' : 'Save as Draft'}</span>
          </button>

          <button
            onClick={() => handleSave(true)}
            disabled={isSaving}
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-5 py-2.5 bg-[#0E623B] hover:bg-[#127949] border border-[#D6BF62] text-[#F0F9F3] font-bold text-xs sm:text-sm rounded-xl shadow-lg hover:shadow-[#0E623B]/30 transition disabled:opacity-50 cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4 text-[#D6BF62]" />
            <span>
              {isSaving
                ? 'Publishing...'
                : status === 'published'
                ? 'Update & Keep Published'
                : 'Publish Examination'}
            </span>
          </button>
        </div>
      </div>

      {/* Global Notifications */}
      {saveSuccessMessage && (
        <div className="mb-6 p-4 bg-[#0A2419] border border-[#D6BF62]/40 rounded-2xl flex items-center gap-3 text-[#F0F9F3] text-xs sm:text-sm">
          <CheckCircle2 className="w-5 h-5 text-[#10B981] shrink-0" />
          <span className="font-semibold">{saveSuccessMessage}</span>
        </div>
      )}

      {validationErrors.length > 0 && (
        <div className="mb-6 p-4 bg-[#2A0808] border border-red-500/40 rounded-2xl text-red-200 text-xs sm:text-sm space-y-1">
          <div className="flex items-center gap-2 font-bold text-red-300 mb-1">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            <span>Please resolve the following issues before continuing:</span>
          </div>
          <ul className="list-disc list-inside space-y-0.5 pl-2">
            {validationErrors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {/* EXAMINATION ID CARD */}
      <div className="bg-gradient-to-br from-[#061C13] via-[#09271B] to-[#04140D] rounded-2xl sm:rounded-3xl shadow-xl p-6 sm:p-7 text-[#F0F9F3] border-2 border-[#D6BF62]/50 mb-8 transition">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
          <div className="space-y-1.5 max-w-xl">
            <h2 className="text-lg sm:text-xl font-black tracking-tight text-[#D6BF62]">
              Examination ID
            </h2>
            <p className="text-xs sm:text-sm text-[#ADCDBA] leading-relaxed">
              This unique ID belongs to this examination. Share it with your students so they can access the correct course examination through the SUN CBT website.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 bg-[#030515]/60 p-2 sm:p-2.5 rounded-2xl border border-[#D6BF62]/30 shrink-0 shadow-inner">
            <div className="px-3.5 py-2 font-mono font-black text-sm sm:text-base text-[#D6BF62] tracking-wide select-all break-all text-center sm:text-left">
              {examId}
            </div>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(examId);
                setCopiedExamId(true);
                setTimeout(() => setCopiedExamId(false), 2500);
              }}
              className={`flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all shadow-md active:scale-95 shrink-0 cursor-pointer ${
                copiedExamId
                  ? 'bg-[#10B981] text-[#061C13] font-black ring-2 ring-[#D6BF62]'
                  : 'bg-[#0E623B] hover:bg-[#127949] border border-[#D6BF62] text-[#F0F9F3] hover:shadow-lg'
              }`}
              title="Copy Exam ID to clipboard"
            >
              {copiedExamId ? (
                <>
                  <Check className="w-4 h-4 text-[#061C13] stroke-[3]" />
                  <span>Exam ID Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 text-[#D6BF62]" />
                  <span>Copy Exam ID</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-8">
        {/* SECTION 1 & 2: Course Info & Department Selection */}
        <div className="bg-[#061C13] rounded-3xl shadow-xl border border-[#789981]/30 p-6 sm:p-8">
          <div className="flex items-center gap-3 pb-4 border-b border-[#789981]/20 mb-6">
            <div className="p-2.5 bg-[#0A2419] border border-[#D6BF62]/30 rounded-xl text-[#D6BF62]">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-[#F0F9F3] text-base">
                1. Examination Information & Department Scope
              </h3>
              <p className="text-xs text-[#ADCDBA]">
                Configure course code, course title, and department eligibility
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Course Code */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#ADCDBA] mb-1.5">
                Course Code <span className="text-[#D6BF62]">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="e.g. SPT 201"
                value={courseCode}
                onChange={(e) => setCourseCode(e.target.value.toUpperCase())}
                className="w-full px-4 py-3 bg-[#0A2419] border border-[#789981]/40 rounded-xl text-sm font-semibold text-[#F0F9F3] placeholder-[#789981]/70 focus:outline-none focus:border-[#D6BF62] focus:ring-1 focus:ring-[#D6BF62]"
              />
            </div>

            {/* Course Title */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#ADCDBA] mb-1.5">
                Course Title <span className="text-[#D6BF62]">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Exercise Physiology & Sports Biomechanics"
                value={courseTitle}
                onChange={(e) => setCourseTitle(e.target.value)}
                className="w-full px-4 py-3 bg-[#0A2419] border border-[#789981]/40 rounded-xl text-sm font-semibold text-[#F0F9F3] placeholder-[#789981]/70 focus:outline-none focus:border-[#D6BF62] focus:ring-1 focus:ring-[#D6BF62]"
              />
            </div>

            {/* Lecturer's Name Field (Dedicated Mandatory Field) */}
            <div className="md:col-span-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-[#ADCDBA] mb-1.5 flex items-center justify-between">
                <span>
                  Lecturer's Name <span className="text-[#D6BF62]">*</span>
                </span>
                <span className="text-[10px] text-[#D6BF62] font-semibold">
                  Mandatory for publication
                </span>
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Dr. Emmanuel Okafor or Prof. A. B. Adeleke"
                value={lecturerName}
                onChange={(e) => setLecturerName(e.target.value)}
                onBlur={(e) => setLecturerName(capitalizeProper(e.target.value))}
                className="w-full px-4 py-3 bg-[#0A2419] border border-[#789981]/40 rounded-xl text-sm font-semibold text-[#F0F9F3] placeholder-[#789981]/70 focus:outline-none focus:border-[#D6BF62] focus:ring-1 focus:ring-[#D6BF62]"
              />
              <p className="text-[11px] text-[#789981] mt-1">
                Enter the course lecturer's full name. This will be automatically associated with this examination, student examination scripts, and official result reports.
              </p>
            </div>

            {/* Department Selection (Simplified: All Departments or Others) */}
            <div className="md:col-span-2 bg-[#0A2419] p-5 rounded-2xl border border-[#789981]/30 space-y-4">
              <label className="block text-xs font-bold uppercase tracking-wider text-[#ADCDBA]">
                Department Eligibility Scope <span className="text-[#D6BF62]">*</span>
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Option 1: All Departments */}
                <label
                  className={`flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition ${
                    departmentMode === 'all'
                      ? 'border-[#D6BF62] bg-[#061C13] shadow-md'
                      : 'border-[#789981]/30 hover:border-[#789981]/60 bg-[#030515]/40'
                  }`}
                >
                  <input
                    type="radio"
                    name="deptMode"
                    value="all"
                    checked={departmentMode === 'all'}
                    onChange={() => setDepartmentMode('all')}
                    className="mt-1 text-[#0E623B] focus:ring-[#D6BF62]"
                  />
                  <div>
                    <span className="text-sm font-bold text-[#F0F9F3] block">All Departments</span>
                    <span className="text-xs text-[#ADCDBA] block mt-0.5">
                      Available to eligible candidates across all faculties and academic departments.
                    </span>
                  </div>
                </label>

                {/* Option 2: Others */}
                <label
                  className={`flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition ${
                    departmentMode === 'others'
                      ? 'border-[#D6BF62] bg-[#061C13] shadow-md'
                      : 'border-[#789981]/30 hover:border-[#789981]/60 bg-[#030515]/40'
                  }`}
                >
                  <input
                    type="radio"
                    name="deptMode"
                    value="others"
                    checked={departmentMode === 'others'}
                    onChange={() => setDepartmentMode('others')}
                    className="mt-1 text-[#0E623B] focus:ring-[#D6BF62]"
                  />
                  <div>
                    <span className="text-sm font-bold text-[#F0F9F3] block">Others (Specific Department)</span>
                    <span className="text-xs text-[#ADCDBA] block mt-0.5">
                      Restrict or designate this examination for a specific department.
                    </span>
                  </div>
                </label>
              </div>

              {/* Conditional Manual Department Input */}
              {departmentMode === 'others' && (
                <div className="pt-2 animate-fadeIn">
                  <label className="block text-xs font-bold uppercase tracking-wider text-[#ADCDBA] mb-1.5">
                    Enter Department <span className="text-[#D6BF62]">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Human Kinetics & Sports Science"
                    value={customDepartment}
                    onChange={(e) => setCustomDepartment(e.target.value)}
                    className="w-full px-4 py-3 bg-[#061C13] border border-[#789981]/40 rounded-xl text-sm font-semibold text-[#F0F9F3] placeholder-[#789981]/70 focus:outline-none focus:border-[#D6BF62] focus:ring-1 focus:ring-[#D6BF62]"
                  />
                  <p className="text-[11px] text-[#789981] mt-1">
                    Note: Students will also confirm their personal department during examination registration.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* SECTION 3: Duration & Availability */}
        <div className="bg-[#061C13] rounded-3xl shadow-xl border border-[#789981]/30 p-6 sm:p-8">
          <div className="flex items-center gap-3 pb-4 border-b border-[#789981]/20 mb-6">
            <div className="p-2.5 bg-[#0A2419] border border-[#D6BF62]/30 rounded-xl text-[#D6BF62]">
              <Clock className="w-5 h-5 text-[#D6BF62]" />
            </div>
            <div>
              <h3 className="font-extrabold text-[#F0F9F3] text-base">
                2. Examination Duration & Schedule
              </h3>
              <p className="text-xs text-[#ADCDBA]">
                Define the allowed time and examination availability window
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-6">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#ADCDBA] mb-1.5">
                Duration (Minutes) <span className="text-[#D6BF62]">*</span>
              </label>
              <input
                type="number"
                min="1"
                max="300"
                required
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="w-full px-4 py-3 bg-[#0A2419] border border-[#789981]/40 rounded-xl text-sm font-semibold text-[#F0F9F3] focus:outline-none focus:border-[#D6BF62] focus:ring-1 focus:ring-[#D6BF62]"
              />
              <span className="text-[11px] text-[#789981] mt-1 block">
                Server timer automatically submits when time expires.
              </span>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#ADCDBA] mb-1.5">
                Availability Starts
              </label>
              <input
                type="datetime-local"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-4 py-3 bg-[#0A2419] border border-[#789981]/40 rounded-xl text-xs sm:text-sm font-medium text-[#F0F9F3] focus:outline-none focus:border-[#D6BF62] focus:ring-1 focus:ring-[#D6BF62]"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#ADCDBA] mb-1.5">
                Availability Closes
              </label>
              <input
                type="datetime-local"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-4 py-3 bg-[#0A2419] border border-[#789981]/40 rounded-xl text-xs sm:text-sm font-medium text-[#F0F9F3] focus:outline-none focus:border-[#D6BF62] focus:ring-1 focus:ring-[#D6BF62]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[#ADCDBA] mb-1.5">
              Candidate Examination Instructions
            </label>
            <textarea
              rows={3}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              className="w-full p-4 bg-[#0A2419] border border-[#789981]/40 rounded-xl text-xs sm:text-sm font-medium text-[#F0F9F3] focus:outline-none focus:border-[#D6BF62] focus:ring-1 focus:ring-[#D6BF62]"
            />
          </div>
        </div>

        {/* SECTION 4: BULK QUESTION PASTING EDITOR */}
        <div className="bg-[#061C13] rounded-3xl shadow-xl border border-[#789981]/30 p-6 sm:p-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-[#789981]/20 mb-6">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-[#0A2419] border border-[#D6BF62]/30 rounded-xl text-[#D6BF62]">
                <Sparkles className="w-5 h-5 text-[#D6BF62]" />
              </div>
              <div>
                <h3 className="font-extrabold text-[#F0F9F3] text-base">
                  3. Add Examination Questions
                </h3>
                <p className="text-xs text-[#ADCDBA]">
                  Paste entire question papers containing questions, options A–D, and correct answers
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setPasteContent(RECOMMENDED_PASTE_SAMPLE)}
              className="text-xs font-bold text-[#D6BF62] hover:text-[#F0F9F3] bg-[#0A2419] hover:bg-[#0E3324] px-3 py-1.5 rounded-lg border border-[#D6BF62]/30 transition cursor-pointer"
            >
              Load Sample Format
            </button>
          </div>

          {/* Multiline Paste Text Editor */}
          <div className="space-y-4">
            <div className="relative">
              <textarea
                rows={10}
                value={pasteContent}
                onChange={(e) => setPasteContent(e.target.value)}
                placeholder={`1. Which of the following is a component of physical fitness?\n   A. Flexibility\n   B. Television\n   C. Politics\n   D. Agriculture\n   Answer: A\n\n2. What is the primary purpose of warming up before exercise?\n   A. To cause fatigue\n   B. To prepare the body for activity\n   C. To reduce body temperature\n   D. To stop blood circulation\n   Answer: B`}
                className="w-full p-4 font-mono text-xs sm:text-sm bg-[#0A2419] border border-[#789981]/40 rounded-2xl text-[#F0F9F3] placeholder-[#789981]/70 focus:bg-[#061C13] focus:outline-none focus:border-[#D6BF62] focus:ring-1 focus:ring-[#D6BF62] leading-relaxed"
              />
            </div>

            {/* Action Button: Parse and Organise Questions */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="text-xs text-[#789981]">
                Supports standard formats: <code className="bg-[#0A2419] text-[#D6BF62] px-1 py-0.5 rounded border border-[#789981]/30">1.</code>, <code className="bg-[#0A2419] text-[#D6BF62] px-1 py-0.5 rounded border border-[#789981]/30">1)</code>, <code className="bg-[#0A2419] text-[#D6BF62] px-1 py-0.5 rounded border border-[#789981]/30">Question 1.</code>, <code className="bg-[#0A2419] text-[#D6BF62] px-1 py-0.5 rounded border border-[#789981]/30">Answer: A</code>
              </div>

              <button
                type="button"
                onClick={handleParseQuestions}
                disabled={!pasteContent.trim()}
                className="w-full sm:w-auto px-6 py-3 bg-[#0E623B] hover:bg-[#127949] border border-[#D6BF62] text-[#F0F9F3] font-extrabold text-sm rounded-xl shadow-lg hover:shadow-[#0E623B]/30 transition flex items-center justify-center gap-2 disabled:opacity-40 cursor-pointer"
              >
                <Sparkles className="w-4 h-4 text-[#D6BF62]" />
                <span>Parse and Organise Questions</span>
              </button>
            </div>

            {/* Parser Feedback Display */}
            {parserFeedback && (
              <div
                className={`p-4 rounded-2xl border text-xs sm:text-sm flex items-start gap-3 ${
                  parserFeedback.errors > 0
                    ? 'bg-[#0A2419] border-amber-400/40 text-amber-200'
                    : 'bg-[#0A2419] border-[#D6BF62]/40 text-[#ADCDBA]'
                }`}
              >
                {parserFeedback.errors > 0 ? (
                  <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                ) : (
                  <CheckCircle2 className="w-5 h-5 text-[#10B981] shrink-0 mt-0.5" />
                )}
                <div>
                  <p className="font-bold text-[#F0F9F3]">{parserFeedback.message}</p>
                  <p className="text-xs text-[#ADCDBA] opacity-90 mt-1">
                    Total Organised: {parserFeedback.total} questions ({parserFeedback.valid} ready, {parserFeedback.errors} flagged).
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* SECTION 5: DUPLICATE QUESTIONS DETECTION BANNER */}
        {activeDuplicatePairs.length > 0 && (
          <div className="bg-[#0A2419] rounded-3xl border-2 border-amber-400/50 p-6 shadow-xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-400/20 text-amber-300 rounded-xl border border-amber-400/30">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-extrabold text-[#F0F9F3] text-sm sm:text-base">
                  Duplicate Questions Detected ({activeDuplicatePairs.length})
                </h4>
                <p className="text-xs text-[#ADCDBA]">
                  The system detected questions that are identical or highly similar. You can review them side by side, edit, or delete.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              {activeDuplicatePairs.map((pair) => (
                <div
                  key={pair.id}
                  className="bg-[#061C13] p-4 rounded-2xl border border-amber-400/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs"
                >
                  <div>
                    <span className="font-bold text-[#F0F9F3]">
                      Possible duplicate detected: Question {pair.q1Number} and Question {pair.q2Number}
                    </span>
                    <span className="ml-2 px-2 py-0.5 bg-amber-400/20 text-amber-300 rounded font-semibold text-[10px] border border-amber-400/40">
                      {pair.similarity}% similarity
                    </span>
                    <p className="text-[#ADCDBA] mt-1 line-clamp-1 italic">
                      "{pair.q1Text}"
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setActiveComparePair(pair)}
                      className="px-3 py-1.5 bg-[#0E623B] hover:bg-[#127949] border border-[#D6BF62] text-[#F0F9F3] font-bold rounded-lg transition cursor-pointer"
                    >
                      Compare Side-by-Side
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDismissedPairIds((prev) => new Set([...prev, pair.id]));
                      }}
                      className="px-3 py-1.5 bg-[#0A2419] hover:bg-[#0E3324] text-[#ADCDBA] border border-[#789981]/40 font-semibold rounded-lg transition cursor-pointer"
                    >
                      Keep Both
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SECTION 6: QUESTION RANDOMISATION & BATCHES */}
        <div className="bg-[#061C13] rounded-3xl shadow-xl border border-[#789981]/30 p-6 sm:p-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-[#789981]/20 mb-6">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-[#0A2419] border border-[#D6BF62]/30 rounded-xl text-[#D6BF62]">
                <Shuffle className="w-5 h-5 text-[#D6BF62]" />
              </div>
              <div>
                <h3 className="font-extrabold text-[#F0F9F3] text-base">
                  4. Question Randomisation & Examination Batches
                </h3>
                <p className="text-xs text-[#ADCDBA]">
                  Automatically generate distinct question orders across 4 examination batches (A, B, C, D)
                </p>
              </div>
            </div>

            {/* Randomization Toggle */}
            <label className="flex items-center gap-3 cursor-pointer">
              <span className="text-xs font-bold text-[#ADCDBA]">
                {randomizationEnabled ? 'Randomisation Enabled' : 'Randomisation Disabled'}
              </span>
              <div
                onClick={() => setRandomizationEnabled(!randomizationEnabled)}
                className={`w-12 h-6 flex items-center rounded-full p-1 cursor-pointer transition ${
                  randomizationEnabled ? 'bg-[#0E623B] border border-[#D6BF62]/50' : 'bg-[#0A2419] border border-[#789981]/40'
                }`}
              >
                <div
                  className={`bg-[#F0F9F3] w-4 h-4 rounded-full shadow-md transform transition ${
                    randomizationEnabled ? 'translate-x-6 bg-[#D6BF62]' : 'translate-x-0'
                  }`}
                />
              </div>
            </label>
          </div>

          {randomizationEnabled ? (
            <div className="space-y-4">
              <p className="text-xs text-[#ADCDBA] leading-relaxed">
                When enabled, candidates will be evenly distributed across four consistent examination batches. Each batch uses a distinct question sequence while preserving exact question contents and automated grading accuracy.
              </p>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
                {['Batch A', 'Batch B', 'Batch C', 'Batch D'].map((bName, bIdx) => (
                  <div
                    key={bName}
                    className="p-3.5 rounded-2xl border border-[#789981]/30 bg-[#0A2419] text-center"
                  >
                    <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-[#0E623B] text-[#D6BF62] border border-[#D6BF62]/30 mb-1">
                      {bName}
                    </span>
                    <p className="text-xs font-bold text-[#F0F9F3]">
                      {questions.length} Questions
                    </p>
                    <p className="text-[10px] text-[#789981] mt-0.5">
                      {bIdx === 0 ? 'Master Order' : `Permuted Sequence #${bIdx + 1}`}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-[#789981] italic">
              Question randomisation is currently disabled. All candidates will receive questions in the exact order listed below.
            </p>
          )}
        </div>

        {/* SECTION 7: PARSED QUESTIONS REVIEW & EDITING */}
        <div className="bg-[#061C13] rounded-3xl shadow-xl border border-[#789981]/30 p-6 sm:p-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-[#789981]/20 mb-6">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-extrabold text-[#F0F9F3] text-base">
                  5. Review and Organised Questions ({questions.length})
                </h3>
                <span className="px-2.5 py-0.5 bg-[#0E623B] text-[#D6BF62] border border-[#D6BF62]/30 rounded-full text-xs font-extrabold">
                  {questions.length} Active
                </span>
              </div>
              <p className="text-xs text-[#ADCDBA] mt-0.5">
                Edit question texts, change options, assign correct answers, or reorder questions
              </p>
            </div>

            <button
              type="button"
              onClick={handleAddNewQuestion}
              className="flex items-center gap-1.5 px-4 py-2 bg-[#0E623B] hover:bg-[#127949] text-[#F0F9F3] font-bold text-xs rounded-xl border border-[#D6BF62]/40 transition cursor-pointer shadow-sm"
            >
              <Plus className="w-4 h-4 text-[#D6BF62]" />
              <span>Add Question</span>
            </button>
          </div>

          {questions.length === 0 ? (
            <div className="py-12 text-center text-[#789981]">
              <FileText className="w-12 h-12 mx-auto text-[#789981] mb-2" />
              <p className="font-bold text-sm text-[#F0F9F3]">No questions added yet</p>
              <p className="text-xs text-[#ADCDBA] mt-1 max-w-sm mx-auto">
                Paste your question paper in Section 3 above or click "Add Question" to begin.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {questions.map((q, qIndex) => {
                const optA = (q.options[0] || '').trim().toLowerCase();
                const optB = (q.options[1] || '').trim().toLowerCase();
                const isTrueFalseQ =
                  optA === 'true' &&
                  optB === 'false' &&
                  !q.options[2]?.trim() &&
                  !q.options[3]?.trim();

                const isCorrectA = !isTrueFalseQ && q.correctAnswer === 0;
                const isCorrectB = !isTrueFalseQ && q.correctAnswer === 1;
                const isCorrectC = !isTrueFalseQ && q.correctAnswer === 2;
                const isCorrectD = !isTrueFalseQ && q.correctAnswer === 3;
                const isCorrectTrue = isTrueFalseQ && q.correctAnswer === 0;
                const isCorrectFalse = isTrueFalseQ && q.correctAnswer === 1;

                return (
                  <div
                    key={q.id || qIndex}
                    className="p-5 sm:p-6 rounded-2xl border border-[#789981]/30 bg-[#0A2419] hover:border-[#D6BF62]/40 transition space-y-4"
                  >
                    {/* Question Header & Order Controls */}
                    <div className="flex items-center justify-between gap-2 border-b border-[#789981]/20 pb-3">
                      <div className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-lg bg-[#0E623B] text-[#D6BF62] border border-[#D6BF62]/30 flex items-center justify-center font-bold text-xs">
                          {qIndex + 1}
                        </span>
                        <span className="text-xs font-bold text-[#F0F9F3] uppercase tracking-wide">
                          Question #{qIndex + 1}
                        </span>
                        {q.explanation && q.explanation.startsWith('Flagged:') && (
                          <span className="px-2 py-0.5 bg-amber-400/20 text-amber-300 text-[10px] font-bold rounded border border-amber-400/30">
                            Needs Review
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleMoveQuestion(qIndex, 'up')}
                          disabled={qIndex === 0}
                          title="Move Up"
                          className="p-1.5 text-[#789981] hover:text-[#F0F9F3] disabled:opacity-20 rounded cursor-pointer"
                        >
                          <ChevronUp className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMoveQuestion(qIndex, 'down')}
                          disabled={qIndex === questions.length - 1}
                          title="Move Down"
                          className="p-1.5 text-[#789981] hover:text-[#F0F9F3] disabled:opacity-20 rounded cursor-pointer"
                        >
                          <ChevronDown className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteQuestion(qIndex)}
                          title="Delete Question"
                          className="p-1.5 text-red-400 hover:text-red-300 rounded ml-1 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Question Text */}
                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-[#789981] mb-1">
                        Question Text
                      </label>
                      <textarea
                        rows={2}
                        value={q.questionText}
                        onChange={(e) => handleUpdateQuestion(qIndex, { questionText: e.target.value })}
                        placeholder="Enter question text here..."
                        className="w-full p-3 bg-[#061C13] border border-[#789981]/40 rounded-xl text-xs sm:text-sm font-semibold text-[#F0F9F3] placeholder-[#789981]/70 focus:outline-none focus:border-[#D6BF62] focus:ring-1 focus:ring-[#D6BF62]"
                      />
                    </div>

                    {/* Unified Section: Set the Correct Answer */}
                    <div className="space-y-2.5 pt-1">
                      <div className="flex flex-wrap items-center justify-between gap-1">
                        <label className="block text-xs font-bold uppercase tracking-wider text-[#ADCDBA]">
                          Set the Correct Answer
                        </label>
                        <span className="text-[11px] text-[#789981]">
                          Select exactly one correct answer from the six options below
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {/* 1. Option A */}
                        <div
                          className={`p-3.5 rounded-xl border transition ${
                            isCorrectA
                              ? 'bg-[#0E623B]/30 border-2 border-[#D6BF62] shadow-sm'
                              : 'bg-[#061C13] border-[#789981]/30 hover:border-[#789981]/60'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <div className="flex items-center gap-2">
                              <span
                                className={`w-6 h-6 rounded-lg flex items-center justify-center font-black text-xs transition ${
                                  isCorrectA
                                    ? 'bg-[#D6BF62] text-[#061C13]'
                                    : 'bg-[#030515] text-[#ADCDBA] border border-[#789981]/30'
                                }`}
                              >
                                A
                              </span>
                              <span className="text-xs font-bold text-[#F0F9F3]">Option A</span>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleSelectAnswerOption(qIndex, 'A')}
                              className={`text-[11px] font-bold px-3 py-1 rounded-lg transition cursor-pointer flex items-center gap-1 ${
                                isCorrectA
                                  ? 'bg-[#D6BF62] text-[#061C13] shadow-sm ring-1 ring-[#D6BF62]'
                                  : 'bg-[#0A2419] hover:bg-[#0E3324] text-[#ADCDBA] border border-[#789981]/30 hover:text-[#F0F9F3]'
                              }`}
                            >
                              {isCorrectA ? '✓ Correct Answer' : 'Set as Correct'}
                            </button>
                          </div>

                          <input
                            type="text"
                            value={isTrueFalseQ ? '' : (q.options[0] || '')}
                            disabled={isTrueFalseQ}
                            onChange={(e) => handleUpdateOption(qIndex, 0, e.target.value)}
                            placeholder={isTrueFalseQ ? 'Disabled for True/False (Click Set as Correct to enable)' : 'Enter Option A'}
                            className={`w-full px-3 py-2 rounded-xl text-xs font-medium focus:outline-none transition ${
                              isTrueFalseQ
                                ? 'bg-[#0A2419]/40 text-[#789981]/50 border border-[#789981]/20 cursor-not-allowed placeholder-[#789981]/40'
                                : 'bg-[#0A2419] border border-[#789981]/40 text-[#F0F9F3] placeholder-[#789981]/70 focus:border-[#D6BF62] focus:ring-1 focus:ring-[#D6BF62]'
                            }`}
                          />
                        </div>

                        {/* 2. Option B */}
                        <div
                          className={`p-3.5 rounded-xl border transition ${
                            isCorrectB
                              ? 'bg-[#0E623B]/30 border-2 border-[#D6BF62] shadow-sm'
                              : 'bg-[#061C13] border-[#789981]/30 hover:border-[#789981]/60'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <div className="flex items-center gap-2">
                              <span
                                className={`w-6 h-6 rounded-lg flex items-center justify-center font-black text-xs transition ${
                                  isCorrectB
                                    ? 'bg-[#D6BF62] text-[#061C13]'
                                    : 'bg-[#030515] text-[#ADCDBA] border border-[#789981]/30'
                                }`}
                              >
                                B
                              </span>
                              <span className="text-xs font-bold text-[#F0F9F3]">Option B</span>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleSelectAnswerOption(qIndex, 'B')}
                              className={`text-[11px] font-bold px-3 py-1 rounded-lg transition cursor-pointer flex items-center gap-1 ${
                                isCorrectB
                                  ? 'bg-[#D6BF62] text-[#061C13] shadow-sm ring-1 ring-[#D6BF62]'
                                  : 'bg-[#0A2419] hover:bg-[#0E3324] text-[#ADCDBA] border border-[#789981]/30 hover:text-[#F0F9F3]'
                              }`}
                            >
                              {isCorrectB ? '✓ Correct Answer' : 'Set as Correct'}
                            </button>
                          </div>

                          <input
                            type="text"
                            value={isTrueFalseQ ? '' : (q.options[1] || '')}
                            disabled={isTrueFalseQ}
                            onChange={(e) => handleUpdateOption(qIndex, 1, e.target.value)}
                            placeholder={isTrueFalseQ ? 'Disabled for True/False (Click Set as Correct to enable)' : 'Enter Option B'}
                            className={`w-full px-3 py-2 rounded-xl text-xs font-medium focus:outline-none transition ${
                              isTrueFalseQ
                                ? 'bg-[#0A2419]/40 text-[#789981]/50 border border-[#789981]/20 cursor-not-allowed placeholder-[#789981]/40'
                                : 'bg-[#0A2419] border border-[#789981]/40 text-[#F0F9F3] placeholder-[#789981]/70 focus:border-[#D6BF62] focus:ring-1 focus:ring-[#D6BF62]'
                            }`}
                          />
                        </div>

                        {/* 3. Option C */}
                        <div
                          className={`p-3.5 rounded-xl border transition ${
                            isCorrectC
                              ? 'bg-[#0E623B]/30 border-2 border-[#D6BF62] shadow-sm'
                              : 'bg-[#061C13] border-[#789981]/30 hover:border-[#789981]/60'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <div className="flex items-center gap-2">
                              <span
                                className={`w-6 h-6 rounded-lg flex items-center justify-center font-black text-xs transition ${
                                  isCorrectC
                                    ? 'bg-[#D6BF62] text-[#061C13]'
                                    : 'bg-[#030515] text-[#ADCDBA] border border-[#789981]/30'
                                }`}
                              >
                                C
                              </span>
                              <span className="text-xs font-bold text-[#F0F9F3]">Option C</span>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleSelectAnswerOption(qIndex, 'C')}
                              className={`text-[11px] font-bold px-3 py-1 rounded-lg transition cursor-pointer flex items-center gap-1 ${
                                isCorrectC
                                  ? 'bg-[#D6BF62] text-[#061C13] shadow-sm ring-1 ring-[#D6BF62]'
                                  : 'bg-[#0A2419] hover:bg-[#0E3324] text-[#ADCDBA] border border-[#789981]/30 hover:text-[#F0F9F3]'
                              }`}
                            >
                              {isCorrectC ? '✓ Correct Answer' : 'Set as Correct'}
                            </button>
                          </div>

                          <input
                            type="text"
                            value={isTrueFalseQ ? '' : (q.options[2] || '')}
                            disabled={isTrueFalseQ}
                            onChange={(e) => handleUpdateOption(qIndex, 2, e.target.value)}
                            placeholder={isTrueFalseQ ? 'Disabled for True/False (Click Set as Correct to enable)' : 'Enter Option C'}
                            className={`w-full px-3 py-2 rounded-xl text-xs font-medium focus:outline-none transition ${
                              isTrueFalseQ
                                ? 'bg-[#0A2419]/40 text-[#789981]/50 border border-[#789981]/20 cursor-not-allowed placeholder-[#789981]/40'
                                : 'bg-[#0A2419] border border-[#789981]/40 text-[#F0F9F3] placeholder-[#789981]/70 focus:border-[#D6BF62] focus:ring-1 focus:ring-[#D6BF62]'
                            }`}
                          />
                        </div>

                        {/* 4. Option D */}
                        <div
                          className={`p-3.5 rounded-xl border transition ${
                            isCorrectD
                              ? 'bg-[#0E623B]/30 border-2 border-[#D6BF62] shadow-sm'
                              : 'bg-[#061C13] border-[#789981]/30 hover:border-[#789981]/60'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <div className="flex items-center gap-2">
                              <span
                                className={`w-6 h-6 rounded-lg flex items-center justify-center font-black text-xs transition ${
                                  isCorrectD
                                    ? 'bg-[#D6BF62] text-[#061C13]'
                                    : 'bg-[#030515] text-[#ADCDBA] border border-[#789981]/30'
                                }`}
                              >
                                D
                              </span>
                              <span className="text-xs font-bold text-[#F0F9F3]">Option D</span>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleSelectAnswerOption(qIndex, 'D')}
                              className={`text-[11px] font-bold px-3 py-1 rounded-lg transition cursor-pointer flex items-center gap-1 ${
                                isCorrectD
                                  ? 'bg-[#D6BF62] text-[#061C13] shadow-sm ring-1 ring-[#D6BF62]'
                                  : 'bg-[#0A2419] hover:bg-[#0E3324] text-[#ADCDBA] border border-[#789981]/30 hover:text-[#F0F9F3]'
                              }`}
                            >
                              {isCorrectD ? '✓ Correct Answer' : 'Set as Correct'}
                            </button>
                          </div>

                          <input
                            type="text"
                            value={isTrueFalseQ ? '' : (q.options[3] || '')}
                            disabled={isTrueFalseQ}
                            onChange={(e) => handleUpdateOption(qIndex, 3, e.target.value)}
                            placeholder={isTrueFalseQ ? 'Disabled for True/False (Click Set as Correct to enable)' : 'Enter Option D'}
                            className={`w-full px-3 py-2 rounded-xl text-xs font-medium focus:outline-none transition ${
                              isTrueFalseQ
                                ? 'bg-[#0A2419]/40 text-[#789981]/50 border border-[#789981]/20 cursor-not-allowed placeholder-[#789981]/40'
                                : 'bg-[#0A2419] border border-[#789981]/40 text-[#F0F9F3] placeholder-[#789981]/70 focus:border-[#D6BF62] focus:ring-1 focus:ring-[#D6BF62]'
                            }`}
                          />
                        </div>

                        {/* 5. True */}
                        <div
                          className={`p-3.5 rounded-xl border transition ${
                            isCorrectTrue
                              ? 'bg-[#0E623B]/30 border-2 border-[#D6BF62] shadow-sm'
                              : 'bg-[#061C13] border-[#789981]/30 hover:border-[#789981]/60'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <div className="flex items-center gap-2">
                              <span
                                className={`w-6 h-6 rounded-lg flex items-center justify-center font-black text-xs transition ${
                                  isCorrectTrue
                                    ? 'bg-[#D6BF62] text-[#061C13]'
                                    : 'bg-[#030515] text-[#ADCDBA] border border-[#789981]/30'
                                }`}
                              >
                                T
                              </span>
                              <span className="text-xs font-bold text-[#F0F9F3]">True</span>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleSelectAnswerOption(qIndex, 'True')}
                              className={`text-[11px] font-bold px-3 py-1 rounded-lg transition cursor-pointer flex items-center gap-1 ${
                                isCorrectTrue
                                  ? 'bg-[#D6BF62] text-[#061C13] shadow-sm ring-1 ring-[#D6BF62]'
                                  : 'bg-[#0A2419] hover:bg-[#0E3324] text-[#ADCDBA] border border-[#789981]/30 hover:text-[#F0F9F3]'
                              }`}
                            >
                              {isCorrectTrue ? '✓ Correct Answer' : 'Set as Correct'}
                            </button>
                          </div>

                          <div className="px-3 py-2 rounded-xl bg-[#0A2419]/60 border border-[#789981]/20 flex items-center justify-between text-xs text-[#ADCDBA]">
                            <span className="font-medium">True statement answer</span>
                            <span className="text-[10px] font-bold text-[#D6BF62] bg-[#0E623B]/60 px-2 py-0.5 rounded border border-[#D6BF62]/30">
                              ✓ Correct if True
                            </span>
                          </div>
                        </div>

                        {/* 6. False */}
                        <div
                          className={`p-3.5 rounded-xl border transition ${
                            isCorrectFalse
                              ? 'bg-[#0E623B]/30 border-2 border-[#D6BF62] shadow-sm'
                              : 'bg-[#061C13] border-[#789981]/30 hover:border-[#789981]/60'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <div className="flex items-center gap-2">
                              <span
                                className={`w-6 h-6 rounded-lg flex items-center justify-center font-black text-xs transition ${
                                  isCorrectFalse
                                    ? 'bg-[#D6BF62] text-[#061C13]'
                                    : 'bg-[#030515] text-[#ADCDBA] border border-[#789981]/30'
                                }`}
                              >
                                F
                              </span>
                              <span className="text-xs font-bold text-[#F0F9F3]">False</span>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleSelectAnswerOption(qIndex, 'False')}
                              className={`text-[11px] font-bold px-3 py-1 rounded-lg transition cursor-pointer flex items-center gap-1 ${
                                isCorrectFalse
                                  ? 'bg-[#D6BF62] text-[#061C13] shadow-sm ring-1 ring-[#D6BF62]'
                                  : 'bg-[#0A2419] hover:bg-[#0E3324] text-[#ADCDBA] border border-[#789981]/30 hover:text-[#F0F9F3]'
                              }`}
                            >
                              {isCorrectFalse ? '✓ Correct Answer' : 'Set as Correct'}
                            </button>
                          </div>

                          <div className="px-3 py-2 rounded-xl bg-[#0A2419]/60 border border-[#789981]/20 flex items-center justify-between text-xs text-[#ADCDBA]">
                            <span className="font-medium">False statement answer</span>
                            <span className="text-[10px] font-bold text-[#D6BF62] bg-[#0E623B]/60 px-2 py-0.5 rounded border border-[#D6BF62]/30">
                              ✓ Correct if False
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* SECTION 6: CANDIDATE PRE-REGISTRATION & BATCH DUPLICATE DETECTION */}
        <div className="bg-[#061C13] rounded-3xl shadow-xl border border-[#789981]/30 p-6 sm:p-8 space-y-5">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-[#789981]/20">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-[#0A2419] border border-[#D6BF62]/30 rounded-xl text-[#D6BF62]">
                <Users className="w-5 h-5 text-[#D6BF62]" />
              </div>
              <div>
                <h3 className="font-extrabold text-[#F0F9F3] text-base">
                  6. Candidate Roster & Pre-Registration ({registeredCandidates.length})
                </h3>
                <p className="text-xs text-[#ADCDBA]">
                  Pre-register candidates and perform batch duplicate matriculation detection before the examination begins
                </p>
              </div>
            </div>

            <span className="px-3 py-1 bg-[#0E623B] text-[#D6BF62] border border-[#D6BF62]/40 rounded-full text-xs font-extrabold">
              {registeredCandidates.length} Registered
            </span>
          </div>

          <div className="space-y-3">
            <label className="block text-xs font-bold uppercase tracking-wider text-[#ADCDBA]">
              Paste Candidate Records (Format: Matric Number, Full Name, Department, Sex [M/F])
            </label>
            <textarea
              rows={4}
              value={candidateBatchInput}
              onChange={(e) => {
                setCandidateBatchInput(e.target.value);
                setCandidateBatchError(null);
              }}
              placeholder={`2026201120, John Doe, Anatomy, M\nDE2026201121, Jane Smith, Nursing, F`}
              className="w-full p-3.5 bg-[#0A2419] border border-[#789981]/40 rounded-xl text-xs sm:text-sm font-mono text-[#F0F9F3] placeholder-[#789981]/60 focus:outline-none focus:border-[#D6BF62] focus:ring-1 focus:ring-[#D6BF62]"
            />
            <p className="text-[11px] text-[#789981]">
              Accepted matriculation formats: 10 digits (e.g. 2026201120) or Direct Entry DE followed by 10 digits (e.g. DE2026201120). Duplicates within this examination are automatically rejected.
            </p>

            {candidateBatchError && (
              <div className="p-3.5 bg-[#2A0808] border border-red-500/50 rounded-xl text-red-200 text-xs flex items-start gap-2.5 whitespace-pre-line">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span>{candidateBatchError}</span>
              </div>
            )}

            {candidateBatchSuccess && (
              <div className="p-3 bg-[#082216] border border-[#0E623B] rounded-xl text-emerald-300 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{candidateBatchSuccess}</span>
              </div>
            )}

            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={handleProcessCandidateBatch}
                className="flex items-center gap-1.5 px-4 py-2.5 bg-[#0E623B] hover:bg-[#127949] text-[#F0F9F3] font-bold text-xs rounded-xl border border-[#D6BF62]/50 transition cursor-pointer shadow-md"
              >
                <Upload className="w-4 h-4 text-[#D6BF62]" />
                <span>Verify & Import Candidates</span>
              </button>

              {registeredCandidates.length > 0 && (
                <button
                  type="button"
                  onClick={() => setRegisteredCandidates([])}
                  className="px-3.5 py-2.5 bg-[#0A2419] hover:bg-red-950/40 text-red-300 font-bold text-xs rounded-xl border border-red-500/30 transition cursor-pointer"
                >
                  Clear Roster ({registeredCandidates.length})
                </button>
              )}
            </div>
          </div>

          {registeredCandidates.length > 0 && (
            <div className="mt-4 pt-4 border-t border-[#789981]/20">
              <div className="max-h-60 overflow-y-auto rounded-xl border border-[#789981]/30">
                <table className="w-full text-left text-xs text-[#ADCDBA]">
                  <thead className="bg-[#0A2419] text-[#789981] uppercase font-bold sticky top-0 border-b border-[#789981]/30">
                    <tr>
                      <th className="p-2.5">#</th>
                      <th className="p-2.5">Matric Number</th>
                      <th className="p-2.5">Student Name</th>
                      <th className="p-2.5">Department</th>
                      <th className="p-2.5">Sex</th>
                      <th className="p-2.5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#789981]/20 bg-[#061C13]">
                    {registeredCandidates.map((c, idx) => (
                      <tr key={c.matricNumber} className="hover:bg-[#0A2419]/60 transition">
                        <td className="p-2.5 font-bold text-[#789981]">{idx + 1}</td>
                        <td className="p-2.5 font-mono font-bold text-[#D6BF62]">{c.matricNumber}</td>
                        <td className="p-2.5 font-semibold text-[#F0F9F3]">{c.fullName || '—'}</td>
                        <td className="p-2.5">{c.department || '—'}</td>
                        <td className="p-2.5 font-bold">{c.gender || 'Not recorded'}</td>
                        <td className="p-2.5 text-right">
                          <button
                            type="button"
                            onClick={() => handleRemoveCandidate(c.matricNumber)}
                            className="text-red-400 hover:text-red-300 p-1 cursor-pointer"
                            title="Remove candidate"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* BOTTOM ACTION BAR */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-6 bg-[#061C13] rounded-3xl shadow-xl border border-[#789981]/30">
          <div className="text-xs text-[#ADCDBA] text-center sm:text-left">
            <span className="font-bold text-[#F0F9F3]">{questions.length} questions organised.</span>{' '}
            Answer keys are stored securely on the server and never exposed to students.
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            <button
              onClick={() => handleSave(false)}
              disabled={isSaving}
              className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-5 py-3 bg-[#0A2419] hover:bg-[#0E3324] text-[#ADCDBA] font-bold text-xs sm:text-sm rounded-xl border border-[#789981]/40 shadow-sm transition disabled:opacity-50 cursor-pointer"
            >
              <Save className="w-4 h-4 text-[#789981]" />
              <span>Save as Draft</span>
            </button>

            <button
              onClick={() => handleSave(true)}
              disabled={isSaving}
              className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-6 py-3 bg-[#0E623B] hover:bg-[#127949] border border-[#D6BF62] text-[#F0F9F3] font-extrabold text-xs sm:text-sm rounded-xl shadow-lg hover:shadow-[#0E623B]/30 transition disabled:opacity-50 cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4 text-[#D6BF62]" />
              <span>
                {isSaving
                  ? 'Publishing...'
                  : status === 'published'
                  ? 'Update & Keep Published'
                  : 'Publish Examination'}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* MODAL: SIDE-BY-SIDE DUPLICATE COMPARISON */}
      {activeComparePair && (
        <div className="fixed inset-0 z-50 bg-[#030515]/80 flex items-center justify-center p-4 backdrop-blur-sm animate-fadeIn">
          <div className="bg-[#061C13] rounded-3xl max-w-3xl w-full p-6 sm:p-8 shadow-2xl border border-[#D6BF62]/30 max-h-[90vh] overflow-y-auto space-y-6">
            <div className="flex items-center justify-between pb-4 border-b border-[#789981]/20">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-400" />
                <h3 className="font-extrabold text-[#F0F9F3] text-lg">
                  Duplicate Question Comparison
                </h3>
              </div>
              <button
                onClick={() => setActiveComparePair(null)}
                className="p-2 text-[#789981] hover:text-[#F0F9F3] rounded-full cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Question 1 */}
              <div className="p-4 rounded-2xl bg-[#0A2419] border border-[#789981]/30 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-[#D6BF62] bg-[#030515] px-2 py-0.5 rounded border border-[#789981]/30">
                    Question #{activeComparePair.q1Number}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      handleDeleteQuestion(activeComparePair.q1Index);
                      setActiveComparePair(null);
                    }}
                    className="text-xs text-red-400 hover:text-red-300 font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Question {activeComparePair.q1Number}</span>
                  </button>
                </div>
                <p className="text-xs font-semibold text-[#F0F9F3] leading-relaxed">
                  {activeComparePair.q1Text}
                </p>
              </div>

              {/* Question 2 */}
              <div className="p-4 rounded-2xl bg-[#0A2419] border border-[#789981]/30 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-[#D6BF62] bg-[#030515] px-2 py-0.5 rounded border border-[#789981]/30">
                    Question #{activeComparePair.q2Number}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      handleDeleteQuestion(activeComparePair.q2Index);
                      setActiveComparePair(null);
                    }}
                    className="text-xs text-red-400 hover:text-red-300 font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Question {activeComparePair.q2Number}</span>
                  </button>
                </div>
                <p className="text-xs font-semibold text-[#F0F9F3] leading-relaxed">
                  {activeComparePair.q2Text}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#789981]/20">
              <button
                type="button"
                onClick={() => {
                  setDismissedPairIds((prev) => new Set([...prev, activeComparePair.id]));
                  setActiveComparePair(null);
                }}
                className="px-4 py-2 bg-[#0A2419] hover:bg-[#0E3324] text-[#ADCDBA] border border-[#789981]/40 font-bold text-xs rounded-xl cursor-pointer"
              >
                Keep Both Questions (Dismiss Warning)
              </button>
              <button
                type="button"
                onClick={() => setActiveComparePair(null)}
                className="px-5 py-2 bg-[#0E623B] hover:bg-[#127949] border border-[#D6BF62] text-[#F0F9F3] font-bold text-xs rounded-xl cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: PUBLISH CONFIRMATION & EXAM ID SHARING */}
      {publishModalOpen && (
        <div className="fixed inset-0 z-50 bg-[#030515]/80 flex items-center justify-center p-4 backdrop-blur-sm animate-fadeIn">
          <div className="bg-[#061C13] rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl border border-[#D6BF62]/40 space-y-6 text-center">
            <div className="w-16 h-16 mx-auto bg-[#0A2419] border border-[#D6BF62]/30 text-[#10B981] rounded-2xl flex items-center justify-center shadow-inner">
              <CheckCircle2 className="w-8 h-8 text-[#10B981]" />
            </div>

            <div>
              <h3 className="text-xl font-black text-[#F0F9F3]">
                Examination Published Successfully!
              </h3>
              <p className="text-xs text-[#ADCDBA] mt-1">
                {courseCode} - {courseTitle} is now accessible to students using its Exam ID.
              </p>
            </div>

            {/* Examination Publication Details */}
            <div className="bg-[#0A2419] p-4 rounded-2xl border border-[#789981]/30 space-y-2 text-left text-xs">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#D6BF62] block">
                Official Examination Publication Details
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-[11px] pt-1">
                <div className="sm:col-span-2">
                  <span className="text-[#789981] block">Course:</span>
                  <span className="font-bold text-[#F0F9F3]">{courseCode} - {courseTitle}</span>
                </div>
                <div>
                  <span className="text-[#789981] block">Course Lecturer:</span>
                  <span className="font-bold text-[#D6BF62]">{capitalizeProper(lecturerName)}</span>
                </div>
                <div>
                  <span className="text-[#789981] block">Department:</span>
                  <span className="font-bold text-[#F0F9F3]">{resolvedDepartment}</span>
                </div>
                <div>
                  <span className="text-[#789981] block">Examination Date:</span>
                  <span className="font-bold text-[#F0F9F3]">{formatLagosDate(startDate)}</span>
                </div>
                <div>
                  <span className="text-[#789981] block">Starting Time:</span>
                  <span className="font-bold text-[#F0F9F3]">{formatLagosTime(startDate)} (WAT)</span>
                </div>
                <div>
                  <span className="text-[#789981] block">Closing Time:</span>
                  <span className="font-bold text-[#F0F9F3]">{formatLagosTime(endDate)} (WAT)</span>
                </div>
                <div>
                  <span className="text-[#789981] block">Allocated Duration:</span>
                  <span className="font-bold text-[#ADCDBA]">{durationMinutes} Minutes</span>
                </div>
              </div>
            </div>

            {/* Exam ID Display */}
            <div className="bg-[#0A2419] p-4 rounded-2xl border border-[#789981]/30 space-y-2 text-left">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#789981]">
                Unique Examination ID
              </span>
              <div className="flex items-center justify-between gap-2">
                <code className="text-sm font-mono font-bold text-[#D6BF62] select-all">
                  {examId}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(examId);
                    setCopiedExamId(true);
                    setTimeout(() => setCopiedExamId(false), 2500);
                  }}
                  className="px-3 py-1.5 bg-[#0E623B] hover:bg-[#127949] border border-[#D6BF62] text-[#F0F9F3] font-bold text-xs rounded-lg transition flex items-center gap-1 shrink-0 cursor-pointer"
                >
                  {copiedExamId ? <Check className="w-3.5 h-3.5 text-[#10B981]" /> : <Copy className="w-3.5 h-3.5 text-[#D6BF62]" />}
                  <span>{copiedExamId ? 'Copied' : 'Copy ID'}</span>
                </button>
              </div>
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={() => {
                  setPublishModalOpen(false);
                  onBack();
                }}
                className="w-full py-3 bg-[#0E623B] hover:bg-[#127949] border border-[#D6BF62] text-[#F0F9F3] font-bold rounded-xl text-sm shadow-lg hover:shadow-[#0E623B]/30 transition cursor-pointer"
              >
                Return to Examinations Dashboard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
