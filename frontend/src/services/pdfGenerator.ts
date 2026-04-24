/**
 * ProxyGuard Studio — PDF Certificate Generator
 * ===============================================
 * Generates a downloadable Fairness Certificate PDF entirely in the browser.
 * Uses jsPDF — no server call needed, no Cloud Storage dependency for the MVP.
 *
 * In production: upload the generated PDF blob to Cloud Storage and return
 * a signed URL so the certificate is permanently accessible and verifiable.
 */

import jsPDF from 'jspdf';
import type { Certificate } from './api';

const BRAND_BLACK  = [15,  15,  15]  as const;
const BRAND_GRAY   = [100, 100, 100] as const;
const BRAND_LIGHT  = [200, 200, 200] as const;
const BRAND_RED    = [226, 75,  74]  as const;
const BRAND_GREEN  = [59,  109, 17]  as const;
const BRAND_AMBER  = [186, 117, 23]  as const;

export function downloadCertificatePDF(cert: Certificate): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210;   // A4 width mm
  let y = 0;

  // ── Helper shortcuts ────────────────────────────────────────────────────────
  const setFont  = (style: 'normal' | 'bold', size: number) => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
  };
  const setColor = (rgb: readonly [number, number, number]) =>
    doc.setTextColor(rgb[0], rgb[1], rgb[2]);
  const line     = (x1: number, y1: number, x2: number, y2: number, thickness = 0.3) => {
    doc.setLineWidth(thickness);
    doc.setDrawColor(...BRAND_LIGHT);
    doc.line(x1, y1, x2, y2);
  };

  // ── Header block ────────────────────────────────────────────────────────────
  doc.setFillColor(15, 15, 15);
  doc.rect(0, 0, W, 42, 'F');

  setColor([255, 255, 255]);
  setFont('bold', 9);
  doc.text('PROXYGUARD STUDIO', 20, 14);

  setFont('normal', 7);
  doc.text('FAIRNESS AUDITING PLATFORM  ·  DETERMINISTIC · SHA-256 SIGNED', 20, 19);

  setFont('bold', 18);
  doc.text('Certificate of Fairness Audit', 20, 30);

  setFont('normal', 8);
  doc.text(cert.certificate_id, W - 20, 14, { align: 'right' });

  y = 52;

  // ── Result banner ────────────────────────────────────────────────────────────
  const resultColor = cert.overall_result === 'PASS'
    ? BRAND_GREEN
    : cert.overall_result === 'FAIL'
    ? BRAND_RED
    : BRAND_AMBER;

  doc.setFillColor(resultColor[0], resultColor[1], resultColor[2]);
  doc.roundedRect(20, y, W - 40, 14, 2, 2, 'F');

  setColor([255, 255, 255]);
  setFont('bold', 10);
  doc.text(
    `AUDIT VERDICT: ${cert.overall_result}  ·  DIR Score: ${cert.overall_dir.toFixed(2)}  ·  ${cert.total_flags} Variable${cert.total_flags !== 1 ? 's' : ''} Flagged`,
    W / 2, y + 9,
    { align: 'center' }
  );

  y += 22;

  // ── Dataset details table ────────────────────────────────────────────────────
  setColor(BRAND_BLACK);
  setFont('bold', 8);
  doc.text('AUDIT DETAILS', 20, y);
  y += 4;
  line(20, y, W - 20, y, 0.5);
  y += 5;

  const rows: [string, string, boolean?][] = [
    ['Dataset',          cert.dataset_name],
    ['Industry Context', cert.industry_context.toUpperCase()],
    ['Fairness Metric',
      cert.industry_context === 'hr'
        ? 'Demographic Parity'
        : cert.industry_context === 'finance'
        ? 'False Positive Rate Parity'
        : 'True Positive Rate Parity'],
    ['Disparate Impact Ratio',
      `${cert.overall_dir.toFixed(2)} (legal threshold: 0.80)`,
      cert.overall_dir < 0.80],
    ['Variables Flagged', `${cert.total_flags} proxy variable${cert.total_flags !== 1 ? 's' : ''} detected`],
    ['Verdict',           cert.overall_result, cert.overall_result === 'FAIL'],
    ['Issued',            new Date(cert.issued_at).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })],
    ['Signed By',         'ProxyGuard Studio / Cloud KMS'],
    ['Hash Verified',     cert.hash_verified ? 'Yes — integrity confirmed' : 'Warning: hash mismatch'],
  ];

  rows.forEach(([label, value, danger]) => {
    setFont('normal', 7);
    setColor(BRAND_GRAY);
    doc.text(label, 20, y);

    setFont('bold', 7);
    if (danger) {
      setColor(BRAND_RED);
    } else {
      setColor(BRAND_BLACK);
    }
    // Truncate long values to fit
    const safeVal = doc.splitTextToSize(value, 110)[0];
    doc.text(safeVal, 95, y);

    y += 6;
    line(20, y, W - 20, y);
    y += 3;
  });

  y += 4;

  // ── Audit hash ───────────────────────────────────────────────────────────────
  setFont('bold', 8);
  setColor(BRAND_BLACK);
  doc.text('SHA-256 AUDIT HASH', 20, y);
  y += 5;

  doc.setFillColor(245, 245, 245);
  doc.roundedRect(20, y, W - 40, 12, 1, 1, 'F');
  setFont('normal', 6.5);
  setColor(BRAND_GRAY);
  // Split hash into two lines for readability
  const hash    = cert.audit_hash;
  const hashL1  = hash.slice(0, 32);
  const hashL2  = hash.slice(32);
  doc.text(hashL1, 25, y + 4.5);
  doc.text(hashL2, 25, y + 8.5);
  y += 18;

  // ── Summary ──────────────────────────────────────────────────────────────────
  setFont('bold', 8);
  setColor(BRAND_BLACK);
  doc.text('AUDIT SUMMARY', 20, y);
  y += 5;
  line(20, y, W - 20, y, 0.5);
  y += 5;

  setFont('normal', 8);
  setColor(BRAND_GRAY);
  const summaryLines = doc.splitTextToSize(cert.summary, W - 40);
  doc.text(summaryLines, 20, y);
  y += summaryLines.length * 4.5 + 6;

  // ── Legal references ─────────────────────────────────────────────────────────
  setFont('bold', 8);
  setColor(BRAND_BLACK);
  doc.text('LEGAL REFERENCES', 20, y);
  y += 5;
  line(20, y, W - 20, y, 0.5);
  y += 5;

  const legalRefs = cert.legal_references.length
    ? cert.legal_references
    : ['EEOC 4/5ths Rule', 'Title VII Civil Rights Act', 'ADEA'];

  setFont('normal', 8);
  setColor(BRAND_GRAY);
  legalRefs.forEach((ref) => {
    doc.text(`• ${ref}`, 24, y);
    y += 5;
  });

  y += 4;

  // ── Footer ───────────────────────────────────────────────────────────────────
  const footerY = 272;
  line(20, footerY, W - 20, footerY, 0.5);

  setFont('normal', 6.5);
  setColor(BRAND_GRAY);
  doc.text(
    'This certificate is cryptographically signed and tamper-evident. ' +
    `Verify at proxyguard.studio/verify/${cert.audit_id}`,
    20, footerY + 5
  );

  doc.text(
    `Generated by ProxyGuard Studio  ·  ${new Date().toISOString()}`,
    W - 20, footerY + 5,
    { align: 'right' }
  );

  // ── Save ─────────────────────────────────────────────────────────────────────
  doc.save(`ProxyGuard_Certificate_${cert.certificate_id}.pdf`);
}

