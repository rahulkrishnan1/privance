"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/index";
import { Modal } from "@/components/Modal";
import type { LocalGroup } from "../types";

type GroupsManagerProps = {
  open: boolean;
  groups: LocalGroup[];
  onClose: () => void;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

export function GroupsManager({ open, groups, onClose, onRename, onDelete }: GroupsManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: open toggle resets edit state
  useEffect(() => {
    setEditingId(null);
    setEditName("");
    setPendingDelete(null);
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
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="groups-manager-title"
      className="max-h-[88vh] overflow-y-auto"
    >
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <h2
            id="groups-manager-title"
            className="font-serif text-[23px] leading-tight font-light tracking-[-0.01em] text-cream"
          >
            Groups
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 cursor-pointer text-faint hover:text-cream focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <X size={18} />
          </button>
        </div>

        <p className="text-[13px] text-dim leading-[1.6]">
          Your own buckets, your own taxonomy. Groups live encrypted with everything else.
        </p>

        {groups.length === 0 && (
          <p className="text-[13px] text-faint text-center py-4">No groups yet</p>
        )}

        <div>
          {groups.map((group) => (
            <div
              key={group.id}
              className="flex items-center gap-3 py-3 border-b border-line-soft last:border-b-0"
            >
              {editingId === group.id ? (
                <div className="flex-1 flex items-center gap-2">
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    aria-label="Group name"
                    // biome-ignore lint/a11y/noAutofocus: focuses the rename input inside the modal
                    autoFocus
                    className="flex-1 rounded-lg border border-accent-dim/30 px-3 py-2 text-[14px] text-cream bg-panel-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent min-h-9"
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
                    className="rounded-lg px-3 py-2 text-[13px] text-dim hover:text-cream min-h-9 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent cursor-pointer transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : pendingDelete === group.id ? (
                <div className="flex-1 flex items-center gap-2">
                  <span className="flex-1 text-[13px] text-cream">
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
                    className="rounded-lg px-3 py-2 text-[13px] text-dim hover:text-cream min-h-9 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent cursor-pointer transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <>
                  <span className="flex-1 text-[14px] text-cream">{group.name}</span>
                  <button
                    type="button"
                    onClick={() => startEdit(group)}
                    aria-label={`Rename ${group.name}`}
                    className="font-mono text-[9.5px] tracking-[.1em] uppercase px-3 py-1 rounded text-faint hover:text-cream min-h-9 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent cursor-pointer transition-colors"
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
                    className="p-1 cursor-pointer text-faint hover:text-down focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent transition-colors"
                  >
                    <X size={15} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
