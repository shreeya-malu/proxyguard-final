import { useState } from 'react';
import { AuthProvider, useAuth } from './services/AuthContext';
import {
  AuditResponse, Certificate,
  generateCertificate,
} from './services/api';
import LoginPage      from './components/auth/LoginPage';
import UploadPage     from './components/upload/UploadPage';
import AuditPage      from './components/audit/AuditPage';
import CertificatePage from './components/audit/CertificatePage';
import ExplorePage    from './components/explore/ExplorePage';
import SimulatePage   from './components/simulate/SimulatePage';
import RegistryPage   from './components/registry/RegistryPage';
import './styles/globals.css';

export default function App() {
  return <AuthProvider><Shell /></AuthProvider>;
}

type Surface = 'audit' | 'explore' | 'simulate' | 'registry';
type AuditStep = 'upload' | 'results' | 'certificate';

function Shell() {
  const { user, loading, signOut } = useAuth();

  const [surface, setSurface] = useState<Surface>('audit');
  const [auditStep, setAuditStep] = useState<AuditStep>('upload');
  const [auditResult, setAuditResult] = useState<AuditResponse | null>(null);
  const [certificate, setCertificate] = useState<Certificate | null>(null);
  const [certLoading, setCertLoading] = useState(false);

  if (loading) return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, background: '#0A0A0F' }}>
      <div style={{ width: 28, height: 28, border: '2px solid #2A2A3A', borderTopColor: '#4D9FFF', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: '#8888AA' }}>Loading ProxyGuard Studio…</div>
    </div>
  );

  if (!user) return <LoginPage />;

  const handleAuditComplete = (result: AuditResponse) => {
    setAuditResult(result);
    setCertificate(null);
    setAuditStep('results');
  };

  const handleGenerateCert = async () => {
    if (!auditResult) return;
    setCertLoading(true);
    try {
      const { certificate: cert } = await generateCertificate(auditResult.audit_id);
      setCertificate(cert);
      setAuditStep('certificate');
    } catch (e) {
      console.error('Certificate failed:', e);
    } finally {
      setCertLoading(false);
    }
  };

  const handleNewAudit = () => {
    setAuditResult(null);
    setCertificate(null);
    setAuditStep('upload');
    setSurface('audit');
  };

  const grade = auditResult?.report?.overall_grade;
  const gradeColors: Record<string, string> = { A: '#3DDC84', B: '#4D9FFF', C: '#FFB830', D: '#FF6B35', F: '#FF4D6D' };
  const gc = grade ? (gradeColors[grade] ?? '#8888AA') : '#8888AA';

  const navItems = [
    { id: 'audit' as Surface,    label: 'Audit',    icon: '🔬', badge: grade ? grade : undefined, badgeColor: gc },
    { id: 'explore' as Surface,  label: 'Explore',  icon: '📊' },
    { id: 'simulate' as Surface, label: 'Simulate', icon: '⚖️' },
    { id: 'registry' as Surface, label: 'Registry', icon: '📋' },
  ];

  const topbarTitle =
    surface === 'audit' && auditStep === 'upload'       ? 'New Audit'
    : surface === 'audit' && auditStep === 'results'     ? `Nutrition Label — ${auditResult?.report.dataset_name ?? ''}`
    : surface === 'audit' && auditStep === 'certificate' ? `Certificate — ${certificate?.certificate_id ?? ''}`
    : surface === 'explore'  ? 'Explore Datasets'
    : surface === 'simulate' ? 'Outcome Simulator'
    : 'Public Registry';

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', fontFamily: 'var(--sans)' }}>

      {/* Sidebar */}
      <aside style={{ width: 200, minWidth: 200, background: '#13131A', borderRight: '0.5px solid #2A2A3A', display: 'flex', flexDirection: 'column' }}>
        {/* Logo */}
        <div style={{ padding: '18px 18px 14px', borderBottom: '0.5px solid #2A2A3A' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: 7, background: 'linear-gradient(135deg, #4D9FFF, #A855F7)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--syne)', fontSize: 11, fontWeight: 800, color: '#fff' }}>PG</div>
            <div>
              <div style={{ fontFamily: 'var(--syne)', fontSize: 13, fontWeight: 700, color: '#F0F0F8' }}>ProxyGuard</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 8, color: '#55556A', letterSpacing: '0.8px' }}>STUDIO</div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ padding: '10px 8px', flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {navItems.map(item => (
            <button key={item.id} onClick={() => setSurface(item.id)} style={{
              display: 'flex', alignItems: 'center', gap: 9,
              padding: '8px 12px', borderRadius: 8, border: 'none',
              background: surface === item.id ? '#1C1C26' : 'none',
              color: surface === item.id ? '#F0F0F8' : '#8888AA',
              cursor: 'pointer', width: '100%', textAlign: 'left',
              fontFamily: 'var(--mono)', fontSize: 12,
              fontWeight: surface === item.id ? 500 : 400,
              transition: 'all 0.1s',
            }}>
              <span style={{ fontSize: 14 }}>{item.icon}</span>
              <span style={{ flex: 1 }}>{item.label}</span>
              {item.badge && (
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, padding: '1px 5px', borderRadius: 4, background: `${item.badgeColor}22`, color: item.badgeColor, fontWeight: 700 }}>
                  {item.badge}
                </span>
              )}
            </button>
          ))}

          {/* Audit sub-steps */}
          {surface === 'audit' && auditResult && (
            <div style={{ marginLeft: 8, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {[
                { step: 'upload' as AuditStep, label: 'Upload', dot: '#4D9FFF' },
                { step: 'results' as AuditStep, label: 'Results', dot: gc },
                { step: 'certificate' as AuditStep, label: 'Certificate', dot: certificate ? '#3DDC84' : '#55556A' },
              ].map(s => (
                <button key={s.step}
                  onClick={() => { if (s.step === 'upload' || auditResult) setAuditStep(s.step); }}
                  disabled={s.step === 'certificate' && !certificate}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 10px', borderRadius: 6, border: 'none',
                    background: auditStep === s.step ? '#242432' : 'none',
                    color: auditStep === s.step ? '#F0F0F8' : '#55556A',
                    cursor: s.step === 'certificate' && !certificate ? 'not-allowed' : 'pointer',
                    fontFamily: 'var(--mono)', fontSize: 11,
                  }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: s.dot, flexShrink: 0 }} />
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </nav>

        {/* User */}
        <div style={{ padding: '10px 12px', borderTop: '0.5px solid #2A2A3A', display: 'flex', alignItems: 'center', gap: 8 }}>
          <img src={user.photoURL ?? ''} alt="" referrerPolicy="no-referrer"
            style={{ width: 26, height: 26, borderRadius: '50%', border: '0.5px solid #2A2A3A', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 500, color: '#F0F0F8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {user.displayName}
            </div>
            <button onClick={signOut} style={{ fontFamily: 'var(--mono)', fontSize: 10, color: '#55556A', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              Sign out
            </button>
          </div>
        </div>

        <div style={{ padding: '8px 14px', borderTop: '0.5px solid #2A2A3A', fontFamily: 'var(--mono)', fontSize: 9, color: '#55556A', lineHeight: 1.6 }}>
          v3.0 · 7 metrics · India context
        </div>
      </aside>

      {/* Main */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* Topbar */}
        <header style={{ height: 52, background: '#13131A', borderBottom: '0.5px solid #2A2A3A', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 500, color: '#F0F0F8' }}>{topbarTitle}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {surface === 'audit' && auditStep === 'results' && auditResult && (
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, padding: '3px 10px', borderRadius: 99, fontWeight: 500, background: `${gc}22`, color: gc }}>
                {auditResult.report.overall_result}
              </span>
            )}
            {surface === 'audit' && auditStep === 'certificate' && (
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, padding: '3px 10px', borderRadius: 99, background: 'rgba(61,220,132,0.15)', color: '#3DDC84' }}>SIGNED</span>
            )}
          </div>
        </header>

        {/* Content */}
        <main style={{ flex: 1, overflowY: 'auto', padding: '28px 32px' }}>
          {certLoading && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300, gap: 16 }}>
              <div style={{ width: 28, height: 28, border: '2px solid #2A2A3A', borderTopColor: '#4D9FFF', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: '#8888AA' }}>Signing with Cloud KMS…</div>
            </div>
          )}

          {!certLoading && surface === 'audit' && auditStep === 'upload' && (
            <UploadPage onAuditComplete={handleAuditComplete} />
          )}
          {!certLoading && surface === 'audit' && auditStep === 'results' && auditResult && (
            <AuditPage
              report={auditResult.report}
              auditId={auditResult.audit_id}
              sensitivityReports={auditResult.sensitivity_reports}
              dlpResult={auditResult.dlp_result}
              gemini={auditResult.gemini}
              onGenerateCertificate={handleGenerateCert}
            />
          )}
          {!certLoading && surface === 'audit' && auditStep === 'certificate' && certificate && auditResult && (
            <CertificatePage
              certificate={certificate}
              report={auditResult.report}
              auditId={auditResult.audit_id}
              onNewAudit={handleNewAudit}
              onViewRegistry={() => setSurface('registry')}
            />
          )}
          {surface === 'explore' && (
            <ExplorePage
              onSimulateDataset={() => setSurface('simulate')}
            />
          )}
          {surface === 'simulate' && <SimulatePage />}
          {surface === 'registry' && <RegistryPage />}
        </main>
      </div>
    </div>
  );
}
