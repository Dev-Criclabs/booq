import type { ReactNode } from 'react';
import '../../../../ui/admin/admin.css';

// The club admin console under /c/{slug}/admin (F11; ADMIN-01). It sits inside the club layout (fonts, palette D); the shell is
// drawn by each page through AdminFrame so the page knows which sidebar entry is current.
export default function AdminLayout({ children }: { children: ReactNode }) {
  return children;
}
