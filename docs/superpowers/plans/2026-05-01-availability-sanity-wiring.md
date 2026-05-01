# /availability Sanity Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `/availability` (Schedules + Advanced settings tabs) to read/write the user's Sanity `availabilityType` document so changes persist across reloads.

**Architecture:** Server Component shell at `app/(admin)/availability/page.tsx` ensures-or-fetches the doc with `_id = availability.${clerkId}` and renders a new `<AvailabilityEditor>` client component. Two scoped server actions (`saveSchedules`, `saveAdvanced`) plus a one-shot `bootstrapTimezoneIfDefault` action handle writes via the existing `serverClient`.

**Tech Stack:** Next.js 16.2.4, React 19.2.4, `@clerk/nextjs/server` for auth, `next-sanity` (`serverClient` already wired with `SANITY_API_WRITE_TOKEN`), `framer-motion`, `lucide-react`. No test runner — verification is manual on the dev server, per the spec.

**Spec:** [../specs/2026-05-01-availability-sanity-wiring-design.md](../specs/2026-05-01-availability-sanity-wiring-design.md)

**Branch:** Continue on `feat/sanity-schemas-design`.

---

## Why no automated tests?

The spec deliberately defers test runner setup. Each task therefore replaces the classic "write failing test → make it pass" steps with **"implement → verify manually on the dev server → commit."** The schema's existing Sanity validation rules act as the integration-test surface for save errors.

If you stop and add a test runner mid-plan, you've drifted out of scope — finish the plan, then propose a follow-up.

---

## File Structure

**Created:**
- `app/(admin)/availability/types.ts` — shared TypeScript types for the editor's form state and the doc shape returned to the client.
- `app/(admin)/availability/defaults.ts` — `defaultSundayFirstSchedule()` and other defaults used by both the server (when creating a missing doc) and the client (just for type checks; never re-exported as a UI default).
- `app/(admin)/availability/actions.ts` — three server actions: `saveSchedules`, `saveAdvanced`, `bootstrapTimezoneIfDefault`.
- `app/(admin)/availability/AvailabilityEditor.tsx` — client component holding the existing JSX from `page.tsx`, re-wired to read state from props and call the server actions on Save.

**Modified:**
- `app/(admin)/availability/page.tsx` — rewritten as an async server component. Drops `"use client"`, drops the local `defaultSchedule` constant and all `useState` hooks; ensures-or-fetches the doc and renders `<AvailabilityEditor initialData={doc} />`.

No other files in the repo are touched. The Calendar settings tab JSX moves into `AvailabilityEditor.tsx` unchanged — it remains static.

---

## Task 1: Add shared types and the default-schedule helper

**Files:**
- Create: `app/(admin)/availability/types.ts`
- Create: `app/(admin)/availability/defaults.ts`

- [ ] **Step 1: Create the types file**

Path: `app/(admin)/availability/types.ts`

```ts
export type DayCode = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'

export interface TimeInterval {
  _key: string
  start: string // 'HH:mm', 24-hour
  end: string   // 'HH:mm', 24-hour
}

export interface DaySchedule {
  _key: DayCode
  day: DayCode
  enabled: boolean
  intervals: TimeInterval[]
}

export interface AvailabilityDoc {
  _id: string
  _type: 'availabilityType'
  user: { _type: 'reference'; _ref: string }
  timezone: string
  weeklySchedule: DaySchedule[]
  minimumNotice: number
  bufferBefore: number
  bufferAfter: number
}
```

- [ ] **Step 2: Create the defaults file**

Path: `app/(admin)/availability/defaults.ts`

```ts
import { randomUUID } from 'crypto'
import type { DaySchedule } from './types'

// Sun-first to match the existing UI ordering. Schema validation is order-agnostic.
const SUN_FIRST: Array<{ day: DaySchedule['day']; enabled: boolean }> = [
  { day: 'sun', enabled: false },
  { day: 'mon', enabled: true },
  { day: 'tue', enabled: true },
  { day: 'wed', enabled: true },
  { day: 'thu', enabled: true },
  { day: 'fri', enabled: true },
  { day: 'sat', enabled: false },
]

export function defaultSundayFirstSchedule(): DaySchedule[] {
  return SUN_FIRST.map(({ day, enabled }) => ({
    _key: day,
    day,
    enabled,
    intervals: [{ _key: randomUUID(), start: '09:00', end: '17:00' }],
  }))
}
```

> Note: `defaults.ts` imports `crypto` from Node, which means it must only be imported from server code (`page.tsx` and `actions.ts`). Do not import it from `AvailabilityEditor.tsx`.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `pnpm exec tsc --noEmit`
Expected: No errors related to the two new files. (Pre-existing errors elsewhere — if any — are not in scope.)

- [ ] **Step 4: Commit**

```bash
git add app/(admin)/availability/types.ts app/(admin)/availability/defaults.ts
git commit -m "feat(availability): add shared types and default schedule helper"
```

---

## Task 2: Add server actions

**Files:**
- Create: `app/(admin)/availability/actions.ts`

- [ ] **Step 1: Create the actions file with the three server actions**

Path: `app/(admin)/availability/actions.ts`

