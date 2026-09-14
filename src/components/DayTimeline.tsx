// src/components/DayTimeline.tsx
// One day, split into hours.
//
// The month grid answers "what is this month like"; this answers "what does today look like" —
// which is the question a time on an event makes askable at all. Before the clock shipped, every
// event sat at midnight and an hour grid would have drawn one stack at the top.
//
// All the arithmetic — conversion into the reader's zone, overlap columns, which hours are worth
// drawing — lives in `dayLayout.ts` and is tested there. This file positions boxes.

import { useMemo } from 'react';
import { format } from 'date-fns';
import { Clock } from 'lucide-react';
import { useThemeStore } from '../store';
import { t, getDateLocale } from '../utils/i18n';
import { displayTime, localZone } from '../utils/eventTime';
import { layoutDay, visibleHours } from '../utils/dayLayout';

/** Row height for one hour, in pixels. The only place the grid's scale is decided. */
const HOUR_PX = 56;

interface DayTimelineProps {
  date: Date;
  /** Already expanded for this day by the caller — recurrence is not this component's business. */
  events: any[];
  onEventClick?: (event: any) => void;
}

export default function DayTimeline({ date, events, onEventClick }: DayTimelineProps) {
  const { language, timezone } = useThemeStore();
  const zone = timezone || localZone();
  const dateLocale = getDateLocale(language);

  // The stored day key is UTC, which is how every date in this app is written.
  const dayKey = useMemo(
    () => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    [date],
  );

  const layout = useMemo(() => layoutDay(events, dayKey, zone), [events, dayKey, zone]);
  const { from, to } = useMemo(() => visibleHours(layout), [layout]);

  const hours = [];
  for (let h = from; h <= to; h++) hours.push(h);

  const gridTop = from * 60;
  const gridHeight = (to - from + 1) * HOUR_PX;

  return (
    <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
      <header className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-2">
        <Clock className="w-4 h-4 text-primary" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {format(date, 'EEEE, d MMMM', { locale: dateLocale })}
        </h3>
      </header>

      {/* All-day events sit ABOVE the grid, not on it: they have no hour, and putting them at
          midnight would read as a real appointment at midnight. */}
      {layout.allDay.length > 0 && (
        <div className="px-4 py-2 border-b border-zinc-100 dark:border-zinc-800 flex flex-wrap gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-zinc-400 self-center mr-1">
            {t('eventAllDay', language)}
          </span>
          {layout.allDay.map((ev: any, i: number) => (
            <button
              key={ev.id || `allday-${i}`}
              onClick={() => onEventClick?.(ev)}
              className="px-2 py-1 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors max-w-full truncate"
            >
              {ev.title || t('logUntitled', language)}
            </button>
          ))}
        </div>
      )}

      {layout.timed.length === 0 && layout.allDay.length === 0 ? (
        <p className="px-4 py-8 text-sm text-zinc-400 text-center">{t('dayNothingScheduled', language)}</p>
      ) : (
        <div className="relative overflow-x-hidden" style={{ height: gridHeight }}>
          {/* hour rules and labels */}
          {hours.map((h, i) => (
            <div
              key={h}
              className="absolute left-0 right-0 border-t border-zinc-100 dark:border-zinc-800 flex"
              style={{ top: i * HOUR_PX, height: HOUR_PX }}
            >
              <span className="w-14 shrink-0 pl-3 pt-1 text-[11px] text-zinc-400 tabular-nums">
                {String(h).padStart(2, '0')}:00
              </span>
            </div>
          ))}

          {/* the events themselves */}
          {layout.timed.map((p, i) => {
            const shown = displayTime(p.event, zone);
            const topPx = ((p.startMin - gridTop) / 60) * HOUR_PX;
            const heightPx = Math.max(22, ((p.endMin - p.startMin) / 60) * HOUR_PX - 2);
            // Columns are a percentage of the track so the blocks keep lining up at any width.
            const widthPct = 100 / p.lanes;

            return (
              <button
                key={p.event.id || `timed-${i}`}
                onClick={() => onEventClick?.(p.event)}
                title={p.event.title}
                className="absolute rounded-lg px-2 py-1 text-left bg-primary/15 hover:bg-primary/25 border-l-2 border-primary transition-colors overflow-hidden"
                style={{
                  top: topPx,
                  height: heightPx,
                  left: `calc(3.5rem + ${p.lane * widthPct}% - ${p.lane * widthPct * 0.035}rem)`,
                  width: `calc(${widthPct}% - 0.5rem)`,
                }}
              >
                <span className="block text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate">
                  {p.event.title || t('logUntitled', language)}
                </span>
                {shown && (
                  <span className="block text-[10px] text-zinc-500 tabular-nums truncate">
                    {shown.text}
                    {/* The zone is named only when it is not the reader's — "19:00" is what you
                        want to read at home, and the note is noise there. */}
                    {shown.zoneNote ? ` · ${shown.zoneNote.split('/').pop()}` : ''}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
