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
  ImageRun,
  HeadingLevel
} from 'docx';
import { Submission, Exam } from '../types';

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
    return {
      'S/N': index + 1,
      'Matriculation Number': sub.matricNumber,
      'Full Name': sub.fullName,
      'Department': sub.department,
      'Course Code': exam.courseCode,
      'Course Title': exam.courseTitle,
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
        width: { size: 6, type: WidthType.PERCENTAGE }
      }),
      new TableCell({
        shading: { fill: '0B532C' },
        children: [new Paragraph({ children: [new TextRun({ text: 'Matric No.', bold: true, color: 'FFFFFF' })] })],
        width: { size: 20, type: WidthType.PERCENTAGE }
      }),
      new TableCell({
        shading: { fill: '0B532C' },
        children: [new Paragraph({ children: [new TextRun({ text: 'Student Name', bold: true, color: 'FFFFFF' })] })],
        width: { size: 28, type: WidthType.PERCENTAGE }
      }),
      new TableCell({
        shading: { fill: '0B532C' },
        children: [new Paragraph({ children: [new TextRun({ text: 'Department', bold: true, color: 'FFFFFF' })] })],
        width: { size: 24, type: WidthType.PERCENTAGE }
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
          children: [new Paragraph({ text: sub.fullName })]
        }),
        new TableCell({
          shading: { fill: bg },
          children: [new Paragraph({ text: sub.department })]
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
              new TextRun({ text: 'Department: ', bold: true }),
              new TextRun({ text: `${exam.department}    |    ` }),
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
                text: '____________________________                                        ____________________________',
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
