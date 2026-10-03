import { useState } from "react";
import { Button } from "@/components";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DateFieldTrigger } from "./date-field-trigger";

type DateFieldPickerProps = {
  id?: string;
  value: string;
  selectedDate: Date | undefined;
  label: string | null;
  placeholder: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
};

const THIS_YEAR = new Date().getFullYear();
const CALENDAR_START = new Date(THIS_YEAR - 20, 0);
const CALENDAR_END = new Date(THIS_YEAR + 10, 11);

function toValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function DateFieldPicker({
  id,
  value,
  selectedDate,
  label,
  placeholder,
  onChange,
  onBlur,
}: DateFieldPickerProps) {
  const [open, setOpen] = useState(true);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) onBlur?.();
      }}
    >
      <PopoverTrigger
        render={<DateFieldTrigger id={id} label={label} placeholder={placeholder} />}
      />
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          captionLayout="dropdown"
          startMonth={CALENDAR_START}
          endMonth={CALENDAR_END}
          selected={selectedDate}
          defaultMonth={selectedDate}
          onSelect={(date) => {
            onChange(date ? toValue(date) : "");
            setOpen(false);
          }}
          // The selected day already uses the brand fill; today uses text so
          // the two states remain distinct.
          classNames={{ today: "text-accent" }}
        />
        {value && (
          <div className="border-t border-line px-2 py-1.5">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-left"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              Clear
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
