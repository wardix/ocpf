import React from 'react';

interface SelectedConversation {
  id: number;
  phone: string;
  name: string;
}

interface Props {
  selectedConv: SelectedConversation;
}

const ContactInfo = ({ selectedConv }: Props) => {
  return (
    <div className="w-72 bg-base-100 border-l border-base-300 flex flex-col h-full shrink-0 overflow-y-auto">
      
      {/* Header Info Dinamis */}
      <div className="p-6 flex flex-col items-center border-b border-base-200">
        <div className="avatar placeholder mb-4 shadow-md rounded-full">
          <div className="bg-neutral text-neutral-content rounded-full w-24">
            <span className="text-3xl">
              {selectedConv.name.substring(0, 2).toUpperCase()}
            </span>
          </div>
        </div>
        <h2 className="font-bold text-xl text-center truncate w-full px-2">
          {selectedConv.name}
        </h2>
        <p className="text-xs text-base-content/60 mt-1">ID Percakapan: #{selectedConv.id}</p>
      </div>

      {/* Detail Attributes */}
      <div className="p-4 space-y-4">
        
        <div>
          <label className="text-[10px] font-bold text-base-content/40 uppercase tracking-wider">Alamat WhatsApp (JID)</label>
          <p className="text-[10px] mt-1 bg-base-200 p-2 rounded-lg font-mono text-primary break-all">
            {selectedConv.phone}
          </p>
        </div>

        <div>
          <label className="text-[10px] font-bold text-base-content/40 uppercase tracking-wider">Status Saluran</label>
          <div className="flex items-center gap-2 mt-2">
            <div className="badge badge-success badge-xs"></div>
            <span className="text-xs font-medium">WhatsApp Terhubung</span>
          </div>
        </div>

        {/* Labels (Bisa dikembangkan nanti agar dinamis dari DB) */}
        <div>
          <label className="text-[10px] font-bold text-base-content/40 uppercase tracking-wider">Label</label>
          <div className="flex flex-wrap gap-2 mt-2">
            <span className="badge badge-outline badge-sm opacity-50 italic text-[10px]">Belum ada label</span>
            <button className="btn btn-xs btn-ghost btn-outline border-dashed text-[9px]">
              + Tambah Label
            </button>
          </div>
        </div>

        <div className="divider opacity-10"></div>
        
        <div className="px-2">
          <button className="btn btn-sm btn-block btn-outline btn-error opacity-70">Blokir Kontak</button>
        </div>
        
      </div>
      
    </div>
  );
};

export default ContactInfo;