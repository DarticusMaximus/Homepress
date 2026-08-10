"use client";

import { useMemo } from "react";
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
} from "@/components/ui/combobox";
import { listTimezoneGroups } from "@/lib/timezones";

export type TimezoneComboboxProps = {
  id: string;
  value: string;
  onValueChange: (timezone: string) => void;
  disabled?: boolean;
};

/**
 * Searchable IANA timezone combobox (common zones first).
 * Submits via a sibling hidden input `name="scheduleTimezone"` owned by the parent
 * so the value is always in the form regardless of popup state.
 */
export function TimezoneCombobox({
  id,
  value,
  onValueChange,
  disabled = false,
}: TimezoneComboboxProps) {
  const groups = useMemo(() => listTimezoneGroups(value), [value]);

  return (
    <Combobox
      items={groups}
      value={value}
      onValueChange={(next) => {
        if (typeof next === "string" && next.length > 0) {
          onValueChange(next);
        }
      }}
      disabled={disabled}
    >
      <ComboboxInput
        id={id}
        placeholder="Search timezone"
        className="w-full"
        disabled={disabled}
        showClear={false}
      />
      <ComboboxContent className="w-(--anchor-width)">
        <ComboboxEmpty>No timezone found.</ComboboxEmpty>
        <ComboboxList>
          {(group: (typeof groups)[number]) => (
            <ComboboxGroup key={group.value} items={group.items}>
              <ComboboxLabel>{group.value}</ComboboxLabel>
              <ComboboxCollection>
                {(zone: string) => (
                  <ComboboxItem key={zone} value={zone}>
                    {zone}
                  </ComboboxItem>
                )}
              </ComboboxCollection>
            </ComboboxGroup>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
