"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";

const DISARM_MS = 3500;

export function ConfirmDeleteButton({
  onConfirm,
  pending = false,
  className,
}: {
  onConfirm: () => void;
  pending?: boolean;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  function handleClick() {
    if (armed) {
      if (timer.current !== null) clearTimeout(timer.current);
      setArmed(false);
      onConfirm();
      return;
    }
    setArmed(true);
    timer.current = setTimeout(() => setArmed(false), DISARM_MS);
  }

  return (
    <Button
      type="button"
      variant={armed ? "danger" : "dangerOutline"}
      onClick={handleClick}
      disabled={pending}
      className={className}
    >
      {armed ? "Tap again to delete" : "Delete"}
    </Button>
  );
}
