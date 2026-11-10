import * as XLSX from 'xlsx';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
  Header,
  Footer,
  ImageRun,
  HeadingLevel,
  PageNumber,
  PageOrientation,
  ShadingType,
  TabStopType
} from 'docx';
import { Submission, Exam, AttendanceRecord } from '../types';
import { capitalizeProper } from './studentValidation';
import { formatLagosDate, formatLagosTime, formatLagosDateTime } from './timeUtils';

function getGrade(percentage: number): { grade: string; remark: string } {
  if (percentage >= 70) return { grade: 'A', remark: 'Excellent' };
  if (percentage >= 60) return { grade: 'B', remark: 'Very Good' };
  if (percentage >= 50) return { grade: 'C', remark: 'Good' };
  if (percentage >= 45) return { grade: 'D', remark: 'Pass' };
  if (percentage >= 40) return { grade: 'E', remark: 'Poor Pass' };
  return { grade: 'F', remark: 'Fail' };
}

export function exportToExcel(exam: Exam, submissions: Submission[]) {
  const data = submissions.map((sub, index) => {
    const { grade, remark } = getGrade(sub.percentage);
    const sexValue =
      sub.gender === 'M' || sub.gender === 'Male'
        ? 'M'
        : sub.gender === 'F' || sub.gender === 'Female'
        ? 'F'
        : 'Not recorded';

    return {
      'S/N': index + 1,
      'Matriculation Number': sub.matricNumber,
      'Full Name': capitalizeProper(sub.fullName),
      'Department': capitalizeProper(sub.department),
      'Sex': sexValue,
      'Course Code': exam.courseCode,
      'Course Title': exam.courseTitle,
      'Course Lecturer': exam.lecturerName || sub.lecturerName || 'Not specified',
      'Examination Date': exam.startDate ? formatLagosDate(exam.startDate) : 'Not specified',
      'Starting Time': exam.startDate ? `${formatLagosTime(exam.startDate)} (WAT)` : 'Not specified',
      'Closing Time': exam.endDate ? `${formatLagosTime(exam.endDate)} (WAT)` : 'Not specified',
      'Score': sub.score,
      'Total Questions': sub.totalQuestions,
      'Percentage (%)': `${sub.percentage}%`,
      'Grade': grade,
      'Remark': remark,
      'Submission Date': new Date(sub.submittedAt).toLocaleDateString(),
      'Submission Time': new Date(sub.submittedAt).toLocaleTimeString(),
      'Receipt Code': sub.submissionReceipt
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(data);

  // Set column widths
  worksheet['!cols'] = [
    { wch: 6 },  // S/N
    { wch: 22 }, // Matric
    { wch: 30 }, // Name
    { wch: 30 }, // Dept
    { wch: 14 }, // Sex
    { wch: 14 }, // Code
    { wch: 30 }, // Title
    { wch: 8 },  // Score
    { wch: 10 }, // Total
    { wch: 14 }, // %
    { wch: 8 },  // Grade
    { wch: 12 }, // Remark
    { wch: 16 }, // Date
    { wch: 16 }, // Time
    { wch: 22 }  // Receipt
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'SUN CBT Results');

  const filename = `${exam.courseCode.replace(/[^a-zA-Z0-9]/g, '_')}_Results_${new Date().toISOString().split('T')[0]}.xlsx`;
  XLSX.writeFile(workbook, filename);
}

export async function exportToWord(exam: Exam, submissions: Submission[]) {
  let logoBuffer: ArrayBuffer | null = null;
  try {
    const response = await fetch('/assets/aistudio/IMG-20261104-WA0018_41e50466.jpg');
    if (response.ok) {
      logoBuffer = await response.arrayBuffer();
    }
  } catch (err) {
    console.warn('Could not load logo for Word document:', err);
  }

  // Summary statistics
  const totalCandidates = submissions.length;
  const avgScore = totalCandidates > 0
    ? (submissions.reduce((acc, cur) => acc + cur.percentage, 0) / totalCandidates).toFixed(1)
    : '0';
  const highestScore = totalCandidates > 0
    ? Math.max(...submissions.map(s => s.score))
    : 0;
  const lowestScore = totalCandidates > 0
    ? Math.min(...submissions.map(s => s.score))
    : 0;
  const passCount = submissions.filter(s => s.percentage >= 50).length;
  const passRate = totalCandidates > 0
    ? Math.round((passCount / totalCandidates) * 100)
    : 0;

  // Build Table Rows
  const tableHeader = new TableRow({
    tableHeader: true,
    children: [
      new TableCell({
        shading: { fill: '0B532C' },
        children: [new Paragraph({ children: [new TextRun({ text: 'S/N', bold: true, color: 'FFFFFF' })] })],
        width: { size: 5, type: WidthType.PERCENTAGE }
      }),
      new TableCell({
        shading: { fill: '0B532C' },
        children: [new Paragraph({ children: [new TextRun({ text: 'Matric No.', bold: true, color: 'FFFFFF' })] })],
        width: { size: 18, type: WidthType.PERCENTAGE }
      }),
      new TableCell({
        shading: { fill: '0B532C' },
        children: [new Paragraph({ children: [new TextRun({ text: 'Student Name', bold: true, color: 'FFFFFF' })] })],
        width: { size: 25, type: WidthType.PERCENTAGE }
      }),
      new TableCell({
        shading: { fill: '0B532C' },
        children: [new Paragraph({ children: [new TextRun({ text: 'Department', bold: true, color: 'FFFFFF' })] })],
        width: { size: 20, type: WidthType.PERCENTAGE }
      }),
      new TableCell({
        shading: { fill: '0B532C' },
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Sex', bold: true, color: 'FFFFFF' })] })],
        width: { size: 10, type: WidthType.PERCENTAGE }
      }),
      new TableCell({
        shading: { fill: '0B532C' },
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Score', bold: true, color: 'FFFFFF' })] })],
        width: { size: 10, type: WidthType.PERCENTAGE }
      }),
      new TableCell({
        shading: { fill: '0B532C' },
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '%', bold: true, color: 'FFFFFF' })] })],
        width: { size: 6, type: WidthType.PERCENTAGE }
      }),
      new TableCell({
        shading: { fill: '0B532C' },
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Grade', bold: true, color: 'FFFFFF' })] })],
        width: { size: 6, type: WidthType.PERCENTAGE }
      })
    ]
  });

  const dataRows = submissions.map((sub, idx) => {
    const { grade } = getGrade(sub.percentage);
    const isEven = idx % 2 === 0;
    const bg = isEven ? 'FFFFFF' : 'F8FAFC';

    return new TableRow({
      children: [
        new TableCell({
          shading: { fill: bg },
          children: [new Paragraph({ text: String(idx + 1) })]
        }),
        new TableCell({
          shading: { fill: bg },
          children: [new Paragraph({ children: [new TextRun({ text: sub.matricNumber, bold: true })] })]
        }),
        new TableCell({
          shading: { fill: bg },
          children: [new Paragraph({ text: capitalizeProper(sub.fullName) })]
        }),
        new TableCell({
          shading: { fill: bg },
          children: [new Paragraph({ text: capitalizeProper(sub.department) })]
        }),
        new TableCell({
          shading: { fill: bg },
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              text:
                sub.gender === 'M' || sub.gender === 'Male'
                  ? 'M'
                  : sub.gender === 'F' || sub.gender === 'Female'
                  ? 'F'
                  : 'Not recorded'
            })
          ]
        }),
        new TableCell({
          shading: { fill: bg },
          children: [new Paragraph({ alignment: AlignmentType.CENTER, text: `${sub.score}/${sub.totalQuestions}` })]
        }),
        new TableCell({
          shading: { fill: bg },
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `${sub.percentage}%`, bold: true })] })]
        }),
        new TableCell({
          shading: { fill: bg },
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: grade, bold: true, color: grade === 'F' ? 'DC2626' : '0B532C' })] })]
        })
      ]
    });
  });

  const headerParagraphs: Paragraph[] = [];
  if (logoBuffer) {
    headerParagraphs.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new ImageRun({
            data: new Uint8Array(logoBuffer),
            transformation: {
              width: 90,
              height: 105
            },
            type: 'jpg'
          })
        ]
      })
    );
  }

  headerParagraphs.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: 'SPORTS UNIVERSITY OF NIGERIA',
          bold: true,
          size: 32,
          color: '0B532C'
        })
      ]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: 'CITADEL FOR CHAMPIONS',
          bold: true,
          size: 20,
          color: 'D4AF37'
        })
      ]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: 'DIRECTORATE OF ACADEMIC AFFAIRS & COMPUTER-BASED TESTING (SUN CBT)',
          size: 18,
          color: '333333'
        })
      ]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [
        new TextRun({
          text: 'OFFICIAL EXAMINATION RESULTS REPORT',
          bold: true,
          size: 24,
          underline: {}
        })
      ]
    })
  );

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          ...headerParagraphs,

          // Course and Exam Meta Box
          new Paragraph({
            children: [
              new TextRun({ text: 'Course Code: ', bold: true }),
              new TextRun({ text: `${exam.courseCode}    |    ` }),
              new TextRun({ text: 'Course Title: ', bold: true }),
              new TextRun({ text: `${exam.courseTitle}` })
            ]
          }),
          new Paragraph({
            children: [
              new TextRun({ text: 'Course Lecturer: ', bold: true }),
              new TextRun({ text: `${exam.lecturerName || 'Not specified'}    |    ` }),
              new TextRun({ text: 'Department: ', bold: true }),
              new TextRun({ text: `${exam.department}` })
            ]
          }),
          new Paragraph({
            children: [
              new TextRun({ text: 'Examination Date: ', bold: true }),
              new TextRun({ text: `${exam.startDate ? formatLagosDate(exam.startDate) : 'Not specified'}    |    ` }),
              new TextRun({ text: 'Time Window: ', bold: true }),
              new TextRun({ text: `${exam.startDate ? formatLagosTime(exam.startDate) : 'N/A'} – ${exam.endDate ? formatLagosTime(exam.endDate) : 'N/A'} (WAT)    |    ` }),
              new TextRun({ text: 'Duration: ', bold: true }),
              new TextRun({ text: `${exam.durationMinutes} Minutes    |    ` }),
              new TextRun({ text: 'Questions: ', bold: true }),
              new TextRun({ text: `${exam.questionsCount}` })
            ]
          }),
          new Paragraph({
            spacing: { after: 200 },
            children: [
              new TextRun({ text: 'Generated On: ', bold: true }),
              new TextRun({ text: `${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} at ${new Date().toLocaleTimeString()}` })
            ]
          }),

          // Summary Statistics
          new Paragraph({
            heading: HeadingLevel.HEADING_3,
            children: [new TextRun({ text: 'EXAMINATION PERFORMANCE SUMMARY', bold: true, color: '0B532C' })]
          }),
          new Paragraph({
            spacing: { after: 200 },
            children: [
              new TextRun({ text: `Total Candidates Assessed: ${totalCandidates}    |    ` }),
              new TextRun({ text: `Class Average: ${avgScore}%    |    ` }),
              new TextRun({ text: `Pass Rate: ${passRate}%    |    ` }),
              new TextRun({ text: `High / Low: ${highestScore} / ${lowestScore}` })
            ]
          }),

          // Results Table
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [tableHeader, ...dataRows]
          }),

          // Sign-off section
          new Paragraph({
            spacing: { before: 400 },
            children: [
              new TextRun({
                text: `${exam.lecturerName ? exam.lecturerName : '____________________________'}                                        ____________________________`,
                bold: true
              })
            ]
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: 'Course Lecturer / Chief Examiner                                    Head of Academic Department',
                bold: true
              })
            ]
          })
        ]
      }
    ]
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${exam.courseCode.replace(/[^a-zA-Z0-9]/g, '_')}_Official_Result_Report.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Export a single candidate's full examination script to an official Word Document (.docx)
 */
