import { useCallback, useEffect, useState } from 'react';
import {
  HEBREW_COPY,
  TIME_WINDOWS,
  type AppSettings,
  type CompletedItem,
  type DashboardResponse,
  type LobbyProfile,
  type PoolTask,
  type StarSummary,
  type TimeWindow,
} from '@habait/shared';
import { api, ClientApiError } from '../api.js';
import { AdminView } from './AdminView.js';
import { HistoryView } from './HistoryView.js';

type WorkspaceTab = 'myDay' | 'pool' | 'history' | 'admin';

type WorkspaceViewProps = {
  userId: number;
  profiles: LobbyProfile[];
  appSettings: AppSettings;
  onSwitchUser: () => void;
  onGlobalRefresh: () => void;
};

const HELP_EMOJIS = ['🤝', '🧸', '📚', '🎲', '🥤', '🧹', '🐶', '🎨'] as const;

function minutesRemaining(targetMs: number, nowMs: number): number {
  return Math.max(1, Math.ceil((targetMs - nowMs) / 60_000));
}

export function WorkspaceView({
  userId,
  profiles,
  appSettings,
  onSwitchUser,
  onGlobalRefresh,
}: WorkspaceViewProps) {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('myDay');
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [poolTasks, setPoolTasks] = useState<PoolTask[]>([]);
  const [starSummary, setStarSummary] = useState<StarSummary | null>(null);
  const [showStarModal, setShowStarModal] = useState(false);
  const [showPeerModal, setShowPeerModal] = useState(false);
  const [peerRecipientId, setPeerRecipientId] = useState<number>(0);
  const [peerTitle, setPeerTitle] = useState('');
  const [peerEmoji, setPeerEmoji] = useState<string>('🤝');
  const [completedOpen, setCompletedOpen] = useState(true);
  const [expandedWindows, setExpandedWindows] = useState<Record<TimeWindow, boolean>>({
    MORNING: true,
    AFTERNOON: false,
    EVENING: false,
    ALL_DAY: true,
  });
  const [celebrationMsg, setCelebrationMsg] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const triggerCelebration = (stars: number) => {
    setCelebrationMsg(stars > 0 ? `כל הכבוד! +${stars} ⭐` : 'כל הכבוד! הושלם ✓');
    setTimeout(() => setCelebrationMsg(null), 2200);
  };

  const refreshWorkspace = useCallback(async () => {
    const [dashData, poolData] = await Promise.all([
      api.getDashboard(userId),
      api.getPool(),
    ]);
    setDashboard(dashData);
    setPoolTasks(poolData.tasks);
    setExpandedWindows((prev) => ({
      ...prev,
      [dashData.serverTime.timeWindow]: true,
      ALL_DAY: true,
    }));
  }, [userId]);

  useEffect(() => {
    void refreshWorkspace();
  }, [refreshWorkspace]);

  const otherProfiles = profiles.filter((p) => p.id !== userId);
  useEffect(() => {
    if (!peerRecipientId && otherProfiles[0]) {
      setPeerRecipientId(otherProfiles[0].id);
    }
  }, [otherProfiles, peerRecipientId]);

  const openStarBreakdown = async () => {
    const res = await api.getStarsSummary();
    const found = res.users.find((u) => u.userId === userId) ?? null;
    setStarSummary(found);
    setShowStarModal(true);
  };

  const handleCompleteRoutine = async (routineId: number) => {
    setErrorBanner(null);
    const res = await api.completeRoutine(routineId);
    triggerCelebration(res.starsAwarded);
    await refreshWorkspace();
    onGlobalRefresh();
  };

  const handleCompleteOneOff = async (taskId: number) => {
    setErrorBanner(null);
    const res = await api.completeOneOff(taskId);
    triggerCelebration(res.starsAwarded);
    await refreshWorkspace();
    onGlobalRefresh();
  };

  const handleClaimPool = async (taskId: number) => {
    setErrorBanner(null);
    try {
      await api.claimPoolTask(taskId);
      await refreshWorkspace();
      onGlobalRefresh();
    } catch (err) {
      setErrorBanner(
        err instanceof ClientApiError ? err.message : HEBREW_COPY.pool.wipLimitHelper,
      );
    }
  };

  const handleUnclaimPool = async (taskId: number) => {
    setErrorBanner(null);
    await api.unclaimPoolTask(taskId);
    await refreshWorkspace();
    onGlobalRefresh();
  };

  const handleCompletePool = async (taskId: number) => {
    setErrorBanner(null);
    const res = await api.completePoolTask(taskId);
    triggerCelebration(res.starsAwarded);
    await refreshWorkspace();
    onGlobalRefresh();
  };

  const handleCompletePeer = async (reqId: number) => {
    setErrorBanner(null);
    await api.completePeerRequest(reqId);
    triggerCelebration(0);
    await refreshWorkspace();
    onGlobalRefresh();
  };

  const handleDeclinePeer = async (reqId: number) => {
    setErrorBanner(null);
    await api.declinePeerRequest(reqId);
    await refreshWorkspace();
    onGlobalRefresh();
  };

  const handleSendPeerRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!peerTitle.trim() || !peerRecipientId) return;
    await api.createPeerRequest({
      recipientId: peerRecipientId,
      title: peerTitle.trim(),
      iconEmoji: peerEmoji,
    });
    setPeerTitle('');
    setShowPeerModal(false);
    await refreshWorkspace();
    onGlobalRefresh();
    triggerCelebration(0);
  };

  const handleUndoCompleted = async (item: CompletedItem) => {
    setErrorBanner(null);
    if (item.kind === 'ROUTINE') {
      await api.revertRoutine(item.log.id);
    } else if (item.kind === 'ONE_OFF') {
      await api.revertOneOff(item.task.id);
    } else if (item.kind === 'POOL') {
      await api.revertPoolExecution(item.execution.id);
    } else {
      await api.revertPeerRequest(item.request.id);
    }
    await refreshWorkspace();
    onGlobalRefresh();
  };

  if (!dashboard) {
    return (
      <div className="flex min-h-[60dvh] items-center justify-center text-xl font-bold text-stone-600">
        טוען את סביבת העבודה...
      </div>
    );
  }

  const { user, serverTime, activeClaim, oneOffTasks, routines, peerRequests, completedToday } =
    dashboard;
  const isParent = user.role === 'PARENT';

  return (
    <div className="mx-auto max-w-4xl px-4 pt-5 pb-28" data-testid="workspace-view">
      {/* Top Workspace Header */}
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-stone-200 bg-white p-5 shadow-xs">
        <div className="flex items-center gap-4">
          <div
            className={`flex h-16 w-16 items-center justify-center rounded-2xl text-4xl shadow-inner ${user.avatarBgColor}`}
          >
            {user.avatarEmoji}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-stone-900 sm:text-3xl" data-testid="workspace-greeting">
              {HEBREW_COPY.greeting(user.name)}
            </h1>
            <p className="text-sm font-medium text-stone-500">
              {HEBREW_COPY.roles[user.role]} · {HEBREW_COPY.timeWindows[serverTime.timeWindow]}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void openStarBreakdown()}
            data-testid="workspace-stars-btn"
            className="flex min-h-12 items-center gap-2 rounded-2xl border border-amber-300 bg-amber-100 px-4 py-2 text-xl font-bold text-amber-950 shadow-xs"
          >
            <span>⭐</span>
            <span data-testid="workspace-stars-count">{dashboard.totalStars}</span>
          </button>

          <button
            type="button"
            onClick={onSwitchUser}
            data-testid="switch-user-btn"
            className="min-h-12 rounded-2xl border border-stone-300 bg-[#FAF6EE] px-4 py-2 text-base font-bold text-stone-800"
          >
            {HEBREW_COPY.actions.switchUser}
          </button>
        </div>
      </header>

      {/* Navigation Pill Bar */}
      <nav
        className="mb-6 grid grid-cols-3 gap-2 rounded-3xl border border-stone-200 bg-white p-2 shadow-xs sm:flex sm:items-center"
        aria-label="ניווט ראשי"
      >
        <button
          type="button"
          onClick={() => setActiveTab('myDay')}
          data-testid="tab-myDay"
          className={`min-h-12 flex-1 rounded-2xl px-4 py-2.5 text-base font-bold ${
            activeTab === 'myDay'
              ? 'bg-stone-900 text-white shadow-xs'
              : 'text-stone-700'
          }`}
        >
          ☀️ {HEBREW_COPY.nav.myDay}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('pool')}
          data-testid="tab-pool"
          className={`min-h-12 flex-1 rounded-2xl px-4 py-2.5 text-base font-bold ${
            activeTab === 'pool'
              ? 'bg-stone-900 text-white shadow-xs'
              : 'text-stone-700'
          }`}
        >
          🧺 {HEBREW_COPY.nav.pool}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('history')}
          data-testid="tab-history"
          className={`min-h-12 flex-1 rounded-2xl px-4 py-2.5 text-base font-bold ${
            activeTab === 'history'
              ? 'bg-stone-900 text-white shadow-xs'
              : 'text-stone-700'
          }`}
        >
          📅 {HEBREW_COPY.nav.history}
        </button>
        {isParent && (
          <button
            type="button"
            onClick={() => setActiveTab('admin')}
            data-testid="tab-admin"
            className={`col-span-3 min-h-12 flex-1 rounded-2xl px-4 py-2.5 text-base font-bold sm:col-span-1 ${
              activeTab === 'admin'
                ? 'bg-amber-600 text-white shadow-xs'
                : 'bg-amber-50 text-amber-950'
            }`}
          >
            ⚙️ {HEBREW_COPY.nav.admin}
          </button>
        )}
      </nav>

      {/* Celebration Toast & Error Banner */}
      {celebrationMsg && (
        <div
          className="animate-star-pop mb-5 flex items-center justify-center rounded-2xl border border-emerald-300 bg-emerald-600 px-5 py-3 text-lg font-bold text-white shadow-lg"
          role="status"
          data-testid="celebration-banner"
        >
          {celebrationMsg}
        </div>
      )}
      {errorBanner && (
        <div
          className="mb-5 rounded-2xl border border-rose-300 bg-rose-100 px-4 py-3 text-base font-bold text-rose-900"
          role="alert"
          data-testid="workspace-error-banner"
        >
          {errorBanner}
        </div>
      )}

      {/* TAB 1: היום שלי (Strict 5-Tier Hierarchy) */}
      {activeTab === 'myDay' && (
        <div className="space-y-6" data-testid="my-day-content">
          {/* SECTION 1 — Active Claimed Pool Task Hero Card (Conditional) */}
          {activeClaim && activeClaim.state === 'CLAIMED' && (
            <section
              data-testid="active-claim-hero"
              className="rounded-3xl border-2 border-amber-400 bg-gradient-to-b from-amber-50 to-amber-100/80 p-6 shadow-md"
            >
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                <div className="flex items-center gap-4">
                  <span className="text-4xl">{activeClaim.iconEmoji}</span>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-amber-500 px-3 py-0.5 text-xs font-bold text-white">
                        משימה שלקחת מקופת המשימות
                      </span>
                      <span className="rounded-full bg-white px-3 py-0.5 text-xs font-bold text-amber-900">
                        {HEBREW_COPY.pool.claimMinutesLeft(
                          minutesRemaining(activeClaim.claimExpiresAt, serverTime.now),
                        )}
                      </span>
                    </div>
                    <h2 className="mt-1.5 text-2xl font-bold text-stone-900">
                      {activeClaim.title}
                    </h2>
                    <p className="text-base font-bold text-amber-800">
                      +{activeClaim.stars} ⭐
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void handleCompletePool(activeClaim.id)}
                    data-testid="hero-complete-pool-btn"
                    className="min-h-12 rounded-2xl bg-emerald-600 px-6 py-3 text-lg font-bold text-white shadow-sm"
                  >
                    {HEBREW_COPY.actions.completePool}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleUnclaimPool(activeClaim.id)}
                    data-testid="hero-unclaim-pool-btn"
                    className="min-h-12 rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm font-bold text-stone-700"
                  >
                    {HEBREW_COPY.actions.returnToPool}
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* SECTION 2 — One-Off Assigned Tasks (משימות מיוחדות) */}
          <section
            data-testid="section-one-offs"
            className="rounded-3xl border border-stone-200 bg-white p-6 shadow-xs"
          >
            <h2 className="mb-4 text-xl font-bold text-stone-900">
              ✨ {HEBREW_COPY.sections.oneOffTasks}
            </h2>
            {oneOffTasks.length === 0 ? (
              <p className="text-sm text-stone-500">אין משימות מיוחדות פתוחות כרגע.</p>
            ) : (
              <div className="space-y-3">
                {oneOffTasks.map((task) => (
                  <div
                    key={task.id}
                    data-testid={`one-off-card-${task.id}`}
                    className="flex items-center justify-between gap-4 rounded-2xl border border-stone-200 bg-[#FAF6EE] p-4"
                  >
                    <div className="flex items-center gap-3.5">
                      <span className="text-4xl">{task.iconEmoji}</span>
                      <div>
                        <h3 className="text-lg font-bold text-stone-900">{task.title}</h3>
                        <div className="mt-1 flex items-center gap-2 text-xs font-medium text-stone-600">
                          <span>{HEBREW_COPY.issuedOn(task.issuedDate)}</span>
                          {task.stars > 0 && (
                            <span className="rounded-full bg-amber-200/80 px-2.5 py-0.5 font-bold text-amber-950">
                              +{task.stars} ⭐
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleCompleteOneOff(task.id)}
                      data-testid={`complete-one-off-${task.id}`}
                      className="min-h-12 min-w-24 rounded-2xl bg-emerald-600 px-5 py-2.5 text-base font-bold text-white shadow-xs"
                    >
                      ✓ {HEBREW_COPY.actions.complete}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* SECTION 3 — Daily Routines (שגרה יומית) */}
          <section
            data-testid="section-routines"
            className="rounded-3xl border border-stone-200 bg-white p-6 shadow-xs"
          >
            <h2 className="mb-4 text-xl font-bold text-stone-900">
              🌞 {HEBREW_COPY.sections.dailyRoutines}
            </h2>
            <div className="space-y-3">
              {TIME_WINDOWS.map((win) => {
                const items = routines[win];
                const isCurrentWindow = serverTime.timeWindow === win;
                const isExpanded = expandedWindows[win];
                return (
                  <div
                    key={win}
                    className={`rounded-2xl border ${
                      isCurrentWindow
                        ? 'border-amber-300 bg-amber-50/40'
                        : 'border-stone-200 bg-[#FAF6EE]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedWindows((prev) => ({ ...prev, [win]: !prev[win] }))
                      }
                      data-testid={`routine-window-toggle-${win}`}
                      className="flex min-h-12 w-full items-center justify-between px-4 py-3 text-start font-bold text-stone-900"
                    >
                      <div className="flex items-center gap-2">
                        <span>{HEBREW_COPY.timeWindows[win]}</span>
                        {isCurrentWindow && (
                          <span className="rounded-full bg-amber-500 px-2.5 py-0.5 text-xs font-bold text-white">
                            עכשיו
                          </span>
                        )}
                        <span className="text-sm font-medium text-stone-500">
                          ({items.length})
                        </span>
                      </div>
                      <span className="text-stone-500">{isExpanded ? '▾' : '◂'}</span>
                    </button>

                    {isExpanded && (
                      <div className="space-y-2 border-t border-stone-200/70 p-3">
                        {items.length === 0 ? (
                          <p className="py-2 text-center text-sm text-stone-500">
                            כל השגרות בחלון זה הושלמו! 🎉
                          </p>
                        ) : (
                          items.map((routine) => (
                            <div
                              key={routine.id}
                              data-testid={`routine-card-${routine.id}`}
                              className="flex items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-white p-3.5 shadow-2xs"
                            >
                              <div className="flex items-center gap-3">
                                <span className="text-3xl">{routine.iconEmoji}</span>
                                <span className="text-lg font-bold text-stone-900">
                                  {routine.title}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => void handleCompleteRoutine(routine.id)}
                                data-testid={`complete-routine-${routine.id}`}
                                className="min-h-12 min-w-24 rounded-2xl bg-emerald-600 px-4 py-2 text-base font-bold text-white"
                              >
                                ✓ {HEBREW_COPY.actions.complete}
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* SECTION 4 — Peer Help Requests (בקשות עזרה) */}
          <section
            data-testid="section-peer-requests"
            className="rounded-3xl border border-stone-200 bg-white p-6 shadow-xs"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-bold text-stone-900">
                🤝 {HEBREW_COPY.sections.peerRequests}
              </h2>
              <button
                type="button"
                onClick={() => setShowPeerModal(true)}
                data-testid="open-request-help-btn"
                className="min-h-12 rounded-2xl bg-sky-600 px-4 py-2 text-sm font-bold text-white shadow-xs"
              >
                {HEBREW_COPY.actions.requestHelp}
              </button>
            </div>

            {peerRequests.length === 0 ? (
              <p className="text-sm text-stone-500">אין בקשות עזרה ממתינות כרגע.</p>
            ) : (
              <div className="space-y-3">
                {peerRequests.map((req) => {
                  const requester = profiles.find((p) => p.id === req.requesterId);
                  return (
                    <div
                      key={req.id}
                      data-testid={`peer-request-card-${req.id}`}
                      className="flex flex-col justify-between gap-3 rounded-2xl border border-sky-200 bg-sky-50/60 p-4 sm:flex-row sm:items-center"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-3xl">{req.iconEmoji}</span>
                        <div>
                          <p className="text-lg font-bold text-stone-900">{req.title}</p>
                          <p className="text-xs font-bold text-sky-900">
                            {HEBREW_COPY.fromRequester(
                              requester ? `${requester.avatarEmoji} ${requester.name}` : `${req.requesterId}`,
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void handleCompletePeer(req.id)}
                          data-testid={`complete-peer-${req.id}`}
                          className="min-h-12 rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white"
                        >
                          {HEBREW_COPY.actions.complete}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeclinePeer(req.id)}
                          data-testid={`decline-peer-${req.id}`}
                          className="min-h-12 rounded-2xl border border-stone-300 bg-white px-4 py-2 text-sm font-bold text-stone-700"
                        >
                          {HEBREW_COPY.actions.decline}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* SECTION 5 — Completed Today (בוצעו היום) */}
          <section
            data-testid="section-completed-today"
            className="rounded-3xl border border-stone-200 bg-[#F3ECE0] p-5"
          >
            <button
              type="button"
              onClick={() => setCompletedOpen((prev) => !prev)}
              data-testid="toggle-completed-today"
              className="flex min-h-12 w-full items-center justify-between text-start text-lg font-bold text-stone-800"
            >
              <span>
                ✅ {HEBREW_COPY.sections.completedToday} ({completedToday.length})
              </span>
              <span>{completedOpen ? '▾' : '◂'}</span>
            </button>

            {completedOpen && (
              <div className="mt-3 space-y-2">
                {completedToday.length === 0 ? (
                  <p className="py-2 text-sm text-stone-500">עדיין לא הושלמו משימות היום.</p>
                ) : (
                  completedToday.map((item, idx) => {
                    const title =
                      item.kind === 'ROUTINE'
                        ? item.log.titleSnapshot
                        : item.kind === 'ONE_OFF'
                          ? item.task.title
                          : item.kind === 'POOL'
                            ? item.execution.titleSnapshot
                            : item.request.title;
                    const emoji =
                      item.kind === 'ROUTINE'
                        ? item.log.iconEmojiSnapshot
                        : item.kind === 'ONE_OFF'
                          ? item.task.iconEmoji
                          : item.kind === 'POOL'
                            ? item.execution.iconEmojiSnapshot
                            : item.request.iconEmoji;
                    const stars =
                      item.kind === 'ONE_OFF'
                        ? item.task.stars
                        : item.kind === 'POOL'
                          ? item.execution.starsAwarded
                          : 0;

                    return (
                      <div
                        key={`${item.kind}-${idx}`}
                        data-testid={`completed-today-item-${idx}`}
                        className="flex items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-white px-4 py-3"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">{emoji}</span>
                          <div>
                            <p className="font-bold text-stone-800 line-through">{title}</p>
                            {stars > 0 && (
                              <span className="text-xs font-bold text-amber-800">
                                +{stars} ⭐
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleUndoCompleted(item)}
                          data-testid={`undo-completed-${idx}`}
                          className="min-h-12 rounded-2xl border border-stone-300 bg-[#FAF6EE] px-4 py-2 text-sm font-bold text-stone-800"
                        >
                          ↩ {HEBREW_COPY.actions.undo}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </section>
        </div>
      )}

      {/* TAB 2: קופת המשימות (Shared Household Pool) */}
      {activeTab === 'pool' && (
        <div className="space-y-5" data-testid="pool-tab-content">
          {activeClaim && (
            <div
              data-testid="pool-wip-helper-banner"
              className="rounded-2xl border border-amber-300 bg-amber-100 px-4 py-3 text-base font-bold text-amber-950"
            >
              ⚠️ {HEBREW_COPY.pool.wipLimitHelper}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {poolTasks.map((pt) => {
              const isAvailable = pt.state === 'AVAILABLE';
              const isClaimed = pt.state === 'CLAIMED';
              const isCooldown = pt.state === 'COOLDOWN';
              const claimer =
                isClaimed ? profiles.find((p) => p.id === pt.claimedByUserId) : undefined;
              const isMine = isClaimed && pt.claimedByUserId === userId;

              return (
                <div
                  key={pt.id}
                  data-testid={`pool-card-${pt.id}`}
                  className={`flex flex-col justify-between rounded-3xl border p-5 shadow-xs ${
                    isCooldown
                      ? 'border-stone-200 bg-stone-100/80 opacity-65'
                      : isMine
                        ? 'border-2 border-amber-400 bg-amber-50'
                        : 'border-stone-200 bg-white'
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-4xl">{pt.iconEmoji}</span>
                      <span className="rounded-full bg-amber-200 px-3 py-1 text-sm font-bold text-amber-950">
                        +{pt.stars} ⭐
                      </span>
                    </div>
                    <h3 className="mt-3 text-xl font-bold text-stone-900">{pt.title}</h3>
                    <p className="mt-1 text-xs font-medium text-stone-500">
                      {HEBREW_COPY.poolResetModes[pt.resetMode]}
                    </p>
                  </div>

                  <div className="mt-5">
                    {isAvailable && (
                      <div className="space-y-2">
                        <button
                          type="button"
                          disabled={activeClaim !== null}
                          onClick={() => void handleClaimPool(pt.id)}
                          data-testid={`claim-pool-btn-${pt.id}`}
                          className={`min-h-12 w-full rounded-2xl px-5 py-3 text-lg font-bold shadow-xs ${
                            activeClaim !== null
                              ? 'cursor-not-allowed bg-stone-200 text-stone-500'
                              : 'bg-amber-500 text-white'
                          }`}
                        >
                          ✋ {HEBREW_COPY.actions.claim}
                        </button>
                        {activeClaim !== null && (
                          <p
                            data-testid={`wip-helper-${pt.id}`}
                            className="text-center text-xs font-bold text-amber-900"
                          >
                            {HEBREW_COPY.pool.wipLimitHelper}
                          </p>
                        )}
                      </div>
                    )}

                    {isClaimed && (
                      <div className="space-y-2">
                        <div className="rounded-2xl bg-amber-100 px-3 py-2 text-center text-sm font-bold text-amber-950">
                          {HEBREW_COPY.pool.claimedBy(claimer?.name ?? 'בן משפחה')} ·{' '}
                          {HEBREW_COPY.pool.claimMinutesLeft(
                            minutesRemaining(pt.claimExpiresAt, serverTime.now),
                          )}
                        </div>
                        {isMine && (
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => void handleCompletePool(pt.id)}
                              data-testid={`pool-complete-btn-${pt.id}`}
                              className="min-h-12 flex-1 rounded-2xl bg-emerald-600 px-4 py-2 font-bold text-white"
                            >
                              {HEBREW_COPY.actions.completePool}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleUnclaimPool(pt.id)}
                              data-testid={`pool-unclaim-btn-${pt.id}`}
                              className="min-h-12 rounded-2xl border border-stone-300 bg-white px-3 py-2 text-sm font-bold text-stone-700"
                            >
                              {HEBREW_COPY.actions.returnToPool}
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {isCooldown && (
                      <div
                        data-testid={`pool-cooldown-badge-${pt.id}`}
                        className="rounded-2xl bg-stone-200 px-3 py-2.5 text-center text-sm font-bold text-stone-700"
                      >
                        ⏳{' '}
                        {HEBREW_COPY.pool.availableAgainIn(
                          minutesRemaining(pt.cooldownEndsAt, serverTime.now),
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 3: היסטוריה */}
      {activeTab === 'history' && (
        <HistoryView
          initialDate={serverTime.logicalDate}
          isParent={isParent}
          onRevertChange={() => {
            void refreshWorkspace();
            onGlobalRefresh();
          }}
        />
      )}

      {/* TAB 4: ניהול הבית (Parents only) */}
      {activeTab === 'admin' && isParent && (
        <AdminView
          appSettings={appSettings}
          onChanged={() => {
            void refreshWorkspace();
            onGlobalRefresh();
          }}
        />
      )}

      {/* Star Breakdown Modal */}
      {showStarModal && starSummary && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/50 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          data-testid="star-breakdown-modal"
        >
          <div className="animate-modal-enter w-full max-w-md rounded-3xl border border-stone-200 bg-[#FAF6EE] p-6 shadow-2xl">
            <h2 className="text-center text-2xl font-bold text-stone-900">
              ⭐ פירוט הכוכבים של {user.name}
            </h2>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-stone-200 bg-white p-4 text-center">
                <p className="text-xs font-bold text-stone-500">{HEBREW_COPY.starPeriods.daily}</p>
                <p className="mt-1 text-2xl font-bold text-amber-600">⭐ {starSummary.daily}</p>
              </div>
              <div className="rounded-2xl border border-stone-200 bg-white p-4 text-center">
                <p className="text-xs font-bold text-stone-500">{HEBREW_COPY.starPeriods.weekly}</p>
                <p className="mt-1 text-2xl font-bold text-amber-600">⭐ {starSummary.weekly}</p>
              </div>
              <div className="rounded-2xl border border-stone-200 bg-white p-4 text-center">
                <p className="text-xs font-bold text-stone-500">{HEBREW_COPY.starPeriods.monthly}</p>
                <p className="mt-1 text-2xl font-bold text-amber-600">⭐ {starSummary.monthly}</p>
              </div>
              <div className="rounded-2xl border border-stone-200 bg-white p-4 text-center">
                <p className="text-xs font-bold text-stone-500">{HEBREW_COPY.starPeriods.yearly}</p>
                <p className="mt-1 text-2xl font-bold text-amber-600">⭐ {starSummary.yearly}</p>
              </div>
            </div>
            <div className="mt-3 rounded-2xl border border-amber-300 bg-amber-100 p-4 text-center">
              <p className="text-xs font-bold text-amber-900">{HEBREW_COPY.starPeriods.total}</p>
              <p className="mt-1 text-3xl font-bold text-amber-950">⭐ {starSummary.total}</p>
            </div>
            <button
              type="button"
              onClick={() => setShowStarModal(false)}
              className="mt-5 min-h-12 w-full rounded-2xl bg-stone-900 font-bold text-white"
            >
              סגור
            </button>
          </div>
        </div>
      )}

      {/* Request Help Modal */}
      {showPeerModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/50 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          data-testid="peer-request-modal"
        >
          <form
            onSubmit={(e) => void handleSendPeerRequest(e)}
            className="animate-modal-enter w-full max-w-md space-y-4 rounded-3xl border border-stone-200 bg-[#FAF6EE] p-6 shadow-2xl"
          >
            <h2 className="text-2xl font-bold text-stone-900">🤝 שליחת בקשת עזרה</h2>
            <div>
              <label className="mb-1 block text-xs font-bold text-stone-600">למי לשלוח?</label>
              <select
                value={peerRecipientId}
                onChange={(e) => setPeerRecipientId(Number(e.target.value))}
                data-testid="peer-recipient-select"
                className="min-h-12 w-full rounded-2xl border border-stone-300 bg-white px-3.5 font-bold"
              >
                {otherProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.avatarEmoji} {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-stone-600">במה צריך עזרה?</label>
              <input
                type="text"
                required
                placeholder="למשל: בוא נעזור לסדר את הלגו..."
                value={peerTitle}
                onChange={(e) => setPeerTitle(e.target.value)}
                data-testid="peer-title-input"
                className="min-h-12 w-full rounded-2xl border border-stone-300 bg-white px-3.5"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-stone-600">בחר אימוג׳י</label>
              <div className="flex flex-wrap gap-2">
                {HELP_EMOJIS.map((em) => (
                  <button
                    key={em}
                    type="button"
                    onClick={() => setPeerEmoji(em)}
                    className={`min-h-12 min-w-12 rounded-2xl text-2xl ${
                      peerEmoji === em
                        ? 'border-2 border-sky-600 bg-sky-100'
                        : 'border border-stone-200 bg-white'
                    }`}
                  >
                    {em}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                data-testid="submit-peer-request-btn"
                className="min-h-12 flex-1 rounded-2xl bg-sky-600 font-bold text-white"
              >
                שלח בקשה
              </button>
              <button
                type="button"
                onClick={() => setShowPeerModal(false)}
                className="min-h-12 rounded-2xl border border-stone-300 bg-white px-5 font-bold text-stone-700"
              >
                ביטול
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
