import { useCallback, useEffect, useState } from 'react';
import {
  EmojiSchema,
  HEBREW_COPY,
  TIME_WINDOWS,
  type AppSettings,
  type DayOfWeek,
  type OneOffTask,
  type PoolResetMode,
  type PoolTask,
  type RoutineTemplate,
  type TimeWindow,
  type User,
  type UserRole,
} from '@habait/shared';
import { api, ClientApiError } from '../api.js';
import {
  BG_COLOR_SWATCHES,
  extractLastGrapheme,
  PRESET_AVATAR_EMOJIS,
} from './ProfileSettingsView.js';

type AdminViewProps = {
  currentUserId: number;
  appSettings: AppSettings;
  onChanged: () => void;
};

const DAY_LABELS: { day: DayOfWeek; label: string }[] = [
  { day: 0, label: 'א׳' },
  { day: 1, label: 'ב׳' },
  { day: 2, label: 'ג׳' },
  { day: 3, label: 'ד׳' },
  { day: 4, label: 'ה׳' },
  { day: 5, label: 'ו׳' },
  { day: 6, label: 'ש׳' },
];

const BG_COLOR_OPTIONS = BG_COLOR_SWATCHES.map((s) => s.token);

export function AdminView({ currentUserId, appSettings, onChanged }: AdminViewProps) {
  const [poolTasks, setPoolTasks] = useState<PoolTask[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [routines, setRoutines] = useState<RoutineTemplate[]>([]);
  const [oneOffs, setOneOffs] = useState<OneOffTask[]>([]);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Settings form state
  const [appTitle, setAppTitle] = useState(appSettings.appTitle);
  const [announcementText, setAnnouncementText] = useState(appSettings.announcementText ?? '');
  const [announcementEmoji, setAnnouncementEmoji] = useState(appSettings.announcementEmoji ?? '📣');

  // New Pool Task form
  const [poolTitle, setPoolTitle] = useState('');
  const [poolEmoji, setPoolEmoji] = useState('🍽️');
  const [poolStars, setPoolStars] = useState(3);
  const [poolResetMode, setPoolResetMode] = useState<PoolResetMode>('COOLDOWN');
  const [poolCooldown, setPoolCooldown] = useState(60);

  // New One-Off Task form
  const [oneOffAssignee, setOneOffAssignee] = useState<number>(0);
  const [oneOffTitle, setOneOffTitle] = useState('');
  const [oneOffEmoji, setOneOffEmoji] = useState('⭐');
  const [oneOffStars, setOneOffStars] = useState(2);

  // New Routine form
  const [routineAssignee, setRoutineAssignee] = useState<number>(0);
  const [routineTitle, setRoutineTitle] = useState('');
  const [routineEmoji, setRoutineEmoji] = useState('🪥');
  const [routineWindow, setRoutineWindow] = useState<TimeWindow>('MORNING');
  const [routineDays, setRoutineDays] = useState<DayOfWeek[]>([0, 1, 2, 3, 4, 5, 6]);

  // New User form
  const [newUserName, setNewUserName] = useState('');
  const [newUserNickname, setNewUserNickname] = useState('');
  const [newUserEmoji, setNewUserEmoji] = useState('🦊');
  const [newUserBg, setNewUserBg] = useState<string>('bg-violet-200');
  const [newUserRole, setNewUserRole] = useState<UserRole>('CHILD');
  const [newUserPin, setNewUserPin] = useState('');

  // Inline Edit / Delete User state
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editNickname, setEditNickname] = useState('');
  const [editEmoji, setEditEmoji] = useState('');
  const [editBg, setEditBg] = useState('');
  const [editRole, setEditRole] = useState<UserRole>('CHILD');
  const [editPin, setEditPin] = useState('');
  const [confirmDeleteUserId, setConfirmDeleteUserId] = useState<number | null>(null);

  const flashFeedback = (msg: string) => {
    setFeedbackMsg(msg);
    setErrorMsg(null);
    setTimeout(() => setFeedbackMsg(null), 2500);
  };

  const loadAll = useCallback(async () => {
    const [poolRes, usersRes, routinesRes, oneOffsRes] = await Promise.all([
      api.adminGetPool(),
      api.adminGetUsers(),
      api.adminGetRoutines(),
      api.adminGetOneOffs(),
    ]);
    setPoolTasks(poolRes.tasks);
    setUsers(usersRes.users);
    setRoutines(routinesRes.routines);
    setOneOffs(oneOffsRes.tasks);
    if (usersRes.users[0]) {
      setOneOffAssignee((prev) => prev || usersRes.users[0]!.id);
      setRoutineAssignee((prev) => prev || usersRes.users[0]!.id);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleTogglePool = async (id: number) => {
    await api.adminTogglePoolActive(id);
    await loadAll();
    onChanged();
    flashFeedback('סטטוס המשימה עודכן');
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.updateSettings({
        appTitle,
        announcementText: announcementText.trim() || null,
        announcementEmoji: announcementText.trim() ? announcementEmoji : null,
      });
      onChanged();
      flashFeedback('הגדרות הבית והודעת המשפחה נשמרו');
    } catch (err) {
      setErrorMsg(err instanceof ClientApiError ? err.message : 'שגיאה בשמירת הגדרות');
    }
  };

  const handleCreatePoolTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!poolTitle.trim()) return;
    try {
      await api.adminCreatePoolTask({
        title: poolTitle.trim(),
        iconEmoji: poolEmoji.trim() || '🧺',
        stars: poolStars,
        resetMode: poolResetMode,
        cooldownMinutes: poolCooldown,
        isActive: true,
      });
      setPoolTitle('');
      await loadAll();
      onChanged();
      flashFeedback('משימה חדשה נוספה לקופת המשימות');
    } catch (err) {
      setErrorMsg(err instanceof ClientApiError ? err.message : 'שגיאה ביצירת משימת קופה');
    }
  };

  const handleCreateOneOff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!oneOffTitle.trim() || !oneOffAssignee) return;
    try {
      await api.adminCreateOneOff({
        assigneeId: oneOffAssignee,
        title: oneOffTitle.trim(),
        iconEmoji: oneOffEmoji.trim() || '⭐',
        stars: oneOffStars,
      });
      setOneOffTitle('');
      await loadAll();
      onChanged();
      flashFeedback('משימה מיוחדת הוקצתה');
    } catch (err) {
      setErrorMsg(err instanceof ClientApiError ? err.message : 'שגיאה ביצירת משימה');
    }
  };

  const handleCancelOneOff = async (id: number) => {
    await api.adminCancelOneOff(id);
    await loadAll();
    onChanged();
    flashFeedback('המשימה בוטלה');
  };

  const toggleRoutineDay = (day: DayOfWeek) => {
    setRoutineDays((prev) =>
      prev.includes(day) ? (prev.length > 1 ? prev.filter((d) => d !== day) : prev) : [...prev, day],
    );
  };

  const handleCreateRoutine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!routineTitle.trim() || !routineAssignee) return;
    try {
      await api.adminCreateRoutine({
        assigneeId: routineAssignee,
        title: routineTitle.trim(),
        iconEmoji: routineEmoji.trim() || '🪥',
        timeWindow: routineWindow,
        daysOfWeek: routineDays,
      });
      setRoutineTitle('');
      await loadAll();
      onChanged();
      flashFeedback('שגרה יומית נוספה');
    } catch (err) {
      setErrorMsg(err instanceof ClientApiError ? err.message : 'שגיאה ביצירת שגרה');
    }
  };

  const handleToggleRoutineActive = async (r: RoutineTemplate) => {
    await api.adminUpdateRoutine(r.id, { isActive: !r.isActive });
    await loadAll();
    onChanged();
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserName.trim()) return;
    try {
      const emojiToUse = extractLastGrapheme(newUserEmoji) || (newUserRole === 'PARENT' ? '🦸' : '🦄');
      if (newUserRole === 'PARENT') {
        await api.adminCreateUser({
          name: newUserName.trim(),
          nickname: newUserNickname.trim() || null,
          avatarEmoji: emojiToUse,
          avatarBgColor: newUserBg,
          role: 'PARENT',
          pin: newUserPin,
        });
      } else {
        await api.adminCreateUser({
          name: newUserName.trim(),
          nickname: newUserNickname.trim() || null,
          avatarEmoji: emojiToUse,
          avatarBgColor: newUserBg,
          role: 'CHILD',
          pin: newUserPin.trim() ? newUserPin.trim() : null,
        });
      }
      setNewUserName('');
      setNewUserNickname('');
      setNewUserPin('');
      await loadAll();
      onChanged();
      flashFeedback('פרופיל משפחתי נוסף');
    } catch (err) {
      setErrorMsg(err instanceof ClientApiError ? err.message : 'שגיאה ביצירת משתמש (הורה חייב קוד בן 4 ספרות)');
    }
  };

  const startEditingUser = (u: User) => {
    setEditingUserId(u.id);
    setConfirmDeleteUserId(null);
    setEditName(u.name);
    setEditNickname(u.nickname ?? '');
    setEditEmoji(u.avatarEmoji);
    setEditBg(u.avatarBgColor);
    setEditRole(u.role);
    setEditPin('');
  };

  const handleSaveUserEdit = async (e: React.FormEvent, u: User) => {
    e.preventDefault();
    setErrorMsg(null);
    const cleanedEmoji = extractLastGrapheme(editEmoji) || u.avatarEmoji;
    if (!EmojiSchema.safeParse(cleanedEmoji).success) {
      setErrorMsg('נא לבחור אימוג׳י תקין אחד בלבד');
      return;
    }
    if (editPin.trim() && !/^\d{4}$/.test(editPin.trim())) {
      setErrorMsg('הקוד הסודי חייב להכיל בדיוק 4 ספרות');
      return;
    }
    try {
      await api.adminUpdateUser(u.id, {
        name: editName.trim() || u.name,
        nickname: editNickname.trim() ? editNickname.trim() : null,
        avatarEmoji: cleanedEmoji,
        avatarBgColor: editBg,
        role: editRole,
        ...(editPin.trim() ? { pin: editPin.trim() } : {}),
      });
      setEditingUserId(null);
      setEditPin('');
      await loadAll();
      onChanged();
      flashFeedback('פרטי בן/בת המשפחה עודכנו');
    } catch (err) {
      setErrorMsg(err instanceof ClientApiError ? err.message : 'שגיאה בעדכון פרופיל');
    }
  };

  const handleRemoveChildPin = async (userId: number) => {
    setErrorMsg(null);
    try {
      await api.adminUpdateUser(userId, { pin: null });
      setEditPin('');
      await loadAll();
      onChanged();
      flashFeedback('קוד סודי הוסר מהפרופיל');
    } catch (err) {
      setErrorMsg(err instanceof ClientApiError ? err.message : 'שגיאה בהסרת קוד סודי');
    }
  };

  const handleConfirmDeleteUser = async (userId: number) => {
    setErrorMsg(null);
    try {
      await api.adminDeleteUser(userId);
      setConfirmDeleteUserId(null);
      if (editingUserId === userId) setEditingUserId(null);
      await loadAll();
      onChanged();
      flashFeedback('הפרופיל וכל משימותיו נמחקו לצמיתות');
    } catch (err) {
      setErrorMsg(err instanceof ClientApiError ? err.message : 'שגיאה במחיקת הפרופיל');
    }
  };

  return (
    <div className="space-y-8" data-testid="admin-view">
      {feedbackMsg && (
        <div
          className="rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-base font-bold text-emerald-900"
          role="status"
          data-testid="admin-feedback"
        >
          ✓ {feedbackMsg}
        </div>
      )}
      {errorMsg && (
        <div
          className="rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 text-base font-bold text-rose-900"
          role="alert"
        >
          {errorMsg}
        </div>
      )}

      {/* 1. Instant Pool Switchboard */}
      <section className="rounded-3xl border border-stone-200 bg-white p-6 shadow-xs">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-stone-900">
              מתגים מהירים — {HEBREW_COPY.nav.pool}
            </h2>
            <p className="text-sm text-stone-600">
              הפעלה או כיבוי בלחיצה אחת (למשל להדליק מחדש &quot;פינוי מדיח הכלים&quot;)
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {poolTasks.map((pt) => (
            <div
              key={pt.id}
              data-testid={`admin-pool-row-${pt.id}`}
              className={`flex items-center justify-between rounded-2xl border p-4 ${
                pt.isActive
                  ? 'border-emerald-200 bg-emerald-50/40'
                  : 'border-stone-200 bg-stone-100/70 opacity-80'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="text-3xl">{pt.iconEmoji}</span>
                <div>
                  <p className="font-bold text-stone-900">{pt.title}</p>
                  <p className="text-xs text-stone-600">
                    +{pt.stars} ⭐ · {HEBREW_COPY.poolResetModes[pt.resetMode]}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleTogglePool(pt.id)}
                data-testid={`admin-pool-toggle-${pt.id}`}
                className={`min-h-12 min-w-24 rounded-2xl px-4 py-2 text-sm font-bold shadow-xs ${
                  pt.isActive
                    ? 'bg-emerald-600 text-white'
                    : 'border border-stone-300 bg-white text-stone-700'
                }`}
              >
                {pt.isActive ? HEBREW_COPY.status.active : HEBREW_COPY.status.inactive}
              </button>
            </div>
          ))}
        </div>

        {/* Add Pool Task Form */}
        <form
          onSubmit={(e) => void handleCreatePoolTask(e)}
          className="mt-5 grid grid-cols-1 gap-3 border-t border-stone-100 pt-5 sm:grid-cols-6"
        >
          <input
            type="text"
            placeholder="שם משימה לקופה..."
            value={poolTitle}
            onChange={(e) => setPoolTitle(e.target.value)}
            data-testid="admin-new-pool-title"
            className="min-h-12 rounded-2xl border border-stone-300 bg-[#FAF6EE] px-3.5 sm:col-span-2"
          />
          <input
            type="text"
            placeholder="אימוג׳י"
            value={poolEmoji}
            onChange={(e) => setPoolEmoji(e.target.value)}
            className="min-h-12 rounded-2xl border border-stone-300 bg-[#FAF6EE] px-3.5 text-center text-2xl"
          />
          <input
            type="number"
            min={0}
            max={100}
            value={poolStars}
            onChange={(e) => setPoolStars(Number(e.target.value))}
            aria-label="כוכבים"
            className="min-h-12 rounded-2xl border border-stone-300 bg-[#FAF6EE] px-3.5"
          />
          <select
            value={poolResetMode}
            onChange={(e) => setPoolResetMode(e.target.value as PoolResetMode)}
            data-testid="admin-new-pool-mode"
            className="min-h-12 rounded-2xl border border-stone-300 bg-[#FAF6EE] px-3"
          >
            <option value="COOLDOWN">{HEBREW_COPY.poolResetModes.COOLDOWN}</option>
            <option value="AUTO_DISABLE">{HEBREW_COPY.poolResetModes.AUTO_DISABLE}</option>
          </select>
          <button
            type="submit"
            data-testid="admin-create-pool-btn"
            className="min-h-12 rounded-2xl bg-amber-600 px-4 font-bold text-white"
          >
            + הוסף לקופה
          </button>
        </form>
      </section>

      {/* 2. Family Announcement & App Title */}
      <section className="rounded-3xl border border-stone-200 bg-white p-6 shadow-xs">
        <h2 className="mb-4 text-2xl font-bold text-stone-900">שם הבית והודעה משפחתית</h2>
        <form onSubmit={(e) => void handleSaveSettings(e)} className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-bold text-stone-600">כותרת האפליקציה</label>
            <input
              type="text"
              value={appTitle}
              onChange={(e) => setAppTitle(e.target.value)}
              data-testid="admin-app-title-input"
              className="min-h-12 w-full rounded-2xl border border-stone-300 bg-[#FAF6EE] px-3.5 font-bold"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-stone-600">אימוג׳י להודעה</label>
            <input
              type="text"
              value={announcementEmoji}
              onChange={(e) => setAnnouncementEmoji(e.target.value)}
              data-testid="admin-announcement-emoji-input"
              className="min-h-12 w-full rounded-2xl border border-stone-300 bg-[#FAF6EE] px-3.5 text-center text-2xl"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-bold text-stone-600">
              הודעה בראש מסך הבית (ריק לניקוי)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={announcementText}
                onChange={(e) => setAnnouncementText(e.target.value)}
                placeholder="הודעה לכל המשפחה..."
                data-testid="admin-announcement-text-input"
                className="min-h-12 flex-1 rounded-2xl border border-stone-300 bg-[#FAF6EE] px-3.5"
              />
              <button
                type="submit"
                data-testid="admin-save-settings-btn"
                className="min-h-12 rounded-2xl bg-stone-900 px-5 font-bold text-white"
              >
                שמור
              </button>
            </div>
          </div>
        </form>
      </section>

      {/* 3. One-Off Tasks Management */}
      <section className="rounded-3xl border border-stone-200 bg-white p-6 shadow-xs">
        <h2 className="mb-4 text-2xl font-bold text-stone-900">
          {HEBREW_COPY.sections.oneOffTasks} — הקצאה וביטול
        </h2>
        <form
          onSubmit={(e) => void handleCreateOneOff(e)}
          className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-5"
        >
          <select
            value={oneOffAssignee}
            onChange={(e) => setOneOffAssignee(Number(e.target.value))}
            className="min-h-12 rounded-2xl border border-stone-300 bg-[#FAF6EE] px-3"
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.avatarEmoji} {u.name}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="תיאור המשימה..."
            value={oneOffTitle}
            onChange={(e) => setOneOffTitle(e.target.value)}
            data-testid="admin-oneoff-title-input"
            className="min-h-12 rounded-2xl border border-stone-300 bg-[#FAF6EE] px-3.5"
          />
          <input
            type="text"
            value={oneOffEmoji}
            onChange={(e) => setOneOffEmoji(e.target.value)}
            className="min-h-12 rounded-2xl border border-stone-300 bg-[#FAF6EE] px-3.5 text-center text-2xl"
          />
          <input
            type="number"
            min={0}
            max={100}
            value={oneOffStars}
            onChange={(e) => setOneOffStars(Number(e.target.value))}
            className="min-h-12 rounded-2xl border border-stone-300 bg-[#FAF6EE] px-3.5"
          />
          <button
            type="submit"
            data-testid="admin-create-oneoff-btn"
            className="min-h-12 rounded-2xl bg-emerald-600 px-4 font-bold text-white"
          >
            + הקצה משימה
          </button>
        </form>

        <div className="space-y-2">
          {oneOffs
            .filter((t) => t.status === 'PENDING')
            .map((t) => {
              const assignee = users.find((u) => u.id === t.assigneeId);
              return (
                <div
                  key={t.id}
                  className="flex items-center justify-between rounded-2xl border border-stone-200 bg-[#FAF6EE] px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{t.iconEmoji}</span>
                    <div>
                      <p className="font-bold text-stone-900">{t.title}</p>
                      <p className="text-xs text-stone-600">
                        עבור: {assignee?.name ?? t.assigneeId} · +{t.stars} ⭐
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleCancelOneOff(t.id)}
                    className="min-h-12 min-w-12 rounded-xl border border-rose-300 bg-rose-50 px-3 py-1 text-xs font-bold text-rose-800"
                  >
                    ביטול משימה
                  </button>
                </div>
              );
            })}
        </div>
      </section>

      {/* 4. Routines Management with Sun-Sat Day Pills */}
      <section className="rounded-3xl border border-stone-200 bg-white p-6 shadow-xs">
        <h2 className="mb-4 text-2xl font-bold text-stone-900">
          {HEBREW_COPY.sections.dailyRoutines} (0 כוכבים)
        </h2>
        <form onSubmit={(e) => void handleCreateRoutine(e)} className="mb-5 space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <select
              value={routineAssignee}
              onChange={(e) => setRoutineAssignee(Number(e.target.value))}
              className="min-h-12 rounded-2xl border border-stone-300 bg-[#FAF6EE] px-3"
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.avatarEmoji} {u.name}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="שם הרגל / שגרה..."
              value={routineTitle}
              onChange={(e) => setRoutineTitle(e.target.value)}
              className="min-h-12 rounded-2xl border border-stone-300 bg-[#FAF6EE] px-3.5"
            />
            <input
              type="text"
              value={routineEmoji}
              onChange={(e) => setRoutineEmoji(e.target.value)}
              className="min-h-12 rounded-2xl border border-stone-300 bg-[#FAF6EE] px-3.5 text-center text-2xl"
            />
            <select
              value={routineWindow}
              onChange={(e) => setRoutineWindow(e.target.value as TimeWindow)}
              className="min-h-12 rounded-2xl border border-stone-300 bg-[#FAF6EE] px-3"
            >
              {TIME_WINDOWS.map((w) => (
                <option key={w} value={w}>
                  {HEBREW_COPY.timeWindows[w]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="me-2 text-xs font-bold text-stone-600">ימים בשבוע:</span>
              {DAY_LABELS.map((dl) => {
                const active = routineDays.includes(dl.day);
                return (
                  <button
                    key={dl.day}
                    type="button"
                    onClick={() => toggleRoutineDay(dl.day)}
                    className={`min-h-12 min-w-12 rounded-xl text-sm font-bold ${
                      active
                        ? 'bg-amber-500 text-white'
                        : 'border border-stone-300 bg-[#FAF6EE] text-stone-600'
                    }`}
                  >
                    {dl.label}
                  </button>
                );
              })}
            </div>
            <button
              type="submit"
              className="min-h-12 rounded-2xl bg-stone-900 px-5 font-bold text-white"
            >
              + הוסף שגרה
            </button>
          </div>
        </form>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {routines.map((r) => {
            const assignee = users.find((u) => u.id === r.assigneeId);
            return (
              <div
                key={r.id}
                className="flex items-center justify-between rounded-2xl border border-stone-200 bg-[#FAF6EE] px-4 py-2.5"
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-2xl">{r.iconEmoji}</span>
                  <div>
                    <p className="text-sm font-bold text-stone-900">{r.title}</p>
                    <p className="text-xs text-stone-600">
                      {assignee?.name} · {HEBREW_COPY.timeWindows[r.timeWindow]}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleToggleRoutineActive(r)}
                  className={`min-h-12 min-w-12 rounded-xl px-3 py-1 text-xs font-bold ${
                    r.isActive
                      ? 'bg-emerald-600 text-white'
                      : 'border border-stone-300 bg-white text-stone-600'
                  }`}
                >
                  {r.isActive ? HEBREW_COPY.status.active : HEBREW_COPY.status.inactive}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* 5. Profile & PIN Management */}
      <section className="rounded-3xl border border-stone-200 bg-white p-6 shadow-xs">
        <div className="mb-4">
          <h2 className="text-2xl font-bold text-stone-900">בני המשפחה וקודים סודיים</h2>
          <p className="text-sm text-stone-600">
            עריכת שמות, כינויים, אימוג׳ים וקודים סודיים, או מחיקת פרופילים מיותרים
          </p>
        </div>

        <div className="mb-6 space-y-3">
          {users.map((u) => {
            const isEditing = editingUserId === u.id;
            const isConfirmingDelete = confirmDeleteUserId === u.id;
            const isSelf = u.id === currentUserId;

            return (
              <div
                key={u.id}
                data-testid={`admin-user-row-${u.id}`}
                className={`rounded-2xl border p-4 ${
                  isEditing
                    ? 'border-amber-400 bg-amber-50/50'
                    : 'border-stone-200 bg-[#FAF6EE]'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-12 w-12 items-center justify-center rounded-2xl text-3xl ${u.avatarBgColor}`}
                    >
                      {u.avatarEmoji}
                    </div>
                    <div>
                      <p className="font-bold text-stone-900">
                        {u.name}
                        {u.nickname ? (
                          <span className="ms-1.5 text-sm font-medium text-stone-600">
                            (&quot;{u.nickname}&quot;)
                          </span>
                        ) : null}
                      </p>
                      <p className="text-xs text-stone-600">
                        {HEBREW_COPY.roles[u.role]} · {u.hasPin ? '🔒 מוגן בקוד' : 'ללא קוד'}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => (isEditing ? setEditingUserId(null) : startEditingUser(u))}
                      data-testid={`admin-edit-user-btn-${u.id}`}
                      className="min-h-12 min-w-12 rounded-xl border border-stone-300 bg-white px-3.5 py-2 text-xs font-bold text-stone-800"
                    >
                      {isEditing ? 'סגור עריכה' : '✏️ עריכה וקוד'}
                    </button>

                    {!isSelf && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingUserId(null);
                          setConfirmDeleteUserId(isConfirmingDelete ? null : u.id);
                        }}
                        data-testid={`admin-delete-user-btn-${u.id}`}
                        className="min-h-12 min-w-12 rounded-xl border border-rose-300 bg-rose-50 px-3.5 py-2 text-xs font-bold text-rose-800"
                      >
                        🗑️ מחיקה
                      </button>
                    )}
                  </div>
                </div>

                {/* Inline Delete Confirmation */}
                {isConfirmingDelete && (
                  <div
                    data-testid={`admin-delete-confirm-box-${u.id}`}
                    className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-300 bg-rose-100/80 p-3.5"
                  >
                    <p className="text-sm font-bold text-rose-950">
                      בטוחים שברצונכם למחוק את {u.name} וכל המשימות וההיסטוריה שלו/ה?
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleConfirmDeleteUser(u.id)}
                        data-testid={`admin-confirm-delete-user-${u.id}`}
                        className="min-h-12 min-w-12 rounded-xl bg-rose-700 px-4 py-2 text-xs font-bold text-white"
                      >
                        כן, מחק סופית
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteUserId(null)}
                        className="min-h-12 min-w-12 rounded-xl border border-stone-300 bg-white px-4 py-2 text-xs font-bold text-stone-700"
                      >
                        ביטול
                      </button>
                    </div>
                  </div>
                )}

                {/* Inline Edit Form */}
                {isEditing && (
                  <form
                    onSubmit={(e) => void handleSaveUserEdit(e, u)}
                    data-testid={`admin-edit-user-form-${u.id}`}
                    className="mt-4 space-y-4 border-t border-stone-200 pt-4"
                  >
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                      <div>
                        <label className="mb-1 block text-xs font-bold text-stone-600">
                          שם רשמי
                        </label>
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          data-testid={`admin-user-name-input-${u.id}`}
                          className="min-h-12 w-full rounded-2xl border border-stone-300 bg-white px-3.5 font-bold"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-bold text-stone-600">
                          כינוי אישי
                        </label>
                        <input
                          type="text"
                          placeholder="ללא כינוי"
                          value={editNickname}
                          onChange={(e) => setEditNickname(e.target.value)}
                          data-testid={`admin-user-nickname-input-${u.id}`}
                          className="min-h-12 w-full rounded-2xl border border-stone-300 bg-white px-3.5"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-bold text-stone-600">
                          תפקיד בבית
                        </label>
                        <select
                          value={editRole}
                          onChange={(e) => setEditRole(e.target.value as UserRole)}
                          disabled={u.id === currentUserId}
                          data-testid={`admin-user-role-select-${u.id}`}
                          className="min-h-12 w-full rounded-2xl border border-stone-300 bg-white px-3 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400"
                        >
                          <option value="CHILD">{HEBREW_COPY.roles.CHILD}</option>
                          <option value="PARENT">{HEBREW_COPY.roles.PARENT}</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-bold text-stone-600">
                          קוד סודי חדש (4 ספרות)
                        </label>
                        <input
                          type="password"
                          inputMode="numeric"
                          maxLength={4}
                          placeholder={u.hasPin ? 'הזן להחלפת קוד...' : 'הגדר קוד 4 ספרות...'}
                          value={editPin}
                          onChange={(e) => setEditPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                          data-testid={`admin-user-pin-input-${u.id}`}
                          className="min-h-12 w-full rounded-2xl border border-stone-300 bg-white px-3.5 text-center font-bold tracking-widest"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {PRESET_AVATAR_EMOJIS.slice(0, 8).map((em) => (
                          <button
                            key={em}
                            type="button"
                            onClick={() => setEditEmoji(em)}
                            className={`flex min-h-12 min-w-12 items-center justify-center rounded-xl border text-xl ${
                              editEmoji === em
                                ? 'border-amber-500 bg-amber-100'
                                : 'border-stone-200 bg-white'
                            }`}
                          >
                            {em}
                          </button>
                        ))}
                        <input
                          type="text"
                          aria-label="אימוג׳י מותאם אישית"
                          value={editEmoji}
                          onChange={(e) => {
                            const last = extractLastGrapheme(e.target.value);
                            if (last) setEditEmoji(last);
                          }}
                          data-testid={`admin-user-emoji-input-${u.id}`}
                          className="min-h-12 w-16 rounded-xl border border-stone-300 bg-white text-center text-2xl"
                        />
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        {BG_COLOR_SWATCHES.map((sw) => (
                          <button
                            key={sw.token}
                            type="button"
                            aria-label={sw.label}
                            onClick={() => setEditBg(sw.token)}
                            className={`flex min-h-12 min-w-12 items-center justify-center rounded-xl border-2 text-xs font-bold ${
                              sw.token
                            } ${
                              editBg === sw.token ? 'border-stone-900' : 'border-stone-300'
                            }`}
                          >
                            {editBg === sw.token ? '✓' : ''}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        {u.role === 'CHILD' && u.hasPin && (
                          <button
                            type="button"
                            onClick={() => void handleRemoveChildPin(u.id)}
                            data-testid={`admin-remove-pin-btn-${u.id}`}
                            className="min-h-12 min-w-12 rounded-xl border border-stone-300 bg-white px-3.5 py-2 text-xs font-bold text-stone-700"
                          >
                            הסר קוד סודי מהילד/ה
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingUserId(null)}
                          className="min-h-12 min-w-12 rounded-xl border border-stone-300 bg-white px-4 py-2 text-xs font-bold text-stone-700"
                        >
                          ביטול
                        </button>
                        <button
                          type="submit"
                          data-testid={`admin-save-user-btn-${u.id}`}
                          className="min-h-12 min-w-12 rounded-xl bg-emerald-600 px-5 py-2 text-xs font-bold text-white"
                        >
                          ✓ שמור שינויים
                        </button>
                      </div>
                    </div>
                  </form>
                )}
              </div>
            );
          })}
        </div>

        <form
          onSubmit={(e) => void handleCreateUser(e)}
          className="grid grid-cols-1 gap-3 border-t border-stone-100 pt-5 sm:grid-cols-6"
        >
          <input
            type="text"
            placeholder="שם בן/בת משפחה..."
            value={newUserName}
            onChange={(e) => setNewUserName(e.target.value)}
            data-testid="admin-new-user-name"
            className="min-h-12 rounded-2xl border border-stone-300 bg-[#FAF6EE] px-3.5"
          />
          <input
            type="text"
            placeholder="כינוי (רשות)..."
            value={newUserNickname}
            onChange={(e) => setNewUserNickname(e.target.value)}
            data-testid="admin-new-user-nickname"
            className="min-h-12 rounded-2xl border border-stone-300 bg-[#FAF6EE] px-3.5"
          />
          <input
            type="text"
            value={newUserEmoji}
            onChange={(e) => {
              const last = extractLastGrapheme(e.target.value);
              setNewUserEmoji(last);
            }}
            placeholder="אימוג׳י"
            data-testid="admin-new-user-emoji"
            className="min-h-12 rounded-2xl border border-stone-300 bg-[#FAF6EE] px-3.5 text-center text-2xl"
          />
          <select
            value={newUserBg}
            onChange={(e) => setNewUserBg(e.target.value)}
            className="min-h-12 rounded-2xl border border-stone-300 bg-[#FAF6EE] px-3"
          >
            {BG_COLOR_SWATCHES.map((sw) => (
              <option key={sw.token} value={sw.token}>
                {sw.label}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <select
              value={newUserRole}
              onChange={(e) => setNewUserRole(e.target.value as UserRole)}
              className="min-h-12 flex-1 rounded-2xl border border-stone-300 bg-[#FAF6EE] px-2 text-sm"
            >
              <option value="CHILD">{HEBREW_COPY.roles.CHILD}</option>
              <option value="PARENT">{HEBREW_COPY.roles.PARENT}</option>
            </select>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              placeholder={newUserRole === 'PARENT' ? 'קוד (חובה)' : 'קוד (רשות)'}
              value={newUserPin}
              onChange={(e) => setNewUserPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              className="min-h-12 w-28 rounded-2xl border border-stone-300 bg-[#FAF6EE] px-2 text-center text-sm"
            />
          </div>
          <button
            type="submit"
            data-testid="admin-create-user-btn"
            className="min-h-12 min-w-12 rounded-2xl bg-stone-900 px-4 font-bold text-white"
          >
            + הוסף פרופיל
          </button>
        </form>
      </section>
    </div>
  );
}
