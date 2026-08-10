"use client";

import { useMemo, useState } from "react";
import {
  computeNextFireAt,
  decodeGuidedCron,
  DEFAULT_GUIDED_SCHEDULE,
  encodeGuidedCron,
  type GuidedScheduleFrequency,
  type GuidedScheduleState,
} from "@newsletter/shared/client";
import { ChevronDownIcon } from "lucide-react";
import { formatScheduleNextFireAt } from "@/components/schedules/format-schedule-next-fire";
import { TimezoneCombobox } from "@/components/schedules/timezone-combobox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type ScheduleFieldsProps = {
  idPrefix: string;
  defaultEnabled: boolean;
  defaultCron: string;
  defaultTimezone: string;
  disabled?: boolean;
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const FREQUENCY_OPTIONS: { value: GuidedScheduleFrequency; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekly", label: "Weekly" },
  { value: "custom", label: "Custom weekdays" },
];

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => hour);
const MINUTE_OPTIONS = Array.from({ length: 12 }, (_, i) => i * 5);

type BuilderMode = "guided" | "custom";

type InitialBuilderState = {
  mode: BuilderMode;
  guided: GuidedScheduleState;
  cron: string;
  timezone: string;
  advancedOpen: boolean;
};

function defaultDaysForFrequency(frequency: GuidedScheduleFrequency): number[] {
  switch (frequency) {
    case "weekly":
      return [1]; // Monday
    case "custom":
      return [1];
    default:
      return [];
  }
}

function seedBuilderState(defaultCron: string, defaultTimezone: string): InitialBuilderState {
  const timezone = defaultTimezone.trim().length > 0 ? defaultTimezone.trim() : "UTC";
  const trimmed = defaultCron.trim();

  if (trimmed.length === 0) {
    const guided = { ...DEFAULT_GUIDED_SCHEDULE };
    return {
      mode: "guided",
      guided,
      cron: encodeGuidedCron(guided),
      timezone,
      advancedOpen: false,
    };
  }

  const decoded = decodeGuidedCron(trimmed);
  if (decoded !== null) {
    return {
      mode: "guided",
      guided: decoded,
      cron: encodeGuidedCron(decoded),
      timezone,
      advancedOpen: false,
    };
  }

  return {
    mode: "custom",
    guided: { ...DEFAULT_GUIDED_SCHEDULE },
    cron: trimmed,
    timezone,
    advancedOpen: true,
  };
}

function tryEncodeGuided(state: GuidedScheduleState): string | null {
  try {
    return encodeGuidedCron(state);
  } catch {
    return null;
  }
}

/**
 * Shared enable / guided cadence / timezone / Advanced cron controls for
 * Schedules edit and Newsletter edit Schedule section.
 */
