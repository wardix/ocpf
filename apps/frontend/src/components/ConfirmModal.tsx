import React, { useEffect, useRef } from 'react';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'warning' | 'error' | 'info' | 'primary';
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmModal = ({ 
  isOpen, 
  title, 
  message, 
  confirmText = 'Ya, Lanjutkan', 
  cancelText = 'Batal', 
  variant = 'warning', 
  onConfirm, 
  onCancel 
}: ConfirmModalProps) => {
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen && confirmBtnRef.current) {
      confirmBtnRef.current.focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        onCancel();
      } else if (e.key === 'Enter') {
        onConfirm();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onConfirm, onCancel]);

  if (!isOpen) return null;
  
  const variantColors = {
    warning: 'btn-warning',
    error: 'btn-error', 
    info: 'btn-info',
    primary: 'btn-primary'
  };
  
  return (
    <dialog className="modal modal-open">
      <div className="modal-box shadow-xl border border-base-300">
        <h3 className="font-bold text-lg">{title}</h3>
        <p className="py-4 text-base-content/80">{message}</p>
        <div className="modal-action">
          <button className="btn btn-ghost" onClick={onCancel}>{cancelText}</button>
          <button 
            ref={confirmBtnRef}
            className={`btn ${variantColors[variant]}`} 
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop bg-base-300/40 backdrop-blur-sm">
        <button onClick={onCancel} className="cursor-default">close</button>
      </form>
    </dialog>
  );
};