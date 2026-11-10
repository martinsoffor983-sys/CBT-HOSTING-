import React, { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft,
  FileSpreadsheet,
  FileText,
  Search,
  Users,
  CheckCircle2,
  XCircle,
  Clock,
  RotateCcw,
  X,
  Calendar,
  Layers,
  Check,
  BookOpen,
  User,
  ShieldAlert,
  GraduationCap,
  Sparkles
} from 'lucide-react';
import { Exam, AttendanceRecord, SUN_DEPARTMENTS } from '../../types';
import { useAuth, isAuthorizedExaminerEmail } from '../../context/AuthContext';
import { collection, query, where, getDocs, doc, getDoc, updateDoc, addDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { capitalizeProper } from '../../utils/studentValidation';
import { formatLagosDate, formatLagosTime, formatLagosDateTime } from '../../utils/timeUtils';
import { exportAttendanceToExcel, exportAttendanceToWord } from '../../utils/exportUtils';

interface ExamAttendanceViewProps {
  exam: Exam;
  allExams: Exam[];
  onSelectExam: (exam: Exam) => void;
  onBack: () => void;
}

export const ExamAttendanceView: React.FC<ExamAttendanceViewProps> = ({
  exam,
  allExams,
  onSelectExam,
  onBack
}) => {
  const { user, isAuthorized } = useAuth();
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDept, setSelectedDept] = useState('All');
  const [signInFilter, setSignInFilter] = useState<'all' | 'signed_in' | 'not_signed_in'>('all');
  const [signOutFilter, setSignOutFilter] = useState<'all' | 'signed_out' | 'pending'>('all');
  const [submissionFilter, setSubmissionFilter] = useState<'all' | 'submitted' | 'in_progress' | 'not_started'>('all');
  const [sortBy, setSortBy] = useState<'matric_asc' | 'matric_desc' | 'name_asc' | 'time_desc'>('matric_asc');

  // Export state
  const [isExportingWord, setIsExportingWord] = useState(false);

  // Reset Attendance Modal state (Administrative Corrections)
  const [candidateToReset, setCandidateToReset] = useState<AttendanceRecord | null>(null);
  const [resetReason, setResetReason] = useState('Administrative attendance status correction');
  const [isSubmittingReset, setIsSubmittingReset] = useState(false);

  // Notification Banner
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    fetchAttendance();
  }, [exam.id, user]);

  /**
   * Resilient Attendance Fetcher:
   * 1. Fetches directly from Firestore using the browser's authenticated token (zero permission errors).
   * 2. Merges registered candidates, attendance records, and submission records.
   * 3. Falls back gracefully to server endpoint if needed.
   */
  const fetchAttendance = async () => {
    if (!user) return;
    setLoading(true);

    try {
      // 1. Fetch attendance records directly from Firestore
      const attQ = query(collection(db, 'attendance_records'), where('examId', '==', exam.id));
      const attSnap = await getDocs(attQ);
      const attMap = new Map<string, any>();
      attSnap.forEach((d) => {
        const data = d.data();
        if (data.matricNumber) {
          attMap.set(String(data.matricNumber).trim().toUpperCase(), { ...data, id: d.id });
        }
      });

      // 2. Fetch submissions directly from Firestore
      const subsQ = query(collection(db, 'submissions'), where('examId', '==', exam.id));
      const subsSnap = await getDocs(subsQ);
      const subsMap = new Map<string, any>();
      subsSnap.forEach((d) => {
        const data = d.data();
        if (data.matricNumber) {
          subsMap.set(String(data.matricNumber).trim().toUpperCase(), data);
        }
      });

      // 3. Fetch latest exam document for registered candidates roster
      const examDocSnap = await getDoc(doc(db, 'exams', exam.id));
      const examData = examDocSnap.exists() ? examDocSnap.data() : exam;
      const roster: any[] = Array.isArray(examData.registeredCandidates) ? examData.registeredCandidates : [];

      // 4. Combine all unique candidates
      const allMatrics = new Set<string>();
      roster.forEach((c: any) => {
        if (c.matricNumber) allMatrics.add(String(c.matricNumber).trim().toUpperCase());
      });
      attMap.forEach((_, matric) => allMatrics.add(matric));
      subsMap.forEach((_, matric) => allMatrics.add(matric));

      const mergedList: AttendanceRecord[] = [];
      allMatrics.forEach((matric) => {
        const rosterEntry = roster.find((c: any) => String(c.matricNumber).trim().toUpperCase() === matric) || {};
        const att = attMap.get(matric) || {};
        const sub = subsMap.get(matric);

        const fullName = capitalizeProper(att.fullName || rosterEntry.fullName || sub?.fullName || 'Candidate');
        const department = capitalizeProper(att.department || rosterEntry.department || sub?.department || exam.department || 'Not Specified');
        const rawGender = att.gender || rosterEntry.gender || sub?.gender || 'Not recorded';
        const gender = (rawGender === 'M' || String(rawGender).trim().toUpperCase() === 'M' || String(rawGender).trim().toUpperCase() === 'MALE')
          ? 'M'
          : (rawGender === 'F' || String(rawGender).trim().toUpperCase() === 'F' || String(rawGender).trim().toUpperCase() === 'FEMALE')
          ? 'F'
          : 'Not recorded';

        const signInTime = att.signInTime || null;
        const signOutTime = att.signOutTime || sub?.submittedAt || null;

        let status: 'absent' | 'signed_in' | 'signed_out' = 'absent';
        if (signOutTime) {
          status = 'signed_out';
        } else if (signInTime) {
          status = 'signed_in';
        } else {
          status = 'absent';
        }

        let submissionStatus: 'not_started' | 'in_progress' | 'submitted' = 'not_started';
        if (sub || att.submissionStatus === 'submitted') {
          submissionStatus = 'submitted';
        } else if (signInTime) {
          submissionStatus = 'in_progress';
        }

        mergedList.push({
          id: att.id || `${exam.id}_${matric.replace(/[^a-zA-Z0-9]/g, '_')}`,
          examId: exam.id,
          courseCode: exam.courseCode,
          courseTitle: exam.courseTitle,
          matricNumber: matric,
          fullName,
          department,
          gender,
          signInTime,
          signedInBy: att.signedInBy || null,
          signOutTime,
          signedOutBy: att.signedOutBy || null,
          status,
          submissionStatus,
          submittedAt: sub?.submittedAt || att.submittedAt || null,
          submissionReceipt: sub?.submissionReceipt || att.submissionReceipt || null,
          updatedAt: att.updatedAt || new Date().toISOString(),
          createdAt: att.createdAt || rosterEntry.registeredAt || new Date().toISOString()
        });
      });

      // Sort alphabetically by Matriculation Number by default
      mergedList.sort((a, b) => a.matricNumber.localeCompare(b.matricNumber));
      setAttendanceRecords(mergedList);
    } catch (directErr: any) {
      console.warn('Direct Firestore fetch notice, attempting server fallback:', directErr);
      try {
        const token = await user.getIdToken();
        const res = await fetch(`/api/exam/${exam.id}/attendance`, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        const data = await res.json();
        if (res.ok && Array.isArray(data.attendanceList)) {
          setAttendanceRecords(data.attendanceList);
        } else {
          throw new Error(data.error || 'Failed to retrieve attendance register.');
        }
      } catch (fallbackErr: any) {
        console.error('Attendance fetch error:', fallbackErr);
        setNotification({
          type: 'error',
          message: fallbackErr.message || 'Could not load examination attendance register.'
        });
      }
    } finally {
      setLoading(false);
    }
  };

  // Reset Attendance Record (Audited Administrative Correction)
  const handleResetAttendance = async () => {
    if (!user || !candidateToReset) return;
    setIsSubmittingReset(true);

    try {
      const matric = candidateToReset.matricNumber;
      const attDocId = `${exam.id}_${matric.replace(/[^a-zA-Z0-9]/g, '_')}`;
      const nowIso = new Date().toISOString();

      // 1. Direct update in Firestore
      await updateDoc(doc(db, 'attendance_records', attDocId), {
        signInTime: null,
        signOutTime: null,
        status: 'absent',
        submissionStatus: 'not_started',
        updatedAt: nowIso
      });

      // 2. Write immutable audit log (Rule 7)
      try {
        await addDoc(collection(db, 'audit_logs'), {
          action: 'ONLINE_ATTENDANCE_CORRECTION_RESET',
          examId: exam.id,
          matricNumber: matric,
          candidateName: candidateToReset.fullName,
          performedByEmail: user.email || 'sunsmartcbt@gmail.com',
          reason: resetReason,
          previousState: {
            signInTime: candidateToReset.signInTime,
            signOutTime: candidateToReset.signOutTime,
            status: candidateToReset.status
          },
          timestamp: nowIso
        });
      } catch (auditErr) {
        console.warn('Could not write audit log:', auditErr);
      }

      setNotification({
        type: 'success',
        message: `Attendance record for ${candidateToReset.fullName} (${matric}) reset to Not Signed In.`
      });
      setTimeout(() => setNotification(null), 4000);
      setCandidateToReset(null);
      await fetchAttendance();
    } catch (err: any) {
      console.warn('Direct Firestore reset encountered error, attempting server fallback:', err);
      try {
        const token = await user.getIdToken();
        const res = await fetch(`/api/exam/${exam.id}/attendance/reset`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            matricNumber: candidateToReset.matricNumber,
            reason: resetReason
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to reset attendance.');
        setNotification({
          type: 'success',
          message: data.message || `Attendance record reset successfully.`
        });
        setTimeout(() => setNotification(null), 4000);
        setCandidateToReset(null);
        await fetchAttendance();
      } catch (fallbackErr: any) {
        console.error('Reset error:', fallbackErr);
        setNotification({
          type: 'error',
          message: fallbackErr.message || 'Failed to reset attendance.'
        });
        setTimeout(() => setNotification(null), 5000);
      }
    } finally {
      setIsSubmittingReset(false);
    }
  };

  // Summary Statistics (Calculated strictly from actual records)
  const stats = useMemo(() => {
    const totalRegistered = attendanceRecords.length;
    const totalSignIn = attendanceRecords.filter((a) => a.signInTime !== null).length;
    const totalSignOut = attendanceRecords.filter((a) => a.signOutTime !== null).length;
    const inExamination = attendanceRecords.filter((a) => a.signInTime !== null && a.signOutTime === null).length;
    const notStarted = attendanceRecords.filter((a) => a.signInTime === null).length;
    const totalSubmitted = attendanceRecords.filter((a) => a.submissionStatus === 'submitted').length;

    return {
      totalRegistered,
      totalSignIn,
      totalSignOut,
      inExamination,
      notStarted,
      totalSubmitted
    };
  }, [attendanceRecords]);

  // Filtered and Sorted Candidate List
  const filteredRecords = useMemo(() => {
    return attendanceRecords
      .filter((rec) => {
        // Search Filter
        const queryClean = searchQuery.toLowerCase().trim();
        const matchesSearch =
          !queryClean ||
          rec.fullName.toLowerCase().includes(queryClean) ||
          rec.matricNumber.toLowerCase().includes(queryClean) ||
          (rec.department && rec.department.toLowerCase().includes(queryClean)) ||
          (rec.submissionReceipt && rec.submissionReceipt.toLowerCase().includes(queryClean));

        // Department Filter
        const matchesDept = selectedDept === 'All' || rec.department === selectedDept;

        // Sign-In Status Filter
        const matchesSignIn =
          signInFilter === 'all' ||
          (signInFilter === 'signed_in' && rec.signInTime !== null) ||
          (signInFilter === 'not_signed_in' && rec.signInTime === null);

        // Sign-Out Status Filter
        const matchesSignOut =
          signOutFilter === 'all' ||
          (signOutFilter === 'signed_out' && rec.signOutTime !== null) ||
          (signOutFilter === 'pending' && rec.signOutTime === null);

        // Submission Status Filter
        const matchesSubmission =
          submissionFilter === 'all' ||
          (submissionFilter === 'submitted' && rec.submissionStatus === 'submitted') ||
          (submissionFilter === 'in_progress' && rec.submissionStatus === 'in_progress') ||
          (submissionFilter === 'not_started' && (!rec.submissionStatus || rec.submissionStatus === 'not_started'));

        return matchesSearch && matchesDept && matchesSignIn && matchesSignOut && matchesSubmission;
      })
      .sort((a, b) => {
        if (sortBy === 'matric_asc') return a.matricNumber.localeCompare(b.matricNumber);
        if (sortBy === 'matric_desc') return b.matricNumber.localeCompare(a.matricNumber);
        if (sortBy === 'name_asc') return a.fullName.localeCompare(b.fullName);
        if (sortBy === 'time_desc') {
          const tA = a.signInTime ? new Date(a.signInTime).getTime() : 0;
          const tB = b.signInTime ? new Date(b.signInTime).getTime() : 0;
          return tB - tA;
        }
        return 0;
      });
  }, [attendanceRecords, searchQuery, selectedDept, signInFilter, signOutFilter, submissionFilter, sortBy]);

  // Export to Word
  const handleExportWord = async () => {
    setIsExportingWord(true);
    try {
      await exportAttendanceToWord(exam, filteredRecords, {
        totalRegistered: stats.totalRegistered,
        totalSignedIn: stats.totalSignIn,
        totalSignedOut: stats.totalSignOut,
        totalCurrentlyInHall: stats.inExamination,
        totalAbsent: stats.notStarted,
        totalSubmitted: stats.totalSubmitted
      });
      setNotification({
        type: 'success',
        message: 'Official Examination Attendance Register (.docx) generated successfully.'
      });
      setTimeout(() => setNotification(null), 4000);
    } catch (err: any) {
      console.error('Word export error:', err);
      setNotification({
        type: 'error',
        message: `Failed to export Word document: ${err?.message || 'Export error'}`
      });
    } finally {
      setIsExportingWord(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto pb-16 px-4 sm:px-6">
      {/* Top Bar Navigation */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 my-6">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm font-semibold text-[#ADCDBA] hover:text-[#F0F9F3] transition cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4 text-[#D6BF62]" />
          <span>Back to Examinations</span>
        </button>

        {/* Action Buttons: Export to Excel & Word (No PDF) */}
        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
          <button
            onClick={() => exportAttendanceToExcel(exam, filteredRecords)}
            disabled={filteredRecords.length === 0}
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 bg-[#0A2419] hover:bg-[#0E3324] text-[#ADCDBA] hover:text-[#F0F9F3] border border-[#789981]/40 font-bold text-xs rounded-xl shadow-sm transition disabled:opacity-40 cursor-pointer"
            title="Download attendance records as Microsoft Excel spreadsheet (.xlsx)"
          >
            <FileSpreadsheet className="w-4 h-4 text-[#D6BF62]" />
            <span>Export to Excel (.xlsx)</span>
          </button>

          <button
            onClick={handleExportWord}
            disabled={filteredRecords.length === 0 || isExportingWord}
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 bg-[#0E623B] hover:bg-[#127949] border border-[#D6BF62] text-[#F0F9F3] font-bold text-xs rounded-xl shadow-lg hover:shadow-[#0E623B]/30 transition disabled:opacity-40 cursor-pointer"
            title="Download institutional examination attendance register as Microsoft Word document (.docx)"
          >
            <FileText className="w-4 h-4 text-[#D6BF62]" />
            <span>{isExportingWord ? 'Generating Word Doc...' : 'Export Official Word Register (.docx)'}</span>
          </button>
        </div>
      </div>

      {/* Action Notification Banner */}
      {notification && (
        <div
          className={`mb-6 p-4 rounded-xl border flex items-center justify-between gap-3 text-xs font-semibold animate-fadeIn ${
            notification.type === 'success'
              ? 'bg-[#061C13] border-[#10B981] text-[#10B981]'
              : 'bg-[#2A0808] border-red-500 text-red-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {notification.type === 'success' ? (
              <Check className="w-4 h-4 shrink-0" />
            ) : (
              <ShieldAlert className="w-4 h-4 shrink-0 text-red-400" />
            )}
            <span>{notification.message}</span>
          </div>
          <button
            onClick={() => setNotification(null)}
            className="text-[#ADCDBA] hover:text-[#F0F9F3] p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Examination Header & Switcher */}
      <div className="bg-[#061C13] rounded-3xl p-6 sm:p-8 shadow-2xl border border-[#D6BF62]/30 mb-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-6 border-b border-[#789981]/20">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-[#D6BF62]/20 text-[#D6BF62] border border-[#D6BF62]/40 uppercase tracking-wider">
                Online CBT Attendance Register
              </span>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                exam.status === 'published'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : exam.status === 'closed'
                  ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                  : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
              }`}>
                {exam.status === 'published' ? 'Active CBT' : exam.status === 'closed' ? 'Closed' : 'Draft'}
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-[#F0F9F3] tracking-tight">
              {exam.courseCode}: {exam.courseTitle}
            </h1>
            <p className="text-xs text-[#ADCDBA] mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>Department: <strong className="text-[#F0F9F3]">{exam.department}</strong></span>
              <span>Course Lecturer: <strong className="text-[#D6BF62]">{exam.lecturerName || 'Not specified'}</strong></span>
              {exam.startDate && (
                <span>Schedule: <strong className="text-[#F0F9F3]">{formatLagosDate(exam.startDate)} • {formatLagosTime(exam.startDate)} (WAT)</strong></span>
              )}
            </p>
          </div>

          {/* Quick Examination Switcher */}
          {allExams.length > 1 && (
            <div className="shrink-0">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-[#789981] mb-1.5 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-[#D6BF62]" />
                Switch Examination Register
              </label>
              <select
                value={exam.id}
                onChange={(e) => {
                  const target = allExams.find((ex) => ex.id === e.target.value);
                  if (target) onSelectExam(target);
                }}
                className="w-full sm:w-64 px-3 py-2 bg-[#0A2419] border border-[#789981]/40 rounded-xl text-xs font-bold text-[#F0F9F3] focus:outline-none focus:border-[#D6BF62] transition cursor-pointer"
              >
                {allExams.map((ex) => (
                  <option key={ex.id} value={ex.id} className="bg-[#030515] text-[#F0F9F3]">
                    {ex.courseCode} — {ex.courseTitle.substring(0, 24)}...
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* SUMMARY STATISTICS CARDS (CALCULATED STRICTLY FROM ACTUAL RECORDS) */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3.5 mt-6">
          {/* Card 1: Total Registered */}
          <div className="bg-[#0A2419] p-4 rounded-2xl border border-[#789981]/30">
            <div className="flex items-center justify-between text-[#789981] mb-1">
              <span className="text-[10px] font-bold uppercase tracking-wider">Total Registered</span>
              <Users className="w-4 h-4 text-[#D6BF62]" />
            </div>
            <p className="text-2xl font-black text-[#F0F9F3]">{stats.totalRegistered}</p>
            <p className="text-[10px] text-[#ADCDBA] mt-0.5">Enrolled candidates</p>
          </div>

          {/* Card 2: Total Sign-In */}
          <div className="bg-[#0A2419] p-4 rounded-2xl border border-emerald-500/30">
            <div className="flex items-center justify-between text-[#789981] mb-1">
              <span className="text-[10px] font-bold uppercase tracking-wider">Total Sign-In</span>
              <CheckCircle2 className="w-4 h-4 text-[#10B981]" />
            </div>
            <p className="text-2xl font-black text-[#10B981]">{stats.totalSignIn}</p>
            <p className="text-[10px] text-[#ADCDBA] mt-0.5">Officially signed in</p>
          </div>

          {/* Card 3: Total Sign-Out */}
          <div className="bg-[#0A2419] p-4 rounded-2xl border border-blue-500/30">
            <div className="flex items-center justify-between text-[#789981] mb-1">
              <span className="text-[10px] font-bold uppercase tracking-wider">Total Sign-Out</span>
              <CheckCircle2 className="w-4 h-4 text-blue-400" />
            </div>
            <p className="text-2xl font-black text-blue-400">{stats.totalSignOut}</p>
            <p className="text-[10px] text-[#ADCDBA] mt-0.5">Submitted & signed out</p>
          </div>

          {/* Card 4: In Examination (Active CBT Session) */}
          <div className="bg-[#0A2419] p-4 rounded-2xl border border-amber-500/30">
            <div className="flex items-center justify-between text-[#789981] mb-1">
              <span className="text-[10px] font-bold uppercase tracking-wider">In Examination</span>
              <Clock className="w-4 h-4 text-amber-400" />
            </div>
            <p className="text-2xl font-black text-amber-400">{stats.inExamination}</p>
            <p className="text-[10px] text-[#ADCDBA] mt-0.5">Writing test right now</p>
          </div>

          {/* Card 5: Not Started */}
          <div className="bg-[#0A2419] p-4 rounded-2xl border border-[#789981]/30 col-span-2 sm:col-span-1">
            <div className="flex items-center justify-between text-[#789981] mb-1">
              <span className="text-[10px] font-bold uppercase tracking-wider">Not Started</span>
              <XCircle className="w-4 h-4 text-[#789981]" />
            </div>
            <p className="text-2xl font-black text-[#ADCDBA]">{stats.notStarted}</p>
            <p className="text-[10px] text-[#789981] mt-0.5">Awaiting sign-in</p>
          </div>
        </div>
      </div>

      {/* FILTER & SEARCH TOOLBAR */}
      <div className="bg-[#061C13] rounded-3xl p-5 shadow-xl border border-[#789981]/30 mb-6 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
          {/* Search Box */}
          <div className="sm:col-span-5 relative">
            <Search className="w-4 h-4 text-[#789981] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by student name, matric number, or receipt..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-[#0A2419] border border-[#789981]/40 rounded-xl text-xs text-[#F0F9F3] placeholder-[#789981] focus:outline-none focus:border-[#D6BF62] transition"
            />
          </div>

          {/* Department Filter */}
          <div className="sm:col-span-3">
            <select
              value={selectedDept}
              onChange={(e) => setSelectedDept(e.target.value)}
              className="w-full px-3 py-2 bg-[#0A2419] border border-[#789981]/40 rounded-xl text-xs text-[#F0F9F3] focus:outline-none focus:border-[#D6BF62] transition cursor-pointer"
            >
              <option value="All">All Departments ({attendanceRecords.length})</option>
              {SUN_DEPARTMENTS.filter((d) => d !== 'All Departments').map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          {/* Sign-In Filter */}
          <div className="sm:col-span-2">
            <select
              value={signInFilter}
              onChange={(e) => setSignInFilter(e.target.value as any)}
              className="w-full px-3 py-2 bg-[#0A2419] border border-[#789981]/40 rounded-xl text-xs text-[#F0F9F3] focus:outline-none focus:border-[#D6BF62] transition cursor-pointer"
            >
              <option value="all">Sign-In: All</option>
              <option value="signed_in">Signed In</option>
              <option value="not_signed_in">Not Signed In</option>
            </select>
          </div>

          {/* Sign-Out Filter */}
          <div className="sm:col-span-2">
            <select
              value={signOutFilter}
              onChange={(e) => setSignOutFilter(e.target.value as any)}
              className="w-full px-3 py-2 bg-[#0A2419] border border-[#789981]/40 rounded-xl text-xs text-[#F0F9F3] focus:outline-none focus:border-[#D6BF62] transition cursor-pointer"
            >
              <option value="all">Sign-Out: All</option>
              <option value="signed_out">Signed Out</option>
              <option value="pending">Pending Submission</option>
            </select>
          </div>
        </div>

        {/* Second Row Filters: Submission Status & Sort Order */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[#789981]/20 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-[#789981] font-bold text-[11px] uppercase tracking-wider">CBT Status:</span>
            <div className="flex items-center gap-1.5">
              {(['all', 'submitted', 'in_progress', 'not_started'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setSubmissionFilter(st)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                    submissionFilter === st
                      ? 'bg-[#0E623B] text-[#F0F9F3] border border-[#D6BF62]'
                      : 'bg-[#0A2419] text-[#ADCDBA] border border-[#789981]/30 hover:border-[#D6BF62]/50'
                  }`}
                >
                  {st === 'all'
                    ? 'All'
                    : st === 'submitted'
                    ? 'Submitted'
                    : st === 'in_progress'
                    ? 'In Progress'
                    : 'Not Started'}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[#789981] font-bold text-[11px] uppercase tracking-wider">Sort:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="px-2.5 py-1 bg-[#0A2419] border border-[#789981]/40 rounded-lg text-xs text-[#F0F9F3] focus:outline-none focus:border-[#D6BF62] cursor-pointer"
            >
              <option value="matric_asc">Matric (A → Z)</option>
              <option value="matric_desc">Matric (Z → A)</option>
              <option value="name_asc">Name (A → Z)</option>
              <option value="time_desc">Recent Sign-In First</option>
            </select>
          </div>
        </div>
      </div>

      {/* STUDENT ATTENDANCE REGISTER TABLE */}
      <div className="bg-[#061C13] rounded-3xl shadow-2xl border border-[#D6BF62]/30 overflow-hidden">
        <div className="p-4 sm:p-5 bg-gradient-to-r from-[#0A2419] to-[#061C13] border-b border-[#D6BF62]/30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GraduationCap className="w-5 h-5 text-[#D6BF62]" />
            <h2 className="text-base font-extrabold text-[#F0F9F3]">
              Official Student Attendance Register
            </h2>
          </div>
          <span className="text-xs font-bold text-[#D6BF62] bg-[#030515] px-3 py-1 rounded-full border border-[#D6BF62]/30">
            {filteredRecords.length} of {attendanceRecords.length} Candidates Displayed
          </span>
        </div>

        {loading ? (
          <div className="p-16 text-center text-[#ADCDBA] space-y-3">
            <div className="w-8 h-8 border-3 border-[#D6BF62] border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-xs font-bold uppercase tracking-wider">Loading Examination Attendance Register...</p>
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="p-16 text-center text-[#ADCDBA] space-y-2">
            <Users className="w-10 h-10 text-[#789981] mx-auto mb-2 opacity-50" />
            <p className="text-sm font-bold text-[#F0F9F3]">No candidate attendance records match your criteria.</p>
            <p className="text-xs text-[#789981]">
              Candidates will automatically appear here once registered or upon signing in to this CBT examination.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#0A2419] text-[#789981] font-bold uppercase text-[10px] tracking-wider border-b border-[#789981]/30">
                  <th className="py-3.5 px-3.5 text-center">#</th>
                  <th className="py-3.5 px-3.5">Student Full Name</th>
                  <th className="py-3.5 px-3.5">Matriculation Number</th>
                  <th className="py-3.5 px-3.5">Department</th>
                  <th className="py-3.5 px-3 text-center">Sex</th>
                  <th className="py-3.5 px-3.5">CBT Submission Status</th>
                  <th className="py-3.5 px-3.5">Sign-In Status</th>
                  <th className="py-3.5 px-3.5">Sign-Out Status</th>
                  <th className="py-3.5 px-3 text-center">Audit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#789981]/20">
                {filteredRecords.map((row, idx) => {
                  const isSignedOut = row.status === 'signed_out' || row.signOutTime !== null;
                  const isSignedIn = row.status === 'signed_in' || row.signInTime !== null;

                  return (
                    <tr
                      key={row.matricNumber}
                      className="hover:bg-[#0A2419]/50 transition group"
                    >
                      {/* Index */}
                      <td className="py-3 px-3.5 text-center font-mono text-[#789981] font-bold">
                        {idx + 1}
                      </td>

                      {/* Full Name */}
                      <td className="py-3 px-3.5">
                        <span className="font-bold text-[#F0F9F3] group-hover:text-[#D6BF62] transition block">
                          {row.fullName}
                        </span>
                      </td>

                      {/* Matriculation Number */}
                      <td className="py-3 px-3.5">
                        <span className="font-mono font-bold text-[#D6BF62] bg-[#030515] px-2 py-0.5 rounded border border-[#789981]/30">
                          {row.matricNumber}
                        </span>
                      </td>

                      {/* Department */}
                      <td className="py-3 px-3.5 text-[#ADCDBA] font-medium">
                        {row.department}
                      </td>

                      {/* Sex */}
                      <td className="py-3 px-3 text-center">
                        <span
                          className={`inline-block w-6 py-0.5 text-center font-bold font-mono rounded ${
                            row.gender === 'M'
                              ? 'bg-blue-500/10 text-blue-300 border border-blue-500/30'
                              : row.gender === 'F'
                              ? 'bg-rose-500/10 text-rose-300 border border-rose-500/30'
                              : 'bg-zinc-700/20 text-zinc-400 border border-zinc-600/30 text-[10px]'
                          }`}
                        >
                          {row.gender || '—'}
                        </span>
                      </td>

                      {/* Examination Submission Status */}
                      <td className="py-3 px-3.5">
                        {row.submissionStatus === 'submitted' ? (
                          <div className="space-y-0.5">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                              <CheckCircle2 className="w-3 h-3 text-[#10B981]" />
                              <span>Submitted</span>
                            </span>
                            {row.submittedAt && (
                              <p className="text-[10px] text-[#789981] font-mono">
                                {formatLagosTime(row.submittedAt)}
                              </p>
                            )}
                            {row.submissionReceipt && (
                              <p className="text-[9px] text-[#D6BF62] font-mono line-clamp-1" title={row.submissionReceipt}>
                                {row.submissionReceipt}
                              </p>
                            )}
                          </div>
                        ) : row.submissionStatus === 'in_progress' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                            <Clock className="w-3 h-3 text-amber-400" />
                            <span>In Progress</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#030515] text-[#789981] border border-[#789981]/30">
                            <XCircle className="w-3 h-3 text-[#789981]" />
                            <span>Not Started</span>
                          </span>
                        )}
                      </td>

                      {/* Sign-In Status */}
                      <td className="py-3 px-3.5">
                        {isSignedIn ? (
                          <div className="space-y-0.5">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#0E623B] text-[#F0F9F3] border border-[#10B981]">
                              <CheckCircle2 className="w-3 h-3 text-[#10B981]" />
                              <span>Signed In</span>
                            </span>
                            {row.signInTime && (
                              <p className="text-[10px] text-[#ADCDBA] font-mono">
                                {formatLagosTime(row.signInTime)} (WAT)
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-zinc-800/60 text-zinc-400 border border-zinc-700/50">
                            <span>Not Signed In</span>
                          </span>
                        )}
                      </td>

                      {/* Sign-Out Status (Automatic Upon Submission) */}
                      <td className="py-3 px-3.5">
                        {isSignedOut ? (
                          <div className="space-y-0.5">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-950/80 text-blue-300 border border-blue-500/50">
                              <CheckCircle2 className="w-3 h-3 text-blue-400" />
                              <span>Signed Out (Auto)</span>
                            </span>
                            {row.signOutTime && (
                              <p className="text-[10px] text-blue-300/80 font-mono">
                                {formatLagosTime(row.signOutTime)} (WAT)
                              </p>
                            )}
                          </div>
                        ) : isSignedIn ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-950/40 text-amber-300 border border-amber-600/30">
                            <span>Pending Submission</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-zinc-800/40 text-zinc-500 border border-zinc-700/30">
                            <span>—</span>
                          </span>
                        )}
                      </td>

                      {/* Audit / Correction Action (Rule 7) */}
                      <td className="py-3 px-3 text-center">
                        <button
                          type="button"
                          onClick={() => {
                            setCandidateToReset(row);
                            setResetReason('Administrative examination attendance correction');
                          }}
                          className="p-1.5 text-[#789981] hover:text-amber-300 hover:bg-[#0A2419] rounded-lg transition border border-transparent hover:border-amber-400/30 cursor-pointer"
                          title="Audited Administrative Correction (Reset Attendance)"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* RESET ATTENDANCE MODAL (AUDITED CORRECTION - RULE 7) */}
      {candidateToReset && (
        <div className="fixed inset-0 z-50 bg-[#030515]/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#061C13] border-2 border-amber-500/50 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-5 animate-scaleUp">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-amber-500/10 border border-amber-500/40 rounded-xl text-amber-400">
                  <RotateCcw className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-[#F0F9F3]">Attendance Reset</h3>
                  <p className="text-xs text-[#ADCDBA]">Audited Administrative Correction</p>
                </div>
              </div>
              <button
                onClick={() => setCandidateToReset(null)}
                className="text-[#789981] hover:text-[#F0F9F3] p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-[#0A2419] p-3.5 rounded-2xl border border-[#789981]/30 text-xs space-y-1">
              <p className="font-bold text-[#F0F9F3]">{candidateToReset.fullName}</p>
              <p className="font-mono text-[#D6BF62]">{candidateToReset.matricNumber}</p>
              <p className="text-[#ADCDBA]">{candidateToReset.department}</p>
              <p className="text-[11px] text-amber-300 pt-1">
                Current Status: <strong>{candidateToReset.status.toUpperCase()}</strong>
                {candidateToReset.signInTime && ` • Signed In at ${formatLagosTime(candidateToReset.signInTime)}`}
                {candidateToReset.signOutTime && ` • Signed Out at ${formatLagosTime(candidateToReset.signOutTime)}`}
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#ADCDBA] mb-1.5">
                Audit Reason / Justification <span className="text-amber-400">*</span>
              </label>
              <textarea
                required
                rows={3}
                value={resetReason}
                onChange={(e) => setResetReason(e.target.value)}
                placeholder="State the academic justification for this attendance reset..."
                className="w-full px-3 py-2 bg-[#0A2419] border border-[#789981]/40 rounded-xl text-xs text-[#F0F9F3] placeholder-[#789981] focus:outline-none focus:border-amber-400 transition"
              />
              <p className="text-[10px] text-[#789981] mt-1">
                This correction will be permanently recorded in institutional security logs with your examiner account.
              </p>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setCandidateToReset(null)}
                disabled={isSubmittingReset}
                className="flex-1 py-2.5 bg-[#0A2419] hover:bg-[#0E3324] text-[#ADCDBA] font-bold text-xs rounded-xl border border-[#789981]/40 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleResetAttendance}
                disabled={isSubmittingReset || !resetReason.trim()}
                className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-500 border border-amber-400 text-white font-extrabold text-xs rounded-xl shadow-lg transition cursor-pointer disabled:opacity-40"
              >
                {isSubmittingReset ? 'Recording Audit...' : 'Confirm Reset'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