export function ScheduleFields({
  idPrefix,
  defaultEnabled,
  defaultCron,
  defaultTimezone,
  disabled = false,
}: ScheduleFieldsProps) {
  const initial = useMemo(
    () => seedBuilderState(defaultCron, defaultTimezone),
    [defaultCron, defaultTimezone],
  );

  const [enabled, setEnabled] = useState(defaultEnabled);
  const [mode, setMode] = useState<BuilderMode>(initial.mode);
  const [guided, setGuided] = useState<GuidedScheduleState>(initial.guided);
  const [cron, setCron] = useState(initial.cron);
  const [timezone, setTimezone] = useState(initial.timezone);
  const [advancedOpen, setAdvancedOpen] = useState(initial.advancedOpen);

  const enabledId = `schedule-enabled-${idPrefix}`;
  const frequencyId = `schedule-frequency-${idPrefix}`;
  const weeklyDayId = `schedule-weekly-day-${idPrefix}`;
  const hourId = `schedule-hour-${idPrefix}`;
  const minuteId = `schedule-minute-${idPrefix}`;
  const timezoneId = `schedule-timezone-${idPrefix}`;
  const cronId = `schedule-cron-${idPrefix}`;
  const advancedId = `schedule-advanced-${idPrefix}`;

  const guidedControlsDisabled = disabled || mode === "custom";

  const nextFireDisplay = useMemo(() => {
    if (!enabled) {
      return formatScheduleNextFireAt(null);
    }
    const trimmed = cron.trim();
    if (trimmed.length === 0) {
      return formatScheduleNextFireAt(null);
    }
    const next = computeNextFireAt(trimmed, timezone);
    return formatScheduleNextFireAt(next ? next.toISOString() : null);
  }, [enabled, cron, timezone]);

  function applyGuidedState(next: GuidedScheduleState, options?: { openAdvanced?: boolean }) {
    const encoded = tryEncodeGuided(next);
    if (encoded === null) {
      // Custom with zero days — keep last valid cron; update visual state only.
      setGuided(next);
      setMode("guided");
      return;
    }
    setGuided(next);
    setCron(encoded);
    setMode("guided");
    if (options?.openAdvanced !== undefined) {
      setAdvancedOpen(options.openAdvanced);
    } else {
      setAdvancedOpen(false);
    }
  }

  function handleFrequencyChange(value: string) {
    const frequency = value as GuidedScheduleFrequency;
    const next: GuidedScheduleState = {
      ...guided,
      frequency,
      daysOfWeek:
        frequency === "weekly" || frequency === "custom"
          ? guided.daysOfWeek.length > 0
            ? frequency === "weekly"
              ? [guided.daysOfWeek[0]!]
              : guided.daysOfWeek
            : defaultDaysForFrequency(frequency)
          : [],
    };
    applyGuidedState(next);
  }

  function handleWeeklyDayChange(value: string) {
    const day = Number(value);
    applyGuidedState({ ...guided, frequency: "weekly", daysOfWeek: [day] });
  }

  function handleCustomDayToggle(day: number) {
    const has = guided.daysOfWeek.includes(day);
    const daysOfWeek = has
      ? guided.daysOfWeek.filter((d) => d !== day)
      : [...guided.daysOfWeek, day].sort((a, b) => a - b);
    applyGuidedState({ ...guided, frequency: "custom", daysOfWeek });
  }

  function handleHourChange(value: string) {
    applyGuidedState({ ...guided, hour: Number(value) });
  }

  function handleMinuteChange(value: string) {
    applyGuidedState({ ...guided, minute: Number(value) });
  }

  function handleAdvancedCronChange(value: string) {
    setCron(value);
    const decoded = decodeGuidedCron(value);
    if (decoded !== null) {
      setGuided(decoded);
      setMode("guided");
    } else {
      setMode("custom");
      setAdvancedOpen(true);
    }
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <input
          id={enabledId}
          type="checkbox"
          name="scheduleEnabled"
          value="true"
          className="size-4 rounded border"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
          disabled={disabled}
        />
        <Label htmlFor={enabledId}>Enable schedule</Label>
      </div>

      {mode === "custom" ? (
        <p className="text-sm text-muted-foreground" data-slot="schedule-mode-status">
          Custom expression
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor={frequencyId}>Frequency</Label>
          <Select
            value={mode === "custom" ? "" : guided.frequency}
            onValueChange={handleFrequencyChange}
            disabled={disabled}
          >
            <SelectTrigger id={frequencyId} className="w-full">
              <SelectValue
                placeholder={mode === "custom" ? "Choose a frequency to overwrite" : "Frequency"}
              />
            </SelectTrigger>
            <SelectContent>
              {FREQUENCY_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div
          className={cn(
            "flex flex-col gap-3",
            mode === "custom" && "pointer-events-none opacity-60",
          )}
        >
          {mode === "guided" && guided.frequency === "weekly" ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor={weeklyDayId}>Day</Label>
              <Select
                value={String(guided.daysOfWeek[0] ?? 1)}
                onValueChange={handleWeeklyDayChange}
                disabled={guidedControlsDisabled}
              >
                <SelectTrigger id={weeklyDayId} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAY_LABELS.map((label, day) => (
                    <SelectItem key={label} value={String(day)}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {mode === "guided" && guided.frequency === "custom" ? (
            <div className="flex flex-col gap-2">
              <Label>Days</Label>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Custom weekdays">
                {DAY_LABELS.map((label, day) => {
                  const selected = guided.daysOfWeek.includes(day);
                  return (
                    <button
                      key={label}
                      type="button"
                      disabled={guidedControlsDisabled}
                      aria-pressed={selected}
                      onClick={() => handleCustomDayToggle(day)}
                      className={cn(
                        "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                        selected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input bg-background text-foreground hover:bg-accent",
                        guidedControlsDisabled && "cursor-not-allowed opacity-50",
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor={hourId}>Hour</Label>
              <Select
                value={String(guided.hour)}
                onValueChange={handleHourChange}
                disabled={guidedControlsDisabled}
              >
                <SelectTrigger id={hourId} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOUR_OPTIONS.map((hour) => (
                    <SelectItem key={hour} value={String(hour)}>
                      {hour}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={minuteId}>Minute</Label>
              <Select
                value={String(guided.minute)}
                onValueChange={handleMinuteChange}
                disabled={guidedControlsDisabled}
              >
                <SelectTrigger id={minuteId} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MINUTE_OPTIONS.map((minute) => (
                    <SelectItem key={minute} value={String(minute)}>
                      {String(minute).padStart(2, "0")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={timezoneId}>Timezone</Label>
        <TimezoneCombobox
          id={timezoneId}
          value={timezone}
          onValueChange={setTimezone}
          disabled={disabled}
        />
        <input type="hidden" name="scheduleTimezone" value={timezone} />
      </div>

      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger
          id={advancedId}
          type="button"
          disabled={disabled}
          className="flex w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          Advanced
          <ChevronDownIcon
            className={cn(
              "size-4 text-muted-foreground transition-transform",
              advancedOpen && "rotate-180",
            )}
          />
        </CollapsibleTrigger>
        {/*
          forceMount keeps scheduleCron in the DOM while collapsed so form submit
          still includes the field (Collapsed-submit pin).
        */}
        <CollapsibleContent forceMount className="data-[state=closed]:hidden">
          <div className="mt-2 flex flex-col gap-2">
            <Label htmlFor={cronId}>Cron expression</Label>
            <Input
              id={cronId}
              name="scheduleCron"
              className="font-mono"
              value={cron}
              onChange={(event) => handleAdvancedCronChange(event.target.value)}
              placeholder="0 9 * * 1-5"
              disabled={disabled}
            />
            <p className="text-xs text-muted-foreground">
              Five fields: minute hour day-of-month month day-of-week. Example: 0 9 * * 1-5
            </p>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <p className="text-sm text-muted-foreground" data-slot="schedule-next-fire">
        Next fire: {nextFireDisplay}
      </p>
    </>
  );
}