export async function exportIndividualScriptToWord(exam: Exam, sub: Submission) {
  let logoBuffer: ArrayBuffer | null = null;
  try {
    if (typeof window !== 'undefined' && window.location) {
      const response = await fetch('/assets/aistudio/IMG-20261104-WA0018_41e50466.jpg');
      if (response.ok) {
        logoBuffer = await response.arrayBuffer();
      }
    }
  } catch (err) {
    console.warn('Could not load logo for script Word document:', err);
  }

  const { grade, remark } = getGrade(sub.percentage);
  const sexValue =
    sub.gender === 'M' || sub.gender === 'Male'
      ? 'M'
      : sub.gender === 'F' || sub.gender === 'Female'
      ? 'F'
      : 'Not recorded';

  // Resolve questions snapshot or fallback to exam.questions
  const questionsList = sub.questionSnapshot && sub.questionSnapshot.length > 0
    ? sub.questionSnapshot
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

  // Compute metrics if not pre-computed
  let attempted = sub.attemptedCount;
  let unanswered = sub.unansweredCount;
  let correct = sub.correctCount;
  let incorrect = sub.incorrectCount;

  if (attempted === undefined || unanswered === undefined) {
    attempted = 0;
    unanswered = 0;
    correct = 0;
    incorrect = 0;
    questionsList.forEach((q) => {
      const choice = sub.answers ? sub.answers[q.id] : undefined;
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

  const resolvedLecturerName =
    (exam.lecturerName && exam.lecturerName.trim() && exam.lecturerName.trim().toLowerCase() !== 'not specified')
      ? exam.lecturerName.trim()
      : (sub.lecturerName && sub.lecturerName.trim() && sub.lecturerName.trim().toLowerCase() !== 'not specified')
      ? sub.lecturerName.trim()
      : '[Institutional Course Examiner / Departmental Assessor]';

  const letters = ['A', 'B', 'C', 'D'];

  // Helper to format answer string cleanly
  const resolveAnswerString = (options: string[], optIdx: number | undefined, isTf?: boolean) => {
    if (optIdx === undefined || optIdx === null || optIdx < 0 || isNaN(Number(optIdx))) {
      return 'UNANSWERED';
    }
    const numIdx = Number(optIdx);
    if (isTf) {
      return numIdx === 0 ? 'True' : 'False';
    }
    const letter = letters[numIdx] || String(numIdx + 1);
    const text = options && options[numIdx] ? options[numIdx] : '';
    return text ? `${letter}. ${text}` : `Option ${letter}`;
  };

  // Helper to create a 2-column table row with clean padding, borders and shading
  const createInfoRow = (label: string, value: string | TextRun[], isAlt?: boolean) => {
    return new TableRow({
      cantSplit: true,
      children: [
        new TableCell({
          width: { size: 30, type: WidthType.PERCENTAGE },
          shading: { fill: 'F8FAFC' },
          margins: { top: 90, bottom: 90, left: 140, right: 140 },
          borders: {
            top: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
            bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
            left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
            right: { style: BorderStyle.NONE, size: 0, color: 'auto' }
          },
          children: [
            new Paragraph({
              spacing: { before: 0, after: 0 },
              children: [
                new TextRun({
                  text: label,
                  bold: true,
                  size: 20, // 10pt
                  color: '334155' // slate-700
                })
              ]
            })
          ]
        }),
        new TableCell({
          width: { size: 70, type: WidthType.PERCENTAGE },
          shading: { fill: isAlt ? 'FAFAFA' : 'FFFFFF' },
          margins: { top: 90, bottom: 90, left: 140, right: 140 },
          borders: {
            top: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
            bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
            left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
            right: { style: BorderStyle.NONE, size: 0, color: 'auto' }
          },
          children: [
            new Paragraph({
              spacing: { before: 0, after: 0 },
              children: typeof value === 'string'
                ? [
                    new TextRun({
                      text: value,
                      size: 20,
                      color: '0F172A' // slate-900
                    })
                  ]
                : value
            })
          ]
        })
      ]
    });
  };

  // Helper for section headings
  const createSectionHeading = (title: string) => {
    return new Paragraph({
      heading: HeadingLevel.HEADING_3,
      keepNext: true,
      spacing: { before: 240, after: 100 },
      children: [
        new TextRun({
          text: title,
          bold: true,
          size: 21,
          color: '0B532C'
        })
      ]
    });
  };

  // 1. Candidate Information Table
  const candidateInfoTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 6, color: 'CBD5E1' },
      bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CBD5E1' },
      left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'auto' }
    },
    rows: [
      createInfoRow('Candidate Full Name', [
        new TextRun({ text: capitalizeProper(sub.fullName), bold: true, size: 20, color: '0F172A' })
      ], false),
      createInfoRow('Matriculation Number', [
        new TextRun({ text: sub.matricNumber, bold: true, size: 20, color: '0B532C' })
      ], true),
      createInfoRow('Academic Department', capitalizeProper(sub.department), false),
      createInfoRow('Sex', sexValue, true),
      createInfoRow('Course Code', [
        new TextRun({ text: exam.courseCode, bold: true, size: 20, color: '0B532C' })
      ], false),
      createInfoRow('Course Title', exam.courseTitle, true),
      createInfoRow("Course Lecturer", resolvedLecturerName, false)
    ]
  });

  // 2. Examination Details Table
  const examinationDetailsTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 6, color: 'CBD5E1' },
      bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CBD5E1' },
      left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'auto' }
    },
    rows: [
      createInfoRow('Examination Date', exam.startDate ? formatLagosDate(exam.startDate) : 'Not specified', false),
      createInfoRow('Starting Time', exam.startDate ? `${formatLagosTime(exam.startDate)} (WAT)` : 'N/A', true),
      createInfoRow('Closing Time', exam.endDate ? `${formatLagosTime(exam.endDate)} (WAT)` : 'N/A', false),
      createInfoRow('Examination Batch', sub.batch || 'Batch A', true),
      createInfoRow('Submission Receipt ID', [
        new TextRun({ text: sub.submissionReceipt, bold: true, size: 20, color: '0F172A' })
      ], false),
      createInfoRow('Submission Date & Time', formatLagosDateTime(sub.submittedAt), true)
    ]
  });

  // 3. Performance Summary Tables
  const summaryMetricsTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 6, color: '0B532C' },
      bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CBD5E1' },
      left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'auto' }
    },
    rows: [
      // Header
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            width: { size: 40, type: WidthType.PERCENTAGE },
            shading: { fill: '0B532C' },
            margins: { top: 100, bottom: 100, left: 140, right: 140 },
            children: [
              new Paragraph({
                children: [new TextRun({ text: 'ASSESSMENT METRIC', bold: true, size: 19, color: 'FFFFFF' })]
              })
            ]
          }),
          new TableCell({
            width: { size: 30, type: WidthType.PERCENTAGE },
            shading: { fill: '0B532C' },
            margins: { top: 100, bottom: 100, left: 140, right: 140 },
            children: [
              new Paragraph({
                children: [new TextRun({ text: 'RECORDED COUNT', bold: true, size: 19, color: 'FFFFFF' })]
              })
            ]
          }),
          new TableCell({
            width: { size: 30, type: WidthType.PERCENTAGE },
            shading: { fill: '0B532C' },
            margins: { top: 100, bottom: 100, left: 140, right: 140 },
            children: [
              new Paragraph({
                children: [new TextRun({ text: 'EVALUATION REMARK', bold: true, size: 19, color: 'FFFFFF' })]
              })
            ]
          })
        ]
      }),
      // Rows
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            width: { size: 40, type: WidthType.PERCENTAGE },
            shading: { fill: 'F8FAFC' },
            margins: { top: 80, bottom: 80, left: 140, right: 140 },
            children: [new Paragraph({ children: [new TextRun({ text: 'Total Questions', bold: true, size: 20 })] })]
          }),
          new TableCell({
            width: { size: 30, type: WidthType.PERCENTAGE },
            margins: { top: 80, bottom: 80, left: 140, right: 140 },
            children: [new Paragraph({ children: [new TextRun({ text: `${sub.totalQuestions}`, bold: true, size: 20 })] })]
          }),
          new TableCell({
            width: { size: 30, type: WidthType.PERCENTAGE },
            margins: { top: 80, bottom: 80, left: 140, right: 140 },
            children: [new Paragraph({ children: [new TextRun({ text: '100% Complete Examination Set', size: 19, color: '64748B' })] })]
          })
        ]
      }),
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            width: { size: 40, type: WidthType.PERCENTAGE },
            shading: { fill: 'F8FAFC' },
            margins: { top: 80, bottom: 80, left: 140, right: 140 },
            children: [new Paragraph({ children: [new TextRun({ text: 'Questions Attempted', bold: true, size: 20 })] })]
          }),
          new TableCell({
            width: { size: 30, type: WidthType.PERCENTAGE },
            margins: { top: 80, bottom: 80, left: 140, right: 140 },
            children: [new Paragraph({ children: [new TextRun({ text: `${attempted}`, bold: true, size: 20 })] })]
          }),
          new TableCell({
            width: { size: 30, type: WidthType.PERCENTAGE },
            margins: { top: 80, bottom: 80, left: 140, right: 140 },
            children: [new Paragraph({ children: [new TextRun({ text: `${((attempted / (sub.totalQuestions || 1)) * 100).toFixed(1)}% Attempt Rate`, size: 19, color: '64748B' })] })]
          })
        ]
      }),
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            width: { size: 40, type: WidthType.PERCENTAGE },
            shading: { fill: 'F8FAFC' },
            margins: { top: 80, bottom: 80, left: 140, right: 140 },
            children: [new Paragraph({ children: [new TextRun({ text: 'Correct Answers', bold: true, size: 20 })] })]
          }),
          new TableCell({
            width: { size: 30, type: WidthType.PERCENTAGE },
            margins: { top: 80, bottom: 80, left: 140, right: 140 },
            children: [new Paragraph({ children: [new TextRun({ text: `${correct}`, bold: true, size: 20, color: '0B532C' })] })]
          }),
          new TableCell({
            width: { size: 30, type: WidthType.PERCENTAGE },
            margins: { top: 80, bottom: 80, left: 140, right: 140 },
            children: [new Paragraph({ children: [new TextRun({ text: `+${correct} Marks Earned`, bold: true, size: 19, color: '0B532C' })] })]
          })
        ]
      }),
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            width: { size: 40, type: WidthType.PERCENTAGE },
            shading: { fill: 'F8FAFC' },
            margins: { top: 80, bottom: 80, left: 140, right: 140 },
            children: [new Paragraph({ children: [new TextRun({ text: 'Incorrect Answers', bold: true, size: 20 })] })]
          }),
          new TableCell({
            width: { size: 30, type: WidthType.PERCENTAGE },
            margins: { top: 80, bottom: 80, left: 140, right: 140 },
            children: [new Paragraph({ children: [new TextRun({ text: `${incorrect}`, bold: true, size: 20, color: 'DC2626' })] })]
          }),
          new TableCell({
            width: { size: 30, type: WidthType.PERCENTAGE },
            margins: { top: 80, bottom: 80, left: 140, right: 140 },
            children: [new Paragraph({ children: [new TextRun({ text: '0 Marks Awarded', size: 19, color: 'DC2626' })] })]
          })
        ]
      }),
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            width: { size: 40, type: WidthType.PERCENTAGE },
            shading: { fill: 'F8FAFC' },
            margins: { top: 80, bottom: 80, left: 140, right: 140 },
            children: [new Paragraph({ children: [new TextRun({ text: 'Unanswered Questions', bold: true, size: 20 })] })]
          }),
          new TableCell({
            width: { size: 30, type: WidthType.PERCENTAGE },
            margins: { top: 80, bottom: 80, left: 140, right: 140 },
            children: [new Paragraph({ children: [new TextRun({ text: `${unanswered}`, bold: true, size: 20, color: 'B45309' })] })]
          }),
          new TableCell({
            width: { size: 30, type: WidthType.PERCENTAGE },
            margins: { top: 80, bottom: 80, left: 140, right: 140 },
            children: [new Paragraph({ children: [new TextRun({ text: '0 Marks Awarded', size: 19, color: 'B45309' })] })]
          })
        ]
      })
    ]
  });

  // Prominent Score & Outcome Banner Table
  const isPassed = sub.percentage >= 50;
  const scoreBannerTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 12, color: isPassed ? '0B532C' : 'DC2626' },
      bottom: { style: BorderStyle.SINGLE, size: 12, color: isPassed ? '0B532C' : 'DC2626' },
      left: { style: BorderStyle.SINGLE, size: 12, color: isPassed ? '0B532C' : 'DC2626' },
      right: { style: BorderStyle.SINGLE, size: 12, color: isPassed ? '0B532C' : 'DC2626' },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' }
    },
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          // Final Score
          new TableCell({
            width: { size: 34, type: WidthType.PERCENTAGE },
            shading: { fill: isPassed ? 'F0FDF4' : 'FEF2F2' },
            margins: { top: 140, bottom: 140, left: 140, right: 140 },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 0, after: 40 },
                children: [
                  new TextRun({
                    text: 'FINAL EXAMINATION SCORE',
                    bold: true,
                    size: 18,
                    color: '475569'
                  })
                ]
              }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 0, after: 30 },
                children: [
                  new TextRun({
                    text: `${sub.score} / ${sub.totalQuestions}`,
                    bold: true,
                    size: 32, // 16pt prominent
                    color: isPassed ? '0B532C' : 'DC2626'
                  })
                ]
              }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 0, after: 0 },
                children: [
                  new TextRun({
                    text: `${sub.percentage}% Score`,
                    bold: true,
                    size: 20,
                    color: '1E293B'
                  })
                ]
              })
            ]
          }),
          // Official Grade
          new TableCell({
            width: { size: 33, type: WidthType.PERCENTAGE },
            shading: { fill: 'FFFFFF' },
            margins: { top: 140, bottom: 140, left: 140, right: 140 },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 0, after: 40 },
                children: [
                  new TextRun({
                    text: 'OFFICIAL GRADE',
                    bold: true,
                    size: 18,
                    color: '475569'
                  })
                ]
              }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 0, after: 30 },
                children: [
                  new TextRun({
                    text: `Grade ${grade}`,
                    bold: true,
                    size: 32, // 16pt prominent
                    color: '1E293B'
                  })
                ]
              }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 0, after: 0 },
                children: [
                  new TextRun({
                    text: `${remark}`,
                    bold: true,
                    size: 20,
                    color: '475569'
                  })
                ]
              })
            ]
          }),
          // Examination Outcome
          new TableCell({
            width: { size: 33, type: WidthType.PERCENTAGE },
            shading: { fill: isPassed ? 'F0FDF4' : 'FEF2F2' },
            margins: { top: 140, bottom: 140, left: 140, right: 140 },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 0, after: 40 },
                children: [
                  new TextRun({
                    text: 'EXAMINATION OUTCOME',
                    bold: true,
                    size: 18,
                    color: '475569'
                  })
                ]
              }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 0, after: 30 },
                children: [
                  new TextRun({
                    text: isPassed ? 'PASSED' : 'FAILED',
                    bold: true,
                    size: 32, // 16pt prominent
                    color: isPassed ? '0B532C' : 'DC2626'
                  })
                ]
              }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 0, after: 0 },
                children: [
                  new TextRun({
                    text: isPassed ? 'Met Pass Benchmark' : 'Benchmark Not Met',
                    bold: true,
                    size: 20,
                    color: isPassed ? '0B532C' : 'DC2626'
                  })
                ]
              })
            ]
          })
        ]
      })
    ]
  });

  // 4. Complete Candidate Question Record Cards
  const questionCardElements: (Table | Paragraph)[] = [];

  questionsList.forEach((q, idx) => {
    const candidateChoiceIdx = sub.answers ? sub.answers[q.id] : undefined;
    const isUnanswered =
      candidateChoiceIdx === undefined ||
      candidateChoiceIdx === null ||
      Number(candidateChoiceIdx) < 0 ||
      isNaN(Number(candidateChoiceIdx));
    const isCorrect = !isUnanswered && Number(candidateChoiceIdx) === q.correctAnswer;

    // Status colors
    const primaryBorderColor = isCorrect ? '0B532C' : isUnanswered ? 'D97706' : 'DC2626';
    const cardBgFill = isCorrect ? 'F7FDF9' : isUnanswered ? 'FFFDF5' : 'FFF8F8';
    const statusTextColor = isCorrect ? '0B532C' : isUnanswered ? 'B45309' : 'DC2626';
    const statusTextLabel = isCorrect
      ? '✓ CORRECT — 1 MARK'
      : isUnanswered
      ? '⚠ UNANSWERED — 0 MARKS'
      : '✗ INCORRECT — 0 MARKS';

    const candidateAnswerText = resolveAnswerString(q.options, candidateChoiceIdx, q.isTrueFalse);
    const correctAnswerText = resolveAnswerString(q.options, q.correctAnswer, q.isTrueFalse);

    // Option paragraphs (each on a clean separate line)
    const optionParagraphs: Paragraph[] = [];
    if (q.isTrueFalse) {
      optionParagraphs.push(
        new Paragraph({
          keepNext: true,
          spacing: { before: 20, after: 30 },
          children: [
            new TextRun({ text: 'A. ', bold: true, size: 20, color: '475569' }),
            new TextRun({ text: 'True', size: 20, color: '1E293B' })
          ]
        }),
        new Paragraph({
          keepNext: true,
          spacing: { before: 20, after: 30 },
          children: [
            new TextRun({ text: 'B. ', bold: true, size: 20, color: '475569' }),
            new TextRun({ text: 'False', size: 20, color: '1E293B' })
          ]
        })
      );
    } else if (q.options && q.options.length > 0) {
      q.options.forEach((opt, oIdx) => {
        const letter = letters[oIdx] || String(oIdx + 1);
        optionParagraphs.push(
          new Paragraph({
            keepNext: true,
            spacing: { before: 20, after: 30 },
            children: [
              new TextRun({ text: `${letter}. `, bold: true, size: 20, color: '475569' }),
              new TextRun({ text: opt || '', size: 20, color: '1E293B' })
            ]
          })
        );
      });
    }

    // Question Block as an isolated Table with cantSplit: true
    const questionCard = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
        bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
        left: { style: BorderStyle.SINGLE, size: 24, color: primaryBorderColor }, // 3pt bold accent bar
        right: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
        insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'auto' },
        insideVertical: { style: BorderStyle.NONE, size: 0, color: 'auto' }
      },
      rows: [
        new TableRow({
          cantSplit: true,
          children: [
            new TableCell({
              width: { size: 100, type: WidthType.PERCENTAGE },
              shading: { fill: cardBgFill },
              margins: { top: 120, bottom: 120, left: 160, right: 160 },
              children: [
                // Header Line
                new Paragraph({
                  keepNext: true,
                  spacing: { before: 0, after: 50 },
                  children: [
                    new TextRun({
                      text: `QUESTION ${idx + 1}`,
                      bold: true,
                      size: 21,
                      color: '0B532C'
                    }),
                    new TextRun({
                      text: `   •   [ ${statusTextLabel} ]`,
                      bold: true,
                      size: 19,
                      color: statusTextColor
                    })
                  ]
                }),

                // Question Text
                new Paragraph({
                  keepNext: true,
                  spacing: { before: 20, after: 90 },
                  children: [
                    new TextRun({
                      text: q.questionText,
                      bold: true,
                      size: 21, // 10.5pt
                      color: '0F172A'
                    })
                  ]
                }),

                // Options List (every option on its own line)
                ...optionParagraphs,

                // Subtle inner separator
                new Paragraph({
                  keepNext: true,
                  spacing: { before: 60, after: 60 },
                  border: {
                    bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' }
                  }
                }),

                // Candidate's Selected Answer
                new Paragraph({
                  keepNext: true,
                  spacing: { before: 20, after: 30 },
                  children: [
                    new TextRun({
                      text: "CANDIDATE'S ANSWER: ",
                      bold: true,
                      size: 20,
                      color: '1E293B'
                    }),
                    new TextRun({
                      text: candidateAnswerText,
                      bold: true,
                      size: 20,
                      color: statusTextColor
                    })
                  ]
                }),

                // Official Correct Answer
                new Paragraph({
                  keepNext: true,
                  spacing: { before: 20, after: 30 },
                  children: [
                    new TextRun({
                      text: 'CORRECT ANSWER: ',
                      bold: true,
                      size: 20,
                      color: '1E293B'
                    }),
                    new TextRun({
                      text: correctAnswerText,
                      bold: true,
                      size: 20,
                      color: '0B532C'
                    })
                  ]
                }),

                // Marking Status & Awarded Marks
                new Paragraph({
                  spacing: { before: 20, after: 0 },
                  children: [
                    new TextRun({
                      text: 'STATUS: ',
                      bold: true,
                      size: 20,
                      color: '1E293B'
                    }),
                    new TextRun({
                      text: statusTextLabel,
                      bold: true,
                      size: 20,
                      color: statusTextColor
                    })
                  ]
                })
              ]
            })
          ]
        })
      ]
    });

    questionCardElements.push(questionCard);
    // Spacing between question cards
    questionCardElements.push(
      new Paragraph({
        spacing: { before: 90, after: 0 }
      })
    );
  });

  // 5. Official Lecturer's Attestation & Signature Card
  const signatureCard = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 8, color: '0B532C' },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
      left: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
      right: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'auto' }
    },
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            width: { size: 100, type: WidthType.PERCENTAGE },
            shading: { fill: 'F8FAFC' },
            margins: { top: 160, bottom: 160, left: 180, right: 180 },
            children: [
              new Paragraph({
                keepNext: true,
                spacing: { before: 0, after: 60 },
                children: [
                  new TextRun({
                    text: "LECTURER'S ATTESTATION & OFFICIAL SIGNATURE",
                    bold: true,
                    size: 21,
                    color: '0B532C'
                  })
                ]
              }),
              new Paragraph({
                keepNext: true,
                spacing: { before: 20, after: 120 },
                children: [
                  new TextRun({
                    text: 'I hereby certify that this examination script represents the authentic, tamper-evident record of the answers and score submitted by the candidate named herein, conducted under the examination regulations and standards of Sports University of Nigeria.',
                    italics: true,
                    size: 19,
                    color: '475569'
                  })
                ]
              }),
              new Paragraph({
                keepNext: true,
                spacing: { before: 100, after: 50 },
                children: [
                  new TextRun({
                    text: "LECTURER'S SIGNATURE:  __________________________________________________",
                    bold: true,
                    size: 20,
                    color: '1E293B'
                  })
                ]
              }),
              new Paragraph({
                keepNext: true,
                spacing: { before: 20, after: 40 },
                children: [
                  new TextRun({
                    text: `NAME OF EXAMINER:      ${resolvedLecturerName}`,
                    bold: true,
                    size: 20,
                    color: '0F172A'
                  })
                ]
              }),
              new Paragraph({
                keepNext: true,
                spacing: { before: 20, after: 40 },
                children: [
                  new TextRun({
                    text: `DESIGNATION:           Course Lecturer / Chief Examiner`,
                    size: 19,
                    color: '475569'
                  })
                ]
              }),
              new Paragraph({
                spacing: { before: 20, after: 0 },
                children: [
                  new TextRun({
                    text: `DATE & STAMP:          __________________________________________________`,
                    bold: true,
                    size: 20,
                    color: '1E293B'
                  })
                ]
              })
            ]
          })
        ]
      })
    ]
  });

  // Construct Full Document
  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: 'Calibri',
            size: 21,
            color: '0F172A'
          }
        }
      }
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: 11906, // A4 width (210mm) in twips
              height: 16838, // A4 height (297mm) in twips
              orientation: PageOrientation.PORTRAIT
            },
            margin: {
              top: 1000,
              bottom: 1000,
              left: 1000,
              right: 1000
            }
          }
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                spacing: { after: 120 },
                children: [
                  new TextRun({
                    text: 'SPORTS UNIVERSITY OF NIGERIA • OFFICIAL CANDIDATE EXAMINATION SCRIPT',
                    italics: true,
                    size: 16,
                    color: '789981'
                  })
                ]
              })
            ]
          })
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                tabStops: [{ type: TabStopType.RIGHT, position: 9906 }],
                children: [
                  new TextRun({
                    text: 'SPORTS UNIVERSITY OF NIGERIA • SUN CBT SYSTEM',
                    size: 16,
                    color: '64748B'
                  }),
                  new TextRun({
                    text: `\tCourse: ${exam.courseCode}  |  Page `,
                    size: 16,
                    color: '64748B'
                  }),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    size: 16,
                    color: '64748B'
                  }),
                  new TextRun({
                    text: ' of ',
                    size: 16,
                    color: '64748B'
                  }),
                  new TextRun({
                    children: [PageNumber.TOTAL_PAGES],
                    size: 16,
                    color: '64748B'
                  })
                ]
              })
            ]
          })
        },
        children: [
          // Institutional Logo & Header
          ...(logoBuffer
            ? [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { before: 0, after: 60 },
                  children: [
                    new ImageRun({
                      data: logoBuffer,
                      transformation: { width: 70, height: 70 },
                      type: 'jpg'
                    })
                  ]
                })
              ]
            : []),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 40, after: 20 },
            children: [
              new TextRun({
                text: 'SPORTS UNIVERSITY OF NIGERIA',
                bold: true,
                size: 32, // 16pt prominent
                color: '0B532C'
              })
            ]
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 0, after: 20 },
            children: [
              new TextRun({
                text: 'Idumuje-Ugboko, Delta State, Nigeria',
                italics: true,
                size: 19,
                color: '475569'
              })
            ]
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 0, after: 80 },
            children: [
              new TextRun({
                text: 'Citadel for Champions • Excellence in Sports and Academics',
                italics: true,
                size: 18,
                color: 'B8860B'
              })
            ]
          }),

          // Accent horizontal rule
          new Paragraph({
            spacing: { before: 40, after: 80 },
            border: {
              bottom: { style: BorderStyle.SINGLE, size: 8, color: '0B532C' }
            }
          }),

          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 60, after: 20 },
            children: [
              new TextRun({
                text: 'OFFICIAL CANDIDATE EXAMINATION SCRIPT',
                bold: true,
                size: 24, // 12pt
                color: '0F172A'
              })
            ]
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 0, after: 180 },
            children: [
              new TextRun({
                text: 'STUDENT PERFORMANCE AND EVALUATION REPORT',
                bold: true,
                size: 20, // 10pt
                color: '0B532C'
              })
            ]
          }),

          // 1. Candidate Information
          createSectionHeading('1. CANDIDATE INFORMATION'),
          candidateInfoTable,

          // 2. Examination Details
          createSectionHeading('2. EXAMINATION DETAILS'),
          examinationDetailsTable,

          // 3. Performance Summary
          createSectionHeading('3. PERFORMANCE SUMMARY & EVALUATION'),
          summaryMetricsTable,
          new Paragraph({ spacing: { before: 120, after: 0 } }),
          scoreBannerTable,

          // 4. Complete Candidate Question Record
          createSectionHeading('4. COMPLETE CANDIDATE QUESTION RECORD'),
          new Paragraph({
            keepNext: true,
            spacing: { before: 0, after: 120 },
            children: [
              new TextRun({
                text: "Official item-by-item question evaluation detailing the candidate's selected options, official benchmark answers, and marks awarded.",
                italics: true,
                size: 19,
                color: '64748B'
              })
            ]
          }),
          ...questionCardElements,

          // 5. Official Lecturer's Attestation & Signature
          createSectionHeading("5. OFFICIAL LECTURER'S ATTESTATION & SIGNATURE"),
          signatureCard
        ]
      }
    ]
  });

  const blob = await Packer.toBlob(doc);
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeMatric = sub.matricNumber.replace(/[^a-zA-Z0-9]/g, '_');
    a.download = `${exam.courseCode.replace(/[^a-zA-Z0-9]/g, '_')}_Script_${safeMatric}.docx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  return blob;
}

/**
 * Export a single candidate's full examination script to Excel (.xlsx)
 */
export function exportIndividualScriptToExcel(exam: Exam, sub: Submission) {
  const { grade, remark } = getGrade(sub.percentage);
  const sexValue =
    sub.gender === 'M' || sub.gender === 'Male'
      ? 'M'
      : sub.gender === 'F' || sub.gender === 'Female'
      ? 'F'
      : 'Not recorded';

  const questionsList = sub.questionSnapshot && sub.questionSnapshot.length > 0
    ? sub.questionSnapshot
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

  const letters = ['A', 'B', 'C', 'D'];

  const rows = questionsList.map((q, idx) => {
    const candidateChoiceIdx = sub.answers ? sub.answers[q.id] : undefined;
    const isUnanswered = candidateChoiceIdx === undefined || candidateChoiceIdx === null || Number(candidateChoiceIdx) < 0;
    const isCorrect = !isUnanswered && Number(candidateChoiceIdx) === q.correctAnswer;

    const candidateChoiceLabel = isUnanswered
      ? 'Unanswered'
      : q.isTrueFalse
      ? (candidateChoiceIdx === 0 ? 'True' : 'False')
      : `Option ${letters[candidateChoiceIdx] || candidateChoiceIdx + 1}${q.options && q.options[candidateChoiceIdx] ? ` (${q.options[candidateChoiceIdx]})` : ''}`;

    const correctLabel = q.isTrueFalse
      ? (q.correctAnswer === 0 ? 'True' : 'False')
      : `Option ${letters[q.correctAnswer] || q.correctAnswer + 1}${q.options && q.options[q.correctAnswer] ? ` (${q.options[q.correctAnswer]})` : ''}`;

    return {
      'Q#': idx + 1,
      'Question Text': q.questionText,
      'Options Presented': q.isTrueFalse ? 'True | False' : (q.options || []).join(' | '),
      'Candidate Selected Answer': candidateChoiceLabel,
      'Official Correct Answer': correctLabel,
      'Outcome': isCorrect ? 'Correct' : isUnanswered ? 'Unanswered' : 'Incorrect',
      'Marks Awarded': isCorrect ? 1 : 0
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet['!cols'] = [
    { wch: 6 },
    { wch: 45 },
    { wch: 40 },
    { wch: 25 },
    { wch: 25 },
    { wch: 14 },
    { wch: 14 }
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Candidate Script');

  const safeMatric = sub.matricNumber.replace(/[^a-zA-Z0-9]/g, '_');
  const filename = `${exam.courseCode.replace(/[^a-zA-Z0-9]/g, '_')}_Script_${safeMatric}.xlsx`;
  XLSX.writeFile(workbook, filename);
}

/**
 * Export official Examination Attendance Register to Excel (.xlsx)
 */
export function exportAttendanceToExcel(
  exam: { courseCode: string; courseTitle: string; lecturerName?: string; startDate?: string },
  attendanceRecords: AttendanceRecord[]
) {
  const rows = attendanceRecords.map((rec, idx) => {
    const sexValue =
      rec.gender === 'M' || rec.gender === 'Male'
        ? 'M'
        : rec.gender === 'F' || rec.gender === 'Female'
        ? 'F'
        : 'Not recorded';

    const attendanceStatusLabel =
      rec.status === 'signed_out'
        ? 'Signed Out'
        : rec.status === 'signed_in'
        ? 'Signed In (In Examination)'
        : 'Absent / Not Started';

    const submissionStatusLabel =
      rec.submissionStatus === 'submitted'
        ? 'Submitted'
        : rec.submissionStatus === 'in_progress'
        ? 'In Progress'
        : 'Not Started';

    return {
      'S/N': idx + 1,
      'Matriculation Number': rec.matricNumber,
      'Student Full Name': capitalizeProper(rec.fullName),
      'Department': capitalizeProper(rec.department),
      'Sex': sexValue,
      'Attendance Status': attendanceStatusLabel,
      'Sign-In Time': rec.signInTime ? `${formatLagosTime(rec.signInTime)} (WAT)` : 'Not Signed In',
      'Sign-In Date': rec.signInTime ? formatLagosDate(rec.signInTime) : '—',
      'Sign-Out Time': rec.signOutTime ? `${formatLagosTime(rec.signOutTime)} (WAT)` : 'Not Signed Out',
      'Sign-Out Date': rec.signOutTime ? formatLagosDate(rec.signOutTime) : '—',
      'CBT Submission Status': submissionStatusLabel,
      'Submission Receipt ID': rec.submissionReceipt || '—',
      'Signed In By (Examiner)': rec.signedInBy || '—',
      'Signed Out By (Examiner)': rec.signedOutBy || '—'
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet['!cols'] = [
    { wch: 6 },  // S/N
    { wch: 20 }, // Matric
    { wch: 32 }, // Name
    { wch: 30 }, // Dept
    { wch: 10 }, // Sex
    { wch: 24 }, // Attendance Status
    { wch: 18 }, // Sign In Time
    { wch: 16 }, // Sign In Date
    { wch: 18 }, // Sign Out Time
    { wch: 16 }, // Sign Out Date
    { wch: 20 }, // CBT Status
    { wch: 24 }, // Receipt
    { wch: 26 }, // Signed In By
    { wch: 26 }  // Signed Out By
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Attendance Register');

  const cleanCode = (exam.courseCode || 'Exam').replace(/[^a-zA-Z0-9]/g, '_');
  const filename = `${cleanCode}_Attendance_Register_${new Date().toISOString().split('T')[0]}.xlsx`;
  XLSX.writeFile(workbook, filename);
}

/**
 * Export official Examination Attendance Register to Word (.docx)
 */
export async function exportAttendanceToWord(
  exam: { courseCode: string; courseTitle: string; lecturerName?: string; startDate?: string; endDate?: string },
  attendanceRecords: AttendanceRecord[],
  summary: {
    totalRegistered: number;
    totalSignedIn: number;
    totalSignedOut: number;
    totalCurrentlyInHall: number;
    totalAbsent: number;
    totalSubmitted?: number;
  }
) {
  let logoBuffer: ArrayBuffer | null = null;
  try {
    if (typeof window !== 'undefined' && window.location) {
      const response = await fetch('/assets/aistudio/IMG-20261104-WA0018_41e50466.jpg');
      if (response.ok) {
        logoBuffer = await response.arrayBuffer();
      }
    }
  } catch (err) {
    console.warn('Could not load logo for attendance Word document:', err);
  }

  const resolvedLecturerName =
    exam.lecturerName && exam.lecturerName.trim() && exam.lecturerName.trim().toLowerCase() !== 'not specified'
      ? exam.lecturerName.trim()
      : '[Institutional Course Examiner / Departmental Assessor]';

  // 1. Examination Details Table
  const examDetailsTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 6, color: '0B532C' },
      bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CBD5E1' },
      left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'auto' }
    },
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            width: { size: 30, type: WidthType.PERCENTAGE },
            shading: { fill: 'F8FAFC' },
            margins: { top: 90, bottom: 90, left: 140, right: 140 },
            children: [new Paragraph({ children: [new TextRun({ text: 'Course Code & Title', bold: true, size: 20 })] })]
          }),
          new TableCell({
            width: { size: 70, type: WidthType.PERCENTAGE },
            margins: { top: 90, bottom: 90, left: 140, right: 140 },
            children: [new Paragraph({ children: [new TextRun({ text: `${exam.courseCode} — ${exam.courseTitle}`, bold: true, size: 20, color: '0B532C' })] })]
          })
        ]
      }),
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            width: { size: 30, type: WidthType.PERCENTAGE },
            shading: { fill: 'F8FAFC' },
            margins: { top: 90, bottom: 90, left: 140, right: 140 },
            children: [new Paragraph({ children: [new TextRun({ text: 'Course Examiner / Invigilator', bold: true, size: 20 })] })]
          }),
          new TableCell({
            width: { size: 70, type: WidthType.PERCENTAGE },
            margins: { top: 90, bottom: 90, left: 140, right: 140 },
            children: [new Paragraph({ children: [new TextRun({ text: resolvedLecturerName, size: 20 })] })]
          })
        ]
      }),
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            width: { size: 30, type: WidthType.PERCENTAGE },
            shading: { fill: 'F8FAFC' },
            margins: { top: 90, bottom: 90, left: 140, right: 140 },
            children: [new Paragraph({ children: [new TextRun({ text: 'Examination Date & Window', bold: true, size: 20 })] })]
          }),
          new TableCell({
            width: { size: 70, type: WidthType.PERCENTAGE },
            margins: { top: 90, bottom: 90, left: 140, right: 140 },
            children: [new Paragraph({ children: [new TextRun({ text: exam.startDate ? `${formatLagosDate(exam.startDate)} • ${formatLagosTime(exam.startDate)} – ${exam.endDate ? formatLagosTime(exam.endDate) : ''} (WAT)` : 'As Scheduled', size: 20 })] })]
          })
        ]
      })
    ]
  });

  // 2. Summary Statistics Table
  const statsTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 6, color: '0B532C' },
      bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CBD5E1' },
      left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'auto' }
    },
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            width: { size: 20, type: WidthType.PERCENTAGE },
            shading: { fill: '0B532C' },
            margins: { top: 100, bottom: 100, left: 100, right: 100 },
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'TOTAL REGISTERED', bold: true, size: 18, color: 'FFFFFF' })] })]
          }),
          new TableCell({
            width: { size: 20, type: WidthType.PERCENTAGE },
            shading: { fill: '0B532C' },
            margins: { top: 100, bottom: 100, left: 100, right: 100 },
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'TOTAL SIGNED IN', bold: true, size: 18, color: 'FFFFFF' })] })]
          }),
          new TableCell({
            width: { size: 20, type: WidthType.PERCENTAGE },
            shading: { fill: '0B532C' },
            margins: { top: 100, bottom: 100, left: 100, right: 100 },
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'TOTAL SIGNED OUT', bold: true, size: 18, color: 'FFFFFF' })] })]
          }),
          new TableCell({
            width: { size: 20, type: WidthType.PERCENTAGE },
            shading: { fill: '0B532C' },
            margins: { top: 100, bottom: 100, left: 100, right: 100 },
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'IN EXAMINATION', bold: true, size: 18, color: 'FFFFFF' })] })]
          }),
          new TableCell({
            width: { size: 20, type: WidthType.PERCENTAGE },
            shading: { fill: '0B532C' },
            margins: { top: 100, bottom: 100, left: 100, right: 100 },
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'NOT STARTED', bold: true, size: 18, color: 'FFFFFF' })] })]
          })
        ]
      }),
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            width: { size: 20, type: WidthType.PERCENTAGE },
            margins: { top: 100, bottom: 100, left: 100, right: 100 },
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `${summary.totalRegistered}`, bold: true, size: 24, color: '0F172A' })] })]
          }),
          new TableCell({
            width: { size: 20, type: WidthType.PERCENTAGE },
            shading: { fill: 'F0FDF4' },
            margins: { top: 100, bottom: 100, left: 100, right: 100 },
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `${summary.totalSignedIn}`, bold: true, size: 24, color: '0B532C' })] })]
          }),
          new TableCell({
            width: { size: 20, type: WidthType.PERCENTAGE },
            shading: { fill: 'EFF6FF' },
            margins: { top: 100, bottom: 100, left: 100, right: 100 },
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `${summary.totalSignedOut}`, bold: true, size: 24, color: '1D4ED8' })] })]
          }),
          new TableCell({
            width: { size: 20, type: WidthType.PERCENTAGE },
            shading: { fill: 'F8FAFC' },
            margins: { top: 100, bottom: 100, left: 100, right: 100 },
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `${summary.totalCurrentlyInHall}`, bold: true, size: 24, color: '0F172A' })] })]
          }),
          new TableCell({
            width: { size: 20, type: WidthType.PERCENTAGE },
            shading: { fill: 'FFFDF5' },
            margins: { top: 100, bottom: 100, left: 100, right: 100 },
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `${summary.totalAbsent}`, bold: true, size: 24, color: 'B45309' })] })]
          })
        ]
      })
    ]
  });

  // 3. Full Student Attendance Table
  const tableHeaders = [
    { text: 'S/N', width: 6 },
    { text: 'Matric Number', width: 17 },
    { text: "Candidate's Full Name", width: 25 },
    { text: 'Department', width: 20 },
    { text: 'Sex', width: 6 },
    { text: 'Sign-In Time', width: 13 },
    { text: 'Sign-Out Time', width: 13 }
  ];

  const attendanceTableRows: TableRow[] = [
    // Header
    new TableRow({
      cantSplit: true,
      children: tableHeaders.map((h) => (
        new TableCell({
          width: { size: h.width, type: WidthType.PERCENTAGE },
          shading: { fill: '0B532C' },
          margins: { top: 90, bottom: 90, left: 80, right: 80 },
          children: [
            new Paragraph({
              alignment: h.text === 'S/N' || h.text === 'Sex' ? AlignmentType.CENTER : AlignmentType.LEFT,
              children: [new TextRun({ text: h.text, bold: true, size: 18, color: 'FFFFFF' })]
            })
          ]
        })
      ))
    }),
    // Student Rows
    ...attendanceRecords.map((rec, idx) => {
      const isAlt = idx % 2 === 1;
      const sexValue =
        rec.gender === 'M' || rec.gender === 'Male'
          ? 'M'
          : rec.gender === 'F' || rec.gender === 'Female'
          ? 'F'
          : '—';

      const signInDisplay = rec.signInTime ? formatLagosTime(rec.signInTime) : 'Absent';
      const signOutDisplay = rec.signOutTime ? formatLagosTime(rec.signOutTime) : '—';

      return new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            width: { size: 6, type: WidthType.PERCENTAGE },
            shading: { fill: isAlt ? 'F8FAFC' : 'FFFFFF' },
            margins: { top: 70, bottom: 70, left: 60, right: 60 },
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `${idx + 1}`, size: 18 })] })]
          }),
          new TableCell({
            width: { size: 17, type: WidthType.PERCENTAGE },
            shading: { fill: isAlt ? 'F8FAFC' : 'FFFFFF' },
            margins: { top: 70, bottom: 70, left: 80, right: 80 },
            children: [new Paragraph({ children: [new TextRun({ text: rec.matricNumber, bold: true, size: 18, color: '0B532C' })] })]
          }),
          new TableCell({
            width: { size: 25, type: WidthType.PERCENTAGE },
            shading: { fill: isAlt ? 'F8FAFC' : 'FFFFFF' },
            margins: { top: 70, bottom: 70, left: 80, right: 80 },
            children: [new Paragraph({ children: [new TextRun({ text: capitalizeProper(rec.fullName), size: 18 })] })]
          }),
          new TableCell({
            width: { size: 20, type: WidthType.PERCENTAGE },
            shading: { fill: isAlt ? 'F8FAFC' : 'FFFFFF' },
            margins: { top: 70, bottom: 70, left: 80, right: 80 },
            children: [new Paragraph({ children: [new TextRun({ text: capitalizeProper(rec.department), size: 18 })] })]
          }),
          new TableCell({
            width: { size: 6, type: WidthType.PERCENTAGE },
            shading: { fill: isAlt ? 'F8FAFC' : 'FFFFFF' },
            margins: { top: 70, bottom: 70, left: 60, right: 60 },
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: sexValue, size: 18 })] })]
          }),
          new TableCell({
            width: { size: 13, type: WidthType.PERCENTAGE },
            shading: { fill: isAlt ? 'F8FAFC' : 'FFFFFF' },
            margins: { top: 70, bottom: 70, left: 80, right: 80 },
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: signInDisplay,
                    bold: rec.signInTime !== null,
                    size: 18,
                    color: rec.signInTime ? '0B532C' : '94A3B8'
                  })
                ]
              })
            ]
          }),
          new TableCell({
            width: { size: 13, type: WidthType.PERCENTAGE },
            shading: { fill: isAlt ? 'F8FAFC' : 'FFFFFF' },
            margins: { top: 70, bottom: 70, left: 80, right: 80 },
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: signOutDisplay,
                    bold: rec.signOutTime !== null,
                    size: 18,
                    color: rec.signOutTime ? '1D4ED8' : '94A3B8'
                  })
                ]
              })
            ]
          })
        ]
      });
    })
  ];

  const attendanceRegisterTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 6, color: '0B532C' },
      bottom: { style: BorderStyle.SINGLE, size: 6, color: '0B532C' },
      left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'auto' }
    },
    rows: attendanceTableRows
  });

  // 4. Attestation & Signature Block
  const signatureCard = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 6, color: '0B532C' },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
      left: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
      right: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'auto' }
    },
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            width: { size: 100, type: WidthType.PERCENTAGE },
            shading: { fill: 'F8FAFC' },
            margins: { top: 140, bottom: 140, left: 160, right: 160 },
            children: [
              new Paragraph({
                keepNext: true,
                spacing: { before: 0, after: 40 },
                children: [
                  new TextRun({
                    text: 'CHIEF INVIGILATOR / COURSE EXAMINER ATTESTATION',
                    bold: true,
                    size: 20,
                    color: '0B532C'
                  })
                ]
              }),
              new Paragraph({
                keepNext: true,
                spacing: { before: 20, after: 100 },
                children: [
                  new TextRun({
                    text: 'I hereby attest and certify that this Attendance Register is the complete, true and accurate record of all student online CBT examination sign-ins and automatic sign-outs recorded during the conduct of this examination at Sports University of Nigeria.',
                    italics: true,
                    size: 18,
                    color: '475569'
                  })
                ]
              }),
              new Paragraph({
                keepNext: true,
                spacing: { before: 80, after: 40 },
                children: [
                  new TextRun({
                    text: "INVIGILATOR'S SIGNATURE:  __________________________________________________",
                    bold: true,
                    size: 20,
                    color: '1E293B'
                  })
                ]
              }),
              new Paragraph({
                keepNext: true,
                spacing: { before: 20, after: 40 },
                children: [
                  new TextRun({
                    text: `NAME OF EXAMINER:        ${resolvedLecturerName}`,
                    bold: true,
                    size: 20,
                    color: '0F172A'
                  })
                ]
              }),
              new Paragraph({
                spacing: { before: 20, after: 0 },
                children: [
                  new TextRun({
                    text: `DATE & HALL STAMP:       __________________________________________________`,
                    bold: true,
                    size: 20,
                    color: '1E293B'
                  })
                ]
              })
            ]
          })
        ]
      })
    ]
  });

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: 'Calibri',
            size: 20,
            color: '0F172A'
          }
        }
      }
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: 11906,
              height: 16838,
              orientation: PageOrientation.PORTRAIT
            },
            margin: {
              top: 1000,
              bottom: 1000,
              left: 1000,
              right: 1000
            }
          }
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                spacing: { after: 120 },
                children: [
                  new TextRun({
                    text: 'SPORTS UNIVERSITY OF NIGERIA • OFFICIAL EXAMINATION ATTENDANCE REGISTER',
                    italics: true,
                    size: 16,
                    color: '789981'
                  })
                ]
              })
            ]
          })
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                tabStops: [{ type: TabStopType.RIGHT, position: 9906 }],
                children: [
                  new TextRun({
                    text: 'SPORTS UNIVERSITY OF NIGERIA • SUN CBT EXAMINATION SYSTEM',
                    size: 16,
                    color: '64748B'
                  }),
                  new TextRun({
                    text: `\tCourse: ${exam.courseCode}  |  Page `,
                    size: 16,
                    color: '64748B'
                  }),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    size: 16,
                    color: '64748B'
                  }),
                  new TextRun({
                    text: ' of ',
                    size: 16,
                    color: '64748B'
                  }),
                  new TextRun({
                    children: [PageNumber.TOTAL_PAGES],
                    size: 16,
                    color: '64748B'
                  })
                ]
              })
            ]
          })
        },
        children: [
          // Header Logo & Institution
          ...(logoBuffer
            ? [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { before: 0, after: 60 },
                  children: [
                    new ImageRun({
                      data: logoBuffer,
                      transformation: { width: 70, height: 70 },
                      type: 'jpg'
                    })
                  ]
                })
              ]
            : []),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 40, after: 20 },
            children: [
              new TextRun({
                text: 'SPORTS UNIVERSITY OF NIGERIA',
                bold: true,
                size: 32,
                color: '0B532C'
              })
            ]
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 0, after: 20 },
            children: [
              new TextRun({
                text: 'Idumuje-Ugboko, Delta State, Nigeria',
                italics: true,
                size: 19,
                color: '475569'
              })
            ]
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 0, after: 80 },
            children: [
              new TextRun({
                text: 'Citadel for Champions • Excellence in Sports and Academics',
                italics: true,
                size: 18,
                color: 'B8860B'
              })
            ]
          }),
          new Paragraph({
            spacing: { before: 40, after: 80 },
            border: {
              bottom: { style: BorderStyle.SINGLE, size: 8, color: '0B532C' }
            }
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 60, after: 20 },
            children: [
              new TextRun({
                text: 'OFFICIAL EXAMINATION ATTENDANCE REGISTER',
                bold: true,
                size: 24,
                color: '0F172A'
              })
            ]
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 0, after: 180 },
            children: [
              new TextRun({
                text: 'PHYSICAL CANDIDATE VERIFICATION & HALL MONITORING REPORT',
                bold: true,
                size: 20,
                color: '0B532C'
              })
            ]
          }),

          // Exam details
          new Paragraph({
            heading: HeadingLevel.HEADING_3,
            keepNext: true,
            spacing: { before: 180, after: 80 },
            children: [new TextRun({ text: '1. EXAMINATION DETAILS', bold: true, size: 21, color: '0B532C' })]
          }),
          examDetailsTable,

          // Summary Statistics
          new Paragraph({
            heading: HeadingLevel.HEADING_3,
            keepNext: true,
            spacing: { before: 200, after: 80 },
            children: [new TextRun({ text: '2. ATTENDANCE SUMMARY STATISTICS', bold: true, size: 21, color: '0B532C' })]
          }),
          statsTable,

          // Student Attendance Register
          new Paragraph({
            heading: HeadingLevel.HEADING_3,
            keepNext: true,
            spacing: { before: 240, after: 80 },
            children: [new TextRun({ text: '3. STUDENT ATTENDANCE REGISTER', bold: true, size: 21, color: '0B532C' })]
          }),
          attendanceRegisterTable,

          // Attestation & Signature
          new Paragraph({
            heading: HeadingLevel.HEADING_3,
            keepNext: true,
            spacing: { before: 240, after: 80 },
            children: [new TextRun({ text: '4. OFFICIAL ATTESTATION & SIGNATURE', bold: true, size: 21, color: '0B532C' })]
          }),
          signatureCard
        ]
      }
    ]
  });

  const blob = await Packer.toBlob(doc);
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const cleanCode = (exam.courseCode || 'Exam').replace(/[^a-zA-Z0-9]/g, '_');
    a.download = `${cleanCode}_Attendance_Register_${new Date().toISOString().split('T')[0]}.docx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  return blob;
}
