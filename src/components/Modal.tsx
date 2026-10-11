import { useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
export default function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    // Keep the original trigger through StrictMode's setup/cleanup replay.
    const active = document.activeElement;
    if (!opener.current && active instanceof HTMLElement && !element.contains(active)) opener.current = active;
    if (!element.open) element.showModal();
    return () => {
      // Capture the node locally: React may detach its ref before cleanup runs.
      if (element.open) element.close();
      const trigger = opener.current;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      // Restore after removal too, but do not steal focus during a StrictMode reopen.
      queueMicrotask(() => { if (!element.open && trigger?.isConnected) trigger.focus({ preventScroll: true }); });
    };
  }, []);
  return <dialog ref={dialog} className={`modal ${wide ? 'modal-wide' : ''}`} aria-labelledby="modal-title" onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === dialog.current) onClose(); }}><div className="modal-head"><h2 id="modal-title">{title}</h2><button className="icon-button" aria-label="关闭面板" onClick={onClose}><X size={22} /></button></div>{children}</dialog>;
}
