'use client';
import { useEffect, useState } from 'react';
import { loadStaff, type StaffMember } from '../../client/admin/staff';
import { useAdmin } from './AdminFrame';
import { AuditPanel } from './AuditPanel';
import { StaffPanel } from './StaffPanel';

// A17 Staff and audit log (F11-T23; ADMIN-17; owner only): the two panels on one page, as on the board. The audit filter lists the same people.
export function StaffScreen() {
  const { slug, t } = useAdmin();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  useEffect(() => {
    void loadStaff(slug, window.fetch.bind(window)).then((r) => r.kind === 'ok' && setStaff(r.body));
  }, [slug]);
  return (
    <div data-testid="staff-page">
      <header className="adm-head"><h1>{t('A-0163')}</h1></header>
      <StaffPanel />
      <AuditPanel staff={staff} />
    </div>
  );
}
