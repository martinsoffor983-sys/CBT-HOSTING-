import React, { useState, useEffect } from 'react';
import {
  Plus,
  BookOpen,
  Share2,
  FileBarChart2,
  Edit,
  Trash2,
  Copy,
  Check,
  CheckCircle2,
  Clock,
  Layers,
  Search,
  ExternalLink,
  Users,
  Eye,
  AlertCircle,
  Shuffle,
  Lock,
  Unlock,
  X
} from 'lucide-react';
import { Exam } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { collection, getDocs, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { ExamEditor } from './ExamEditor';
import { ExamResultsView } from './ExamResultsView';
import { formatLagosDate, formatLagosTime } from '../../utils/timeUtils';

export const LecturerDashboard: React.FC = () => {
  const { user, isAuthorized, logout } = useAuth();
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'published' | 'draft' | 'closed'>('all');

  // Navigation states inside lecturer portal
  const [activeView, setActiveView] = useState<'list' | 'create' | 'edit' | 'results'>('list');
  const [selectedExam, setSelectedExam] = useState<Exam | null>(null);
  const [detailsExam, setDetailsExam] = useState<Exam | null>(null);

  // Delete modal state
  const [examToDelete, setExamToDelete] = useState<Exam | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [actionNotification, setActionNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Copy feedback state (Only Exam ID)
  const [copiedIdExamId, setCopiedIdExamId] = useState<string | null>(null);

  useEffect(() => {
    if (user && isAuthorized && (user.email || '').toLowerCase().trim() === 'sunsmartcbt@gmail.com') {
      fetchExams();
    }
  }, [user, isAuthorized]);

  const fetchExams = async () => {
    if (!user || !isAuthorized || (user.email || '').toLowerCase().trim() !== 'sunsmartcbt@gmail.com') {
      return;
    }
    setLoading(true);
    try {
      const q = collection(db, 'exams');
      const snap = await getDocs(q);
      const list: Exam[] = [];
      snap.forEach((docSnap) => {
        list.push({ id: docSnap.id, ...docSnap.data() } as Exam);
      });
      // Sort by newest first
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setExams(list);
    } catch (err: any) {
      console.warn('Notice fetching exams:', err);
      if (err?.code === 'permission-denied') {
        await logout();
      } else {
        handleFirestoreError(err, OperationType.LIST, 'exams');
      }
    } finally {
      setLoading(false);
    }
  };

  const confirmDeleteExam = async () => {
    if (!examToDelete) return;
    setIsDeleting(true);
    const targetId = examToDelete.id;
    const courseCode = examToDelete.courseCode;

    try {
      // 1. Direct Firestore delete
      await deleteDoc(doc(db, 'exams', targetId));
      setExams((prev) => prev.filter((e) => e.id !== targetId));
      setActionNotification({
        type: 'success',
        message: `Examination ${courseCode} (${targetId}) has been deleted successfully.`
      });
      setTimeout(() => setActionNotification(null), 4000);
      setExamToDelete(null);
    } catch (err: any) {
      console.warn('Direct Firestore delete encountered error, attempting server fallback:', err);
      try {
        const token = user ? await user.getIdToken() : '';
        const res = await fetch(`/api/exam/${targetId}`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          }
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to delete examination from database.');
        }
        setExams((prev) => prev.filter((e) => e.id !== targetId));
        setActionNotification({
          type: 'success',
          message: `Examination ${courseCode} (${targetId}) has been deleted successfully.`
        });
        setTimeout(() => setActionNotification(null), 4000);
        setExamToDelete(null);
      } catch (fallbackErr: any) {
        console.error('Delete exam error:', fallbackErr);
        setActionNotification({
          type: 'error',
          message: `Could not delete examination: ${fallbackErr.message || 'Permission denied'}`
        });
      }
    } finally {
      setIsDeleting(false);
    }
  };

  const handleToggleStatus = async (exam: Exam) => {
    const nextStatus = exam.status === 'published' ? 'closed' : 'published';
    try {
      await updateDoc(doc(db, 'exams', exam.id), { status: nextStatus, updatedAt: new Date().toISOString() });
      setExams((prev) =>
        prev.map((e) => (e.id === exam.id ? { ...e, status: nextStatus } : e))
      );
    } catch (err: any) {
      console.error('Error updating status:', err);
      handleFirestoreError(err, OperationType.UPDATE, `exams/${exam.id}`);
    }
  };

  const handlePublishDraft = async (exam: Exam) => {
    if (!exam.questions || exam.questions.length === 0) {
      setActionNotification({
        type: 'error',
        message: 'Cannot publish an examination with 0 questions. Please add questions first.'
      });
      setSelectedExam(exam);
      setActiveView('edit');
      return;
    }
    try {
      await updateDoc(doc(db, 'exams', exam.id), { status: 'published', updatedAt: new Date().toISOString() });
      setExams((prev) =>
        prev.map((e) => (e.id === exam.id ? { ...e, status: 'published' } : e))
      );
      setActionNotification({
        type: 'success',
        message: `Examination ${exam.courseCode} has been published successfully!`
      });
      setTimeout(() => setActionNotification(null), 4000);
    } catch (err: any) {
      console.error('Error publishing draft:', err);
      handleFirestoreError(err, OperationType.UPDATE, `exams/${exam.id}`);
    }
  };

  const handleCopyExamId = (examId: string) => {
    navigator.clipboard.writeText(examId);
    setCopiedIdExamId(examId);
    setTimeout(() => setCopiedIdExamId(null), 2500);
  };

  if (activeView === 'create' || (activeView === 'edit' && selectedExam)) {
    return (
      <ExamEditor
        initialExam={activeView === 'edit' ? selectedExam : null}
        onBack={() => {
          setActiveView('list');
          setSelectedExam(null);
        }}
        onSaved={(_savedExam) => {
          fetchExams();
          setActiveView('list');
          setSelectedExam(null);
        }}
      />
    );
  }

  if (activeView === 'results' && selectedExam) {
    return (
      <ExamResultsView
        exam={selectedExam}
        onBack={() => {
          setActiveView('list');
          setSelectedExam(null);
        }}
      />
    );
  }


  const publishedCount = exams.filter((e) => e.status === 'published').length;
  const draftCount = exams.filter((e) => e.status === 'draft').length;
  const closedCount = exams.filter((e) => e.status === 'closed').length;
  const totalQuestions = exams.reduce((acc, cur) => acc + (cur.questionsCount || 0), 0);

  const filteredExams = exams.filter((exam) => {
    const matchesSearch =
      exam.courseCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
      exam.courseTitle.toLowerCase().includes(searchQuery.toLowerCase()) ||
      exam.department.toLowerCase().includes(searchQuery.toLowerCase()) ||
      exam.id.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus =
      statusFilter === 'all' || exam.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  return (
    <div className="max-w-6xl mx-auto py-8 px-4 sm:px-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-black text-[#F0F9F3] tracking-tight">Examiner Dashboard</h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#D6BF62]/10 text-[#D6BF62] border border-[#D6BF62]/30">
              Citadel for Champions
            </span>
          </div>
          <p className="text-xs text-[#ADCDBA] mt-1">
            Centrally authorized university examiner (<span className="font-semibold text-[#D6BF62]">{user?.email}</span>).
          </p>
        </div>

        <button
          onClick={() => {
            setSelectedExam(null);
            setActiveView('create');
          }}
          className="flex items-center gap-2 px-5 py-2.5 bg-[#0E623B] hover:bg-[#127949] border border-[#D6BF62] text-[#F0F9F3] font-bold text-sm rounded-xl shadow-lg hover:shadow-[#0E623B]/30 transition transform active:scale-95 cursor-pointer"
        >
          <Plus className="w-4 h-4 text-[#D6BF62]" />
          <span>Create Examination</span>
        </button>
      </div>

      {/* Action / Notification Banner */}
      {actionNotification && (
        <div
          className={`mb-6 p-4 rounded-2xl flex items-center justify-between gap-3 text-xs sm:text-sm animate-fadeIn border ${
            actionNotification.type === 'success'
              ? 'bg-[#0A2419] border-[#D6BF62]/40 text-[#F0F9F3]'
              : 'bg-[#2A0808] border-red-500/40 text-red-200'
          }`}
        >
          <div className="flex items-center gap-2.5 font-semibold">
            {actionNotification.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-[#10B981] shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
            )}
            <span>{actionNotification.message}</span>
          </div>
          <button
            onClick={() => setActionNotification(null)}
            className="p-1 hover:bg-[#030515]/40 rounded-lg text-[#ADCDBA]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* KPI Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-8">
        <div
          onClick={() => setStatusFilter('all')}
          className="bg-[#061C13] p-5 rounded-2xl shadow-xl border border-[#789981]/30 cursor-pointer hover:border-[#D6BF62]/50 transition group"
        >
          <div className="flex items-center justify-between text-[#789981] mb-1">
            <span className="text-xs font-bold uppercase tracking-wider">Total Exams</span>
            <BookOpen className="w-4 h-4 text-[#D6BF62]" />
          </div>
          <p className="text-2xl font-black text-[#F0F9F3] group-hover:text-[#D6BF62] transition">{exams.length}</p>
          <p className="text-[11px] text-[#ADCDBA] mt-0.5">In SUN CBT repository</p>
        </div>

        <div
          onClick={() => setStatusFilter('published')}
          className="bg-[#061C13] p-5 rounded-2xl shadow-xl border border-[#789981]/30 cursor-pointer hover:border-[#10B981]/50 transition group"
        >
          <div className="flex items-center justify-between text-[#789981] mb-1">
            <span className="text-xs font-bold uppercase tracking-wider">Published & Live</span>
            <CheckCircle2 className="w-4 h-4 text-[#10B981]" />
          </div>
          <p className="text-2xl font-black text-[#10B981]">{publishedCount}</p>
          <p className="text-[11px] text-[#ADCDBA] mt-0.5">Accessible via Exam ID</p>
        </div>

        <div
          onClick={() => setStatusFilter('draft')}
          className="bg-[#061C13] p-5 rounded-2xl shadow-xl border border-[#789981]/30 cursor-pointer hover:border-amber-400/50 transition group"
        >
          <div className="flex items-center justify-between text-[#789981] mb-1">
            <span className="text-xs font-bold uppercase tracking-wider">Drafts</span>
            <Edit className="w-4 h-4 text-amber-400" />
          </div>
          <p className="text-2xl font-black text-amber-300">{draftCount}</p>
          <p className="text-[11px] text-[#ADCDBA] mt-0.5">Click to view & edit drafts</p>
        </div>

        <div className="bg-[#061C13] p-5 rounded-2xl shadow-xl border border-[#789981]/30">
          <div className="flex items-center justify-between text-[#789981] mb-1">
            <span className="text-xs font-bold uppercase tracking-wider">Total Questions</span>
            <Layers className="w-4 h-4 text-[#D6BF62]" />
          </div>
          <p className="text-2xl font-black text-[#F0F9F3]">{totalQuestions}</p>
          <p className="text-[11px] text-[#ADCDBA] mt-0.5">Stored with verified keys</p>
        </div>
      </div>

      {/* Search and Filter Row */}
      <div className="bg-[#061C13] rounded-2xl shadow-xl border border-[#789981]/30 p-4 mb-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-[#789981] absolute left-3 top-3" />
            <input
              type="text"
              placeholder="Search by course code or Exam ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3.5 py-2 bg-[#0A2419] border border-[#789981]/40 rounded-xl text-xs font-medium text-[#F0F9F3] placeholder-[#789981]/70 focus:outline-none focus:border-[#D6BF62] focus:ring-1 focus:ring-[#D6BF62]"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
            {[
              { id: 'all', label: 'All Exams', count: exams.length },
              { id: 'published', label: 'Published', count: publishedCount },
              { id: 'draft', label: 'Drafts', count: draftCount },
              { id: 'closed', label: 'Closed', count: closedCount }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setStatusFilter(tab.id as any)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-xl transition shrink-0 cursor-pointer ${
                  statusFilter === tab.id
                    ? 'bg-[#0E623B] border border-[#D6BF62] text-[#F0F9F3] shadow-md'
                    : 'bg-[#0A2419] border border-[#789981]/30 text-[#ADCDBA] hover:bg-[#0E3324]'
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] font-black ${
                    statusFilter === tab.id
                      ? 'bg-[#D6BF62] text-[#061C13]'
                      : 'bg-[#030515] text-[#ADCDBA] border border-[#789981]/30'
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Draft Section Helper Banner */}
      {statusFilter === 'draft' && (
        <div className="mb-6 p-4 bg-[#0A2419] border border-amber-400/40 rounded-2xl flex items-center justify-between gap-3 text-xs text-amber-200">
          <div className="flex items-center gap-2.5">
            <Edit className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              <strong className="text-[#F0F9F3]">Draft Examinations ({draftCount})</strong> — Drafts are private and inaccessible to students. Open any draft to add or edit questions, then click <strong className="text-[#D6BF62]">Publish</strong> when ready.
            </span>
          </div>
        </div>
      )}

      {/* Examinations List */}
      <div className="space-y-4">
        {loading ? (
          <div className="p-12 text-center bg-[#061C13] rounded-2xl border border-[#789981]/30">
            <div className="w-8 h-8 border-3 border-[#D6BF62] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-xs text-[#ADCDBA] font-medium">Loading faculty examinations...</p>
          </div>
        ) : filteredExams.length === 0 ? (
          <div className="p-12 text-center bg-[#061C13] rounded-2xl border border-dashed border-[#789981]/40">
            <BookOpen className="w-12 h-12 text-[#789981] mx-auto mb-3" />
            <h3 className="text-base font-bold text-[#F0F9F3]">
              {statusFilter === 'draft' ? 'No Draft Examinations Found' : 'No Examinations Found'}
            </h3>
            <p className="text-xs text-[#ADCDBA] max-w-sm mx-auto mt-1 mb-5">
              {searchQuery
                ? `No examinations matched "${searchQuery}". Try searching by another course code or Exam ID.`
                : statusFilter === 'draft'
                ? 'You do not have any saved draft examinations. Click below to start a new examination draft.'
                : 'Get started by creating a new university examination.'}
            </p>
            <button
              onClick={() => {
                setSelectedExam(null);
                setActiveView('create');
              }}
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#0E623B] hover:bg-[#127949] border border-[#D6BF62] text-[#F0F9F3] text-xs font-bold rounded-xl shadow-md transition cursor-pointer"
            >
              <Plus className="w-4 h-4 text-[#D6BF62]" />
              <span>Create New Exam</span>
            </button>
          </div>
        ) : (
          filteredExams.map((exam) => (
            <div
              key={exam.id}
              className={`bg-[#061C13] rounded-2xl shadow-xl border p-5 sm:p-6 transition space-y-4 ${
                exam.status === 'draft'
                  ? 'border-amber-400/30 hover:border-amber-400/60'
                  : 'border-[#789981]/30 hover:border-[#D6BF62]/50'
              }`}
            >
              <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
                <div className="space-y-1.5 flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-md text-xs font-black bg-[#0A2419] border border-[#D6BF62]/40 text-[#D6BF62]">
                      {exam.courseCode}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wider ${
                        exam.status === 'published'
                          ? 'bg-[#0E623B]/40 text-[#10B981] border border-[#10B981]/40'
                          : exam.status === 'closed'
                          ? 'bg-[#030515] text-[#789981] border border-[#789981]/30'
                          : 'bg-amber-400/20 text-amber-300 border border-amber-400/40'
                      }`}
                    >
                      {exam.status === 'draft' ? 'Draft' : exam.status}
                    </span>
                    <span className="text-xs text-[#ADCDBA] font-medium truncate">
                      Dept: <span className="text-[#F0F9F3] font-semibold">{exam.department}</span>
                    </span>
                    {exam.randomizationEnabled && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#0A2419] border border-[#D6BF62]/30 text-[#D6BF62] flex items-center gap-1">
                        <Shuffle className="w-3 h-3 text-[#D6BF62]" />
                        <span>Batched (A–D)</span>
                      </span>
                    )}
                  </div>

                  <h3 className="text-base sm:text-lg font-bold text-[#F0F9F3] truncate">
                    {exam.courseTitle}
                  </h3>

                  <div className="flex flex-wrap items-center gap-4 text-xs text-[#ADCDBA] pt-0.5">
                    <span className="flex items-center gap-1 font-medium">
                      <Clock className="w-3.5 h-3.5 text-[#D6BF62]" />
                      {exam.durationMinutes} Minutes
                    </span>
                    <span className="flex items-center gap-1 font-medium">
                      <Layers className="w-3.5 h-3.5 text-[#D6BF62]" />
                      {exam.questionsCount || 0} Questions
                    </span>
                    <span className="text-[#789981]">
                      Created: {new Date(exam.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                {/* Primary Card Actions */}
                <div className="flex flex-wrap items-center gap-2 shrink-0 w-full sm:w-auto">
                  {exam.status === 'draft' ? (
                    <>
                      {/* Open & Edit Draft Button */}
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedExam(exam);
                          setActiveView('edit');
                        }}
                        className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2 bg-[#0A2419] hover:bg-[#0E3324] text-amber-300 border border-amber-400/40 rounded-xl text-xs font-bold transition shadow-sm cursor-pointer"
                        title="Open and continue editing this draft"
                      >
                        <Edit className="w-3.5 h-3.5 text-amber-400" />
                        <span>Open & Edit Draft</span>
                      </button>

                      {/* Publish Draft Button */}
                      <button
                        type="button"
                        onClick={() => handlePublishDraft(exam)}
                        className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 bg-[#0E623B] hover:bg-[#127949] border border-[#D6BF62] text-[#F0F9F3] font-bold rounded-xl text-xs shadow-md transition cursor-pointer"
                        title="Publish this draft for students"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#D6BF62]" />
                        <span>Publish</span>
                      </button>
                    </>
                  ) : (
                    <>
                      {/* Results View */}
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedExam(exam);
                          setActiveView('results');
                        }}
                        className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2 bg-[#0A2419] hover:bg-[#0E3324] text-[#ADCDBA] hover:text-[#F0F9F3] border border-[#789981]/40 rounded-xl text-xs font-bold transition cursor-pointer"
                        title="View student results and analytics"
                      >
                        <FileBarChart2 className="w-3.5 h-3.5 text-[#D6BF62]" />
                        <span>Results & Reports</span>
                      </button>

                      {/* Edit Exam */}
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedExam(exam);
                          setActiveView('edit');
                        }}
                        className="p-2 text-[#ADCDBA] hover:text-[#F0F9F3] hover:bg-[#0A2419] rounded-xl transition border border-[#789981]/30 cursor-pointer"
                        title="Edit Examination"
                      >
                        <Edit className="w-4 h-4" />
                      </button>

                      {/* Close / Reopen Toggle */}
                      <button
                        type="button"
                        onClick={() => handleToggleStatus(exam)}
                        className={`flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                          exam.status === 'published'
                            ? 'bg-[#0A2419] hover:bg-[#0E3324] text-[#ADCDBA] border-[#789981]/30'
                            : 'bg-[#0E623B]/30 hover:bg-[#0E623B]/50 text-[#10B981] border-[#10B981]/40'
                        }`}
                        title={exam.status === 'published' ? 'Close examination' : 'Reopen examination'}
                      >
                        {exam.status === 'published' ? <Lock className="w-3.5 h-3.5 text-[#789981]" /> : <Unlock className="w-3.5 h-3.5 text-[#10B981]" />}
                        <span>{exam.status === 'published' ? 'Close' : 'Reopen'}</span>
                      </button>
                    </>
                  )}

                  {/* Delete Examination Button (Opens Confirmation Modal) */}
                  <button
                    type="button"
                    onClick={() => setExamToDelete(exam)}
                    className="p-2 text-[#789981] hover:text-red-400 hover:bg-[#2A0808] rounded-xl transition border border-transparent hover:border-red-500/30 cursor-pointer"
                    title="Delete Examination"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* EXAM ID SHARING BAR (ONLY ONE COPY EXAM ID BUTTON - NO COPY WEBSITE ADDRESS) */}
              <div className="bg-[#0A2419] p-3 rounded-xl border border-[#789981]/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
                <div className="flex flex-wrap items-center gap-2 font-mono">
                  <span className="font-bold text-[#789981] uppercase text-[10px]">Exam ID:</span>
                  <span className="font-bold text-[#D6BF62] bg-[#030515] px-2.5 py-1 rounded border border-[#789981]/30 select-all text-xs break-all">
                    {exam.id}
                  </span>
                </div>

                {/* Single Copy Exam ID Button */}
                <button
                  type="button"
                  onClick={() => handleCopyExamId(exam.id)}
                  className={`flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition border shrink-0 w-full sm:w-auto cursor-pointer ${
                    copiedIdExamId === exam.id
                      ? 'bg-[#0E623B] border-[#10B981] text-[#F0F9F3]'
                      : 'bg-[#061C13] hover:bg-[#0A2419] text-[#D6BF62] border-[#D6BF62]/40 shadow-xs'
                  }`}
                >
                  {copiedIdExamId === exam.id ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-[#10B981]" />
                      <span>Exam ID Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-[#D6BF62]" />
                      <span>Copy Exam ID</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* CONFIRM DELETE MODAL */}
      {examToDelete && (
        <div className="fixed inset-0 z-50 bg-[#030515]/80 flex items-center justify-center p-4 backdrop-blur-sm animate-fadeIn">
          <div className="bg-[#061C13] rounded-3xl max-w-md w-full p-6 sm:p-7 shadow-2xl border border-red-500/40 text-center space-y-5">
            <div className="w-14 h-14 mx-auto bg-[#2A0808] text-red-400 rounded-2xl flex items-center justify-center border border-red-500/40 shadow-sm">
              <Trash2 className="w-7 h-7" />
            </div>

            <div className="space-y-2 text-left sm:text-center">
              <h3 className="text-lg font-black text-[#F0F9F3] text-center">
                Are you sure you want to delete this examination?
              </h3>
              <p className="text-xs text-[#ADCDBA] leading-relaxed text-center">
                This will permanently delete <span className="font-bold text-[#F0F9F3]">{examToDelete.courseCode}</span> ({examToDelete.courseTitle}) from the database.
              </p>
              <div className="bg-[#0A2419] p-3 rounded-xl border border-[#789981]/30 text-xs font-mono text-[#D6BF62] text-center">
                Exam ID: <span className="font-bold text-[#F0F9F3]">{examToDelete.id}</span>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setExamToDelete(null)}
                disabled={isDeleting}
                className="flex-1 py-2.5 px-4 bg-[#0A2419] hover:bg-[#0E3324] text-[#ADCDBA] border border-[#789981]/40 font-bold text-xs rounded-xl transition disabled:opacity-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteExam}
                disabled={isDeleting}
                className="flex-1 py-2.5 px-4 bg-red-700 hover:bg-red-600 border border-red-500 text-white font-bold text-xs rounded-xl shadow-md transition flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                {isDeleting ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    <span>Yes, Delete Exam</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DETAILS VIEW MODAL */}
      {detailsExam && (
        <div className="fixed inset-0 z-50 bg-[#030515]/80 flex items-center justify-center p-4 backdrop-blur-sm animate-fadeIn">
          <div className="bg-[#061C13] rounded-3xl max-w-2xl w-full p-6 sm:p-8 shadow-2xl border border-[#D6BF62]/30 max-h-[90vh] overflow-y-auto space-y-6">
            <div className="flex items-center justify-between pb-4 border-b border-[#789981]/20">
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-[#D6BF62] bg-[#0A2419] border border-[#D6BF62]/30 px-2.5 py-1 rounded-lg text-xs">
                  {detailsExam.courseCode}
                </span>
                <h3 className="font-extrabold text-[#F0F9F3] text-base">
                  {detailsExam.courseTitle}
                </h3>
              </div>
              <button
                onClick={() => setDetailsExam(null)}
                className="p-2 text-[#789981] hover:text-[#F0F9F3] rounded-full cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs text-[#ADCDBA]">
              <div className="grid grid-cols-2 gap-4 bg-[#0A2419] p-4 rounded-2xl border border-[#789981]/30">
                <div>
                  <span className="text-[#789981] uppercase font-bold text-[10px] block">Unique Exam ID</span>
                  <span className="font-mono font-bold text-[#D6BF62]">{detailsExam.id}</span>
                </div>
                <div>
                  <span className="text-[#789981] uppercase font-bold text-[10px] block">Current Status</span>
                  <span className="font-bold uppercase text-[#10B981]">{detailsExam.status}</span>
                </div>
                <div>
                  <span className="text-[#789981] uppercase font-bold text-[10px] block">Department Eligibility</span>
                  <span className="font-semibold text-[#F0F9F3]">{detailsExam.department}</span>
                </div>
                <div>
                  <span className="text-[#789981] uppercase font-bold text-[10px] block">Duration</span>
                  <span className="font-semibold text-[#F0F9F3]">{detailsExam.durationMinutes} Minutes</span>
                </div>
                <div>
                  <span className="text-[#789981] uppercase font-bold text-[10px] block">Availability Window</span>
                  <span className="font-medium text-[#F0F9F3]">
                    {formatLagosDate(detailsExam.startDate)} ({formatLagosTime(detailsExam.startDate)}) – {formatLagosDate(detailsExam.endDate)} ({formatLagosTime(detailsExam.endDate)})
                  </span>
                </div>
                <div>
                  <span className="text-[#789981] uppercase font-bold text-[10px] block">Randomisation</span>
                  <span className="font-semibold text-[#F0F9F3]">
                    {detailsExam.randomizationEnabled ? 'Enabled (Batches A, B, C, D)' : 'Disabled'}
                  </span>
                </div>
              </div>

              <div>
                <span className="text-[#D6BF62] uppercase font-bold text-[10px] block mb-1">
                  Examination Instructions
                </span>
                <p className="bg-[#0A2419] p-3 rounded-xl border border-[#789981]/30 whitespace-pre-line leading-relaxed text-[#ADCDBA]">
                  {detailsExam.instructions || 'Standard examination instructions apply.'}
                </p>
              </div>

              {detailsExam.batches && (
                <div>
                  <span className="text-[#D6BF62] uppercase font-bold text-[10px] block mb-1">
                    Configured Examination Batches
                  </span>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    {['Batch A', 'Batch B', 'Batch C', 'Batch D'].map((b) => (
                      <div key={b} className="p-2 bg-[#0A2419] border border-[#D6BF62]/30 rounded-xl font-bold text-[#D6BF62]">
                        {b}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#789981]/20">
              <button
                type="button"
                onClick={() => {
                  setSelectedExam(detailsExam);
                  setDetailsExam(null);
                  setActiveView('edit');
                }}
                className="px-4 py-2 bg-[#0A2419] hover:bg-[#0E3324] text-[#ADCDBA] border border-[#789981]/40 font-bold text-xs rounded-xl cursor-pointer"
              >
                Edit Examination
              </button>
              <button
                type="button"
                onClick={() => setDetailsExam(null)}
                className="px-5 py-2 bg-[#0E623B] hover:bg-[#127949] border border-[#D6BF62] text-[#F0F9F3] font-bold text-xs rounded-xl cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
