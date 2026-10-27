import { useCallback, useEffect, useState } from 'react';
import {
  HEBREW_COPY,
  shiftLogicalDate,
  type HistoryResponse,
} from '@habait/shared';
import { api } from '../api.js';

type HistoryViewProps = {
  initialDate: string;
  isParent?: boolean;
  onRevertChange?: () => void;
};

type StarPeriodKey = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'total';

const PERIOD_TABS: { key: StarPeriodKey; label: string }[] = [
  { key: 'daily', label: HEBREW_COPY.starPeriods.daily },
  { key: 'weekly', label: HEBREW_COPY.starPeriods.weekly },
  { key: 'monthly', label: HEBREW_COPY.starPeriods.monthly },
  { key: 'yearly', label: HEBREW_COPY.starPeriods.yearly },
  { key: 'total', label: HEBREW_COPY.starPeriods.total },
];

export function HistoryView({ initialDate, isParent = false, onRevertChange }: HistoryViewProps) {
  const [date, setDate] = useState(initialDate);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPeriod, setSelectedPeriod] = useState<StarPeriodKey>('daily');

  const loadHistory = useCallback(async (targetDate: string) => {
    setLoading(true);
    try {
      const data = await api.getHistory(targetDate);
      setHistory(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory(date);
  }, [date, loadHistory]);

  const stepDate = (delta: number) => {
    setDate((prev) => shiftLogicalDate(prev, delta));
  };

  const handleParentRevert = async (
    kind: 'ROUTINE' | 'ONE_OFF' | 'POOL' | 'PEER_REQUEST',
    id: number,
  ) => {
    if (kind === 'ROUTINE') await api.revertRoutine(id);
    else if (kind === 'ONE_OFF') await api.revertOneOff(id);
    else if (kind === 'POOL') await api.revertPoolExecution(id);
    else await api.revertPeerRequest(id);
    await loadHistory(date);
    onRevertChange?.();
  };

  return (
    <div className="space-y-6" data-testid="history-view">
      {/* Date Navigator & Star Period Switcher */}
      <div className="flex flex-col justify-between gap-4 rounded-3xl border border-stone-200 bg-white p-5 shadow-xs sm:flex-row sm:items-center">
        <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start sm:gap-3">
          <button
            type="button"
            onClick={() => stepDate(-1)}
            data-testid="history-prev-day"
            className="flex min-h-12 min-w-12 items-center justify-center rounded-2xl border border-stone-200 bg-stone-100 px-3 text-base font-bold text-stone-800 sm:text-lg"
            aria-label="יום קודם"
          >
            → יום קודם
          </button>
          <input
            type="date"
            value={date}
            onChange={(e) => {
              if (e.target.value) setDate(e.target.value);
            }}
            data-testid="history-date-input"
            className="min-h-12 rounded-2xl border border-stone-300 bg-[#FAF6EE] px-3 py-2 text-base font-bold text-stone-900 sm:px-4 sm:text-lg"
          />
          <button
            type="button"
            onClick={() => stepDate(1)}
            data-testid="history-next-day"
            className="flex min-h-12 min-w-12 items-center justify-center rounded-2xl border border-stone-200 bg-stone-100 px-3 text-base font-bold text-stone-800 sm:text-lg"
            aria-label="יום הבא"
          >
            יום הבא ←
          </button>
        </div>

        {/* Star Analytics Period Tabs */}
        <div className="flex flex-wrap items-center justify-center gap-1.5 rounded-2xl bg-[#F3ECE0] p-1.5 sm:justify-start">
          {PERIOD_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setSelectedPeriod(t.key)}
              data-testid={`star-period-${t.key}`}
              className={`min-h-12 min-w-12 rounded-xl px-3 py-1.5 text-sm font-bold ${
                selectedPeriod === t.key
                  ? 'bg-amber-500 text-white shadow-xs'
                  : 'text-stone-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {loading && !history ? (
        <div className="py-12 text-center text-lg font-medium text-stone-500">טוען היסטוריה...</div>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {history?.users.map((entry) => {
            const starCount = entry.starsEarned[selectedPeriod];
            return (
              <div
                key={entry.user.id}
                data-testid={`history-user-card-${entry.user.id}`}
                className="flex flex-col rounded-3xl border border-stone-200 bg-white p-5 shadow-xs"
              >
                <div className="flex items-center justify-between border-b border-stone-100 pb-4">
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-14 w-14 items-center justify-center rounded-2xl text-3xl ${entry.user.avatarBgColor}`}
                    >
                      {entry.user.avatarEmoji}
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-stone-900">{entry.user.name}</h3>
                      <p className="text-xs font-medium text-stone-500">
                        יומי: ⭐ {entry.starsEarned.daily} · שבועי: ⭐ {entry.starsEarned.weekly} · חודשי: ⭐{' '}
                        {entry.starsEarned.monthly} · שנתי: ⭐ {entry.starsEarned.yearly}
                      </p>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-amber-300 bg-amber-100 px-3.5 py-2 text-center">
                    <span className="text-lg font-bold text-amber-900">⭐ {starCount}</span>
                  </div>
                </div>

                <div className="mt-4 space-y-3 text-sm">
                  {/* Completed Routines */}
                  {entry.routinesCompleted.map((r) => (
                    <div
                      key={`rc-${r.id}`}
                      className="flex items-center justify-between rounded-2xl bg-emerald-50 px-3.5 py-2.5"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="text-2xl">{r.iconEmojiSnapshot}</span>
                        <div>
                          <p className="font-bold text-stone-900">{r.titleSnapshot}</p>
                          <p className="text-xs text-emerald-700">
                            שגרה ({HEBREW_COPY.timeWindows[r.timeWindowSnapshot]}) · הושלם ✓
                          </p>
                        </div>
                      </div>
                      {isParent && (
                        <button
                          type="button"
                          onClick={() => void handleParentRevert('ROUTINE', r.id)}
                          className="min-h-12 min-w-12 rounded-xl border border-stone-300 bg-white px-2.5 py-1 text-xs font-bold text-stone-700"
                        >
                          {HEBREW_COPY.actions.undo}
                        </button>
                      )}
                    </div>
                  ))}

                  {/* Missed Routines */}
                  {entry.routinesMissed.map((r) => (
                    <div
                      key={`rm-${r.id}`}
                      className="flex items-center justify-between rounded-2xl bg-rose-50 px-3.5 py-2.5"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="text-2xl opacity-75">{r.iconEmojiSnapshot}</span>
                        <div>
                          <p className="font-bold text-stone-800">{r.titleSnapshot}</p>
                          <p className="text-xs font-bold text-rose-700">
                            {HEBREW_COPY.status.missed}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Completed One-Offs */}
                  {entry.oneOffsCompleted.map((t) => (
                    <div
                      key={`oo-${t.id}`}
                      className="flex items-center justify-between rounded-2xl bg-amber-50/80 px-3.5 py-2.5"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="text-2xl">{t.iconEmoji}</span>
                        <div>
                          <p className="font-bold text-stone-900">{t.title}</p>
                          <p className="text-xs text-amber-800">משימה מיוחדת · +{t.stars} ⭐</p>
                        </div>
                      </div>
                      {isParent && (
                        <button
                          type="button"
                          onClick={() => void handleParentRevert('ONE_OFF', t.id)}
                          className="min-h-12 min-w-12 rounded-xl border border-stone-300 bg-white px-2.5 py-1 text-xs font-bold text-stone-700"
                        >
                          {HEBREW_COPY.actions.undo}
                        </button>
                      )}
                    </div>
                  ))}

                  {/* Completed Pool Executions */}
                  {entry.poolExecutions.map((pe) => (
                    <div
                      key={`pe-${pe.id}`}
                      className="flex items-center justify-between rounded-2xl bg-amber-50 px-3.5 py-2.5"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="text-2xl">{pe.iconEmojiSnapshot}</span>
                        <div>
                          <p className="font-bold text-stone-900">{pe.titleSnapshot}</p>
                          <p className="text-xs text-amber-900">
                            קופת המשימות · +{pe.starsAwarded} ⭐
                          </p>
                        </div>
                      </div>
                      {isParent && (
                        <button
                          type="button"
                          onClick={() => void handleParentRevert('POOL', pe.id)}
                          className="min-h-12 min-w-12 rounded-xl border border-stone-300 bg-white px-2.5 py-1 text-xs font-bold text-stone-700"
                        >
                          {HEBREW_COPY.actions.undo}
                        </button>
                      )}
                    </div>
                  ))}

                  {/* Peer Requests */}
                  {entry.peerRequests.map((pr) => (
                    <div
                      key={`peer-${pr.id}`}
                      className="flex items-center justify-between rounded-2xl bg-sky-50 px-3.5 py-2.5"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="text-2xl">{pr.iconEmoji}</span>
                        <div>
                          <p className="font-bold text-stone-900">{pr.title}</p>
                          <p className="text-xs text-sky-800">בקשת עזרה · {pr.status}</p>
                        </div>
                      </div>
                    </div>
                  ))}

                  {entry.routinesCompleted.length === 0 &&
                    entry.routinesMissed.length === 0 &&
                    entry.oneOffsCompleted.length === 0 &&
                    entry.poolExecutions.length === 0 &&
                    entry.peerRequests.length === 0 && (
                      <p className="py-4 text-center text-sm text-stone-400">
                        אין רשומות לתאריך זה
                      </p>
                    )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
