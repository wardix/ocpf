import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ConfirmModal } from './ConfirmModal';

describe('ConfirmModal Component', () => {
  it('should render nothing when isOpen is false', () => {
    const { container } = render(
      <ConfirmModal
        isOpen={false}
        title="Test Title"
        message="Test Message"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('should render title, message and buttons when isOpen is true', () => {
    render(
      <ConfirmModal
        isOpen={true}
        title="Konfirmasi Hapus"
        message="Apakah Anda yakin?"
        confirmText="Ya"
        cancelText="Tidak"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText('Konfirmasi Hapus')).toBeInTheDocument();
    expect(screen.getByText('Apakah Anda yakin?')).toBeInTheDocument();
    expect(screen.getByText('Ya')).toBeInTheDocument();
    expect(screen.getByText('Tidak')).toBeInTheDocument();
  });

  it('should call onConfirm when confirm button is clicked', () => {
    const handleConfirm = vi.fn();
    const handleCancel = vi.fn();

    render(
      <ConfirmModal
        isOpen={true}
        title="Title"
        message="Message"
        confirmText="Yes"
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    );

    fireEvent.click(screen.getByText('Yes'));
    expect(handleConfirm).toHaveBeenCalledTimes(1);
    expect(handleCancel).not.toHaveBeenCalled();
  });

  it('should call onCancel when cancel button is clicked', () => {
    const handleConfirm = vi.fn();
    const handleCancel = vi.fn();

    render(
      <ConfirmModal
        isOpen={true}
        title="Title"
        message="Message"
        cancelText="No"
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    );

    fireEvent.click(screen.getByText('No'));
    expect(handleCancel).toHaveBeenCalledTimes(1);
    expect(handleConfirm).not.toHaveBeenCalled();
  });
});