```ts
'use server'

import { auth } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'

import { serverClient } from '@/sanity/lib/serverClient'
import type { DaySchedule } from './types'

const docIdFor = (clerkId: string) => `availability.${clerkId}`

type Result = { ok: true } | { ok: false; error: string }

async function requireClerkId(): Promise<string> {
  const { userId } = await auth()
  if (!userId) throw new Error('Unauthenticated')
  return userId
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return 'Unknown error'
  }
}

export async function saveSchedules(input: {
  weeklySchedule: DaySchedule[]
  timezone: string
}): Promise<Result> {
  try {
    const clerkId = await requireClerkId()
    await serverClient
      .patch(docIdFor(clerkId))
      .set({
        weeklySchedule: input.weeklySchedule,
        timezone: input.timezone,
      })
      .commit()
    revalidatePath('/availability')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: toErrorMessage(err) }
  }
}

export async function saveAdvanced(input: {
  minimumNotice: number
  bufferBefore: number
  bufferAfter: number
}): Promise<Result> {
  try {
    const clerkId = await requireClerkId()
    await serverClient
      .patch(docIdFor(clerkId))
      .set({
        minimumNotice: input.minimumNotice,
        bufferBefore: input.bufferBefore,
        bufferAfter: input.bufferAfter,
      })
      .commit()
    revalidatePath('/availability')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: toErrorMessage(err) }
  }
}

export async function bootstrapTimezoneIfDefault(detected: string): Promise<void> {
  if (!detected || detected === 'UTC') return
  try {
    const clerkId = await requireClerkId()
    const id = docIdFor(clerkId)
    // Only patch if the doc still has the placeholder timezone — keeps this idempotent.
    const current = await serverClient.fetch<string | null>(
      `*[_id == $id][0].timezone`,
      { id },
    )
    if (current === 'UTC') {
      await serverClient.patch(id).set({ timezone: detected }).commit()
      revalidatePath('/availability')
    }
  } catch {
    // Best-effort — never throw to the client.
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `pnpm exec tsc --noEmit`
Expected: No errors in `actions.ts`.

- [ ] **Step 3: Verify lint passes**

Run: `pnpm exec eslint app/(admin)/availability/actions.ts`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add app/(admin)/availability/actions.ts
git commit -m "feat(availability): add saveSchedules, saveAdvanced, and timezone bootstrap server actions"
```

---

## Task 3: Refactor `page.tsx` into a server component shell

**Files:**
- Modify: `app/(admin)/availability/page.tsx` (rewrite — entire file replaced)

> Important: this task removes the existing client UI from `page.tsx`. The UI stops working between this commit and Task 4. That's fine — they're consecutive commits on the same branch and we don't push between them. If you need the branch to stay green between commits, do Tasks 3 and 4 as a single commit instead.

- [ ] **Step 1: Replace `page.tsx` with the server component shell**

Path: `app/(admin)/availability/page.tsx`

```tsx
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'

import { serverClient } from '@/sanity/lib/serverClient'
import AvailabilityEditor from './AvailabilityEditor'
import { defaultSundayFirstSchedule } from './defaults'
import type { AvailabilityDoc } from './types'

export default async function AvailabilityPage() {
  const { userId: clerkId } = await auth()
  if (!clerkId) redirect('/')

  const id = `availability.${clerkId}`
  let doc = await serverClient.getDocument<AvailabilityDoc>(id)
  if (!doc) {
    doc = (await serverClient.createIfNotExists({
      _id: id,
      _type: 'availabilityType',
      user: { _type: 'reference', _ref: `user.${clerkId}` },
      timezone: 'UTC',
      weeklySchedule: defaultSundayFirstSchedule(),
      minimumNotice: 240,
      bufferBefore: 0,
      bufferAfter: 0,
    })) as AvailabilityDoc
  }

  return <AvailabilityEditor initialData={doc} />
}
```

> Note: `AvailabilityEditor` does not exist yet — TypeScript will error on the import. That's expected. It gets created in Task 4. Don't run the dev server between Task 3 and Task 4.

- [ ] **Step 2: Commit (as part of Task 4 — see the warning above)**

Skip the commit here. Move directly to Task 4 and commit them together at the end of Task 4.

---

## Task 4: Create `AvailabilityEditor.tsx` (client component)

**Files:**
- Create: `app/(admin)/availability/AvailabilityEditor.tsx`

This is the largest task — we lift the existing ~310-line client UI out of the old `page.tsx` and re-wire it to read from props instead of `useState(defaultSchedule)`. **No animations, classNames, or visual structure change.** We also do not yet bind the Save buttons to the server actions — that happens in Tasks 5 and 6.

- [ ] **Step 1: Create `AvailabilityEditor.tsx` with the lifted JSX, state from props, and inert Save buttons**

Path: `app/(admin)/availability/AvailabilityEditor.tsx`

