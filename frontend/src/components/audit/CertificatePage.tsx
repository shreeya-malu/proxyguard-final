import { useState } from 'react';
import { Certificate, AuditReport, publishToRegistry } from '../../services/api';
import { downloadCertificatePDF } from '../../services/pdfGenerator';

interface Props {
  certificate: Certificate;
  report: AuditReport;
  auditId: string;
  onNewAudit: () => void;
  onViewRegistry: () => void;
}

const C = {
  red:'#FF4D6D', redBg:'rgba(255,77,109,0.1)', redText:'#FF6B85',
  green:'#3DDC84', greenBg:'rgba(61,220,132,0.1)', greenText:'#3DDC84',
  amber:'#FFB830', amberBg:'rgba(255,184,48,0.1)',
  blue:'#4D9FFF', blueBg:'rgba(77,159,255,0.1)', blueText:'#7DBFFF',
  surface:'#13131A', surface2:'#1C1C26', border:'#2A2A3A', border2:'#363650',
  text:'#F0F0F8', muted:'#8888AA', hint:'#55556A',
};

const gradeColor = (g: string) => ({A:C.green,B:C.blue,C:C.amber,D:'#FF6B35',F:C.red}[g] ?? C.hint);

export default function CertificatePage({ certificate: cert, report, auditId, onNewAudit, onViewRegistry }: Props) {
  const [publishing, setPublishing] = useState(false);
  const [published,  setPublished]  = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  const issued = new Date(cert.issued_at).toLocaleString('en-IN', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
  });

  const gc = gradeColor(cert.overall_grade);

  const handlePublish = async () => {
    setPublishing(true);
    setPublishError(null);
    try {
      await publishToRegistry(auditId);
      setPublished(true);
    } catch (e) {
      setPublishError('Publish failed. Check that the backend is running.');
    } finally {
      setPublishing(false);
    }
  };

  const rows: [string, string, string?][] = [
    ['Certificate ID',     cert.certificate_id],
    ['Dataset',            cert.dataset_name],
    ['Industry',           cert.industry_context.toUpperCase()],
    ['Region',             cert.region.toUpperCase()],
    ['Verdict',            cert.overall_result],
    ['Grade',              cert.overall_grade],
    ['DIR Score',          `${cert.overall_dir.toFixed(2)} (threshold: 0.80)`, cert.overall_dir < 0.8 ? 'red' : undefined],
    ['Metrics Computed',   `${cert.metrics_computed} independent fairness metrics`],
    ['Sensitivity Run',    cert.sensitivity_computed ? 'Yes — bounded estimates computed' : 'No — ground truth was provided'],
    ['Impossibility Flag', cert.has_impossibility ? 'Yes — mathematical conflict detected and explained' : 'No conflicts detected'],
    ['Ground Truth Used',  cert.ground_truth_used ? 'Yes' : 'No — sensitivity analysis used instead'],
    ['Hash Verified',      cert.hash_verified ? '✓ Integrity confirmed' : '⚠ Hash mismatch'],
    ['Signing Method',     cert.signing_method],
    ['Issued',             issued],
    ['Signed By',          cert.signed_by],
  ];

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', paddingBottom: 40 }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '1px', textTransform: 'uppercase', color: C.hint, marginBottom: 14 }}>
        Fairness Certificate · Signed
      </div>

      <div style={{ background: C.surface, border: `0.5px solid ${C.border}`, borderRadius: 16, overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '28px 32px', background: `${gc}0D`, borderBottom: `3px solid ${gc}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: C.muted, marginBottom: 4 }}>ProxyGuard Studio</div>
              <div style={{ fontFamily: 'var(--syne)', fontSize: 24, fontWeight: 800, letterSpacing: '-0.5px' }}>Certificate of Fairness Audit</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ width: 64, height: 64, borderRadius: 12, background: `${gc}22`, color: gc, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--syne)', fontSize: 32, fontWeight: 800 }}>
                {cert.overall_grade}
              </div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: C.hint, marginTop: 4 }}>Fairness Grade</div>
            </div>
          </div>
          <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.65, margin: 0 }}>
            This certificate attests that the dataset below was subjected to a complete
            multi-checkpoint deterministic bias audit using seven independent fairness metrics,
            sensitivity analysis under ground truth uncertainty, and Google Cloud KMS cryptographic signing.
          </p>
        </div>

        {/* Body */}
        <div style={{ padding: '24px 32px' }}>
          {rows.map(([label, value, flag]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '9px 0', borderBottom: `0.5px solid ${C.border}` }}>
              <span style={{ fontSize: 12, color: C.muted, fontFamily: 'var(--mono)' }}>{label}</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 500, maxWidth: '55%', textAlign: 'right', wordBreak: 'break-all', color: flag === 'red' ? C.red : C.text }}>
                {value}
              </span>
            </div>
          ))}

          {/* Hash */}
          <div style={{ marginTop: 18, padding: '12px 14px', background: C.surface2, borderRadius: 10 }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: C.hint, marginBottom: 5, letterSpacing: '0.5px', textTransform: 'uppercase' }}>SHA-256 Audit Hash</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.muted, wordBreak: 'break-all', lineHeight: 1.8 }}>{cert.audit_hash}</div>
          </div>

          {/* Signature */}
          <div style={{ marginTop: 12, padding: '12px 14px', background: C.surface2, borderRadius: 10 }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: C.hint, marginBottom: 5, letterSpacing: '0.5px', textTransform: 'uppercase' }}>KMS Signature</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.muted, wordBreak: 'break-all', lineHeight: 1.8 }}>{cert.signature}</div>
          </div>

          {/* Summary */}
          <div style={{ marginTop: 16 }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Audit Summary</div>
            <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.7, margin: 0 }}>{cert.summary}</p>
          </div>

          {/* Legal refs */}
          <div style={{ marginTop: 16 }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Legal References</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {cert.legal_references.map(r => (
                <span key={r} style={{ fontFamily: 'var(--mono)', fontSize: 10, padding: '3px 8px', borderRadius: 4, background: C.surface2, color: C.muted }}>{r}</span>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 32px', borderTop: `0.5px solid ${C.border}`, background: C.surface2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 11, color: C.hint, lineHeight: 1.6 }}>
            Tamper-evident · cryptographically signed<br />
            Verify: proxyguard.studio/verify/{cert.audit_id}
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, padding: '5px 10px', borderRadius: 8, background: C.greenBg, color: C.greenText }}>
            ✓ {cert.hash_verified ? 'KMS VERIFIED' : 'SIGNED'}
          </div>
        </div>
      </div>

      {/* Publish to registry */}
      {!published ? (
        <div style={{ marginTop: 16, padding: '18px 20px', background: C.surface, border: `0.5px solid ${C.border}`, borderRadius: 12 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 500, marginBottom: 6 }}>Publish to Public Registry</div>
          <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.6, marginBottom: 14 }}>
            Publishing makes this audit permanently verifiable by anyone. No organisation can falsify or hide results.
            The registry is the accountability layer making non-auditing visible.
          </p>
          {publishError && <div style={{ color: C.red, fontFamily: 'var(--mono)', fontSize: 11, marginBottom: 10 }}>{publishError}</div>}
          <button onClick={handlePublish} disabled={publishing} style={{
            padding: '10px 20px', background: C.blue, color: '#fff', border: 'none',
            borderRadius: 8, fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 500,
            cursor: publishing ? 'not-allowed' : 'pointer', opacity: publishing ? 0.6 : 1,
          }}>
            {publishing ? 'Publishing…' : 'Publish to Registry →'}
          </button>
        </div>
      ) : (
        <div style={{ marginTop: 16, padding: '18px 20px', background: C.greenBg, border: `0.5px solid rgba(61,220,132,0.4)`, borderRadius: 12 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: C.green, marginBottom: 6 }}>Published to Public Registry</div>
          <p style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
            This audit is now publicly verifiable. Anyone can verify the hash at any time.
          </p>
          <button onClick={onViewRegistry} style={{
            padding: '8px 16px', background: 'none', border: `0.5px solid rgba(61,220,132,0.5)`,
            borderRadius: 8, color: C.green, fontFamily: 'var(--mono)', fontSize: 11, cursor: 'pointer',
          }}>View in Registry</button>
        </div>
      )}

      {/* Actions */}
      <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
        <button onClick={() => downloadCertificatePDF(cert, report)} style={{
          flex: 1, padding: 11, background: C.text, color: C.surface, border: 'none',
          borderRadius: 8, fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
        }}>Download PDF Certificate</button>
        <button onClick={onNewAudit} style={{
          flex: 1, padding: 11, background: 'none', border: `0.5px solid ${C.border2}`,
          borderRadius: 8, fontFamily: 'var(--mono)', fontSize: 12, cursor: 'pointer', color: C.muted,
        }}>Run New Audit</button>
      </div>
    </div>
  );
}
