import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  ArrowLeft,
  FileSpreadsheet,
  FileText,
  Search,
  Filter,
  Users,
  CheckCircle2,
  XCircle,
  Clock,
  UserCheck,
  UserX,
  LogOut,
  LogIn,
  AlertCircle,
  RefreshCw,
  QrCode,
  ShieldCheck,
  RotateCcw,
  Plus,
  X,
  Calendar,
  Layers,
  Check,
  BookOpen,
  User,
  ShieldAlert
} from 'lucide-react';
import { Exam, AttendanceRecord, SUN_DEPARTMENTS } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { capitalizeProper, validateMatricNumber } from '../../utils/studentValidation';
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
  const { user } = useAuth();
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  // Quick Scanner / Matric input state
  const [quickMatric, setQuickMatric] = useState('');
  const [quickActionType, setQuickActionType] = useState<'sign-in' | 'sign-out'>('sign-in');
  const [quickFeedback, setQuickFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const quickInputRef = useRef<HTMLInputElement>(null);

  // Filters state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDept, setSelectedDept] = useState('All');
  const [signInFilter, setSignInFilter] = useState<'all' | 'signed_in' | 'not_signed_in'>('all');
  const [signOutFilter, setSignOutFilter] = useState<'all' | 'signed_out' | 'not_signed_out'>('all');
  const [submissionFilter, setSubmissionFilter] = useState<'all' | 'submitted' | 'not_submitted'>('all');
  const [sortBy, setSortBy] = useState<'matric_asc' | 'matric_desc' | 'name_asc' | 'time_desc'>('matric_asc');

  // Export states
  const [isExportingWord, setIsExportingWord] = useState(false);

  // Admit Candidate Modal state
  const [showAdmitModal, setShowAdmitModal] = useState(false);
  const [admitForm, setAdmitForm] = useState({
    matricNumber: '',
    fullName: '',
    department: exam.department !== 'All Departments' ? exam.department : 'Human Kinetics & Sports Science',
    gender: 'M',
    autoSignIn: true
  });
  const [admitError, setAdmitError] = useState<string | null>(null);
  const [isSubmittingAdmit, setIsSubmittingAdmit] = useState(false);

  // Reset Attendance Modal state
  const [candidateToReset, setCandidateToReset] = useState<AttendanceRecord | null>(null);
  const [resetReason, setResetReason] = useState('Administrative attendance status correction');
  const [isSubmittingReset, setIsSubmittingReset] = useState(false);

  // General Notification Banner
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    fetchAttendance();
  }, [exam.id, user]);

  const fetchAttendance = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/exam/${exam.id}/attendance`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to retrieve attendance records.');
      }
      setAttendanceRecords(data.attendanceList || []);
    } catch (err: any) {
      console.error('Fetch attendance error:', err);
      setNotification({
        type: 'error',
        message: err.message || 'Could not load examination attendance register.'
      });
    } finally {
      setLoading(false);
    }
  };

  // Sign In Candidate
  const handleSignIn = async (matricNumber: string, extraData?: { fullName?: string; department?: string; gender?: string }) => {
    if (!user) return;
    setActionLoadingId(`in_${matricNumber}`);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/exam/${exam.id}/attendance/sign-in`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          matricNumber,
          fullName: extraData?.fullName,
          department: extraData?.department,
          gender: extraData?.gender
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to record sign-in.');
      }

      setNotification({
        type: 'success',
        message: data.message || `Student ${matricNumber} successfully signed in.`
      });
      setTimeout(() => setNotification(null), 4000);
      await fetchAttendance();
    } catch (err: any) {
      console.error('Sign-in error:', err);
      setNotification({
        type: 'error',
        message: err.message || 'Sign-in failed.'
      });
      setTimeout(() => setNotification(null), 5000);
    } finally {
      setActionLoadingId(null);
    }
  };

  // Sign Out Candidate
  const handleSignOut = async (matricNumber: string) => {
    if (!user) return;
    setActionLoadingId(`out_${matricNumber}`);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/exam/${exam.id}/attendance/sign-out`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ matricNumber })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to record sign-out.');
      }

      setNotification({
        type: 'success',
        message: data.message || `Student ${matricNumber} successfully signed out.`
      });
      setTimeout(() => setNotification(null), 4000);
      await fetchAttendance();
    } catch (err: any) {
      console.error('Sign-out error:', err);
      setNotification({
        type: 'error',
        message: err.message || 'Sign-out failed.'
      });
      setTimeout(() => setNotification(null), 5000);
    } finally {
      setActionLoadingId(null);
    }
  };

  // Quick Barcode / Scanner Form Submit
  const handleQuickScannerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawInput = quickMatric.trim();
    if (!rawInput) return;

    const validation = validateMatricNumber(rawInput);
    if (!validation.isValid) {
      setQuickFeedback({
        type: 'error',
        message: validation.error || 'Invalid matriculation number format.'
      });
      setTimeout(() => setQuickFeedback(null), 4000);
      return;
    }

    const cleanMatric = validation.normalized;
    const existing = attendanceRecords.find((r) => r.matricNumber === cleanMatric);

    if (quickActionType === 'sign-in') {
      if (existing?.signInTime) {
        setQuickFeedback({
          type: 'error',
          message: `Duplicate action prevented: ${existing.fullName} (${cleanMatric}) is ALREADY signed in at ${formatLagosTime(existing.signInTime)}.`
        });
        setTimeout(() => setQuickFeedback(null), 4500);
        return;
      }
      await handleSignIn(cleanMatric, existing ? { fullName: existing.fullName, department: existing.department, gender: existing.gender } : undefined);
      setQuickFeedback({
        type: 'success',
        message: `✓ Signed In: ${existing?.fullName || cleanMatric}`
      });
    } else {
      if (!existing?.signInTime) {
        setQuickFeedback({
          type: 'error',
          message: `Cannot sign out: ${cleanMatric} has not signed in yet. Physical sign-in is required first.`
        });
        setTimeout(() => setQuickFeedback(null), 4500);
        return;
      }
      if (existing.signOutTime) {
        setQuickFeedback({
          type: 'error',
          message: `Duplicate action prevented: ${existing.fullName} (${cleanMatric}) already signed out at ${formatLagosTime(existing.signOutTime)}.`
        });
        setTimeout(() => setQuickFeedback(null), 4500);
        return;
      }
      await handleSignOut(cleanMatric);
      setQuickFeedback({
        type: 'success',
        message: `✓ Signed Out: ${existing.fullName || cleanMatric}`
      });
    }

    setQuickMatric('');
    setTimeout(() => setQuickFeedback(null), 4000);
    if (quickInputRef.current) {
      quickInputRef.current.focus();
    }
  };

  // Admit Candidate Form Submit
  const handleAdmitSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdmitError(null);

    const val = validateMatricNumber(admitForm.matricNumber);
    if (!val.isValid) {
      setAdmitError(val.error || 'Please enter a valid Format A or Format B matriculation number.');
      return;
    }

    if (!admitForm.fullName.trim()) {
      setAdmitError('Student full name is required.');
      return;
    }

    setIsSubmittingAdmit(true);
    try {
      const token = await user?.getIdToken();
      const res = await fetch(`/api/exam/${exam.id}/attendance/admit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          matricNumber: val.normalized,
          fullName: admitForm.fullName.trim(),
          department: admitForm.department,
          gender: admitForm.gender,
          autoSignIn: admitForm.autoSignIn
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to admit candidate.');
      }

      setNotification({
        type: 'success',
        message: data.message || `Candidate ${admitForm.fullName} admitted successfully.`
      });
      setTimeout(() => setNotification(null), 4000);
      setShowAdmitModal(false);
      setAdmitForm({
        matricNumber: '',
        fullName: '',
        department: exam.department !== 'All Departments' ? exam.department : 'Human Kinetics & Sports Science',
        gender: 'M',
        autoSignIn: true
      });
      await fetchAttendance();
    } catch (err: any) {
      console.error('Admit error:', err);
      setAdmitError(err.message || 'Failed to admit candidate.');
    } finally {
      setIsSubmittingAdmit(false);
    }
  };

  // Reset / Correct Attendance
  const confirmResetAttendance = async () => {
    if (!candidateToReset || !user) return;
    setIsSubmittingReset(true);
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
          reason: resetReason.trim()
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to correct attendance record.');
      }

      setNotification({
        type: 'success',
        message: data.message || `Attendance for ${candidateToReset.matricNumber} reset successfully.`
      });
      setTimeout(() => setNotification(null), 5000);
      setCandidateToReset(null);
      await fetchAttendance();
    } catch (err: any) {
      console.error('Reset error:', err);
      setNotification({
        type: 'error',
        message: err.message || 'Could not reset attendance record.'
      });
      setTimeout(() => setNotification(null), 5000);
    } finally {
      setIsSubmittingReset(false);
    }
  };

  // Filtered & Sorted Records
  const filteredRecords = useMemo(() => {
    return attendanceRecords
      .filter((rec) => {
        const matchesSearch =
          rec.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
          rec.matricNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (rec.submissionReceipt && rec.submissionReceipt.toLowerCase().includes(searchQuery.toLowerCase()));

        const matchesDept = selectedDept === 'All' || rec.department === selectedDept;

        const matchesSignIn =
          signInFilter === 'all' ||
          (signInFilter === 'signed_in' && rec.signInTime !== null) ||
          (signInFilter === 'not_signed_in' && rec.signInTime === null);

        const matchesSignOut =
          signOutFilter === 'all' ||
          (signOutFilter === 'signed_out' && rec.signOutTime !== null) ||
          (signOutFilter === 'not_signed_out' && rec.signOutTime === null);

        const matchesSubmission =
          submissionFilter === 'all' ||
          (submissionFilter === 'submitted' && rec.submissionStatus === 'submitted') ||
          (submissionFilter === 'not_submitted' && rec.submissionStatus !== 'submitted');

        return matchesSearch && matchesDept && matchesSignIn && matchesSignOut && matchesSubmission;
      })
      .sort((a, b) => {
        if (sortBy === 'matric_asc') return a.matricNumber.localeCompare(b.matricNumber);
        if (sortBy === 'matric_desc') return b.matricNumber.localeCompare(a.matricNumber);
        if (sortBy === 'name_asc') return a.fullName.localeCompare(b.fullName);
        if (sortBy === 'time_desc') {
          const timeA = a.signInTime ? new Date(a.signInTime).getTime() : 0;
          const timeB = b.signInTime ? new Date(b.signInTime).getTime() : 0;
          return timeB - timeA;
        }
        return 0;
      });
  }, [attendanceRecords, searchQuery, selectedDept, signInFilter, signOutFilter, submissionFilter, sortBy]);

  // Real KPI statistics calculated from actual records
  const totalRegistered = attendanceRecords.length;
  const totalSignedIn = attendanceRecords.filter((a) => a.signInTime !== null).length;
  const totalSignedOut = attendanceRecords.filter((a) => a.signOutTime !== null).length;
  const totalCurrentlyInHall = attendanceRecords.filter((a) => a.signInTime !== null && a.signOutTime === null).length;
  const totalAbsent = attendanceRecords.filter((a) => a.signInTime === null).length;
  const totalSubmitted = attendanceRecords.filter((a) => a.submissionStatus === 'submitted').length;

  const handleExportWord = async () => {
    setIsExportingWord(true);
    try {
      await exportAttendanceToWord(exam, filteredRecords, {
        totalRegistered,
        totalSignedIn,
        totalSignedOut,
        totalCurrentlyInHall,
        totalAbsent,
        totalSubmitted
      });
    } catch (err) {
      console.error('Word export error:', err);
      alert('Failed to generate Word attendance report.');
    } finally {
      setIsExportingWord(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto pb-16 px-4 sm:px-6">
      {/* Top Bar Navigation & Exam Switcher */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 my-6">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm font-semibold text-[#ADCDBA] hover:text-[#F0F9F3] transition cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4 text-[#D6BF62]" />
          <span>Back to Examinations</span>
        </button>

        {/* Action & Export Buttons */}
        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
          {/* Admit Candidate Button */}
          <button
            onClick={() => {
              setAdmitError(null);
              setShowAdmitModal(true);
            }}
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2 bg-[#0A2419] hover:bg-[#0E3324] text-[#D6BF62] hover:text-[#F0F9F3] border border-[#D6BF62]/50 font-bold text-xs rounded-xl shadow-sm transition cursor-pointer"
          >
            <Plus className="w-4 h-4 text-[#D6BF62]" />
            <span>Admit Candidate</span>
          </button>

          {/* Export to Excel (.xlsx) */}
          <button
            onClick={() => exportAttendanceToExcel(exam, filteredRecords)}
            disabled={filteredRecords.length === 0}
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2 bg-[#0A2419] hover:bg-[#0E3324] text-[#ADCDBA] hover:text-[#F0F9F3] border border-[#789981]/40 font-bold text-xs rounded-xl shadow-sm transition disabled:opacity-40 cursor-pointer"
            title="Export filtered attendance register to Microsoft Excel"
          >
            <FileSpreadsheet className="w-4 h-4 text-[#D6BF62]" />
            <span>Export Excel (.xlsx)</span>
          </button>

          {/* Export to Word (.docx) */}
          <button
            onClick={handleExportWord}
            disabled={filteredRecords.length === 0 || isExportingWord}
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2 bg-[#0E623B] hover:bg-[#127949] border border-[#D6BF62] text-[#F0F9F3] font-bold text-xs rounded-xl shadow-lg hover:shadow-[#0E623B]/30 transition disabled:opacity-40 cursor-pointer"
            title="Export official Word attendance report with attestation and signature block"
          >
            <FileText className="w-4 h-4 text-[#D6BF62]" />
            <span>{isExportingWord ? 'Generating Word Doc...' : 'Export Word Report (.docx)'}</span>
          </button>
        </div>
      </div>

      {/* Global Notification Banner */}
      {notification && (
        <div
          className={`mb-6 p-4 rounded-xl border flex items-center justify-between gap-3 text-xs sm:text-sm font-semibold animate-fadeIn ${
            notification.type === 'success'
              ? 'bg-[#061C13] border-[#10B981] text-[#10B981]'
              : 'bg-[#2A0808] border-red-500 text-red-300'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {notification.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 shrink-0 text-[#10B981]" />
            ) : (
              <ShieldAlert className="w-5 h-5 shrink-0 text-red-400" />
            )}
            <span>{notification.message}</span>
          </div>
          <button onClick={() => setNotification(null)} className="p-1 hover:opacity-80 rounded cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Header Banner & Examination Switcher */}
      <div className="bg-[#061C13] rounded-2xl shadow-xl border border-[#789981]/30 p-6 sm:p-7 mb-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-1 bg-[#0A2419] border border-[#D6BF62]/30 text-[#D6BF62] font-black text-xs rounded-md">
                {exam.courseCode}
              </span>
              <span
                className={`px-2 py-0.5 rounded text-[11px] font-bold uppercase ${
                  exam.status === 'published'
                    ? 'bg-[#0E623B]/40 text-[#10B981] border border-[#10B981]/40'
                    : 'bg-[#030515] text-[#789981] border border-[#789981]/30'
                }`}
              >
                {exam.status}
              </span>
              <span className="text-xs text-[#ADCDBA]">
                Dept: <strong className="text-[#F0F9F3]">{exam.department}</strong>
              </span>
            </div>

            <div className="flex items-center gap-3 pt-1">
              <h1 className="text-xl sm:text-2xl font-black text-[#F0F9F3] tracking-tight">
                {exam.courseTitle}
              </h1>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-[#ADCDBA] pt-1">
              <div className="flex items-center gap-1">
                <User className="w-3.5 h-3.5 text-[#D6BF62]" />
                <span>Course Examiner: <strong className="text-[#F0F9F3]">{exam.lecturerName || 'Not specified'}</strong></span>
              </div>
              <span className="text-[#789981]/40 hidden sm:inline">•</span>
              <div className="flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-[#D6BF62]" />
                <span>Date: <strong className="text-[#F0F9F3]">{exam.startDate ? formatLagosDate(exam.startDate) : 'Not scheduled'}</strong></span>
              </div>
              <span className="text-[#789981]/40 hidden sm:inline">•</span>
              <div className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-[#D6BF62]" />
                <span>Window: <strong className="text-[#F0F9F3]">{exam.startDate ? `${formatLagosTime(exam.startDate)} – ${exam.endDate ? formatLagosTime(exam.endDate) : ''} (WAT)` : 'N/A'}</strong></span>
              </div>
            </div>

            <p className="text-[11px] text-[#789981] pt-1">
              SPORTS UNIVERSITY OF NIGERIA • PHYSICAL CANDIDATE VERIFICATION & EXAMINATION ATTENDANCE SYSTEM
            </p>
          </div>

          {/* Quick Examination Switcher Dropdown */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 bg-[#0A2419] p-2.5 rounded-xl border border-[#789981]/30 self-stretch md:self-auto">
            <span className="text-[11px] font-bold uppercase text-[#789981] px-1">Switch Exam:</span>
            <select
              value={exam.id}
              onChange={(e) => {
                const found = allExams.find((x) => x.id === e.target.value);
                if (found) onSelectExam(found);
              }}
              className="bg-[#061C13] border border-[#789981]/40 rounded-lg px-2.5 py-1.5 text-xs font-bold text-[#D6BF62] focus:outline-none focus:border-[#D6BF62] cursor-pointer"
            >
              {allExams.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.courseCode} — {x.courseTitle}
                </option>
              ))}
            </select>
            <button
              onClick={fetchAttendance}
              disabled={loading}
              className="p-1.5 text-[#789981] hover:text-[#F0F9F3] rounded-lg transition hover:bg-[#030515] cursor-pointer"
              title="Refresh attendance records"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-[#D6BF62]' : ''}`} />
            </button>
          </div>
        </div>

        {/* Summary Statistics Cards (Calculated from actual records) */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3.5 mt-6 pt-6 border-t border-[#789981]/20">
          <div className="bg-[#0A2419] p-3.5 rounded-xl border border-[#789981]/30">
            <div className="flex items-center justify-between text-[#789981] mb-1">
              <span className="text-[10px] font-bold uppercase tracking-wider">Total Registered</span>
              <Users className="w-3.5 h-3.5 text-[#D6BF62]" />
            </div>
            <p className="text-xl sm:text-2xl font-black text-[#F0F9F3]">{totalRegistered}</p>
            <p className="text-[10px] text-[#ADCDBA] mt-0.5">Eligible candidates</p>
          </div>

          <div className="bg-[#0A2419] p-3.5 rounded-xl border border-[#10B981]/40">
            <div className="flex items-center justify-between text-[#10B981] mb-1">
              <span className="text-[10px] font-bold uppercase tracking-wider">Total Sign-In</span>
              <LogIn className="w-3.5 h-3.5 text-[#10B981]" />
            </div>
            <p className="text-xl sm:text-2xl font-black text-[#10B981]">{totalSignedIn}</p>
            <p className="text-[10px] text-[#ADCDBA] mt-0.5">Recorded present</p>
          </div>

          <div className="bg-[#0A2419] p-3.5 rounded-xl border border-blue-500/40">
            <div className="flex items-center justify-between text-blue-400 mb-1">
              <span className="text-[10px] font-bold uppercase tracking-wider">Total Sign-Out</span>
              <LogOut className="w-3.5 h-3.5 text-blue-400" />
            </div>
            <p className="text-xl sm:text-2xl font-black text-blue-300">{totalSignedOut}</p>
            <p className="text-[10px] text-[#ADCDBA] mt-0.5">Departed hall</p>
          </div>

          <div className="bg-[#0A2419] p-3.5 rounded-xl border border-[#D6BF62]/40">
            <div className="flex items-center justify-between text-[#D6BF62] mb-1">
              <span className="text-[10px] font-bold uppercase tracking-wider">Present in Hall</span>
              <UserCheck className="w-3.5 h-3.5 text-[#D6BF62]" />
            </div>
            <p className="text-xl sm:text-2xl font-black text-[#D6BF62]">{totalCurrentlyInHall}</p>
            <p className="text-[10px] text-[#ADCDBA] mt-0.5">Active candidates</p>
          </div>

          <div className="bg-[#0A2419] p-3.5 rounded-xl border border-amber-500/40 col-span-2 sm:col-span-1">
            <div className="flex items-center justify-between text-amber-400 mb-1">
              <span className="text-[10px] font-bold uppercase tracking-wider">Absent / Pending</span>
              <UserX className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <p className="text-xl sm:text-2xl font-black text-amber-300">{totalAbsent}</p>
            <p className="text-[10px] text-[#ADCDBA] mt-0.5">Not yet signed in</p>
          </div>
        </div>
      </div>

      {/* FAST SCANNER & QUICK MATRICULATION ENTRY BAR */}
      <div className="bg-[#061C13] rounded-2xl shadow-xl border border-[#D6BF62]/30 p-4 sm:p-5 mb-6">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#0A2419] border border-[#D6BF62]/40 flex items-center justify-center text-[#D6BF62] shrink-0">
              <QrCode className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-black text-[#F0F9F3]">
                Fast Attendance Scanner & Matric Entry
              </h2>
              <p className="text-[11px] text-[#ADCDBA]">
                Scan student ID barcode/QR or type matriculation number and press Enter to record immediately.
              </p>
            </div>
          </div>

          {/* Quick Action Toggle & Input Form */}
          <form onSubmit={handleQuickScannerSubmit} className="flex flex-col sm:flex-row items-center gap-2 flex-1 max-w-xl">
            {/* Mode Toggle */}
            <div className="flex items-center bg-[#0A2419] p-1 rounded-xl border border-[#789981]/30 shrink-0 w-full sm:w-auto">
              <button
                type="button"
                onClick={() => setQuickActionType('sign-in')}
                className={`flex-1 sm:flex-none px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer flex items-center justify-center gap-1 ${
                  quickActionType === 'sign-in'
                    ? 'bg-[#0E623B] text-[#F0F9F3] border border-[#10B981]'
                    : 'text-[#ADCDBA] hover:text-[#F0F9F3]'
                }`}
              >
                <LogIn className="w-3 h-3 text-[#10B981]" />
                <span>Sign In</span>
              </button>
              <button
                type="button"
                onClick={() => setQuickActionType('sign-out')}
                className={`flex-1 sm:flex-none px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer flex items-center justify-center gap-1 ${
                  quickActionType === 'sign-out'
                    ? 'bg-blue-900/60 text-blue-200 border border-blue-500'
                    : 'text-[#ADCDBA] hover:text-[#F0F9F3]'
                }`}
              >
                <LogOut className="w-3 h-3 text-blue-400" />
                <span>Sign Out</span>
              </button>
            </div>

            {/* Matric Input */}
            <div className="relative flex-1 w-full">
              <input
                ref={quickInputRef}
                type="text"
                placeholder="Enter or Scan Matric (e.g. 2026201120 or DE2026201120)..."
                value={quickMatric}
                onChange={(e) => setQuickMatric(e.target.value.toUpperCase())}
                className="w-full pl-3.5 pr-24 py-2 bg-[#0A2419] border border-[#D6BF62]/50 rounded-xl text-xs font-mono font-bold text-[#F0F9F3] placeholder-[#789981]/60 focus:outline-none focus:ring-1 focus:ring-[#D6BF62]"
              />
              <button
                type="submit"
                disabled={!quickMatric.trim()}
                className={`absolute right-1 top-1 bottom-1 px-3 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1 disabled:opacity-40 ${
                  quickActionType === 'sign-in'
                    ? 'bg-[#0E623B] hover:bg-[#127949] text-[#F0F9F3]'
                    : 'bg-blue-700 hover:bg-blue-600 text-white'
                }`}
              >
                <span>{quickActionType === 'sign-in' ? 'Sign In' : 'Sign Out'}</span>
              </button>
            </div>
          </form>
        </div>

        {/* Quick Feedback Toast */}
        {quickFeedback && (
          <div
            className={`mt-3 p-2.5 rounded-xl border text-xs font-semibold flex items-center gap-2 animate-fadeIn ${
              quickFeedback.type === 'success'
                ? 'bg-[#0E623B]/30 border-[#10B981] text-[#10B981]'
                : 'bg-[#2A0808] border-red-500 text-red-300'
            }`}
          >
            {quickFeedback.type === 'success' ? (
              <Check className="w-4 h-4 shrink-0 text-[#10B981]" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
            )}
            <span>{quickFeedback.message}</span>
          </div>
        )}
      </div>

      {/* FILTER & SEARCH TOOLBAR */}
      <div className="bg-[#061C13] rounded-2xl shadow-xl border border-[#789981]/30 p-4 mb-6 space-y-3">
        <div className="flex flex-col lg:flex-row items-center justify-between gap-3">
          {/* Search Bar */}
          <div className="relative w-full lg:w-72">
            <Search className="w-4 h-4 text-[#789981] absolute left-3 top-3" />
            <input
              type="text"
              placeholder="Search by name, matric or receipt..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3.5 py-2 bg-[#0A2419] border border-[#789981]/40 rounded-xl text-xs font-medium text-[#F0F9F3] placeholder-[#789981]/70 focus:outline-none focus:border-[#D6BF62]"
            />
          </div>

          {/* Department Filter */}
          <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
            <div className="flex items-center gap-1.5 bg-[#0A2419] px-3 py-1.5 rounded-xl border border-[#789981]/30 text-xs text-[#ADCDBA] w-full sm:w-auto">
              <Filter className="w-3.5 h-3.5 text-[#D6BF62]" />
              <span>Dept:</span>
              <select
                value={selectedDept}
                onChange={(e) => setSelectedDept(e.target.value)}
                className="bg-transparent font-bold text-[#F0F9F3] focus:outline-none cursor-pointer max-w-[150px] truncate"
              >
                <option value="All" className="bg-[#061C13]">All Departments</option>
                {SUN_DEPARTMENTS.filter(d => d !== 'All Departments').map((d) => (
                  <option key={d} value={d} className="bg-[#061C13]">{d}</option>
                ))}
              </select>
            </div>

            {/* Sign-In Filter */}
            <select
              value={signInFilter}
              onChange={(e) => setSignInFilter(e.target.value as any)}
              className="bg-[#0A2419] border border-[#789981]/30 text-[#ADCDBA] rounded-xl px-3 py-1.5 text-xs font-bold focus:outline-none cursor-pointer"
            >
              <option value="all" className="bg-[#061C13]">All Sign-In Status</option>
              <option value="signed_in" className="bg-[#061C13]">Signed In Only</option>
              <option value="not_signed_in" className="bg-[#061C13]">Not Signed In (Absent)</option>
            </select>

            {/* Sign-Out Filter */}
            <select
              value={signOutFilter}
              onChange={(e) => setSignOutFilter(e.target.value as any)}
              className="bg-[#0A2419] border border-[#789981]/30 text-[#ADCDBA] rounded-xl px-3 py-1.5 text-xs font-bold focus:outline-none cursor-pointer"
            >
              <option value="all" className="bg-[#061C13]">All Sign-Out Status</option>
              <option value="signed_out" className="bg-[#061C13]">Signed Out Only</option>
              <option value="not_signed_out" className="bg-[#061C13]">Not Signed Out</option>
            </select>

            {/* Submission Filter */}
            <select
              value={submissionFilter}
              onChange={(e) => setSubmissionFilter(e.target.value as any)}
              className="bg-[#0A2419] border border-[#789981]/30 text-[#ADCDBA] rounded-xl px-3 py-1.5 text-xs font-bold focus:outline-none cursor-pointer"
            >
              <option value="all" className="bg-[#061C13]">All CBT Status</option>
              <option value="submitted" className="bg-[#061C13]">Submitted</option>
              <option value="not_submitted" className="bg-[#061C13]">Not Submitted</option>
            </select>

            {/* Sort Filter */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="bg-[#0A2419] border border-[#789981]/30 text-[#D6BF62] rounded-xl px-3 py-1.5 text-xs font-bold focus:outline-none cursor-pointer"
            >
              <option value="matric_asc" className="bg-[#061C13]">Sort: Matric (Ascending)</option>
              <option value="matric_desc" className="bg-[#061C13]">Sort: Matric (Descending)</option>
              <option value="name_asc" className="bg-[#061C13]">Sort: Name (A–Z)</option>
              <option value="time_desc" className="bg-[#061C13]">Sort: Recent Sign-In</option>
            </select>
          </div>
        </div>

        {/* Filter count indicator */}
        <div className="flex items-center justify-between text-xs text-[#789981] pt-1 border-t border-[#789981]/20">
          <span>
            Showing <strong className="text-[#F0F9F3]">{filteredRecords.length}</strong> of{' '}
            <strong className="text-[#D6BF62]">{attendanceRecords.length}</strong> registered students
          </span>
          {(searchQuery || selectedDept !== 'All' || signInFilter !== 'all' || signOutFilter !== 'all' || submissionFilter !== 'all') && (
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedDept('All');
                setSignInFilter('all');
                setSignOutFilter('all');
                setSubmissionFilter('all');
              }}
              className="text-[#D6BF62] hover:underline cursor-pointer font-bold"
            >
              Clear Filters
            </button>
          )}
        </div>
      </div>

      {/* STUDENT ATTENDANCE REGISTER TABLE */}
      <div className="bg-[#061C13] rounded-2xl shadow-xl border border-[#789981]/30 overflow-hidden">
        <div className="p-4 border-b border-[#789981]/20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-extrabold text-[#F0F9F3] uppercase tracking-wider">
              Student Attendance Register
            </h2>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-[#0A2419] text-[#D6BF62] border border-[#D6BF62]/30">
              {filteredRecords.length} Students
            </span>
          </div>

          <div className="flex items-center gap-2 text-xs text-[#ADCDBA]">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#10B981]" /> Signed In
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-500 ml-2" /> Signed Out
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-slate-500 ml-2" /> Absent
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center text-[#ADCDBA]">
            <div className="w-8 h-8 border-2 border-[#D6BF62] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-xs">Loading attendance register...</p>
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="p-12 text-center text-[#ADCDBA]">
            <UserX className="w-10 h-10 text-[#789981] mx-auto mb-2" />
            <h3 className="text-sm font-bold text-[#F0F9F3]">No Attendance Records Found</h3>
            <p className="text-xs text-[#789981] mt-1 max-w-sm mx-auto">
              {searchQuery
                ? `No candidates matched "${searchQuery}".`
                : 'No candidates registered for this examination yet. You can admit candidates using the "Admit Candidate" button above.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#0A2419] border-b border-[#789981]/30 text-[#789981] uppercase font-bold text-[10px] tracking-wider">
                  <th className="py-3 px-3 text-center w-10">S/N</th>
                  <th className="py-3 px-3">Matriculation Number</th>
                  <th className="py-3 px-3">Student's Full Name</th>
                  <th className="py-3 px-3">Department</th>
                  <th className="py-3 px-3 text-center w-12">Sex</th>
                  <th className="py-3 px-3">Sign-In Time</th>
                  <th className="py-3 px-3">Sign-Out Time</th>
                  <th className="py-3 px-3 text-center">CBT Submission</th>
                  <th className="py-3 px-3 text-center">Attendance</th>
                  <th className="py-3 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#789981]/15 text-[#ADCDBA]">
                {filteredRecords.map((rec, idx) => {
                  const isSignedIn = rec.signInTime !== null;
                  const isSignedOut = rec.signOutTime !== null;
                  const isSubmitted = rec.submissionStatus === 'submitted';

                  return (
                    <tr
                      key={rec.matricNumber}
                      className={`hover:bg-[#0A2419]/60 transition ${
                        isSignedOut
                          ? 'bg-blue-950/10'
                          : isSignedIn
                          ? 'bg-[#0E623B]/10'
                          : 'bg-transparent'
                      }`}
                    >
                      <td className="py-3 px-3 text-center text-[#789981] font-mono">{idx + 1}</td>
                      <td className="py-3 px-3 font-mono font-bold text-[#D6BF62] whitespace-nowrap">
                        {rec.matricNumber}
                      </td>
                      <td className="py-3 px-3 font-semibold text-[#F0F9F3] whitespace-nowrap">
                        {capitalizeProper(rec.fullName)}
                      </td>
                      <td className="py-3 px-3 text-[#ADCDBA] whitespace-nowrap">
                        {capitalizeProper(rec.department)}
                      </td>
                      <td className="py-3 px-3 text-center font-bold text-[#D6BF62]">
                        {rec.gender || '—'}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        {rec.signInTime ? (
                          <div className="flex flex-col">
                            <span className="font-bold text-[#10B981] flex items-center gap-1">
                              <LogIn className="w-3 h-3" />
                              {formatLagosTime(rec.signInTime)}
                            </span>
                            <span className="text-[10px] text-[#789981]">{formatLagosDate(rec.signInTime)}</span>
                          </div>
                        ) : (
                          <span className="text-slate-500 italic">Not Signed In</span>
                        )}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        {rec.signOutTime ? (
                          <div className="flex flex-col">
                            <span className="font-bold text-blue-300 flex items-center gap-1">
                              <LogOut className="w-3 h-3" />
                              {formatLagosTime(rec.signOutTime)}
                            </span>
                            <span className="text-[10px] text-[#789981]">{formatLagosDate(rec.signOutTime)}</span>
                          </div>
                        ) : (
                          <span className="text-slate-500 italic">Not Signed Out</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-center whitespace-nowrap">
                        {isSubmitted ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#0E623B]/40 text-[#10B981] border border-[#10B981]/40" title={`Submitted at ${rec.submittedAt ? formatLagosDateTime(rec.submittedAt) : ''}`}>
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Submitted</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#030515] text-[#789981] border border-[#789981]/30">
                            <span>Not Submitted</span>
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-center whitespace-nowrap">
                        {isSignedOut ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-900/40 text-blue-300 border border-blue-500/40">
                            <span>Signed Out</span>
                          </span>
                        ) : isSignedIn ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#0E623B]/40 text-[#10B981] border border-[#10B981]/40">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-pulse" />
                            <span>In Hall</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#2A0808]/40 text-red-300 border border-red-500/30">
                            <span>Absent</span>
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Sign In Button */}
                          {!isSignedIn && (
                            <button
                              type="button"
                              onClick={() => handleSignIn(rec.matricNumber, { fullName: rec.fullName, department: rec.department, gender: rec.gender })}
                              disabled={actionLoadingId === `in_${rec.matricNumber}`}
                              className="px-2.5 py-1 bg-[#0E623B] hover:bg-[#127949] text-[#F0F9F3] font-bold rounded-lg text-[11px] shadow-sm transition disabled:opacity-40 cursor-pointer flex items-center gap-1"
                              title="Record student sign-in"
                            >
                              <LogIn className="w-3 h-3 text-[#D6BF62]" />
                              <span>Sign In</span>
                            </button>
                          )}

                          {/* Sign Out Button */}
                          {isSignedIn && !isSignedOut && (
                            <button
                              type="button"
                              onClick={() => handleSignOut(rec.matricNumber)}
                              disabled={actionLoadingId === `out_${rec.matricNumber}`}
                              className="px-2.5 py-1 bg-blue-700 hover:bg-blue-600 text-white font-bold rounded-lg text-[11px] shadow-sm transition disabled:opacity-40 cursor-pointer flex items-center gap-1"
                              title="Record student sign-out"
                            >
                              <LogOut className="w-3 h-3 text-white" />
                              <span>Sign Out</span>
                            </button>
                          )}

                          {/* Reset / Correction Button */}
                          {(isSignedIn || isSignedOut) && (
                            <button
                              type="button"
                              onClick={() => {
                                setCandidateToReset(rec);
                                setResetReason('Administrative attendance correction');
                              }}
                              className="p-1 text-[#789981] hover:text-amber-300 hover:bg-[#0A2419] rounded-lg transition border border-transparent hover:border-amber-400/30 cursor-pointer"
                              title="Reset or correct attendance for this candidate (Audited)"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ADMIT CANDIDATE MODAL */}
      {showAdmitModal && (
        <div className="fixed inset-0 z-50 bg-[#030515]/85 flex items-center justify-center p-4 backdrop-blur-sm animate-fadeIn">
          <div className="bg-[#061C13] rounded-3xl max-w-lg w-full p-6 sm:p-7 shadow-2xl border border-[#D6BF62]/40 space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-[#789981]/30">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-[#0A2419] border border-[#D6BF62]/30 flex items-center justify-center text-[#D6BF62]">
                  <Plus className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-extrabold text-[#F0F9F3] text-base">Admit Candidate to Register</h3>
                  <p className="text-[11px] text-[#ADCDBA]">Direct admission for this examination ({exam.courseCode})</p>
                </div>
              </div>
              <button onClick={() => setShowAdmitModal(false)} className="p-1 text-[#789981] hover:text-[#F0F9F3] rounded-lg cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            {admitError && (
              <div className="p-3 bg-[#2A0808] border border-red-500 text-red-300 rounded-xl text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                <span>{admitError}</span>
              </div>
            )}

            <form onSubmit={handleAdmitSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block text-[#ADCDBA] font-bold mb-1">
                  Matriculation Number <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. 2026201120 or DE2026201120"
                  value={admitForm.matricNumber}
                  onChange={(e) => setAdmitForm({ ...admitForm, matricNumber: e.target.value.toUpperCase() })}
                  className="w-full px-3.5 py-2.5 bg-[#0A2419] border border-[#789981]/40 rounded-xl text-xs font-mono font-bold text-[#F0F9F3] focus:outline-none focus:border-[#D6BF62]"
                  required
                />
                <span className="text-[10px] text-[#789981] mt-1 block">Format A: 10 numeric digits • Format B: DE + 10 numeric digits</span>
              </div>

              <div>
                <label className="block text-[#ADCDBA] font-bold mb-1">
                  Student Full Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. John Doe Okafor"
                  value={admitForm.fullName}
                  onChange={(e) => setAdmitForm({ ...admitForm, fullName: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-[#0A2419] border border-[#789981]/40 rounded-xl text-xs font-semibold text-[#F0F9F3] focus:outline-none focus:border-[#D6BF62]"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#ADCDBA] font-bold mb-1">Department</label>
                  <select
                    value={admitForm.department}
                    onChange={(e) => setAdmitForm({ ...admitForm, department: e.target.value })}
                    className="w-full px-3 py-2.5 bg-[#0A2419] border border-[#789981]/40 rounded-xl text-xs font-semibold text-[#F0F9F3] focus:outline-none focus:border-[#D6BF62] cursor-pointer"
                  >
                    {SUN_DEPARTMENTS.filter(d => d !== 'All Departments').map((d) => (
                      <option key={d} value={d} className="bg-[#061C13]">{d}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[#ADCDBA] font-bold mb-1">Sex (M/F)</label>
                  <select
                    value={admitForm.gender}
                    onChange={(e) => setAdmitForm({ ...admitForm, gender: e.target.value })}
                    className="w-full px-3 py-2.5 bg-[#0A2419] border border-[#789981]/40 rounded-xl text-xs font-bold text-[#D6BF62] focus:outline-none focus:border-[#D6BF62] cursor-pointer"
                  >
                    <option value="M" className="bg-[#061C13]">M (Male)</option>
                    <option value="F" className="bg-[#061C13]">F (Female)</option>
                  </select>
                </div>
              </div>

              <div className="pt-2">
                <label className="flex items-center gap-2 cursor-pointer bg-[#0A2419] p-3 rounded-xl border border-[#789981]/30">
                  <input
                    type="checkbox"
                    checked={admitForm.autoSignIn}
                    onChange={(e) => setAdmitForm({ ...admitForm, autoSignIn: e.target.checked })}
                    className="rounded accent-[#10B981] w-4 h-4 cursor-pointer"
                  />
                  <span className="text-[#F0F9F3] font-bold text-xs">Immediately Record Sign-In upon admission</span>
                </label>
              </div>

              <div className="flex items-center gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAdmitModal(false)}
                  className="flex-1 py-2.5 px-4 bg-[#0A2419] hover:bg-[#0E3324] text-[#ADCDBA] border border-[#789981]/40 font-bold rounded-xl transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingAdmit}
                  className="flex-1 py-2.5 px-4 bg-[#0E623B] hover:bg-[#127949] border border-[#D6BF62] text-[#F0F9F3] font-bold rounded-xl shadow-lg transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {isSubmittingAdmit ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      <Check className="w-4 h-4 text-[#D6BF62]" />
                      <span>Confirm Admission</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RESET ATTENDANCE CONFIRMATION MODAL (AUDITED) */}
      {candidateToReset && (
        <div className="fixed inset-0 z-50 bg-[#030515]/85 flex items-center justify-center p-4 backdrop-blur-sm animate-fadeIn">
          <div className="bg-[#061C13] rounded-3xl max-w-md w-full p-6 sm:p-7 shadow-2xl border border-amber-500/50 space-y-5 text-center">
            <div className="w-14 h-14 mx-auto bg-[#2A0808] text-amber-400 rounded-2xl flex items-center justify-center border border-amber-500/40 shadow-sm">
              <RotateCcw className="w-7 h-7" />
            </div>

            <div className="space-y-2 text-left sm:text-center">
              <h3 className="text-lg font-black text-[#F0F9F3]">
                Reset Attendance Record?
              </h3>
              <p className="text-xs text-[#ADCDBA] leading-relaxed">
                This will reset the sign-in and sign-out timestamps for <strong className="text-[#F0F9F3]">{candidateToReset.fullName}</strong> ({candidateToReset.matricNumber}) back to absent.
              </p>
              <div className="p-3 bg-[#0A2419] rounded-xl border border-[#789981]/30 text-xs text-left space-y-1">
                <div className="flex justify-between text-[#ADCDBA]">
                  <span className="text-[#789981]">Sign-In Record:</span>
                  <span className="font-mono text-[#10B981]">{candidateToReset.signInTime ? formatLagosDateTime(candidateToReset.signInTime) : 'None'}</span>
                </div>
                <div className="flex justify-between text-[#ADCDBA]">
                  <span className="text-[#789981]">Sign-Out Record:</span>
                  <span className="font-mono text-blue-300">{candidateToReset.signOutTime ? formatLagosDateTime(candidateToReset.signOutTime) : 'None'}</span>
                </div>
              </div>

              <div className="text-left pt-2">
                <label className="block text-[11px] font-bold text-[#ADCDBA] mb-1">
                  Reason for correction (will be recorded in audit log):
                </label>
                <input
                  type="text"
                  value={resetReason}
                  onChange={(e) => setResetReason(e.target.value)}
                  placeholder="e.g. Student scanned by mistake or hall reassignment"
                  className="w-full px-3 py-2 bg-[#0A2419] border border-[#789981]/40 rounded-xl text-xs text-[#F0F9F3] focus:outline-none focus:border-amber-400"
                />
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setCandidateToReset(null)}
                disabled={isSubmittingReset}
                className="flex-1 py-2.5 px-4 bg-[#0A2419] hover:bg-[#0E3324] text-[#ADCDBA] border border-[#789981]/40 font-bold text-xs rounded-xl transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmResetAttendance}
                disabled={isSubmittingReset}
                className="flex-1 py-2.5 px-4 bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs rounded-xl shadow-md transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isSubmittingReset ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <RotateCcw className="w-4 h-4" />
                    <span>Confirm Reset</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
