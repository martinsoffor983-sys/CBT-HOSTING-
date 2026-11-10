import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  Download,
  FileSpreadsheet,
  FileText,
  Search,
  Filter,
  Users,
  Award,
  TrendingUp,
  Percent,
  CheckCircle,
  XCircle,
  Clock,
  ArrowUpDown,
  Eye,
  User,
  Calendar,
  X,
  Printer,
  ShieldAlert,
  Check,
  HelpCircle,
  Eraser,
  ClipboardCheck
} from 'lucide-react';
import { Exam, Submission, SUN_DEPARTMENTS, QuestionSnapshot } from '../../types';
import { collection, query, where, getDocs, writeBatch, doc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import {
  exportToExcel,
  exportToWord,
  exportIndividualScriptToWord,
  exportIndividualScriptToExcel
} from '../../utils/exportUtils';
import { capitalizeProper } from '../../utils/studentValidation';
import { formatLagosDate, formatLagosTime, formatLagosDateTime } from '../../utils/timeUtils';
import { useAuth, isAuthorizedExaminerEmail } from '../../context/AuthContext';

interface ExamResultsViewProps {
  exam: Exam;
  onBack: () => void;
  onViewAttendance?: () => void;
}

export const ExamResultsView: React.FC<ExamResultsViewProps> = ({ exam, onBack, onViewAttendance }) => {
  const { user } = useAuth();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('All');
  const [sortBy, setSortBy] = useState<'matric_asc' | 'matric_desc' | 'score_desc' | 'score_asc' | 'date_desc'>('matric_asc');
  const [isExportingWord, setIsExportingWord] = useState(false);
  const [isExportingScriptWord, setIsExportingScriptWord] = useState(false);
  const [selectedScript, setSelectedScript] = useState<Submission | null>(null);
  const [showDeleteResultsModal, setShowDeleteResultsModal] = useState(false);
  const [isDeletingResults, setIsDeletingResults] = useState(false);
  const [deleteNotification, setDeleteNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const isSuperAdmin = isAuthorizedExaminerEmail(user?.email);
  const isCourseLecturer = (exam.lecturerEmail || '').toLowerCase().trim() === (user?.email || '').toLowerCase().trim();
  const isAuthorized = isSuperAdmin || isCourseLecturer;

  const handleDeleteResults = async () => {
    if (!user) return;
    setIsDeletingResults(true);
    try {
      // 1. Direct authenticated client deletion of submissions
      try {
        const subsQuery = query(collection(db, 'submissions'), where('examId', '==', exam.id));
        const subsSnap = await getDocs(subsQuery);
        if (!subsSnap.empty) {
          const batch = writeBatch(db);
          subsSnap.forEach((d) => batch.delete(d.ref));
          await batch.commit();
        }
      } catch (clientSubErr) {
        console.warn('Direct client submission delete notice:', clientSubErr);
      }

      // 2. Direct authenticated client deletion of exam_sessions
      try {
        const sesQuery = query(collection(db, 'exam_sessions'), where('examId', '==', exam.id));
        const sesSnap = await getDocs(sesQuery);
        if (!sesSnap.empty) {
          const sesBatch = writeBatch(db);
          sesSnap.forEach((d) => sesBatch.delete(d.ref));
          await sesBatch.commit();
        }
      } catch (clientSesErr) {
        console.warn('Direct client session delete notice:', clientSesErr);
      }

      // 3. Server-side cleanup, audit log, and active timer clear
      const token = await user.getIdToken();
      const res = await fetch(`/api/exam/${exam.id}/delete-results`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok && !data.success) {
        throw new Error(data.error || 'Failed to complete examination results deletion.');
      }

      setSubmissions([]);
      setShowDeleteResultsModal(false);
      setDeleteNotification({
        type: 'success',
        message: data.message || `All student results for ${exam.courseCode} have been deleted successfully.`
      });
      setTimeout(() => setDeleteNotification(null), 5000);
    } catch (err: any) {
      console.error('Delete results error:', err);
      setDeleteNotification({
        type: 'error',
        message: `Failed to delete examination results: ${err.message || 'Operation failed'}`
      });
      setTimeout(() => setDeleteNotification(null), 6000);
    } finally {
      setIsDeletingResults(false);
    }
  };

  useEffect(() => {
    fetchSubmissions();
  }, [exam.id, user]);

  const fetchSubmissions = async () => {
    if (!user || !isAuthorized) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const q = query(collection(db, 'submissions'), where('examId', '==', exam.id));
      const snap = await getDocs(q);
      const list: Submission[] = [];
      snap.forEach((doc) => {
        list.push({ ...doc.data(), id: doc.id } as Submission);
      });
      // Sort by submission date (newest first)
      list.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
      setSubmissions(list);
    } catch (err: any) {
      console.warn('Notice fetching submissions:', err);
      if (err?.code === 'permission-denied') {
        // Handled silently
      } else {
        handleFirestoreError(err, OperationType.LIST, 'submissions');
      }
    } finally {
      setLoading(false);
    }
  };

  // Filter & Search Logic
  const filteredSubmissions = submissions
    .filter((sub) => {
      const matchesSearch =
        sub.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        sub.matricNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
        sub.submissionReceipt.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (sub.gender && sub.gender.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesDept =
        selectedDepartment === 'All' || sub.department === selectedDepartment;

      return matchesSearch && matchesDept;
    })
    .sort((a, b) => {
      if (sortBy === 'matric_asc') return a.matricNumber.localeCompare(b.matricNumber);
      if (sortBy === 'matric_desc') return b.matricNumber.localeCompare(a.matricNumber);
      if (sortBy === 'score_desc') return b.score - a.score;
      if (sortBy === 'score_asc') return a.score - b.score;
      if (sortBy === 'date_desc') return new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime();
      return 0;
    });

  // KPI calculations
  const totalCount = submissions.length;
  const avgPercentage =
    totalCount > 0
      ? (submissions.reduce((acc, cur) => acc + cur.percentage, 0) / totalCount).toFixed(1)
      : '0';
  const highestScore = totalCount > 0 ? Math.max(...submissions.map((s) => s.score)) : 0;
  const passCandidates = submissions.filter((s) => s.percentage >= 50).length;
  const passRate = totalCount > 0 ? Math.round((passCandidates / totalCount) * 100) : 0;

  const handleExportWord = async () => {
    setIsExportingWord(true);
    try {
      await exportToWord(exam, filteredSubmissions);
    } catch (err) {
      console.error('Word export error:', err);
      alert('Failed to generate Word document report.');
    } finally {
      setIsExportingWord(false);
    }
  };

  if (!isAuthorized) {
    return (
      <div className="max-w-2xl mx-auto py-16 px-4 text-center">
        <div className="w-16 h-16 rounded-2xl bg-red-950/60 border border-red-500/50 flex items-center justify-center mx-auto mb-4 text-red-400">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-[#F0F9F3]">Access Restricted</h2>
        <p className="text-xs text-[#ADCDBA] mt-2 max-w-md mx-auto">
          You are not authorized to access individual scripts or examination results for {exam.courseCode} ({exam.courseTitle}).
          Only the authorized course lecturer ({exam.lecturerName || 'Course Examiner'}) or the central university administrator may view these records.
        </p>
        <button
          onClick={onBack}
          className="mt-6 inline-flex items-center gap-2 px-4 py-2 bg-[#0A2419] hover:bg-[#0E3324] text-[#D6BF62] hover:text-[#F0F9F3] border border-[#D6BF62]/40 rounded-xl text-xs font-bold transition cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Return to Examinations</span>
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto pb-16 px-4 sm:px-6">
      {/* Top Bar Navigation */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 my-6">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm font-semibold text-[#ADCDBA] hover:text-[#F0F9F3] transition cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4 text-[#D6BF62]" />
          <span>Back to Examinations</span>
        </button>

        {/* Export & Action Buttons */}
        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
          {onViewAttendance && (
            <button
              type="button"
              onClick={onViewAttendance}
              className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 bg-[#0E623B]/30 hover:bg-[#0E623B]/60 text-[#F0F9F3] border border-[#D6BF62]/50 font-bold text-xs rounded-xl shadow-sm transition cursor-pointer"
              title="Switch to Examination Attendance Register"
            >
              <ClipboardCheck className="w-4 h-4 text-[#D6BF62]" />
              <span>Attendance Register</span>
            </button>
          )}

          <button
            onClick={() => exportToExcel(exam, filteredSubmissions)}
            disabled={filteredSubmissions.length === 0}
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 bg-[#0A2419] hover:bg-[#0E3324] text-[#ADCDBA] hover:text-[#F0F9F3] border border-[#789981]/40 font-bold text-xs rounded-xl shadow-sm transition disabled:opacity-40 cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4 text-[#D6BF62]" />
            <span>Export to Excel (.xlsx)</span>
          </button>

          <button
            onClick={handleExportWord}
            disabled={filteredSubmissions.length === 0 || isExportingWord}
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 bg-[#0E623B] hover:bg-[#127949] border border-[#D6BF62] text-[#F0F9F3] font-bold text-xs rounded-xl shadow-lg hover:shadow-[#0E623B]/30 transition disabled:opacity-40 cursor-pointer"
          >
            <FileText className="w-4 h-4 text-[#D6BF62]" />
            <span>{isExportingWord ? 'Generating Word Doc...' : 'Export Official Word Report (.docx)'}</span>
          </button>

          {/* Delete Results Action (Separate from Delete Exam) */}
          <button
            type="button"
            onClick={() => setShowDeleteResultsModal(true)}
            disabled={submissions.length === 0}
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 bg-[#2A0808]/70 hover:bg-[#3D0C0C] text-red-300 hover:text-white border border-red-500/40 font-bold text-xs rounded-xl shadow-sm transition disabled:opacity-40 cursor-pointer"
            title="Delete all student submissions, answers and results for this examination only"
          >
            <Eraser className="w-4 h-4 text-red-400" />
            <span>Delete Results</span>
          </button>
        </div>
      </div>

      {/* Action Notification */}
      {deleteNotification && (
        <div
          className={`mb-6 p-4 rounded-xl border flex items-center justify-between gap-3 text-xs font-semibold animate-fadeIn ${
            deleteNotification.type === 'success'
              ? 'bg-[#061C13] border-[#10B981] text-[#10B981]'
              : 'bg-[#2A0808] border-red-500 text-red-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {deleteNotification.type === 'success' ? (
              <Check className="w-4 h-4 shrink-0" />
            ) : (
              <ShieldAlert className="w-4 h-4 shrink-0 text-red-400" />
            )}
            <span>{deleteNotification.message}</span>
          </div>
          <button
            onClick={() => setDeleteNotification(null)}
            className="p-1 hover:opacity-80 rounded cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Header Banner */}
      <div className="bg-[#061C13] rounded-2xl shadow-xl border border-[#789981]/30 p-6 sm:p-8 mb-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 bg-[#0A2419] border border-[#D6BF62]/30 text-[#D6BF62] font-extrabold text-xs rounded-md">
                {exam.courseCode}
              </span>
              <span className="text-xs text-[#ADCDBA] font-medium">Department: {exam.department}</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-[#F0F9F3] mt-1">
              {exam.courseTitle}
            </h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-2 text-xs text-[#ADCDBA]">
              <div className="flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-[#D6BF62]" />
                <span>Course Lecturer: <strong className="text-[#F0F9F3] font-bold">{exam.lecturerName || 'Not specified'}</strong></span>
              </div>
              <span className="text-[#789981]/50 hidden sm:inline">•</span>
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-[#D6BF62]" />
                <span>Date: <strong className="text-[#F0F9F3]">{formatLagosDate(exam.startDate)}</strong></span>
              </div>
              <span className="text-[#789981]/50 hidden sm:inline">•</span>
              <div className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-[#D6BF62]" />
                <span>Window: <strong className="text-[#F0F9F3]">{formatLagosTime(exam.startDate)} – {formatLagosTime(exam.endDate)} (WAT)</strong></span>
              </div>
            </div>
            <p className="text-[11px] text-[#789981] mt-1.5">
              Official Examination Results & Candidate Evaluation Registry • Sports University of Nigeria
            </p>
          </div>

          <button
            onClick={fetchSubmissions}
            className="px-3 py-1.5 bg-[#0A2419] hover:bg-[#0E3324] text-[#ADCDBA] hover:text-[#F0F9F3] border border-[#789981]/30 text-xs font-semibold rounded-lg transition self-start md:self-auto cursor-pointer"
          >
            Refresh Records
          </button>
        </div>

        {/* KPI Metrics Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-6 border-t border-[#789981]/20">
          <div className="bg-[#0A2419] p-4 rounded-xl border border-[#789981]/30">
            <div className="flex items-center justify-between text-[#789981] mb-1">
              <span className="text-xs font-bold uppercase tracking-wider">Candidates</span>
              <Users className="w-4 h-4 text-[#D6BF62]" />
            </div>
            <p className="text-2xl font-extrabold text-[#F0F9F3]">{totalCount}</p>
            <p className="text-[11px] text-[#ADCDBA] mt-0.5">Submissions received</p>
          </div>

          <div className="bg-[#0A2419] p-4 rounded-xl border border-[#789981]/30">
            <div className="flex items-center justify-between text-[#789981] mb-1">
              <span className="text-xs font-bold uppercase tracking-wider">Class Average</span>
              <TrendingUp className="w-4 h-4 text-[#D6BF62]" />
            </div>
            <p className="text-2xl font-extrabold text-[#F0F9F3]">{avgPercentage}%</p>
            <p className="text-[11px] text-[#ADCDBA] mt-0.5">Mean student performance</p>
          </div>

          <div className="bg-[#0A2419] p-4 rounded-xl border border-[#789981]/30">
            <div className="flex items-center justify-between text-[#789981] mb-1">
              <span className="text-xs font-bold uppercase tracking-wider">Top Score</span>
              <Award className="w-4 h-4 text-[#D6BF62]" />
            </div>
            <p className="text-2xl font-extrabold text-[#D6BF62]">
              {highestScore} <span className="text-xs text-[#789981] font-normal">/ {exam.questionsCount}</span>
            </p>
            <p className="text-[11px] text-[#ADCDBA] mt-0.5">Highest raw mark</p>
          </div>

          <div className="bg-[#0A2419] p-4 rounded-xl border border-[#789981]/30">
            <div className="flex items-center justify-between text-[#789981] mb-1">
              <span className="text-xs font-bold uppercase tracking-wider">Pass Rate</span>
              <Percent className="w-4 h-4 text-[#10B981]" />
            </div>
            <p className="text-2xl font-extrabold text-[#10B981]">{passRate}%</p>
            <p className="text-[11px] text-[#ADCDBA] mt-0.5">Scored 50% and above</p>
          </div>
        </div>

        {/* Examination Batches Distribution */}
        {exam.randomizationEnabled && (
          <div className="mt-6 pt-5 border-t border-[#789981]/20">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-[#ADCDBA] flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-[#D6BF62]" />
                <span>Candidate Distribution Across Batches</span>
              </span>
              <span className="text-[11px] text-[#789981]">
                Randomisation Enabled
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {(['Batch A', 'Batch B', 'Batch C', 'Batch D'] as const).map((bName) => {
                const count = submissions.filter((s) => (s.batch || 'Batch A') === bName).length;
                const pct = totalCount > 0 ? Math.round((count / totalCount) * 100) : 0;
                return (
                  <div key={bName} className="p-3 bg-[#0A2419] rounded-xl border border-[#789981]/30 text-center">
                    <span className="inline-block px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-[#0E623B] text-[#D6BF62] border border-[#D6BF62]/30 mb-1">
                      {bName}
                    </span>
                    <p className="text-lg font-black text-[#F0F9F3]">{count} Candidates</p>
                    <p className="text-[10px] text-[#ADCDBA]">{pct}% of cohort</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Filters and Search Bar */}
      <div className="bg-[#061C13] rounded-2xl shadow-xl border border-[#789981]/30 p-4 sm:p-5 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Search */}
          <div className="relative">
            <Search className="w-4 h-4 text-[#789981] absolute left-3.5 top-3" />
            <input
              type="text"
              placeholder="Search by student name or matric no..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3.5 py-2 bg-[#0A2419] border border-[#789981]/40 rounded-xl text-xs font-medium text-[#F0F9F3] placeholder-[#789981]/70 focus:outline-none focus:border-[#D6BF62] focus:ring-1 focus:ring-[#D6BF62]"
            />
          </div>

          {/* Department Filter */}
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-[#789981] shrink-0" />
            <select
              value={selectedDepartment}
              onChange={(e) => setSelectedDepartment(e.target.value)}
              className="w-full px-3 py-2 bg-[#0A2419] border border-[#789981]/40 rounded-xl text-xs font-medium text-[#F0F9F3] focus:outline-none focus:border-[#D6BF62] focus:ring-1 focus:ring-[#D6BF62]"
            >
              <option value="All">All Departments ({submissions.length})</option>
              {Array.from(
                new Set([
                  ...submissions.map((s) => s.department).filter(Boolean),
                  ...SUN_DEPARTMENTS.filter((d) => d !== 'All Departments')
                ])
              )
                .sort()
                .map((dept) => {
                  const count = submissions.filter((s) => s.department === dept).length;
                  return (
                    <option key={dept} value={dept}>
                      {dept} {count > 0 ? `(${count})` : ''}
                    </option>
                  );
                })}
            </select>
          </div>

          {/* Sort Control */}
          <div className="flex items-center gap-2">
            <ArrowUpDown className="w-4 h-4 text-[#789981] shrink-0" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="w-full px-3 py-2 bg-[#0A2419] border border-[#789981]/40 rounded-xl text-xs font-medium text-[#F0F9F3] focus:outline-none focus:border-[#D6BF62] focus:ring-1 focus:ring-[#D6BF62]"
            >
              <option value="matric_asc">Matriculation No. (A to Z)</option>
              <option value="matric_desc">Matriculation No. (Z to A)</option>
              <option value="score_desc">Score (Highest First)</option>
              <option value="score_asc">Score (Lowest First)</option>
              <option value="date_desc">Submission Date & Time</option>
            </select>
          </div>
        </div>
      </div>

      {/* Submissions Table */}
      <div className="bg-[#061C13] rounded-2xl shadow-xl border border-[#789981]/30 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <div className="w-8 h-8 border-3 border-[#D6BF62] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-xs text-[#ADCDBA] font-medium">Loading candidate records...</p>
          </div>
        ) : filteredSubmissions.length === 0 ? (
          <div className="p-12 text-center">
            <Users className="w-10 h-10 text-[#789981] mx-auto mb-2" />
            <p className="text-sm font-semibold text-[#F0F9F3]">No Student Records Found</p>
            <p className="text-xs text-[#ADCDBA] mt-1 max-w-sm mx-auto">
              {searchQuery || selectedDepartment !== 'All'
                ? 'No students matched your search criteria.'
                : 'No candidate has submitted this examination yet.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gradient-to-r from-[#0A2419] to-[#061C13] border-b border-[#D6BF62]/30 text-[#D6BF62] text-[11px] font-bold uppercase tracking-wider">
                  <th className="py-3.5 px-4 w-12">S/N</th>
                  <th className="py-3.5 px-4">Matriculation No.</th>
                  <th className="py-3.5 px-4">Student Name</th>
                  <th className="py-3.5 px-4">Department</th>
                  <th className="py-3.5 px-4 text-center">Sex</th>
                  <th className="py-3.5 px-4 text-center">Batch</th>
                  <th className="py-3.5 px-4 text-center">Score</th>
                  <th className="py-3.5 px-4 text-center">Percentage</th>
                  <th className="py-3.5 px-4 text-center">Grade</th>
                  <th className="py-3.5 px-4 text-center">Action</th>
                  <th className="py-3.5 px-4 text-right">Submitted At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#789981]/20 text-xs font-medium text-[#ADCDBA]">
                {filteredSubmissions.map((sub, index) => {
                  const isPass = sub.percentage >= 50;
                  return (
                    <tr key={sub.id} className="hover:bg-[#0A2419]/70 transition">
                      <td className="py-3.5 px-4 text-[#789981] font-mono">{index + 1}</td>
                      <td className="py-3.5 px-4 font-mono font-bold text-[#D6BF62]">
                        {sub.matricNumber}
                      </td>
                      <td className="py-3.5 px-4 font-semibold text-[#F0F9F3]">{capitalizeProper(sub.fullName)}</td>
                      <td className="py-3.5 px-4 text-[#ADCDBA]">{capitalizeProper(sub.department)}</td>
                      <td className="py-3.5 px-4 text-center">
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded text-xs font-bold font-mono ${
                            sub.gender === 'M' || sub.gender === 'Male'
                              ? 'bg-[#0E623B]/50 text-[#10B981] border border-[#10B981]/40'
                              : sub.gender === 'F' || sub.gender === 'Female'
                              ? 'bg-[#0A2419] text-[#D6BF62] border border-[#D6BF62]/40'
                              : 'text-[#789981] font-sans font-normal'
                          }`}
                        >
                          {sub.gender === 'M' || sub.gender === 'Male'
                            ? 'M'
                            : sub.gender === 'F' || sub.gender === 'Female'
                            ? 'F'
                            : 'Not recorded'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <span className="px-2 py-0.5 rounded bg-[#030515] text-[#D6BF62] border border-[#789981]/30 text-[10px] font-bold">
                          {sub.batch || 'Batch A'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-center font-bold">
                        <span className="text-sm text-[#F0F9F3]">{sub.score}</span>
                        <span className="text-[#789981] font-normal"> / {sub.totalQuestions}</span>
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold ${
                            isPass
                              ? 'bg-[#0E623B]/40 text-[#10B981] border border-[#10B981]/30'
                              : 'bg-[#2A0808] text-red-300 border border-red-500/30'
                          }`}
                        >
                          {sub.percentage}%
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-center font-bold">
                        {sub.percentage >= 70 ? (
                          <span className="text-[#10B981]">A</span>
                        ) : sub.percentage >= 60 ? (
                          <span className="text-[#10B981]">B</span>
                        ) : sub.percentage >= 50 ? (
                          <span className="text-[#D6BF62]">C</span>
                        ) : sub.percentage >= 45 ? (
                          <span className="text-amber-400">D</span>
                        ) : sub.percentage >= 40 ? (
                          <span className="text-orange-400">E</span>
                        ) : (
                          <span className="text-red-400">F</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <button
                          onClick={() => setSelectedScript(sub)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#0A2419] hover:bg-[#0E3324] text-[#D6BF62] hover:text-[#F0F9F3] border border-[#D6BF62]/40 hover:border-[#D6BF62] text-xs font-bold rounded-lg transition cursor-pointer shadow-sm"
                          title="View Individual Examination Script"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>View Individual Script</span>
                        </button>
                      </td>
                      <td className="py-3.5 px-4 text-right text-[#789981] font-mono text-[11px]">
                        {formatLagosDateTime(sub.submittedAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Individual Candidate Examination Script Modal */}
      {selectedScript && (() => {
        // Resolve questions: prefer immutable snapshot, fallback gracefully to exam question bank
        const scriptQuestions = selectedScript.questionSnapshot && selectedScript.questionSnapshot.length > 0
          ? selectedScript.questionSnapshot
          : (exam.questions && exam.questions.length > 0
            ? exam.questions.map((q, idx) => ({
                id: q.id || `q_${idx}`,
                questionNumber: idx + 1,
                questionText: q.questionText,
                options: q.options,
                correctAnswer: q.correctAnswer,
                isTrueFalse: Boolean(
                  (q.options && q.options.length === 2 && (q.options[0].toLowerCase() === 'true')) ||
                  (q as any).isTrueFalse
                )
              }))
            : []);

        const isHistoricalFallback = (!selectedScript.questionSnapshot || selectedScript.questionSnapshot.length === 0) && exam.questions && exam.questions.length > 0;

        let attempted = selectedScript.attemptedCount;
        let unanswered = selectedScript.unansweredCount;
        let correct = selectedScript.correctCount;
        let incorrect = selectedScript.incorrectCount;

        if (attempted === undefined || unanswered === undefined) {
          attempted = 0;
          unanswered = 0;
          correct = 0;
          incorrect = 0;
          scriptQuestions.forEach((q) => {
            const choice = selectedScript.answers ? selectedScript.answers[q.id] : undefined;
            const isUnans = choice === undefined || choice === null || Number(choice) < 0 || isNaN(Number(choice));
            if (isUnans) {
              unanswered! += 1;
            } else {
              attempted! += 1;
              if (Number(choice) === q.correctAnswer) {
                correct! += 1;
              } else {
                incorrect! += 1;
              }
            }
          });
        }

        const letters = ['A', 'B', 'C', 'D'];
        const lecturerNameValue = exam.lecturerName || selectedScript.lecturerName || 'Not specified';
        const isPass = selectedScript.percentage >= 50;

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-md overflow-y-auto">
            <div className="bg-[#061C13] border-2 border-[#D6BF62]/70 rounded-2xl max-w-4xl w-full p-5 sm:p-8 shadow-2xl relative my-6 max-h-[92vh] flex flex-col print-container">
              {/* Modal Header */}
              <div className="flex items-start justify-between border-b border-[#789981]/30 pb-4 mb-4 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-[#0E623B] border border-[#D6BF62] flex items-center justify-center text-[#D6BF62] font-black text-lg shadow-md">
                    SUN
                  </div>
                  <div>
                    <h3 className="text-lg sm:text-xl font-black text-[#F0F9F3]">
                      Official Candidate Examination Script
                    </h3>
                    <p className="text-xs text-[#ADCDBA]">
                      Sports University of Nigeria • Evaluation & Performance Audit
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 no-print">
                  <button
                    onClick={() => exportIndividualScriptToWord(exam, selectedScript)}
                    className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#0A2419] hover:bg-[#0E3324] text-[#D6BF62] border border-[#D6BF62]/40 rounded-lg text-xs font-bold transition cursor-pointer"
                    title="Export Script to Microsoft Word"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Word (.docx)</span>
                  </button>
                  <button
                    onClick={() => exportIndividualScriptToExcel(exam, selectedScript)}
                    className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#0A2419] hover:bg-[#0E3324] text-[#ADCDBA] border border-[#789981]/40 rounded-lg text-xs font-bold transition cursor-pointer"
                    title="Export Script to Microsoft Excel"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 text-[#D6BF62]" />
                    <span>Excel (.xlsx)</span>
                  </button>
                  <button
                    onClick={() => window.print()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#0A2419] hover:bg-[#0E3324] text-[#ADCDBA] border border-[#789981]/40 rounded-lg text-xs font-bold transition cursor-pointer"
                    title="Print Candidate Examination Script"
                  >
                    <Printer className="w-3.5 h-3.5 text-[#D6BF62]" />
                    <span>Print</span>
                  </button>
                  <button
                    onClick={() => setSelectedScript(null)}
                    className="p-1.5 rounded-lg bg-[#0A2419] text-[#789981] hover:text-[#F0F9F3] hover:bg-[#0E3324] transition cursor-pointer"
                    title="Close Script View"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Modal Scrollable Body */}
              <div className="overflow-y-auto space-y-5 pr-1 text-xs">
                {/* 1. Student and Examination Information (Requirement 2) */}
                <div className="bg-[#0A2419] p-4 sm:p-5 rounded-xl border border-[#789981]/30 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  <div>
                    <span className="text-[10px] text-[#789981] uppercase font-bold block">Student Full Name</span>
                    <span className="font-extrabold text-[#F0F9F3] text-sm">{capitalizeProper(selectedScript.fullName)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[#789981] uppercase font-bold block">Matriculation Number</span>
                    <span className="font-mono font-bold text-[#D6BF62] text-sm">{selectedScript.matricNumber}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[#789981] uppercase font-bold block">Department</span>
                    <span className="font-semibold text-[#ADCDBA]">{capitalizeProper(selectedScript.department)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[#789981] uppercase font-bold block">Sex</span>
                    <span className="font-mono font-bold text-[#D6BF62]">
                      {selectedScript.gender === 'M' || selectedScript.gender === 'Male'
                        ? 'M (Male)'
                        : selectedScript.gender === 'F' || selectedScript.gender === 'Female'
                        ? 'F (Female)'
                        : 'Not recorded'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[#789981] uppercase font-bold block">Course Code</span>
                    <span className="font-bold text-[#F0F9F3]">{exam.courseCode}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[#789981] uppercase font-bold block">Course Title</span>
                    <span className="font-semibold text-[#ADCDBA]">{exam.courseTitle}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[#789981] uppercase font-bold block">Course Lecturer's Name</span>
                    <span className="font-extrabold text-[#D6BF62]">{lecturerNameValue}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[#789981] uppercase font-bold block">Examination Date</span>
                    <span className="font-bold text-[#F0F9F3]">{exam.startDate ? formatLagosDate(exam.startDate) : 'Not specified'}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[#789981] uppercase font-bold block">Examination Starting Time</span>
                    <span className="font-bold text-[#F0F9F3]">{exam.startDate ? `${formatLagosTime(exam.startDate)} (WAT)` : 'Not specified'}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[#789981] uppercase font-bold block">Examination Batch</span>
                    <span className="font-bold text-[#F0F9F3]">{selectedScript.batch || 'Batch A'}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[#789981] uppercase font-bold block">Submitted At</span>
                    <span className="font-mono text-[#ADCDBA]">{formatLagosDateTime(selectedScript.submittedAt)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[#789981] uppercase font-bold block">Submission Receipt ID</span>
                    <span className="font-mono text-[#D6BF62] break-all">{selectedScript.submissionReceipt}</span>
                  </div>
                </div>

                {/* 2. Performance Summary (Requirement 4) */}
                <div>
                  <h4 className="text-xs font-bold text-[#D6BF62] uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                    <Award className="w-3.5 h-3.5" />
                    <span>Candidate Performance Summary</span>
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2.5 text-center">
                    <div className="bg-[#0A2419] p-3 rounded-xl border border-[#789981]/30">
                      <span className="text-[10px] text-[#789981] font-bold uppercase block">Total Items</span>
                      <span className="text-xl font-black text-[#F0F9F3]">{selectedScript.totalQuestions}</span>
                    </div>
                    <div className="bg-[#0A2419] p-3 rounded-xl border border-[#789981]/30">
                      <span className="text-[10px] text-[#789981] font-bold uppercase block">Attempted</span>
                      <span className="text-xl font-black text-[#ADCDBA]">{attempted}</span>
                    </div>
                    <div className="bg-[#0A2419] p-3 rounded-xl border border-[#10B981]/40">
                      <span className="text-[10px] text-[#10B981] font-bold uppercase block">Correct (✓)</span>
                      <span className="text-xl font-black text-[#10B981]">{correct}</span>
                    </div>
                    <div className="bg-[#0A2419] p-3 rounded-xl border border-red-500/40">
                      <span className="text-[10px] text-red-400 font-bold uppercase block">Incorrect (✕)</span>
                      <span className="text-xl font-black text-red-400">{incorrect}</span>
                    </div>
                    <div className="bg-[#0A2419] p-3 rounded-xl border border-amber-500/40">
                      <span className="text-[10px] text-amber-300 font-bold uppercase block">Unanswered (—)</span>
                      <span className="text-xl font-black text-amber-300">{unanswered}</span>
                    </div>
                    <div className="bg-[#0A2419] p-3 rounded-xl border border-[#D6BF62]/50">
                      <span className="text-[10px] text-[#D6BF62] font-bold uppercase block">Score & Grade</span>
                      <span className="text-xl font-black text-[#D6BF62]">
                        {selectedScript.score} <span className="text-xs text-[#789981]">({selectedScript.percentage}%)</span>
                      </span>
                      <span className={`block text-[10px] font-bold mt-0.5 ${isPass ? 'text-[#10B981]' : 'text-red-400'}`}>
                        {isPass ? 'PASSED' : 'FAILED'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Historical fallback warning if needed */}
                {isHistoricalFallback && (
                  <div className="p-3 bg-[#0A2419] border border-amber-500/40 rounded-xl text-amber-300 text-xs flex items-center gap-2">
                    <HelpCircle className="w-4 h-4 shrink-0 text-amber-400" />
                    <span>
                      Historical Submission Notice: This candidate record was submitted prior to snapshot storage. Questions are presented from the associated examination bank.
                    </span>
                  </div>
                )}

                {/* 3. Complete Question Record (Requirement 3 & 5) */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-bold text-[#D6BF62] uppercase tracking-wider flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5" />
                      <span>Complete Question Record ({scriptQuestions.length} Items)</span>
                    </h4>
                    <span className="text-[11px] text-[#789981]">
                      Preserved in Candidate Presentation Order
                    </span>
                  </div>

                  {scriptQuestions.length === 0 ? (
                    <div className="p-6 bg-[#0A2419] rounded-xl border border-[#789981]/30 text-center text-[#ADCDBA]">
                      No preserved question records are available for this examination script.
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {scriptQuestions.map((q, idx) => {
                        const candidateChoiceIdx = selectedScript.answers ? selectedScript.answers[q.id] : undefined;
                        const isUnanswered = candidateChoiceIdx === undefined || candidateChoiceIdx === null || Number(candidateChoiceIdx) < 0 || isNaN(Number(candidateChoiceIdx));
                        const isCorrect = !isUnanswered && Number(candidateChoiceIdx) === q.correctAnswer;

                        const formatChoiceText = (optIdx: number | undefined) => {
                          if (optIdx === undefined || optIdx === null || optIdx < 0) return 'Unanswered (None)';
                          if (q.isTrueFalse) {
                            return optIdx === 0 ? 'True' : 'False';
                          }
                          const optText = q.options && q.options[optIdx] ? ` (${q.options[optIdx]})` : '';
                          return `Option ${letters[optIdx] || optIdx + 1}${optText}`;
                        };

                        return (
                          <div key={q.id} className="p-4 bg-[#0A2419] rounded-xl border border-[#789981]/30">
                            {/* Question Header & Status Indicator */}
                            <div className="flex items-start justify-between gap-3 mb-2">
                              <span className="font-extrabold text-[#F0F9F3] text-sm">
                                Question {idx + 1}. {q.questionText}
                              </span>
                              <span
                                className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold ${
                                  isCorrect
                                    ? 'bg-[#0E623B] text-[#10B981] border border-[#10B981]/50'
                                    : isUnanswered
                                    ? 'bg-amber-950/60 text-amber-300 border border-amber-500/40'
                                    : 'bg-red-950/60 text-red-300 border border-red-500/40'
                                }`}
                              >
                                {isCorrect ? '✓ Correct (+1 Mark)' : isUnanswered ? '— Unanswered (0 Marks)' : '✕ Incorrect (0 Marks)'}
                              </span>
                            </div>

                            {/* Every Answer Option Presented */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 my-3 pt-2 border-t border-[#789981]/20">
                              {q.options && q.options.map((optText, optIdx) => {
                                const isSelected = !isUnanswered && Number(candidateChoiceIdx) === optIdx;
                                const isThisCorrect = q.correctAnswer === optIdx;

                                return (
                                  <div
                                    key={optIdx}
                                    className={`px-3 py-2 rounded-lg border text-xs flex items-center justify-between ${
                                      isSelected && isThisCorrect
                                        ? 'bg-[#0E623B]/50 border-[#10B981] text-[#F0F9F3]'
                                        : isSelected && !isThisCorrect
                                        ? 'bg-red-950/50 border-red-500/60 text-red-200'
                                        : isThisCorrect
                                        ? 'bg-[#030F0A] border-[#D6BF62]/50 text-[#D6BF62]'
                                        : 'bg-[#061C13]/60 border-[#789981]/20 text-[#ADCDBA]'
                                    }`}
                                  >
                                    <div className="flex items-center gap-2">
                                      <span className="w-5 h-5 rounded-full bg-[#030F0A] border border-[#789981]/40 flex items-center justify-center font-bold text-[10px] text-[#D6BF62]">
                                        {q.isTrueFalse ? (optIdx === 0 ? 'T' : 'F') : letters[optIdx] || optIdx + 1}
                                      </span>
                                      <span className="font-medium">{optText}</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      {isSelected && (
                                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${isCorrect ? 'bg-[#10B981] text-black' : 'bg-red-600 text-white'}`}>
                                          Student Choice
                                        </span>
                                      )}
                                      {isThisCorrect && (
                                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#D6BF62] text-black">
                                          Correct Answer
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>

                            {/* Summary choices line */}
                            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs pt-1 border-t border-[#789981]/20">
                              <span>
                                Candidate Choice:{' '}
                                <strong className={isCorrect ? 'text-[#10B981]' : isUnanswered ? 'text-amber-300' : 'text-red-400'}>
                                  {formatChoiceText(candidateChoiceIdx)}
                                </strong>
                              </span>
                              <span>
                                Official Correct Answer:{' '}
                                <strong className="text-[#D6BF62]">
                                  {formatChoiceText(q.correctAnswer)}
                                </strong>
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 4. Lecturer's Signature Section (Requirement 6) */}
                <div className="bg-[#030F0A] p-6 rounded-xl border border-[#789981]/40 mt-6">
                  <div className="max-w-md">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-[#D6BF62] block mb-6">
                      Lecturer's Signature
                    </span>
                    <div className="w-full border-b-2 border-[#F0F9F3] mb-2" />
                    <p className="text-sm font-bold text-[#F0F9F3]">
                      {lecturerNameValue}
                    </p>
                    <p className="text-xs text-[#ADCDBA]">
                      Course Lecturer / Chief Examiner
                    </p>
                    <p className="text-[11px] text-[#789981] mt-3">
                      Date: ________________________
                    </p>
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="border-t border-[#789981]/30 pt-4 mt-4 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0 no-print">
                <span className="text-[11px] text-[#789981]">
                  Official CBT Evaluation Record • Sports University of Nigeria
                </span>
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <button
                    onClick={() => exportIndividualScriptToWord(exam, selectedScript)}
                    className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 bg-[#0A2419] hover:bg-[#0E3324] text-[#D6BF62] hover:text-[#F0F9F3] border border-[#D6BF62]/40 rounded-xl text-xs font-bold transition cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Export Word (.docx)</span>
                  </button>
                  <button
                    onClick={() => exportIndividualScriptToExcel(exam, selectedScript)}
                    className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 bg-[#0A2419] hover:bg-[#0E3324] text-[#ADCDBA] hover:text-[#F0F9F3] border border-[#789981]/40 rounded-xl text-xs font-bold transition cursor-pointer"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 text-[#D6BF62]" />
                    <span>Export Excel (.xlsx)</span>
                  </button>
                  <button
                    onClick={() => window.print()}
                    className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 bg-[#0A2419] hover:bg-[#0E3324] text-[#F0F9F3] border border-[#789981]/40 rounded-xl text-xs font-bold transition cursor-pointer"
                  >
                    <Printer className="w-3.5 h-3.5 text-[#D6BF62]" />
                    <span>Print Script</span>
                  </button>
                  <button
                    onClick={() => setSelectedScript(null)}
                    className="flex-1 sm:flex-none px-4 py-2 bg-[#0E623B] hover:bg-[#127949] text-[#F0F9F3] text-xs font-bold rounded-xl transition cursor-pointer shadow-md"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* CONFIRM DELETE RESULTS MODAL (SEPARATE FROM DELETE EXAM) */}
      {showDeleteResultsModal && (
        <div className="fixed inset-0 z-50 bg-[#030515]/85 flex items-center justify-center p-4 backdrop-blur-sm animate-fadeIn">
          <div className="bg-[#061C13] rounded-3xl max-w-lg w-full p-6 sm:p-7 shadow-2xl border border-red-500/50 space-y-5">
            <div className="w-14 h-14 mx-auto bg-[#2A0808] text-red-400 rounded-2xl flex items-center justify-center border border-red-500/40 shadow-sm">
              <Eraser className="w-7 h-7" />
            </div>

            <div className="space-y-3 text-center">
              <h3 className="text-xl font-black text-[#F0F9F3]">
                Delete Examination Results?
              </h3>
              <p className="text-xs sm:text-sm text-[#ADCDBA] leading-relaxed text-left sm:text-center">
                This action will permanently delete the student submissions, answers and results associated with this examination. The examination, questions, correct answers and settings will remain unchanged. Student profiles and results from other examinations will not be affected.
              </p>
              <div className="bg-[#0A2419] p-3.5 rounded-xl border border-[#789981]/30 text-xs text-left space-y-1">
                <div className="flex justify-between items-center text-[#ADCDBA]">
                  <span className="text-[#789981]">Course:</span>
                  <span className="font-bold text-[#F0F9F3]">{exam.courseCode} — {exam.courseTitle}</span>
                </div>
                <div className="flex justify-between items-center text-[#ADCDBA]">
                  <span className="text-[#789981]">Lecturer:</span>
                  <span className="font-medium text-[#F0F9F3]">{exam.lecturerName || 'SUN Faculty'}</span>
                </div>
                <div className="flex justify-between items-center font-mono">
                  <span className="text-[#789981] font-sans">Exam ID:</span>
                  <span className="font-bold text-[#D6BF62]">{exam.id}</span>
                </div>
                <div className="flex justify-between items-center text-[#ADCDBA]">
                  <span className="text-[#789981]">Total Submissions to Delete:</span>
                  <span className="font-bold text-red-400">{submissions.length}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteResultsModal(false)}
                disabled={isDeletingResults}
                className="flex-1 py-2.5 px-4 bg-[#0A2419] hover:bg-[#0E3324] text-[#ADCDBA] border border-[#789981]/40 font-bold text-xs sm:text-sm rounded-xl transition disabled:opacity-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteResults}
                disabled={isDeletingResults}
                className="flex-1 py-2.5 px-4 bg-red-700 hover:bg-red-600 border border-red-500 text-white font-bold text-xs sm:text-sm rounded-xl shadow-md transition flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                {isDeletingResults ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <Eraser className="w-4 h-4" />
                    <span>Confirm Delete Results</span>
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