```tsx
"use client";

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, Plus, Trash2, Globe, Check, Calendar } from 'lucide-react';

import type { AvailabilityDoc, DayCode, DaySchedule, TimeInterval } from './types';

const DAY_LABELS: Record<DayCode, string> = {
  sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat',
};
const DAY_ORDER: DayCode[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const TABS = ['Schedules', 'Calendar settings', 'Advanced settings'] as const;
type Tab = typeof TABS[number];

function makeIntervalKey(): string {
  // Browser: window.crypto.randomUUID() exists in all modern browsers.
  return crypto.randomUUID();
}

export default function AvailabilityEditor({ initialData }: { initialData: AvailabilityDoc }) {
  // Sort the incoming weekly schedule into UI's Sun-first order so toggles align with DAY_ORDER.
  const [schedule, setSchedule] = useState<DaySchedule[]>(() =>
    DAY_ORDER.map((d) => {
      const found = initialData.weeklySchedule.find((x) => x.day === d);
      return found ?? {
        _key: d,
        day: d,
        enabled: false,
        intervals: [{ _key: makeIntervalKey(), start: '09:00', end: '17:00' }],
      };
    })
  );
  const [timezone, setTimezone] = useState<string>(initialData.timezone);
  const [minimumNotice, setMinimumNotice] = useState<number>(initialData.minimumNotice);
  const [bufferBefore, setBufferBefore] = useState<number>(initialData.bufferBefore);
  const [bufferAfter, setBufferAfter] = useState<number>(initialData.bufferAfter);
  const [activeTab, setActiveTab] = useState<Tab>('Schedules');

  const toggleDay = (dayIndex: number) => {
    setSchedule((prev) => {
      const next = [...prev];
      next[dayIndex] = { ...next[dayIndex], enabled: !next[dayIndex].enabled };
      return next;
    });
  };

  const updateInterval = (dayIndex: number, intervalIndex: number, field: 'start' | 'end', value: string) => {
    setSchedule((prev) => {
      const next = [...prev];
      const day = { ...next[dayIndex] };
      const intervals = [...day.intervals];
      intervals[intervalIndex] = { ...intervals[intervalIndex], [field]: value };
      day.intervals = intervals;
      next[dayIndex] = day;
      return next;
    });
  };

  const addInterval = (dayIndex: number) => {
    setSchedule((prev) => {
      const next = [...prev];
      const day = { ...next[dayIndex] };
      day.intervals = [...day.intervals, { _key: makeIntervalKey(), start: '09:00', end: '17:00' }];
      next[dayIndex] = day;
      return next;
    });
  };

  const removeInterval = (dayIndex: number, intervalIndex: number) => {
    setSchedule((prev) => {
      const next = [...prev];
      const day = { ...next[dayIndex] };
      day.intervals = day.intervals.filter((_, i) => i !== intervalIndex);
      next[dayIndex] = day;
      return next;
    });
  };

  return (
    <div className="relative w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-20 min-h-[calc(100vh-80px)] flex flex-col z-10 overflow-hidden">
      {/* Background Colorful Shapes */}
      <div className="absolute top-[0%] right-[0%] w-[100%] h-[100%] z-0 pointer-events-none">
        <motion.div
          animate={{ y: ["0%", "-5%", "0%"], rotate: [12, 15, 12] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-[-10%] right-[0%] w-[60%] h-[60%] bg-[#0CA5E9] rounded-tl-[100px] rounded-br-[80px] rounded-bl-[140px] opacity-10 blur-[60px]"
        />
        <motion.div
          animate={{ y: ["0%", "8%", "0%"], rotate: [-6, -2, -6] }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 1 }}
          className="absolute bottom-[20%] left-[-10%] w-[50%] h-[50%] bg-[#D946EF] rounded-tl-[140px] rounded-br-[100px] rounded-bl-[60px] opacity-10 blur-[60px]"
        />
      </div>

      <div className="relative z-10 w-full mb-8 text-center lg:text-left">
        <h1 className="text-4xl lg:text-5xl font-extrabold text-[#0B3558] tracking-tight mb-4">Availability</h1>
        <p className="text-lg text-slate-500 max-w-2xl mx-auto lg:mx-0 leading-relaxed">
          Configure your standard hours. These will be applied to all your event types by default.
        </p>
      </div>

      <div className="relative z-10 w-full flex items-center border-b border-gray-200 mb-8 overflow-x-auto hide-scrollbar">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`whitespace-nowrap px-6 py-4 font-semibold text-sm transition-all relative ${
              activeTab === tab ? 'text-[#1A73E8]' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {tab}
            {activeTab === tab && (
              <motion.div
                layoutId="activeTabIndicator"
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#1A73E8]"
                initial={false}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
              />
            )}
          </button>
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="relative z-10 bg-white/95 backdrop-blur-xl rounded-[2rem] shadow-[0_20px_50px_-12px_rgba(0,0,0,0.15)] border border-white/40 overflow-hidden w-full"
      >
        <AnimatePresence mode="wait">
          {activeTab === 'Schedules' && (
            <motion.div key="schedules" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
              <div className="px-6 sm:px-10 py-8 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-6 bg-white/60">
                <div>
                  <h2 className="text-2xl font-bold text-[#0B3558] tracking-tight">Working Hours</h2>
                  <div className="flex items-center text-sm text-slate-500 mt-2 gap-2">
                    <div className="bg-slate-100 p-1.5 rounded-full text-slate-600"><Globe className="w-4 h-4" /></div>
                    <span className="font-medium">{timezone}</span>
                  </div>
                </div>
                <button className="bg-[#1A73E8] hover:bg-[#155DB1] text-white px-6 py-3 rounded-xl font-semibold transition-all duration-200 text-sm shadow-md hover:shadow-lg flex items-center justify-center gap-2">
                  <Check className="w-4 h-4" />
                  Save changes
                </button>
              </div>

              <div className="p-6 sm:px-10 sm:py-8">
                <div className="flex flex-col gap-8">
                  {schedule.map((dayItem, dIndex) => (
                    <div key={dayItem._key} className="flex flex-col sm:flex-row sm:items-start gap-4 pb-8 border-b border-gray-50 last:border-0 last:pb-0">
                      <div className="w-32 flex items-center gap-4 pt-1 sm:pt-2">
                        <button
                          onClick={() => toggleDay(dIndex)}
                          className={`w-12 h-7 rounded-full transition-colors relative flex items-center shadow-inner ${dayItem.enabled ? 'bg-[#10B981]' : 'bg-slate-200'}`}
                        >
                          <motion.div layout className={`w-5 h-5 bg-white rounded-full shadow-sm absolute ${dayItem.enabled ? 'right-1' : 'left-1'}`} />
                        </button>
                        <span className={`text-base font-bold ${dayItem.enabled ? 'text-[#0B3558]' : 'text-slate-400'}`}>{DAY_LABELS[dayItem.day]}</span>
                      </div>

                      <div className="flex-1 flex flex-col gap-3">
                        {!dayItem.enabled ? (
                          <div className="text-slate-400 pt-1 sm:pt-2 font-medium bg-slate-50 px-4 py-2 rounded-lg inline-block w-fit">Unavailable</div>
                        ) : (
                          dayItem.intervals.map((interval, iIndex) => (
                            <motion.div
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              key={interval._key}
                              className="flex items-center gap-3 flex-wrap"
                            >
                              <div className="flex items-center gap-3">
                                <div className="relative">
                                  <input
                                    type="time"
                                    value={interval.start}
                                    onChange={(e) => updateInterval(dIndex, iIndex, 'start', e.target.value)}
                                    className="bg-white border border-gray-200 text-[#0B3558] font-semibold rounded-xl pl-4 pr-2 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A73E8]/30 focus:border-[#1A73E8] transition-all shadow-sm"
                                  />
                                </div>
                                <span className="text-slate-400 font-bold">-</span>
                                <div className="relative">
                                  <input
                                    type="time"
                                    value={interval.end}
                                    onChange={(e) => updateInterval(dIndex, iIndex, 'end', e.target.value)}
                                    className="bg-white border border-gray-200 text-[#0B3558] font-semibold rounded-xl pl-4 pr-2 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A73E8]/30 focus:border-[#1A73E8] transition-all shadow-sm"
                                  />
                                </div>
                              </div>

                              <div className="flex items-center gap-1 ml-2">
                                {dayItem.intervals.length > 1 && (
                                  <button
                                    onClick={() => removeInterval(dIndex, iIndex)}
                                    className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                                    title="Remove time slot"
                                  >
                                    <Trash2 className="w-5 h-5" />
                                  </button>
                                )}

                                {iIndex === dayItem.intervals.length - 1 && (
                                  <button
                                    onClick={() => addInterval(dIndex)}
                                    className="p-2 text-slate-400 hover:text-[#1A73E8] hover:bg-blue-50 rounded-lg transition-all"
                                    title="Add time slot"
                                  >
                                    <Plus className="w-5 h-5" />
                                  </button>
                                )}
                              </div>
                            </motion.div>
                          ))
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'Calendar settings' && (
            <motion.div key="calendar-settings" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
              {/* UNCHANGED — copied verbatim from the old page.tsx */}
              <div className="px-6 sm:px-10 py-8 border-b border-gray-100 bg-white/60">
                <h2 className="text-2xl font-bold text-[#0B3558] tracking-tight">Connected Calendars</h2>
              </div>
              <div className="p-6 sm:px-10 sm:py-8">
                <div className="flex items-center justify-between p-5 border border-gray-200 rounded-2xl mb-8 bg-white shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center border border-slate-200">
                      <Calendar className="w-6 h-6 text-slate-600" />
                    </div>
                    <div>
                      <h3 className="font-bold text-[#0B3558] text-lg">Google Calendar</h3>
                      <p className="text-sm text-slate-500 font-medium mt-0.5">user@example.com</p>
                    </div>
                  </div>
                  <button className="text-[#1A73E8] text-sm font-bold hover:underline px-4 py-2 hover:bg-blue-50 rounded-lg transition-colors">Edit</button>
                </div>

                <div className="mb-8">
                  <h3 className="font-bold text-[#0B3558] mb-2 text-lg">Check for conflicts</h3>
                  <p className="text-sm text-slate-500 mb-4">Calendry will check these calendars for conflicts to prevent double bookings.</p>
                  <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-xl border border-slate-200 w-full max-w-md">
                    <input type="checkbox" defaultChecked className="w-5 h-5 rounded text-[#1A73E8] border-gray-300 focus:ring-[#1A73E8]" />
                    <span className="text-sm font-semibold text-[#0B3558]">user@example.com</span>
                  </div>
                </div>

                <div>
                  <h3 className="font-bold text-[#0B3558] mb-2 text-lg">Add to calendar</h3>
                  <p className="text-sm text-slate-500 mb-4">New events will be added to this calendar.</p>
                  <select className="w-full max-w-md bg-white border border-gray-200 text-[#0B3558] font-semibold rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A73E8]/30 focus:border-[#1A73E8] transition-all shadow-sm">
                    <option>user@example.com</option>
                  </select>
                </div>

                <div className="mt-8 pt-6 border-t border-gray-100">
                  <button className="bg-[#1A73E8] hover:bg-[#155DB1] text-white px-6 py-3 rounded-xl font-semibold transition-all duration-200 text-sm shadow-md hover:shadow-lg flex items-center justify-center gap-2">
                    <Check className="w-4 h-4" />
                    Save changes
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'Advanced settings' && (
            <motion.div key="advanced-settings" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
              <div className="px-6 sm:px-10 py-8 border-b border-gray-100 bg-white/60">
                <h2 className="text-2xl font-bold text-[#0B3558] tracking-tight">Advanced Settings</h2>
              </div>
              <div className="p-6 sm:px-10 sm:py-8">
                <div className="mb-8">
                  <h3 className="font-bold text-[#0B3558] mb-2 text-lg">Minimum Notice</h3>
                  <p className="text-sm text-slate-500 mb-4">Avoid last minute bookings.</p>
                  <select
                    value={minimumNotice}
                    onChange={(e) => setMinimumNotice(Number(e.target.value))}
                    className="w-full max-w-xs bg-white border border-gray-200 text-[#0B3558] font-semibold rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A73E8]/30 focus:border-[#1A73E8] transition-all shadow-sm"
                  >
                    <option value={240}>4 hours</option>
                    <option value={720}>12 hours</option>
                    <option value={1440}>24 hours</option>
                    <option value={2880}>48 hours</option>
                  </select>
                </div>

                <div className="mb-8">
                  <h3 className="font-bold text-[#0B3558] mb-2 text-lg">Buffer before</h3>
                  <p className="text-sm text-slate-500 mb-4">Add extra time before each event.</p>
                  <select
                    value={bufferBefore}
                    onChange={(e) => setBufferBefore(Number(e.target.value))}
                    className="w-full max-w-xs bg-white border border-gray-200 text-[#0B3558] font-semibold rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A73E8]/30 focus:border-[#1A73E8] transition-all shadow-sm"
                  >
                    <option value={0}>0 minutes</option>
                    <option value={15}>15 minutes</option>
                    <option value={30}>30 minutes</option>
                    <option value={60}>1 hour</option>
                  </select>
                </div>

                <div className="mb-8">
                  <h3 className="font-bold text-[#0B3558] mb-2 text-lg">Buffer after</h3>
                  <p className="text-sm text-slate-500 mb-4">Add extra time after each event.</p>
                  <select
                    value={bufferAfter}
                    onChange={(e) => setBufferAfter(Number(e.target.value))}
                    className="w-full max-w-xs bg-white border border-gray-200 text-[#0B3558] font-semibold rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A73E8]/30 focus:border-[#1A73E8] transition-all shadow-sm"
                  >
                    <option value={0}>0 minutes</option>
                    <option value={15}>15 minutes</option>
                    <option value={30}>30 minutes</option>
                    <option value={60}>1 hour</option>
                  </select>
                </div>

                <div className="mt-8 pt-6 border-t border-gray-100">
                  <button className="bg-[#1A73E8] hover:bg-[#155DB1] text-white px-6 py-3 rounded-xl font-semibold transition-all duration-200 text-sm shadow-md hover:shadow-lg flex items-center justify-center gap-2">
                    <Check className="w-4 h-4" />
                    Save changes
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
```

> Notes:
> - The `_key` for each interval is preserved across edits — we never regenerate it inside `updateInterval` / `removeInterval` / `addInterval` (only `addInterval` mints a new one for the new row).
> - The Save buttons are intentionally inert — Tasks 5 and 6 wire them up.
> - The `Clock` import is unused right now but matches the lifted source. Remove it if eslint complains.
> - The Calendar settings tab is copied verbatim. Do not refactor it.

- [ ] **Step 2: Run dev server and verify the page renders unchanged**

Run: `pnpm dev`
Open: `http://localhost:3000/availability` while signed in
Expected:
- Page renders identically to before, including the floating animated shapes, the three tabs, the day toggles with framer-motion knob slide, and the time inputs.
- Day labels read 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat' from top to bottom.
- The Working Hours header shows the timezone as `UTC` (since the doc was just created with that default). It will flip to your detected zone in Task 7.
- Save buttons are clickable but do nothing.
- Open Sanity Studio (`/studio`), navigate to Schedule, confirm a doc with `_id: availability.user_<your-clerk-id>` exists with `weeklySchedule` Mon–Fri 9–17 enabled and Sat/Sun disabled.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `pnpm exec tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Verify lint passes**

Run: `pnpm exec eslint app/(admin)/availability/`
Expected: No errors. If `Clock` is flagged unused, remove the import.

- [ ] **Step 5: Commit Tasks 3 and 4 together**

```bash
git add app/(admin)/availability/page.tsx app/(admin)/availability/AvailabilityEditor.tsx
git commit -m "feat(availability): split page into server shell + client editor"
```

---

## Task 5: Wire the Schedules tab Save button

**Files:**
- Modify: `app/(admin)/availability/AvailabilityEditor.tsx`

This adds dirty tracking, pending state, success pill, and error banner for the Schedules tab only. The Advanced tab is wired in Task 6 with the same pattern.

- [ ] **Step 1: Add the imports and per-tab snapshot/state at the top of the component**

Path: `app/(admin)/availability/AvailabilityEditor.tsx`

At the top of the file, add to the `react` import and add the actions import:

```tsx
import React, { useRef, useState, useTransition } from 'react';
// ...existing imports
import { saveSchedules } from './actions';
```

Inside the `AvailabilityEditor` component, after the existing `useState` declarations, add:

```tsx
const schedulesSnapshotRef = useRef<{ weeklySchedule: DaySchedule[]; timezone: string }>({
  weeklySchedule: initialData.weeklySchedule,
  timezone: initialData.timezone,
});
const [schedulesPending, startSchedulesTransition] = useTransition();
const [schedulesSavedAt, setSchedulesSavedAt] = useState<number | null>(null);
const [schedulesError, setSchedulesError] = useState<string | null>(null);

const isSchedulesDirty =
  JSON.stringify({ weeklySchedule: schedule, timezone }) !==
  JSON.stringify(schedulesSnapshotRef.current);

const onSaveSchedules = () => {
  setSchedulesError(null);
  startSchedulesTransition(async () => {
    const result = await saveSchedules({ weeklySchedule: schedule, timezone });
    if (result.ok) {
      schedulesSnapshotRef.current = { weeklySchedule: schedule, timezone };
      setSchedulesSavedAt(Date.now());
      setTimeout(() => {
        setSchedulesSavedAt((cur) => (cur === Date.now() ? null : cur));
      }, 2000);
    } else {
      setSchedulesError(result.error);
    }
  });
};
```

> The `setTimeout` closure is intentionally a best-effort dismiss. If the user clicks Save again within 2s, the new timestamp wins; the auto-dismiss only fires for stale timestamps.

- [ ] **Step 2: Replace the Schedules tab Save button JSX**

Find the existing Schedules-tab Save button:

```tsx
<button className="bg-[#1A73E8] hover:bg-[#155DB1] text-white px-6 py-3 rounded-xl font-semibold transition-all duration-200 text-sm shadow-md hover:shadow-lg flex items-center justify-center gap-2">
  <Check className="w-4 h-4" />
  Save changes
</button>
```

Replace with:

```tsx
<div className="flex flex-col items-end gap-2">
  <div className="flex items-center gap-3">
    {schedulesSavedAt !== null && !schedulesPending && (
      <span className="text-sm font-semibold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full">Saved</span>
    )}
    <button
      onClick={onSaveSchedules}
      disabled={!isSchedulesDirty || schedulesPending}
      className="bg-[#1A73E8] hover:bg-[#155DB1] disabled:bg-slate-300 disabled:cursor-not-allowed text-white px-6 py-3 rounded-xl font-semibold transition-all duration-200 text-sm shadow-md hover:shadow-lg flex items-center justify-center gap-2"
    >
      {schedulesPending ? (
        <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
      ) : (
        <Check className="w-4 h-4" />
      )}
      Save changes
    </button>
  </div>
  {schedulesError && (
    <p className="text-sm font-medium text-red-600 bg-red-50 px-3 py-2 rounded-lg max-w-md">{schedulesError}</p>
  )}
</div>
```

- [ ] **Step 3: Run dev server and verify the Schedules round-trip works**

Run: `pnpm dev`
Open: `http://localhost:3000/availability`
Verify:
1. Save button is **disabled** on first load (no edits yet).
2. Toggle Wednesday off. Save button becomes **enabled**.
3. Click Save. Button shows a spinner, then a "Saved" pill appears for ~2s and the button returns to disabled.
4. Hard-reload the page. Wednesday is still off. Open Studio, confirm `weeklySchedule[].day == 'wed'` has `enabled: false`.
5. Toggle Wednesday back on. Save. Reload. Wednesday is on again.
6. Add a second interval to Tuesday (09:00–12:00 + 13:00–17:00). Save. Reload. Both intervals present in order.
7. Try removing the only interval on a day where there's just one — the trash button should be hidden. Add another interval first, then trash should appear on both rows.

- [ ] **Step 4: Verify lint and TypeScript**

Run: `pnpm exec tsc --noEmit && pnpm exec eslint app/(admin)/availability/`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add app/(admin)/availability/AvailabilityEditor.tsx
git commit -m "feat(availability): wire Schedules tab Save to saveSchedules server action"
```

---

## Task 6: Wire the Advanced tab Save button

**Files:**
- Modify: `app/(admin)/availability/AvailabilityEditor.tsx`

Same pattern as Task 5, but for `minimumNotice`, `bufferBefore`, `bufferAfter`.

- [ ] **Step 1: Add the import**

Path: `app/(admin)/availability/AvailabilityEditor.tsx`

Update the actions import to include `saveAdvanced`:

```tsx
import { saveSchedules, saveAdvanced } from './actions';
```

- [ ] **Step 2: Add the Advanced state, snapshot, and save handler**

Add after the Schedules-tab block from Task 5:

```tsx
const advancedSnapshotRef = useRef<{ minimumNotice: number; bufferBefore: number; bufferAfter: number }>({
  minimumNotice: initialData.minimumNotice,
  bufferBefore: initialData.bufferBefore,
  bufferAfter: initialData.bufferAfter,
});
const [advancedPending, startAdvancedTransition] = useTransition();
const [advancedSavedAt, setAdvancedSavedAt] = useState<number | null>(null);
const [advancedError, setAdvancedError] = useState<string | null>(null);

const isAdvancedDirty =
  JSON.stringify({ minimumNotice, bufferBefore, bufferAfter }) !==
  JSON.stringify(advancedSnapshotRef.current);

const onSaveAdvanced = () => {
  setAdvancedError(null);
  startAdvancedTransition(async () => {
    const result = await saveAdvanced({ minimumNotice, bufferBefore, bufferAfter });
    if (result.ok) {
      advancedSnapshotRef.current = { minimumNotice, bufferBefore, bufferAfter };
      setAdvancedSavedAt(Date.now());
      setTimeout(() => {
        setAdvancedSavedAt((cur) => (cur === Date.now() ? null : cur));
      }, 2000);
    } else {
      setAdvancedError(result.error);
    }
  });
};
```

- [ ] **Step 3: Replace the Advanced tab Save button JSX**

Find the existing Advanced-tab Save button (inside the `activeTab === 'Advanced settings'` block, at the bottom):

```tsx
<button className="bg-[#1A73E8] hover:bg-[#155DB1] text-white px-6 py-3 rounded-xl font-semibold transition-all duration-200 text-sm shadow-md hover:shadow-lg flex items-center justify-center gap-2">
  <Check className="w-4 h-4" />
  Save changes
</button>
```

Replace with:

```tsx
<div className="flex flex-col items-start gap-2">
  <div className="flex items-center gap-3">
    <button
      onClick={onSaveAdvanced}
      disabled={!isAdvancedDirty || advancedPending}
      className="bg-[#1A73E8] hover:bg-[#155DB1] disabled:bg-slate-300 disabled:cursor-not-allowed text-white px-6 py-3 rounded-xl font-semibold transition-all duration-200 text-sm shadow-md hover:shadow-lg flex items-center justify-center gap-2"
    >
      {advancedPending ? (
        <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
      ) : (
        <Check className="w-4 h-4" />
      )}
      Save changes
    </button>
    {advancedSavedAt !== null && !advancedPending && (
      <span className="text-sm font-semibold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full">Saved</span>
    )}
  </div>
  {advancedError && (
    <p className="text-sm font-medium text-red-600 bg-red-50 px-3 py-2 rounded-lg max-w-md">{advancedError}</p>
  )}
</div>
```

- [ ] **Step 4: Run dev server and verify the Advanced round-trip + per-tab save isolation**

Run: `pnpm dev`
Verify:
1. Switch to Advanced tab. Change Minimum Notice to 24 hours. Save. Reload. Still 24 hours.
2. Change Buffer before to 15 and Buffer after to 30. Save. Reload. Still 15 / 30.
3. **Per-tab isolation:** edit Schedules without saving (toggle Sunday on). Switch to Advanced. Edit Buffer before. Save Advanced. Reload. Schedules edit should be gone (Sunday off again — never saved); Advanced edit should persist.
4. Open Studio. Confirm the doc has the new `minimumNotice / bufferBefore / bufferAfter` values.

- [ ] **Step 5: Verify lint and TypeScript**

Run: `pnpm exec tsc --noEmit && pnpm exec eslint app/(admin)/availability/`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add app/(admin)/availability/AvailabilityEditor.tsx
git commit -m "feat(availability): wire Advanced tab Save with split bufferBefore/bufferAfter"
```

---

## Task 7: Add the timezone bootstrap effect

**Files:**
- Modify: `app/(admin)/availability/AvailabilityEditor.tsx`

When a brand-new user lands and the doc still has `timezone: 'UTC'`, detect the browser's timezone and patch the doc once.

- [ ] **Step 1: Add the imports and effect**

Path: `app/(admin)/availability/AvailabilityEditor.tsx`

Update the react import to include `useEffect`:

```tsx
import React, { useEffect, useRef, useState, useTransition } from 'react';
```

Update the actions import to include `bootstrapTimezoneIfDefault`:

```tsx
import { saveSchedules, saveAdvanced, bootstrapTimezoneIfDefault } from './actions';
```

Add this effect inside the component, after the state declarations:

```tsx
useEffect(() => {
  if (timezone !== 'UTC') return;
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!detected || detected === 'UTC') return;
  bootstrapTimezoneIfDefault(detected).then(() => {
    setTimezone(detected);
    schedulesSnapshotRef.current = { ...schedulesSnapshotRef.current, timezone: detected };
  });
  // Empty deps — fires once per mount. Idempotent thanks to the timezone !== 'UTC' guard.
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

> Note: We update the `schedulesSnapshotRef` after bootstrap so the timezone change isn't counted as user-driven dirtiness — the Save button stays disabled.

- [ ] **Step 2: Run dev server and verify**

Run: `pnpm dev`
Open the page in an incognito window and sign up as a brand-new Clerk user (or, in Sanity Studio, manually edit your existing doc's `timezone` back to `UTC` and reload the page).
Verify:
1. The Working Hours timezone label flips from `UTC` to your detected zone (e.g., `Europe/Berlin`, `America/Los_Angeles`) within ~1s of page load.
2. Save button stays disabled — no user dirtiness counted.
3. Refresh the page. Timezone is still your detected zone (not UTC). The bootstrap effect short-circuits because `timezone !== 'UTC'`.
4. Open Studio. Doc's `timezone` field shows the detected zone.

- [ ] **Step 3: Verify lint and TypeScript**

Run: `pnpm exec tsc --noEmit && pnpm exec eslint app/(admin)/availability/`
Expected: No errors. The `react-hooks/exhaustive-deps` disable-line keeps the lint clean.

- [ ] **Step 4: Commit**

```bash
git add app/(admin)/availability/AvailabilityEditor.tsx
git commit -m "feat(availability): browser-detected timezone bootstrap on first visit"
```

---

## Task 8: Final end-to-end verification

**Files:** None (manual verification only).

Run through the spec's full verification checklist on the dev server. If anything fails, fix it and add a follow-up task; do not skip.

- [ ] **Step 1: Brand-new-user path**

In an incognito window:
1. Sign up via Clerk → land on `/availability`.
2. Confirm Mon–Fri enabled with 09:00–17:00, Sat/Sun disabled.
3. Confirm timezone label flips from `UTC` to your detected zone within ~1s.
4. In Studio, confirm exactly one new `availabilityType` doc with `_id = availability.<clerkId>`.

- [ ] **Step 2: Schedule round-trip**

1. Toggle Wednesday off → Save → reload → Wednesday still off.
2. Toggle Wednesday back on → its previous interval (09:00–17:00) is still there.
3. Add a second interval to Tuesday (09:00–12:00 + 13:00–17:00) → Save → reload → both present.
4. Remove the second interval → Save → reload → only one interval on Tuesday.

- [ ] **Step 3: Advanced round-trip**

1. Switch to Advanced tab → set Minimum Notice = 24h, Buffer before = 15, Buffer after = 30 → Save → reload → values still selected.

- [ ] **Step 4: Validation rejection (optional but recommended)**

Open Studio, manually edit one of your doc's intervals to be `start: '17:00', end: '09:00'`. Studio should reject with "End time must be after start time" — confirms the schema is the validation source.

- [ ] **Step 5: Per-tab save isolation**

1. Edit Schedules without saving → switch to Advanced → edit Advanced → Save Advanced → reload → Schedules edits gone, Advanced edits persisted.

- [ ] **Step 6: Auth gate**

Sign out → visit `/availability` → redirected to `/`. (Already enforced by `(admin)/layout.tsx`; just confirming the new files don't break it.)

- [ ] **Step 7: Idempotency**

Hard-refresh the page 5 times. In Studio, confirm there is still exactly one `availabilityType` doc — no duplicates.

- [ ] **Step 8: Build + lint dry-run for Vercel parity**

Run: `pnpm build`
Expected: Build completes without errors. (This catches the kind of Next 16 / pnpm hoisting issues that bit the previous Vercel deploy.)

- [ ] **Step 9: Update memory**

Update `C:\Users\Walaa\.claude\projects\c--dev-calendry\memory\project_calendry_state.md` to mark `/availability` Sanity wiring as done and Spec 2 (Google Calendar OAuth) as the next task.

- [ ] **Step 10: Open PR**

```bash
git push -u origin feat/sanity-schemas-design
gh pr create --title "feat(availability): wire Schedules and Advanced settings tabs to Sanity" --body "$(cat <<'EOF'
## Summary
- Server Component shell + Client editor + scoped Server Actions
- Deterministic _id = availability.${clerkId}, idempotent createIfNotExists
- Browser-detected timezone bootstrap on first visit
- Per-tab Save buttons with dirty tracking, pending state, inline errors
- Calendar settings tab unchanged (Spec 2 — Google OAuth — coming next)

## Test plan
- [x] Brand-new user path
- [x] Schedule round-trip (toggle, add/remove intervals, reload)
- [x] Advanced round-trip (minimumNotice, bufferBefore, bufferAfter)
- [x] Per-tab save isolation
- [x] Auth gate (signed-out redirect to /)
- [x] Idempotency (no duplicate docs across reloads)
- [x] pnpm build passes locally

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- Architecture (server shell + client editor + actions) → Tasks 3, 4
- Document shape and `_id` strategy → Task 1 (types), Task 2 (server actions reference `_id`), Task 3 (creation)
- Read path with `createIfNotExists` → Task 3
- Write path (`saveSchedules`, `saveAdvanced`) → Task 2 (definition), Tasks 5/6 (wiring)
- Timezone bootstrap action → Task 2 (definition), Task 7 (wiring)
- State init from props, dirty tracking, pending/success/error UI → Tasks 4, 5, 6
- Hide trash on last interval → Task 4 (`dayItem.intervals.length > 1` guard)
- Disabled-day intervals preserved on save → Task 4 (state never strips intervals when toggling off)
- Timezone display read-only → Task 4 (`<span>{timezone}</span>`)
- Advanced tab three dropdowns matching schema 1:1 → Task 4
- Calendar settings unchanged → Task 4 (verbatim copy)
- Verification plan → Task 8

**Placeholder scan:** No TBDs/TODOs. The "cleaner alternative" callout in Task 2 is explicit guidance to use the cleaner snippet, not a placeholder.

**Type consistency:** `DaySchedule`, `TimeInterval`, `AvailabilityDoc`, `DayCode` are defined once in Task 1 and used unchanged everywhere. Server-action signatures (`saveSchedules`, `saveAdvanced`, `bootstrapTimezoneIfDefault`) are introduced in Task 2 and consumed unchanged in Tasks 5, 6, 7.

No gaps found.
