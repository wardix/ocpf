import React from 'react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const shortcutsList = [
  { category: 'General', items: [
    { keys: ['?'], description: 'Tampilkan shortcuts ini' },
    { keys: ['Esc'], description: 'Tutup modal / dropdown' },
  ]},
  { category: 'Navigation', items: [
    { keys: ['Ctrl', 'K'], description: 'Search percakapan & kontak' },
    { keys: ['↑'], description: 'Percakapan sebelumnya' },
    { keys: ['↓'], description: 'Percakapan selanjutnya' },
  ]},
  { category: 'Messaging', items: [
    { keys: ['Ctrl', 'Enter'], description: 'Kirim pesan' },
    { keys: ['Ctrl', 'Shift', 'N'], description: 'Toggle Private Note' },
  ]},
  { category: 'Actions', items: [
    { keys: ['Alt', 'R'], description: 'Resolve / Re-open tiket' },
    { keys: ['Alt', 'A'], description: 'Assign tiket ke saya' },
  ]}
];

export const ShortcutsModal = ({ isOpen, onClose }: Props) => {
  if (!isOpen) return null;

  return (
    <dialog className="modal modal-open">
      <div className="modal-box max-w-lg shadow-xl border border-base-300">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold text-lg">⌨️ Keyboard Shortcuts</h3>
          <button className="btn btn-sm btn-circle btn-ghost" onClick={onClose}>✕</button>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {shortcutsList.map(group => (
            <div key={group.category} className="mb-2">
              <h4 className="text-sm font-bold text-base-content/60 mb-3 border-b border-base-200 pb-1">{group.category}</h4>
              <div className="flex flex-col gap-2">
                {group.items.map((item, i) => (
                  <div key={i} className="flex justify-between items-center py-1">
                    <span className="text-sm">{item.description}</span>
                    <div className="flex gap-1">
                      {item.keys.map(key => (
                        <kbd key={key} className="kbd kbd-sm font-mono text-[10px] min-h-6 min-w-6">{key}</kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <form method="dialog" className="modal-backdrop bg-base-300/40 backdrop-blur-sm" onClick={onClose}>
        <button type="button">close</button>
      </form>
    </dialog>
  );
};