import React, { useState, useEffect } from 'react';
import {
  Calendar as CalendarIcon,
  CheckCircle,
  AlertCircle,
  Loader2,
  ExternalLink,
  RefreshCw,
  LogOut,
  Sparkles,
  Clock,
  ShieldCheck,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { PublicExam, Exam } from '../../types';
import {
  connectGoogleCalendar,
  getCalendarAccessToken,
  getCalendarConnectedUser,
  disconnectGoogleCalendar,
  isRunningInIframe
} from '../../lib/googleCalendarAuth';
import {
  syncExamToGoogleCalendar,
  SyncExamResult
} from '../../services/googleCalendarService';
import { formatLagosDate, formatLagosTime } from '../../utils/timeUtils';

interface GoogleCalendarSyncProps {
  exams: (PublicExam | Exam)[];
  candidateMatric?: string;
  departmentFilter?: string;
  onSyncComplete?: (results: SyncExamResult[]) => void;
}

export const GoogleCalendarSync: React.FC<GoogleCalendarSyncProps> = ({
  exams,
  candidateMatric,
  departmentFilter,
  onSyncComplete
}) => {
  const [isConnected, setIsConnected] = useState<boolean>(() => Boolean(getCalendarAccessToken()));
  const [connectedEmail, setConnectedEmail] = useState<string | null>(
    () => getCalendarConnectedUser()?.email || null
  );
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResults, setSyncResults] = useState<SyncExamResult[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);

  // Filter eligible published upcoming/active exams with valid start dates
  const eligibleExams = exams.filter((e) => {
    if (e.status !== 'published') return false;
    if (!e.startDate) return false;
    // If student department is selected, prioritize matched department or 'All Departments'
    if (departmentFilter && departmentFilter !== 'All' && departmentFilter !== 'All Departments') {
      const examDept = (e.department || '').toLowerCase().trim();
      const studentDept = departmentFilter.toLowerCase().trim();
      if (examDept !== 'all' && examDept !== 'all departments' && examDept !== studentDept) {
        return false;
      }
    }
    return true;
  });

  // Automatically sync eligible examinations when user is connected or when published exams change
  useEffect(() => {
    const token = getCalendarAccessToken();
    if (token && eligibleExams.length > 0 && !isSyncing && !lastSyncTime) {
      handleAutoSync(token);
    }
  }, [eligibleExams.length, isConnected]);

  const handleAutoSync = async (token: string) => {
    setIsSyncing(true);
    setErrorMessage(null);
    const results: SyncExamResult[] = [];
    try {
      for (const exam of eligibleExams) {
        const res = await syncExamToGoogleCalendar(token, exam, candidateMatric);
        results.push(res);
      }
      setSyncResults(results);
      setLastSyncTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      onSyncComplete?.(results);
      const successfulCount = results.filter((r) => r.status === 'created' || r.status === 'updated').length;
      if (successfulCount > 0) {
        setSuccessMessage(
          `Automatically synchronized ${successfulCount} eligible examination ${
            successfulCount === 1 ? 'schedule' : 'schedules'
          } to your Google Calendar with 5-minute reminders.`
        );
      }
    } catch (err: any) {
      console.warn('Auto-sync notice:', err);
    } finally {
      setIsSyncing(false);
    }
  };

  const inIframe = isRunningInIframe();

  const handleConnect = async () => {
    // When running inside the AI Studio Preview iframe, do not launch the popup
    if (inIframe) {
      setErrorMessage('Connect your Google Calendar from the deployed SUN CBT website.');
      return;
    }

    setIsConnecting(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      // Individual student Google OAuth authorization
      const { user, accessToken } = await connectGoogleCalendar();
      if (accessToken && user) {
        setIsConnected(true);
        setConnectedEmail(user.email || 'Connected Google Account');
        setSuccessMessage('Successfully connected your personal Google Account. Your eligible examination schedules are being synchronized automatically.');
        await handleAutoSync(accessToken);
      }
    } catch (err: any) {
      const code = err?.code || '';
      const msg = err?.message || '';

      if (msg.includes('Connect your Google Calendar from the deployed SUN CBT website')) {
        setErrorMessage('Connect your Google Calendar from the deployed SUN CBT website.');
      } else if (code === 'auth/popup-closed-by-user' || msg.includes('popup-closed-by-user')) {
        // User voluntarily dismissed the sign-in modal
        setErrorMessage('Google authorization was cancelled or closed before completing. Click again when you are ready to connect.');
      } else if (code === 'auth/popup-blocked') {
        setErrorMessage('The Google sign-in window was blocked by your browser. Please allow popups for this site and try again.');
      } else if (code === 'auth/cancelled-popup-request') {
        // Ignored duplicate popup click
      } else {
        console.warn('Google Calendar connection notice:', err);
        setErrorMessage(err?.message || 'Failed to authenticate with Google Calendar.');
      }
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = () => {
    disconnectGoogleCalendar();
    setIsConnected(false);
    setConnectedEmail(null);
    setSyncResults(null);
    setLastSyncTime(null);
    setSuccessMessage(null);
    setErrorMessage(null);
  };

  const handleSyncAll = async () => {
    const token = getCalendarAccessToken();
    if (!token) {
      setIsConnected(false);
      setErrorMessage('Please connect your Google Account first.');
      return;
    }
    await handleAutoSync(token);
  };

  const handleSyncSingle = async (exam: PublicExam | Exam) => {
    const token = getCalendarAccessToken();
    if (!token) {
      setIsConnected(false);
      setErrorMessage('Please connect your Google Account first.');
      return;
    }

    setIsSyncing(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await syncExamToGoogleCalendar(token, exam, candidateMatric);
      setSyncResults((prev) => {
        const filtered = (prev || []).filter((r) => r.examId !== exam.id);
        return [...filtered, res];
      });

      if (res.status === 'created' || res.status === 'updated') {
        setSuccessMessage(
          `Successfully added ${exam.courseCode} to your Google Calendar.`
        );
      } else {
        setErrorMessage(`Could not sync ${exam.courseCode}: ${res.error || 'Unknown error'}`);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Single sync failed.');
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="bg-[#061C13] border border-[#D6BF62]/30 rounded-xl p-3 sm:px-4 sm:py-2.5 text-left shadow-md">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="space-y-0.5 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-xs sm:text-sm font-black text-[#F0F9F3] tracking-wide">
              Examination Reminders
            </h3>
            {isConnected && (
              <span className="px-2 py-0.5 bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 font-bold rounded-md text-[10px] flex items-center gap-1">
                <CheckCircle className="w-3 h-3 text-emerald-400" />
                Connected
              </span>
            )}
          </div>
          <p className="text-[11px] sm:text-xs text-[#ADCDBA] leading-tight">
            Receive your examination schedules and reminders in your Google Calendar.
          </p>
        </div>

        <div className="shrink-0 flex items-center gap-2">
          {!isConnected ? (
            <button
              type="button"
              onClick={handleConnect}
              disabled={isConnecting}
              className="px-3.5 py-1.5 bg-[#0E623B] hover:bg-[#127949] text-[#F0F9F3] border border-[#D6BF62] text-xs font-bold rounded-lg transition shadow-sm disabled:opacity-50 cursor-pointer flex items-center justify-center gap-1.5 active:scale-95"
            >
              {isConnecting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#D6BF62]" />
                  <span>Connecting...</span>
                </>
              ) : (
                <span>Connect</span>
              )}
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSyncAll}
                disabled={isSyncing || eligibleExams.length === 0}
                className="px-2.5 py-1 bg-[#0A2419] hover:bg-[#0E3324] border border-[#789981]/40 text-[#ADCDBA] hover:text-[#F0F9F3] text-[11px] font-semibold rounded-lg transition flex items-center gap-1 disabled:opacity-50 cursor-pointer"
                title="Synchronize examination timetable"
              >
                {isSyncing ? (
                  <Loader2 className="w-3 h-3 animate-spin text-[#D6BF62]" />
                ) : (
                  <RefreshCw className="w-3 h-3 text-[#D6BF62]" />
                )}
                <span>{isSyncing ? 'Syncing...' : 'Sync'}</span>
              </button>

              <button
                type="button"
                onClick={handleDisconnect}
                title="Disconnect Examination Reminders"
                className="text-[11px] text-[#789981] hover:text-red-300 transition cursor-pointer px-2 py-1 rounded-md hover:bg-[#160a0a]"
              >
                Disconnect
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Notifications */}
      {errorMessage && (
        <div className="mt-2 px-2.5 py-1 bg-[#2A0808] border border-red-500/40 rounded-lg text-red-200 text-[10px] sm:text-[11px] flex items-center gap-1.5">
          <AlertCircle className="w-3 h-3 text-red-400 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {successMessage && (
        <div className="mt-2 px-2.5 py-1 bg-[#0E3324] border border-[#D6BF62]/50 rounded-lg text-[#F0F9F3] text-[10px] sm:text-[11px] flex items-center gap-1.5">
          <CheckCircle className="w-3 h-3 text-[#D6BF62] shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}
    </div>
  );
};