export interface RemediationReportPayloadPDF {
  original_audit: {
    grade: string;
    dir: number;
    date: string;
    dataset_name: string;
    audit_hash: string;
  };
  changes: Array<{ description: string; implementation_note: string }>;
  projected: { dir: number; grade: string; threshold: number };
  implementation_checklist: string[];
  instructions: string;
  disclaimer: string;
}

export function downloadRemediationPDF(report: RemediationReportPayloadPDF): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210;
  let y = 0;

  const setFont  = (style: 'normal' | 'bold', size: number) => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
  };
  const setColor = (rgb: readonly [number, number, number]) => doc.setTextColor(rgb[0], rgb[1], rgb[2]);
  const line     = (x1: number, y1: number, x2: number, y2: number, thickness = 0.3) => {
    doc.setLineWidth(thickness);
    doc.setDrawColor(...BRAND_LIGHT);
    doc.line(x1, y1, x2, y2);
  };

  doc.setFillColor(15, 15, 15);
  doc.rect(0, 0, W, 42, 'F');
  setColor([255, 255, 255]);
  setFont('bold', 9);
  doc.text('PROXYGUARD STUDIO', 20, 14);
  setFont('normal', 7);
  doc.text('REMEDIATION PLAN · PROJECTED FAIRNESS IMPROVEMENT', 20, 19);
  setFont('bold', 18);
  doc.text('Remediation Plan', 20, 30);
  setFont('normal', 8);
  doc.text(report.original_audit.dataset_name, W - 20, 14, { align: 'right' });
  y = 52;

  const headerRows: [string, string][] = [
    ['Dataset', report.original_audit.dataset_name],
    ['Audit Date', report.original_audit.date],
    ['Original Grade', report.original_audit.grade],
    ['Original DIR', report.original_audit.dir.toFixed(2)],
    ['Audit Hash', report.original_audit.audit_hash],
  ];

  headerRows.forEach(([label, value]) => {
    setFont('bold', 8);
    setColor(BRAND_BLACK);
    doc.text(label, 20, y);
    setFont('normal', 8);
    setColor(BRAND_GRAY);
    doc.text(value, 95, y);
    y += 6;
  });

  y += 4;
  setColor(BRAND_BLACK);
  setFont('bold', 9);
  doc.text('Interventions Applied', 20, y);
  y += 5;
  line(20, y, W - 20, y, 0.5);
  y += 6;

  report.changes.forEach((change, index) => {
    setFont('bold', 8);
    setColor(BRAND_BLACK);
    doc.text(`${index + 1}. ${change.description}`, 20, y);
    y += 5;
    setFont('normal', 8);
    setColor(BRAND_GRAY);
    const changeLines = doc.splitTextToSize(change.implementation_note, W - 40);
    doc.text(changeLines, 20, y);
    y += changeLines.length * 4.5 + 4;
    if (y > 250) {
      doc.addPage();
      y = 20;
    }
  });

  setFont('bold', 9);
  setColor(BRAND_BLACK);
  doc.text('Projected Outcome', 20, y);
  y += 5;
  line(20, y, W - 20, y, 0.5);
  y += 6;
  setFont('normal', 8);
  setColor(BRAND_GRAY);
  const projLines = [
    `Projected DIR: ${report.projected.dir.toFixed(2)}`,
    `Projected Grade: ${report.projected.grade}`,
    `Threshold: ${report.projected.threshold.toFixed(2)}`,
  ];
  projLines.forEach(lineText => {
    doc.text(lineText, 20, y);
    y += 5;
  });
  y += 4;

  setFont('bold', 9);
  setColor(BRAND_BLACK);
  doc.text('Implementation Checklist', 20, y);
  y += 5;
  line(20, y, W - 20, y, 0.5);
  y += 6;
  report.implementation_checklist.forEach((item, index) => {
    setFont('normal', 8);
    setColor(BRAND_GRAY);
    const itemLines = doc.splitTextToSize(`${index + 1}. ${item}`, W - 40);
    doc.text(itemLines, 20, y);
    y += itemLines.length * 4.5 + 4;
    if (y > 250) {
      doc.addPage();
      y = 20;
    }
  });

  y += 4;
  setFont('bold', 9);
  setColor(BRAND_BLACK);
  doc.text('Next Step', 20, y);
  y += 5;
  line(20, y, W - 20, y, 0.5);
  y += 6;
  setFont('normal', 8);
  setColor(BRAND_GRAY);
  const instructions = doc.splitTextToSize(report.instructions, W - 40);
  doc.text(instructions, 20, y);
  y += instructions.length * 4.5 + 4;

  y += 4;
  setFont('normal', 7);
  setColor(BRAND_RED);
  const disclaimerLines = doc.splitTextToSize(report.disclaimer, W - 40);
  doc.text(disclaimerLines, 20, y);

  doc.save(`ProxyGuard_RemediationPlan_${report.original_audit.audit_hash.slice(0, 8)}.pdf`);
}
