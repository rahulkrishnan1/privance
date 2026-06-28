"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/index";
import { Dialog, DialogContent, DialogTitleRow } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent aria-labelledby="groups-manager-title">
        <div className="flex flex-col gap-5">
          <DialogTitleRow titleId="groups-manager-title" title="Groups" onClose={onClose} />

          <p className="text-sm text-dim leading-[1.6]">Your own buckets, your own taxonomy.</p>

          {groups.length === 0 && (
            <p className="text-sm text-faint text-center py-4">No groups yet</p>
          )}

          <div>
            {groups.map((group) => (
              <div
                key={group.id}
                className="flex items-center gap-3 py-3 border-b border-line-soft last:border-b-0"
              >
                {editingId === group.id ? (
                  <div className="flex-1 flex items-center gap-2">
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      aria-label="Group name"
                      autoFocus
                      className="flex-1 border-accent-dim/30"
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
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={cancelEdit}
                      aria-label="Cancel edit"
                    >
                      Cancel
                    </Button>
                  </div>
                ) : pendingDelete === group.id ? (
                  <div className="flex-1 flex items-center gap-2">
                    <span className="flex-1 text-sm text-cream">
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
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setPendingDelete(null)}
                      aria-label="Cancel delete"
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <>
                    <span className="flex-1 text-base text-cream">{group.name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => startEdit(group)}
                      aria-label={`Rename ${group.name}`}
                    >
                      Rename
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setPendingDelete(group.id);
                        setEditingId(null);
                      }}
                      aria-label={`Delete ${group.name}`}
                    >
                      <X size={15} />
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
