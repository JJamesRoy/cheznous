"use client";

import { UserRound } from "lucide-react";
import { cn } from "@/lib/ui/cn";
import { Avatar } from "./avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";

export type Assignee = { id: string; name: string; avatarUrl?: string | null; tone?: "a" | "b" | "joint" | "neutral" };

export type AssigneePickerProps = {
  people: Assignee[];
  value: string | null;
  onValueChange: (id: string | null) => void;
  /** Offer "Personne" (unassigned). Default true. */
  allowUnassigned?: boolean;
  /** Show the selected name next to the avatar. */
  showName?: boolean;
  label?: string;
  className?: string;
};

const NONE = "__none__";

/** Avatar button that opens a menu to pick who is responsible. */
export function AssigneePicker({
  people,
  value,
  onValueChange,
  allowUnassigned = true,
  showName = false,
  label = "Responsable",
  className,
}: AssigneePickerProps) {
  const selected = people.find((person) => person.id === value) ?? null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${label} : ${selected ? selected.name : "personne"}`}
        className={cn(
          "pressable inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-full px-1.5 text-base text-fg-muted hover:bg-surface-2 md:h-8 md:min-w-8 md:px-1",
          "data-[state=open]:bg-surface-2",
          className,
        )}
      >
        {selected ? (
          <Avatar name={selected.name} src={selected.avatarUrl} tone={selected.tone} size="sm" decorative />
        ) : (
          <span className="flex size-6 items-center justify-center rounded-full border border-dashed border-gray-8 text-fg-subtle">
            <UserRound className="size-3.5" aria-hidden />
          </span>
        )}
        {showName ? (
          <span className="pr-1.5 text-fg">{selected ? selected.name : "Personne"}</span>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={value ?? NONE}
          onValueChange={(next) => onValueChange(next === NONE ? null : next)}
        >
          {people.map((person) => (
            <DropdownMenuRadioItem
              key={person.id}
              value={person.id}
              icon={<Avatar name={person.name} src={person.avatarUrl} tone={person.tone} size="sm" decorative />}
            >
              {person.name}
            </DropdownMenuRadioItem>
          ))}
          {allowUnassigned ? (
            <DropdownMenuRadioItem
              value={NONE}
              icon={
                <span className="flex size-6 items-center justify-center rounded-full border border-dashed border-gray-8 text-fg-subtle">
                  <UserRound className="size-3.5" aria-hidden />
                </span>
              }
            >
              Personne
            </DropdownMenuRadioItem>
          ) : null}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
