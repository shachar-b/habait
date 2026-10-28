import { useCallback, useEffect, useState } from 'react';
import {
  getDisplayName,
  HEBREW_COPY,
  TIME_ZONE,
  type LobbyProfile,
  type LobbyResponse,
} from '@habait/shared';
import { api } from './api.js';
import { HistoryView } from './components/HistoryView.js';
import { PinModal } from './components/PinModal.js';
import { WorkspaceView } from './components/WorkspaceView.js';

type RouteState =
  | { view: 'lobby' }
  | { view: 'history' }
  | { view: 'profile'; userId: number };

function parseRoute(pathname: string): RouteState {
  if (pathname === '/history') return { view: 'history' };
  const match = /^\/profile\/(\d+)/.exec(pathname);
  if (match && match[1]) {
    return { view: 'profile', userId: Number(match[1]) };
  }
  return { view: 'lobby' };
}

function formatClock(ms: number): string {
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(ms));
}

function formatHebrewDate(ms: number): string {
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: TIME_ZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(ms));
}

export function App() {
  const [route, setRoute] = useState<RouteState>(() => parseRoute(window.location.pathname));
  const [lobby, setLobby] = useState<LobbyResponse | null>(null);
  const [clockMs, setClockMs] = useState<number>(() => Date.now());
  const [pinTarget, setPinTarget] = useState<LobbyProfile | null>(null);

  const navigate = useCallback((path: string) => {
    window.history.pushState({}, '', path);
    setRoute(parseRoute(path));
  }, []);

  useEffect(() => {
    const onPopState = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const loadLobby = useCallback(async () => {
    const data = await api.getLobby();
    setLobby(data);
    setClockMs(data.serverTime.now);
  }, []);

  useEffect(() => {
    void loadLobby();
  }, [loadLobby]);

  useEffect(() => {
    const interval = setInterval(() => {
      setClockMs((prev) => prev + 15_000);
    }, 15_000);
    return () => clearInterval(interval);
  }, []);

  const handleSelectProfile = async (profile: LobbyProfile) => {
    if (!profile.hasPin) {
      await api.login({ userId: profile.id });
      navigate(`/profile/${profile.id}`);
    } else {
      setPinTarget(profile);
    }
  };

  if (!lobby) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-2xl font-bold text-stone-600">
        טוען את הבית שלנו...
      </div>
    );
  }

  if (route.view === 'profile') {
    return (
      <WorkspaceView
        userId={route.userId}
        profiles={lobby.profiles}
        appSettings={lobby.appSettings}
        onSwitchUser={() => {
          void loadLobby();
          navigate('/');
        }}
        onGlobalRefresh={() => {
          void loadLobby();
        }}
      />
    );
  }

  if (route.view === 'history') {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-stone-200 bg-white p-5 shadow-xs">
          <h1 className="text-2xl font-bold text-stone-900 sm:text-3xl">
            📅 {HEBREW_COPY.nav.history} — {lobby.appSettings.appTitle}
          </h1>
          <button
            type="button"
            onClick={() => navigate('/')}
            data-testid="history-back-lobby-btn"
            className="min-h-12 rounded-2xl border border-stone-300 bg-[#FAF6EE] px-4 py-2 font-bold text-stone-800"
          >
            חזרה למסך הבית
          </button>
        </header>
        <HistoryView initialDate={lobby.serverTime.logicalDate} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:py-10" data-testid="lobby-screen">
      {/* 1. Top Header Bar */}
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-stone-200 bg-white px-6 py-5 shadow-xs">
        <div>
          <h1
            className="text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl"
            data-testid="lobby-app-title"
          >
            🏠 {lobby.appSettings.appTitle}
          </h1>
          <p className="mt-1 text-sm font-medium text-stone-500" data-testid="lobby-hebrew-date">
            {formatHebrewDate(clockMs)}
          </p>
        </div>

        <div className="flex items-center gap-4">
          <div
            className="rounded-2xl bg-[#FAF6EE] px-4 py-2 text-2xl font-bold text-stone-800 tabular-nums"
            data-testid="lobby-clock"
          >
            {formatClock(clockMs)}
          </div>
          <button
            type="button"
            onClick={() => navigate('/history')}
            data-testid="lobby-history-link"
            className="min-h-12 rounded-2xl border border-stone-300 bg-[#FAF6EE] px-4 py-2 text-base font-bold text-stone-800"
          >
            📅 {HEBREW_COPY.nav.history}
          </button>
        </div>
      </header>

      {/* 2. Family Announcement Banner */}
      {lobby.appSettings.announcementText && (
        <section
          data-testid="lobby-announcement-banner"
          className="mb-8 flex items-center gap-4 rounded-3xl border border-amber-300 bg-gradient-to-b from-amber-50 to-amber-100/70 px-6 py-4 shadow-xs"
        >
          <span className="text-4xl" data-testid="lobby-announcement-emoji">
            {lobby.appSettings.announcementEmoji ?? '📣'}
          </span>
          <p
            className="text-lg font-bold text-stone-900 sm:text-xl"
            data-testid="lobby-announcement-text"
          >
            {lobby.appSettings.announcementText}
          </p>
        </section>
      )}

      {/* 3. Netflix-Style Profile Selector Grid */}
      <section aria-label="בחירת פרופיל">
        <h2 className="mb-5 text-center text-xl font-bold text-stone-700">
          מי משתמש עכשיו? בחרו פרופיל:
        </h2>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {lobby.profiles.map((profile) => (
            <button
              key={profile.id}
              type="button"
              onClick={() => void handleSelectProfile(profile)}
              data-testid={`profile-card-${profile.id}`}
              className="card-hover flex flex-col items-center rounded-3xl border border-stone-200 bg-white p-6 text-center shadow-xs"
            >
              <div
                className={`relative flex h-24 w-24 items-center justify-center rounded-3xl text-5xl shadow-inner ${profile.avatarBgColor}`}
              >
                <span>{profile.avatarEmoji}</span>
                {profile.role === 'PARENT' && (
                  <span
                    title="הורה"
                    data-testid={`profile-parent-badge-${profile.id}`}
                    className="absolute -top-2 -start-2 flex h-8 w-8 items-center justify-center rounded-full border border-amber-300 bg-amber-100 text-base shadow-xs"
                  >
                    👑
                  </span>
                )}
              </div>

              <h3 className="mt-4 text-2xl font-bold text-stone-900">
                {getDisplayName(profile)}
              </h3>
              {profile.nickname && (
                <span
                  data-testid={`profile-official-name-${profile.id}`}
                  className="mt-0.5 text-xs font-medium text-stone-500"
                >
                  ({profile.name})
                </span>
              )}

              {/* Star Pill */}
              <div
                data-testid={`profile-stars-${profile.id}`}
                className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-100 px-3.5 py-1 text-base font-bold text-amber-950"
              >
                <span>⭐</span>
                <span>{profile.totalStars}</span>
              </div>

              {/* Non-Overwhelming Open-Task Indicator Dot (STRICTLY zero task counts) */}
              <div
                data-testid={`profile-status-${profile.id}`}
                className="mt-4 flex items-center gap-2 rounded-full bg-[#FAF6EE] px-3.5 py-1.5 text-xs font-bold text-stone-700"
              >
                <span
                  data-testid={`profile-status-dot-${profile.id}`}
                  className={`h-3 w-3 rounded-full ${
                    profile.hasOpenTasks
                      ? 'animate-pulse bg-amber-500'
                      : 'bg-emerald-500'
                  }`}
                />
                <span>
                  {profile.hasOpenTasks
                    ? HEBREW_COPY.status.hasOpenTasks
                    : HEBREW_COPY.status.allDone}
                </span>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* 4. Conditional PIN Modal */}
      {pinTarget && (
        <PinModal
          profile={pinTarget}
          onCancel={() => setPinTarget(null)}
          onSuccess={() => {
            const targetId = pinTarget.id;
            setPinTarget(null);
            navigate(`/profile/${targetId}`);
          }}
        />
      )}
    </div>
  );
}
