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
  ArrowUpDown
} from 'lucide-react';
import { Exam, Submission, SUN_DEPARTMENTS } from '../../types';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { exportToExcel, exportToWord } from '../../utils/exportUtils';
import { useAuth } from '../../context/AuthContext';

interface ExamResultsViewProps {
  exam: Exam;
  onBack: () => void;
}

export const ExamResultsView: React.FC<ExamResultsViewProps> = ({ exam, onBack }) => {
  const { user } = useAuth();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('All');
  const [sortBy, setSortBy] = useState<'matric_asc' | 'matric_desc' | 'score_desc' | 'score_asc' | 'date_desc'>('matric_asc');
  const [isExportingWord, setIsExportingWord] = useState(false);

  useEffect(() => {
    fetchSubmissions();
  }, [exam.id, user]);

  const fetchSubmissions = async () => {
    if (!user || (user.email || '').toLowerCase().trim() !== 'sunsmartcbt@gmail.com') return;
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
        sub.submissionReceipt.toLowerCase().includes(searchQuery.toLowerCase());

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

        {/* Export Buttons */}
        <div className="flex items-center gap-3 w-full sm:w-auto">
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
        </div>
      </div>

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
            <p className="text-xs text-[#ADCDBA] mt-1">
              Examination Results & Automated Evaluation Records (Citadel for Champions)
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
                  <th className="py-3.5 px-4 text-center">Batch</th>
                  <th className="py-3.5 px-4 text-center">Score</th>
                  <th className="py-3.5 px-4 text-center">Percentage</th>
                  <th className="py-3.5 px-4 text-center">Grade</th>
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
                      <td className="py-3.5 px-4 font-semibold text-[#F0F9F3]">{sub.fullName}</td>
                      <td className="py-3.5 px-4 text-[#ADCDBA]">{sub.department}</td>
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
                      <td className="py-3.5 px-4 text-right text-[#789981] font-mono text-[11px]">
                        {new Date(sub.submittedAt).toLocaleDateString()} {new Date(sub.submittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
