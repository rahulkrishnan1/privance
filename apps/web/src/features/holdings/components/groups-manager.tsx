"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/index";
import type { LocalGroup } from "../types";

type GroupsManagerProps = {
  open: boolean;
  groups: LocalGroup[];
  onClose: () => void;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

export function GroupsManager({ open, groups, onClose, onRename, onDelete }: GroupsManagerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const startEdit = (group: LocalGroup) => {
    setEditingId(group.id);
    setEditName(group.name);
    setPendingDelete(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
  };

  const commitRename = async (id: string) => {
    const name = editName.trim();
    if (!name) return;
    setBusy(true);
    try {
      await onRename(id, name);
      setEditingId(null);
      setEditName("");
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async (id: string) => {
    setBusy(true);
    try {
      await onDelete(id);
      setPendingDelete(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="m-0 sm:m-auto rounded-none sm:rounded-2xl p-0 shadow-xl w-full h-svh sm:h-auto max-w-none sm:max-w-sm max-h-none sm:max-h-[90vh] bg-app-panel border-0 backdrop:bg-black/50 focus-visible:outline-none overflow-y-auto"
      aria-modal="true"
      aria-label="Manage groups"
    >
      <div className="p-5 flex flex-col gap-4 [padding-bottom:max(env(safe-area-inset-bottom),5rem)] sm:[padding-bottom:1.25rem]">
        <div className="flex items-center justify-between">
          <h2
            className="font-serif text-[26px] leading-tight font-light tracking-[-0.015em] text-app-text"
            style={{ fontVariationSettings: '"opsz" 48, "SOFT" 50' }}
          >
            Manage groups
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded-full hover:bg-white/[0.03] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-accent focus-visible:rounded-[inherit] cursor-pointer"
          >
            <X size={20} className="text-app-muted" />
          </button>
        </div>

        {groups.length === 0 && (
          <p className="text-sm text-app-muted text-center py-4">No groups yet</p>
        )}

        {groups.map((group) => (
          <div
            key={group.id}
            className="flex items-center gap-2 py-2 border-b border-app-line-soft"
          >
            {editingId === group.id ? (
              <div className="flex-1 flex items-center gap-2">
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  aria-label="Group name"
                  autoFocus
                  className="flex-1 rounded-lg border border-gold-accent/30 px-3 py-2 text-sm text-app-text bg-app-panel-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-accent focus-visible:rounded-[inherit] min-h-9"
                />
                <Button
                  onClick={() => void commitRename(group.id)}
                  disabled={busy || editName.trim().length === 0}
                  loading={busy}
                  aria-label="Save group name"
                  size="sm"
                >
                  Save
                </Button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  aria-label="Cancel edit"
                  className="rounded-lg px-3 py-2 hover:bg-white/[0.03] text-sm text-app-muted min-h-9 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-accent focus-visible:rounded-[inherit] cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            ) : pendingDelete === group.id ? (
              <div className="flex-1 flex items-center gap-2">
                <span className="flex-1 text-sm text-app-text">
                  Delete &quot;{group.name}&quot;?
                </span>
                <Button
                  onClick={() => void confirmDelete(group.id)}
                  disabled={busy}
                  loading={busy}
                  aria-label="Confirm delete"
                  variant="danger"
                  size="sm"
                >
                  Delete
                </Button>
                <button
                  type="button"
                  onClick={() => setPendingDelete(null)}
                  aria-label="Cancel delete"
                  className="rounded-lg px-3 py-2 hover:bg-white/[0.03] text-sm text-app-muted min-h-9 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-accent focus-visible:rounded-[inherit] cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <>
                <span className="flex-1 text-sm font-medium text-app-text">{group.name}</span>
                <button
                  type="button"
                  onClick={() => startEdit(group)}
                  aria-label={`Rename ${group.name}`}
                  className="px-3 py-1 rounded hover:bg-white/[0.03] text-xs text-gold-accent font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-accent focus-visible:rounded-[inherit] min-h-9 cursor-pointer"
                >
                  Rename
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPendingDelete(group.id);
                    setEditingId(null);
                  }}
                  aria-label={`Delete ${group.name}`}
                  className="px-3 py-1 rounded hover:bg-white/[0.03] text-xs text-app-red font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-accent focus-visible:rounded-[inherit] min-h-9 cursor-pointer"
                >
                  Delete
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </dialog>
  );
}
