"use client";

import { useEffect, useRef, useState } from "react";
import { SORTS, type Filters, type RawInputs, type SortBy } from "@/lib/eventFilters";

interface Props {
  filters: Filters;
  raw: RawInputs;
  showing: number;
  total: number;
  narrowed: boolean;
  onSort: (sort: SortBy) => void;
  onRaw: (raw: Partial<RawInputs>) => void;
  onSpareOnly: (spareOnly: boolean) => void;
  onClear: () => void;
}

export function EventFilters({
  filters,
  raw,
  showing,
  total,
  narrowed,
  onSort,
  onRaw,
  onSpareOnly,
  onClear,
}: Props) {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onPointer(event: MouseEvent) {
      if (menu.current && !menu.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = countActive(filters);

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-t border-rule py-4">
      <div className="flex items-center gap-3">
        <label className="eyebrow text-muted" htmlFor="sort">
          Sort by
        </label>
        <select
          id="sort"
          value={filters.sort}
          onChange={(event) => onSort(event.target.value as SortBy)}
          className="border border-rule bg-card px-3 py-2 text-sm text-ink outline-none focus:border-ink"
        >
          {SORTS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="relative" ref={menu}>
        <button
          onClick={() => setOpen((was) => !was)}
          aria-expanded={open}
          aria-haspopup="dialog"
          className={`eyebrow flex items-center gap-2 border px-3 py-2 transition ${
            open || active > 0
              ? "border-ink text-ink"
              : "border-rule text-muted hover:border-ink hover:text-ink"
          }`}
        >
          <FilterIcon />
          Filter
          {active > 0 && (
            <span className="bg-accent px-1.5 py-0.5 text-[10px] leading-none text-paper">
              {active}
            </span>
          )}
        </button>

        {open && (
          <div
            role="dialog"
            aria-label="Filter events"
            className="absolute right-0 z-20 mt-2 w-72 border border-rule bg-card p-5 shadow-lg"
          >
            <div>
              <span className="eyebrow block pb-2 text-muted">Price</span>
              <div className="flex items-center gap-2">
                <Money
                  value={raw.min}
                  placeholder="Min"
                  onChange={(min) => onRaw({ min })}
                />
                <span className="text-xs text-muted">to</span>
                <Money
                  value={raw.max}
                  placeholder="Max"
                  onChange={(max) => onRaw({ max })}
                />
              </div>
            </div>

            <div className="mt-5">
              <span className="eyebrow block pb-2 text-muted">Date</span>
              <div className="space-y-2">
                <Day value={raw.from} onChange={(from) => onRaw({ from })} />
                <Day value={raw.until} onChange={(until) => onRaw({ until })} />
              </div>
            </div>

            <label className="mt-5 flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={filters.spareOnly}
                onChange={(event) => onSpareOnly(event.target.checked)}
                className="sr-only"
              />
              <span
                aria-hidden
                className={`h-2.5 w-2.5 border transition ${
                  filters.spareOnly
                    ? "border-accent bg-accent"
                    : "border-rule bg-transparent"
                }`}
              />
              <span
                className={`eyebrow ${
                  filters.spareOnly ? "text-ink" : "text-muted"
                }`}
              >
                Only with tickets spare
              </span>
            </label>

            <div className="mt-6 flex items-center justify-between border-t border-rule pt-4">
              <button
                onClick={onClear}
                disabled={active === 0}
                className="eyebrow text-muted transition hover:text-ink disabled:opacity-40"
              >
                Clear all
              </button>
              <button
                onClick={() => setOpen(false)}
                className="eyebrow bg-ink px-4 py-2 text-paper transition hover:bg-accent"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>

      {narrowed && (
        <p className="w-full text-xs text-muted">
          {showing} of {total}
          {showing === 0 ? ". Nothing matches." : ""}
        </p>
      )}
    </div>
  );
}

function countActive(filters: Filters): number {
  let count = 0;
  if (filters.minInCents !== null || filters.maxInCents !== null) {
    count += 1;
  }
  if (filters.from !== null || filters.until !== null) {
    count += 1;
  }
  if (filters.spareOnly) {
    count += 1;
  }
  return count;
}

function FilterIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M1.5 3.5h13M4 8h8M6.5 12.5h3" />
    </svg>
  );
}

function Money({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder: string;
  onChange: (next: string) => void;
}) {
  return (
    <span className="flex flex-1 items-baseline border border-rule px-2 focus-within:border-ink">
      <span className="text-xs text-muted">$</span>
      <input
        value={value}
        onChange={(event) =>
          onChange(event.target.value.replace(/[^0-9.]/g, ""))
        }
        inputMode="decimal"
        placeholder={placeholder}
        className="w-full bg-transparent py-1.5 pl-1 text-sm outline-none placeholder:text-muted"
      />
    </span>
  );
}

function Day({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      type="date"
      className="w-full border border-rule bg-transparent px-2 py-1.5 text-sm text-ink outline-none focus:border-ink"
    />
  );
}
