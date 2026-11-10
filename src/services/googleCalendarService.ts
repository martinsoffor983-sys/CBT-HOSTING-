import { PublicExam, Exam } from '../types';

export interface CalendarEventPayload {
  summary: string;
  description: string;
  location?: string;
  start: {
    dateTime: string; // ISO string with timezone offset e.g. 2026-11-10T09:00:00+01:00
    timeZone: string;
  };
  end: {
    dateTime: string;
    timeZone: string;
  };
  reminders: {
    useDefault: boolean;
    overrides: Array<{
      method: 'popup' | 'email';
      minutes: number;
    }>;
  };
  extendedProperties?: {
    private: {
      sunExamId: string;
      courseCode: string;
      system: string;
    };
  };
}

export interface SyncExamResult {
  examId: string;
  courseCode: string;
  courseTitle: string;
  status: 'created' | 'updated' | 'already_synced' | 'failed' | 'skipped';
  eventId?: string;
  htmlLink?: string;
  error?: string;
}

/**
 * Format ISO datetime with Africa/Lagos (+01:00) offset for Google Calendar
 */
function toLagosIsoString(dateInput: string | Date): string {
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(d.getTime())) {
    throw new Error('Invalid examination date time provided.');
  }

  // If already contains offset or Z, parse as UTC then format +01:00
  // Lagos is UTC+1 (WAT) without daylight saving
  const lagosOffsetMs = 60 * 60 * 1000;
  const lagosTime = new Date(d.getTime() + lagosOffsetMs);

  const year = lagosTime.getUTCFullYear();
  const month = String(lagosTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(lagosTime.getUTCDate()).padStart(2, '0');
  const hours = String(lagosTime.getUTCHours()).padStart(2, '0');
  const minutes = String(lagosTime.getUTCMinutes()).padStart(2, '0');
  const seconds = String(lagosTime.getUTCSeconds()).padStart(2, '0');

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+01:00`;
}

/**
 * Build rich, clear description and details for student calendar event
 */
export function buildExamCalendarEvent(exam: PublicExam | Exam, studentMatric?: string): CalendarEventPayload {
  const startDate = new Date(exam.startDate);
  let endDate: Date;

  if (exam.endDate) {
    endDate = new Date(exam.endDate);
  } else {
    // Fallback: start + duration
    endDate = new Date(startDate.getTime() + (exam.durationMinutes || 60) * 60 * 1000);
  }

  // Ensure end is strictly after start
  if (endDate.getTime() <= startDate.getTime()) {
    endDate = new Date(startDate.getTime() + (exam.durationMinutes || 60) * 60 * 1000);
  }

  const startIso = toLagosIsoString(startDate);
  const endIso = toLagosIsoString(endDate);

  const appBaseUrl = window.location.origin;
  const directExamUrl = `${appBaseUrl}?examId=${encodeURIComponent(exam.id)}`;

  const descriptionLines = [
    `🎓 SPORTS UNIVERSITY OF NIGERIA (SUN CBT)`,
    `Official Computer-Based Examination Schedule`,
    ``,
    `📚 Course: ${exam.courseCode} - ${exam.courseTitle}`,
    `🏛 Department: ${exam.department}`,
    `👨‍🏫 Course Lecturer: ${exam.lecturerName || 'Faculty Examiner'}`,
    `⏱ Duration: ${exam.durationMinutes} Minutes (${exam.questionsCount || 0} Questions)`,
    ``,
    `🔑 Exam Access ID: ${exam.id}`,
    studentMatric ? `👤 Registered Candidate: ${studentMatric}` : null,
    ``,
    `🚀 Online CBT Portal Link:`,
    directExamUrl,
    ``,
    `⚠️ Notice: Ensure you have your Matriculation Number ready and stable network connectivity before starting.`,
    `Institutional Motto: Citadel for Champions`
  ].filter(Boolean).join('\n');

  return {
    summary: `[SUN CBT Exam] ${exam.courseCode}: ${exam.courseTitle}`,
    description: descriptionLines,
    location: 'Sports University of Nigeria CBT Online Portal',
    start: {
      dateTime: startIso,
      timeZone: 'Africa/Lagos'
    },
    end: {
      dateTime: endIso,
      timeZone: 'Africa/Lagos'
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 5 } // 5 minutes before examination start
      ]
    },
    extendedProperties: {
      private: {
        sunExamId: exam.id,
        courseCode: exam.courseCode,
        system: 'SUN_CBT'
      }
    }
  };
}

/**
 * Searches the user's primary Google Calendar for an existing event with matching sunExamId
 */
export async function findExistingExamEvent(
  accessToken: string,
  examId: string
): Promise<{ id: string; htmlLink?: string } | null> {
  try {
    const qUrl = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    qUrl.searchParams.set('privateExtendedProperty', `sunExamId=${examId}`);
    qUrl.searchParams.set('maxResults', '5');

    const res = await fetch(qUrl.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json'
      }
    });

    if (!res.ok) {
      // Fallback search by text query if extended properties indexing fails
      const fallbackUrl = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
      fallbackUrl.searchParams.set('q', examId);
      fallbackUrl.searchParams.set('maxResults', '5');
      const fallbackRes = await fetch(fallbackUrl.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (fallbackRes.ok) {
        const data = await fallbackRes.json();
        const found = (data.items || []).find((item: any) =>
          (item.description && item.description.includes(examId)) ||
          (item.extendedProperties?.private?.sunExamId === examId)
        );
        if (found) return { id: found.id, htmlLink: found.htmlLink };
      }
      return null;
    }

    const data = await res.json();
    if (data.items && data.items.length > 0) {
      return { id: data.items[0].id, htmlLink: data.items[0].htmlLink };
    }
    return null;
  } catch (err) {
    console.warn('Error checking existing calendar event:', err);
    return null;
  }
}

/**
 * Synchronize a single exam to Google Calendar (creates or updates)
 */
export async function syncExamToGoogleCalendar(
  accessToken: string,
  exam: PublicExam | Exam,
  studentMatric?: string
): Promise<SyncExamResult> {
  try {
    const payload = buildExamCalendarEvent(exam, studentMatric);
    const existing = await findExistingExamEvent(accessToken, exam.id);

    if (existing?.id) {
      // Update existing event
      const updateUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${existing.id}`;
      const res = await fetch(updateUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson?.error?.message || `Failed to update calendar event (status ${res.status}).`);
      }

      const updatedData = await res.json();
      return {
        examId: exam.id,
        courseCode: exam.courseCode,
        courseTitle: exam.courseTitle,
        status: 'updated',
        eventId: updatedData.id,
        htmlLink: updatedData.htmlLink
      };
    } else {
      // Create new event
      const createUrl = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
      const res = await fetch(createUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson?.error?.message || `Failed to create calendar event (status ${res.status}).`);
      }

      const createdData = await res.json();
      return {
        examId: exam.id,
        courseCode: exam.courseCode,
        courseTitle: exam.courseTitle,
        status: 'created',
        eventId: createdData.id,
        htmlLink: createdData.htmlLink
      };
    }
  } catch (error: any) {
    console.error(`Sync error for exam ${exam.courseCode}:`, error);
    return {
      examId: exam.id,
      courseCode: exam.courseCode,
      courseTitle: exam.courseTitle,
      status: 'failed',
      error: error?.message || 'Sync failed.'
    };
  }
}

/**
 * Remove an examination event from Google Calendar (Requires explicit user confirmation)
 */
export async function removeExamFromGoogleCalendar(
  accessToken: string,
  eventId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const delUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`;
    const res = await fetch(delUrl, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!res.ok && res.status !== 404 && res.status !== 410) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson?.error?.message || 'Could not delete calendar event.');
    }

    return { success: true };
  } catch (error: any) {
    console.error('Remove calendar event error:', error);
    return { success: false, error: error?.message || 'Failed to remove calendar event.' };
  }
}
