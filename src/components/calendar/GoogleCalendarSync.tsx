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
    <div className="bg-[#061C13] border border-[#D6BF62]/30 rounded-2xl p-4 sm:p-5 text-left space-y-4 shadow-xl">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#0E623B]/30 border border-[#D6BF62]/40 flex items-center justify-center text-[#D6BF62] shrink-0">
            <CalendarIcon className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-black text-[#F0F9F3] tracking-wide">
              Examination Reminders
            </h3>
            <p className="text-xs text-[#ADCDBA] mt-0.5">
              Automatically receive your examination schedules and reminders.
            </p>
          </div>
        </div>

        {/* Toggle Details / View Timetable */}
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-xs text-[#D6BF62] hover:text-[#f3df88] flex items-center gap-1 font-semibold self-start sm:self-auto cursor-pointer"
        >
          <span>{isExpanded ? 'Hide Details' : 'View Timetable'}</span>
          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Notifications */}
      {errorMessage && (
        <div className="p-3 bg-[#2A0808] border border-red-500/40 rounded-xl text-red-200 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {successMessage && (
        <div className="p-3 bg-[#0E3324] border border-[#D6BF62]/50 rounded-xl text-[#F0F9F3] text-xs flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-[#D6BF62] shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Connection & Action Section */}
      <div className="pt-3 border-t border-[#789981]/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {!isConnected ? (
          <div className="w-full sm:w-auto">
            <button
              type="button"
              onClick={handleConnect}
              disabled={isConnecting}
              className="px-5 py-2.5 bg-[#0E623B] hover:bg-[#127949] text-[#F0F9F3] border border-[#D6BF62]/80 text-xs font-bold rounded-xl transition shadow-md disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
            >
              {isConnecting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-[#D6BF62]" />
                  <span>Connecting...</span>
                </>
              ) : (
                <span>Connect</span>
              )}
            </button>
            <p className="text-[11px] text-[#ADCDBA] mt-2 leading-relaxed">
              Connect once to receive automatic examination reminders five minutes before each examination.
            </p>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full justify-between">
            <div className="flex items-center gap-3">
              <span className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse shrink-0" />
              <div className="text-xs">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-1 bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 font-black rounded-lg text-xs flex items-center gap-1.5">
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                    Connected
                  </span>
                  <span className="text-[#D6BF62] font-mono text-[11px] font-bold">({connectedEmail})</span>
                </div>
                <div className="flex items-center gap-2 mt-1.5 text-[11px] text-[#ADCDBA]">
                  <span>5-Minute Reminders Active</span>
                  <span>•</span>
                  <span>
                    Last Synced: <strong className="text-[#F0F9F3]">{lastSyncTime || 'Just now'}</strong>
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSyncAll}
                disabled={isSyncing || eligibleExams.length === 0}
                className="px-3.5 py-1.5 bg-[#0A2419] hover:bg-[#0E3324] border border-[#789981]/40 text-[#ADCDBA] hover:text-[#F0F9F3] text-xs font-semibold rounded-xl transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                title="Synchronize examination timetable"
              >
                {isSyncing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[#D6BF62]" />
                    <span>Syncing...</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 text-[#D6BF62]" />
                    <span>Sync Now</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleDisconnect}
                title="Disconnect Examination Reminders"
                className="text-xs text-[#789981] hover:text-red-300 transition cursor-pointer px-2 py-1 rounded-lg hover:bg-[#160a0a]"
              >
                Disconnect
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Expandable Timetable Review */}
      {isExpanded && (
        <div className="pt-3 border-t border-[#789981]/20 space-y-2">
          <p className="text-xs font-bold text-[#ADCDBA] uppercase tracking-wider">
            Examinations Available For Calendar Sync ({eligibleExams.length})
          </p>
          {eligibleExams.length === 0 ? (
            <p className="text-xs text-[#789981] italic py-2">
              No upcoming scheduled examinations found for the selected department.
            </p>
          ) : (
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {eligibleExams.map((ex) => {
                const result = syncResults?.find((r) => r.examId === ex.id);
                return (
                  <div
                    key={ex.id}
                    className="p-2.5 rounded-xl bg-[#0A2419] border border-[#789981]/30 flex items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-[#D6BF62]">{ex.courseCode}</span>
                        <span className="text-[#F0F9F3] font-medium line-clamp-1">{ex.courseTitle}</span>
                      </div>
                      <p className="text-[10px] text-[#ADCDBA] mt-0.5">
                        {formatLagosDate(ex.startDate)} • {formatLagosTime(ex.startDate)} – {formatLagosTime(ex.endDate)} ({ex.durationMinutes} mins)
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {result?.status === 'created' || result?.status === 'updated' ? (
                        <span className="flex items-center gap-1 text-[11px] text-emerald-400 font-bold bg-emerald-950/60 px-2 py-0.5 rounded-lg border border-emerald-500/30">
                          <CheckCircle className="w-3 h-3" />
                          <span>Synced</span>
                        </span>
                      ) : null}

                      {result?.htmlLink && (
                        <a
                          href={result.htmlLink}
                          target="_blank"
                          rel="noreferrer"
                          className="p-1.5 text-[#D6BF62] hover:text-[#fff] bg-[#030515] rounded-lg border border-[#789981]/30 transition"
                          title="Open in Google Calendar"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}

                      {isConnected && (
                        <button
                          type="button"
                          onClick={() => handleSyncSingle(ex)}
                          disabled={isSyncing}
                          className="px-2.5 py-1 bg-[#0E623B] hover:bg-[#127949] text-[#F0F9F3] font-bold text-[11px] rounded-lg transition disabled:opacity-50 cursor-pointer border border-[#D6BF62]/40"
                        >
                          {result?.status === 'created' || result?.status === 'updated' ? 'Re-sync' : 'Add to Calendar'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
