"use client";

import { useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

type ChipInputProps = {
  id?: string;
  value: string[];
  onChange: (chips: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
};

export function ChipInput({ id, value, onChange, placeholder, disabled }: ChipInputProps) {
  const [draft, setDraft] = useState("");

  function commit() {
    const trimmed = draft.trim();
    setDraft("");
    if (trimmed.length === 0) return;
    if (value.includes(trimmed)) return;
    onChange([...value, trimmed]);
  }

  function removeAt(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
      return;
    }
    if (event.key === "Backspace" && draft === "" && value.length > 0) {
      removeAt(value.length - 1);
    }
  }

  return (
    <div className="flex min-h-9 flex-wrap items-center gap-2 rounded-md border border-input bg-transparent px-2 py-1.5 text-sm shadow-xs focus-within:ring-[3px] focus-within:ring-ring/50">
      {value.map((chip, index) => (
        <Badge key={`${chip}-${index}`} variant="secondary" className="gap-1 pr-1">
          <span>{chip}</span>
          <button
            type="button"
            aria-label={`Remove ${chip}`}
            onClick={() => removeAt(index)}
            disabled={disabled}
            className="inline-flex size-4 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}
      <Input
        id={id}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
        placeholder={placeholder}
        disabled={disabled}
        className="h-7 min-w-[140px] flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
      />
    </div>
  );
}
