import { useState } from 'react';
import {
  EmojiSchema,
  HEBREW_COPY,
  getDisplayName,
  type User,
} from '@habait/shared';
import { api, ClientApiError } from '../api.js';

export const PRESET_AVATAR_EMOJIS = [
  '🦄',
  '🦁',
  '🦖',
  '🦊',
  '🐼',
  '🦸‍♀️',
  '🦸‍♂️',
  '⚽',
  '🎨',
  '🚀',
  '👑',
  '🐶',
] as const;

export const BG_COLOR_SWATCHES: { token: string; label: string }[] = [
  { token: 'bg-rose-200', label: 'ורוד' },
  { token: 'bg-amber-200', label: 'צהוב חם' },
  { token: 'bg-emerald-200', label: 'ירוק' },
  { token: 'bg-sky-200', label: 'תכלת' },
  { token: 'bg-violet-200', label: 'סגול' },
  { token: 'bg-teal-200', label: 'טורקיז' },
  { token: 'bg-orange-200', label: 'כתום' },
  { token: 'bg-indigo-200', label: 'אינדיגו' },
];

const graphemeSegmenter = new Intl.Segmenter('he', { granularity: 'grapheme' });

export function extractLastGrapheme(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  const segments = Array.from(graphemeSegmenter.segment(trimmed));
  return segments[segments.length - 1]?.segment ?? '';
}

type ProfileSettingsViewProps = {
  user: User;
  totalStars: number;
  onUpdated: () => void;
};

export function ProfileSettingsView({
  user,
  totalStars,
  onUpdated,
}: ProfileSettingsViewProps) {
  const [nickname, setNickname] = useState(user.nickname ?? '');
  const [avatarEmoji, setAvatarEmoji] = useState(user.avatarEmoji);
  const [customEmojiInput, setCustomEmojiInput] = useState(
    PRESET_AVATAR_EMOJIS.includes(user.avatarEmoji as (typeof PRESET_AVATAR_EMOJIS)[number])
      ? ''
      : user.avatarEmoji,
  );
  const [avatarBgColor, setAvatarBgColor] = useState(user.avatarBgColor);
  const [newPin, setNewPin] = useState('');
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const flashSuccess = (msg: string) => {
    setFeedbackMsg(msg);
    setErrorMsg(null);
    setTimeout(() => setFeedbackMsg(null), 2500);
  };

  const handleCustomEmojiChange = (raw: string) => {
    const last = extractLastGrapheme(raw);
    setCustomEmojiInput(last);
    if (!last) {
      setErrorMsg(null);
      return;
    }
    if (EmojiSchema.safeParse(last).success) {
      setAvatarEmoji(last);
      setErrorMsg(null);
    } else {
      setErrorMsg('נא לבחור אימוג׳י תקין אחד בלבד');
    }
  };

  const handleSaveIdentity = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (customEmojiInput && !EmojiSchema.safeParse(customEmojiInput).success) {
      setErrorMsg('נא לבחור אימוג׳י תקין אחד בלבד');
      return;
    }
    if (!EmojiSchema.safeParse(avatarEmoji).success) {
      setErrorMsg('נא לבחור אימוג׳י תקין אחד בלבד');
      return;
    }
    try {
      await api.updateOwnProfile({
        nickname: nickname.trim() ? nickname.trim() : null,
        avatarEmoji,
        avatarBgColor,
      });
      onUpdated();
      flashSuccess('הפרופיל האישי שלך נשמר בהצלחה!');
    } catch (err) {
      setErrorMsg(err instanceof ClientApiError ? err.message : 'שגיאה בשמירת הפרופיל');
    }
  };

  const handleSavePin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!/^\d{4}$/.test(newPin)) {
      setErrorMsg('הקוד הסודי חייב להכיל בדיוק 4 ספרות');
      return;
    }
    try {
      await api.updateOwnProfile({ pin: newPin });
      setNewPin('');
      onUpdated();
      flashSuccess('הקוד הסודי עודכן!');
    } catch (err) {
      setErrorMsg(err instanceof ClientApiError ? err.message : 'שגיאה בעדכון קוד סודי');
    }
  };

  const handleRemovePin = async () => {
    setErrorMsg(null);
    try {
      await api.updateOwnProfile({ pin: null });
      setNewPin('');
      onUpdated();
      flashSuccess('הקוד הסודי הוסר — מעכשיו הכניסה מהירה ללא קוד');
    } catch (err) {
      setErrorMsg(err instanceof ClientApiError ? err.message : 'לא ניתן להסיר קוד סודי');
    }
  };

  const previewTitle = getDisplayName({ name: user.name, nickname });
  const hasNicknamePreview = nickname.trim().length > 0;

  return (
    <div className="space-y-6" data-testid="profile-settings-view">
      {feedbackMsg && (
        <div
          className="rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-base font-bold text-emerald-900"
          role="status"
          data-testid="profile-feedback"
        >
          ✓ {feedbackMsg}
        </div>
      )}
      {errorMsg && (
        <div
          className="rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 text-base font-bold text-rose-900"
          role="alert"
          data-testid="profile-error"
        >
          {errorMsg}
        </div>
      )}

      {/* 1. Live Identity Card Preview */}
      <section
        data-testid="profile-live-preview"
        className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border-2 border-amber-300 bg-gradient-to-b from-white to-amber-50/70 p-6 shadow-xs"
      >
        <div className="flex items-center gap-4">
          <div
            data-testid="profile-preview-avatar"
            className={`flex h-20 w-20 items-center justify-center rounded-3xl text-5xl shadow-inner ${avatarBgColor}`}
          >
            {avatarEmoji}
          </div>
          <div>
            <span className="inline-block rounded-full bg-amber-100 px-3 py-0.5 text-xs font-bold text-amber-900">
              תצוגה מקדימה בכניסה לבית
            </span>
            <h2
              className="mt-1 text-2xl font-bold text-stone-900 sm:text-3xl"
              data-testid="profile-preview-title"
            >
              {previewTitle}
            </h2>
            <p className="text-sm font-medium text-stone-600">
              {hasNicknamePreview ? `שם רשמי: ${user.name} · ` : ''}⭐ {totalStars} כוכבים
            </p>
          </div>
        </div>
        <span className="rounded-full border border-stone-200 bg-[#FAF6EE] px-3.5 py-1.5 text-xs font-bold text-stone-700">
          {HEBREW_COPY.roles[user.role]}
        </span>
      </section>

      {/* 2. Identity, Nickname, Avatar Emoji & Background Color */}
      <form
        onSubmit={(e) => void handleSaveIdentity(e)}
        className="space-y-6 rounded-3xl border border-stone-200 bg-white p-6 shadow-xs"
      >
        <h3 className="text-xl font-bold text-stone-900">עיצוב הכרטיס האישי והכינוי</h3>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 flex items-center justify-between text-xs font-bold text-stone-600">
              <span>שם פרטי</span>
              <span>🔒 נקבע על ידי ההורים</span>
            </label>
            <input
              type="text"
              value={user.name}
              disabled
              data-testid="profile-official-name-input"
              className="min-h-12 w-full cursor-not-allowed rounded-2xl border border-dashed border-stone-300 bg-stone-100 px-3.5 font-bold text-stone-500"
            />
          </div>

          <div>
            <label
              htmlFor="profile-nickname-input"
              className="mb-1.5 block text-xs font-bold text-stone-600"
            >
              כינוי אישי (יוצג בברכה ובמסך הכניסה — השאירו ריק לניקוי)
            </label>
            <input
              id="profile-nickname-input"
              type="text"
              maxLength={40}
              placeholder="למשל: אלוף הכוכבים ✨"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              data-testid="profile-nickname-input"
              className="min-h-12 w-full rounded-2xl border border-stone-300 bg-[#FAF6EE] px-3.5 font-bold text-stone-900"
            />
          </div>
        </div>

        {/* Preset Emojis + Custom Emoji Input */}
        <div>
          <label className="mb-2 block text-xs font-bold text-stone-600">
            בחירת דמות או הקלדת אימוג׳י מהמקלדת:
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {PRESET_AVATAR_EMOJIS.map((em) => {
              const selected = avatarEmoji === em;
              return (
                <button
                  key={em}
                  type="button"
                  onClick={() => {
                    setAvatarEmoji(em);
                    setCustomEmojiInput('');
                    setErrorMsg(null);
                  }}
                  data-testid={`profile-emoji-preset-${em}`}
                  className={`flex min-h-12 min-w-12 items-center justify-center rounded-2xl border text-2xl ${
                    selected
                      ? 'border-2 border-amber-500 bg-amber-100 shadow-xs'
                      : 'border-stone-200 bg-[#FAF6EE]'
                  }`}
                >
                  {em}
                </button>
              );
            })}

            <div className="flex items-center gap-2 rounded-2xl border border-stone-300 bg-[#FAF6EE] px-3 py-1">
              <label
                htmlFor="profile-custom-emoji-input"
                className="text-xs font-bold text-stone-700"
              >
                + אימוג׳י מהמקלדת:
              </label>
              <input
                id="profile-custom-emoji-input"
                type="text"
                placeholder="😀"
                value={customEmojiInput}
                onChange={(e) => handleCustomEmojiChange(e.target.value)}
                data-testid="profile-custom-emoji-input"
                className="min-h-10 w-14 rounded-xl border border-stone-300 bg-white text-center text-2xl"
              />
            </div>
          </div>
        </div>

        {/* Background Color Swatches */}
        <div>
          <label className="mb-2 block text-xs font-bold text-stone-600">
            צבע רקע לכרטיס הפרופיל:
          </label>
          <div className="flex flex-wrap items-center gap-2.5">
            {BG_COLOR_SWATCHES.map((sw) => {
              const selected = avatarBgColor === sw.token;
              return (
                <button
                  key={sw.token}
                  type="button"
                  onClick={() => setAvatarBgColor(sw.token)}
                  aria-label={sw.label}
                  data-testid={`profile-bg-swatch-${sw.token}`}
                  className={`flex min-h-12 min-w-12 items-center justify-center rounded-2xl border-2 text-xs font-bold ${
                    sw.token
                  } ${
                    selected
                      ? 'border-stone-900 ring-2 ring-stone-900/20'
                      : 'border-stone-300/80'
                  }`}
                >
                  {selected ? '✓' : ''}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            data-testid="profile-save-identity-btn"
            className="min-h-12 min-w-12 rounded-2xl bg-emerald-600 px-6 py-2.5 text-base font-bold text-white shadow-xs"
          >
            ✓ שמירת עיצוב וכינוי
          </button>
        </div>
      </form>

      {/* 3. Self-Service PIN Management */}
      <section className="rounded-3xl border border-stone-200 bg-white p-6 shadow-xs">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-xl font-bold text-stone-900">🔒 קוד סודי אישי (4 ספרות)</h3>
            <p className="text-xs text-stone-600">
              {user.role === 'PARENT'
                ? 'פרופיל הורה חייב תמיד להיות מוגן בקוד סודי בן 4 ספרות.'
                : 'ניתן להגדיר או להחליף קוד סודי של 4 ספרות, או לבחור כניסה חופשית ללא קוד.'}
            </p>
          </div>
          <span
            data-testid="profile-pin-status-badge"
            className="rounded-full bg-[#FAF6EE] px-3 py-1 text-xs font-bold text-stone-700"
          >
            {user.hasPin ? '🔒 מוגן בקוד סודי' : '🔓 ללא קוד סודי'}
          </span>
        </div>

        <form
          onSubmit={(e) => void handleSavePin(e)}
          className="flex flex-wrap items-center gap-3"
        >
          <input
            type="password"
            inputMode="numeric"
            maxLength={4}
            placeholder="קוד 4 ספרות חדש..."
            value={newPin}
            onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            data-testid="profile-new-pin-input"
            className="min-h-12 w-44 rounded-2xl border border-stone-300 bg-[#FAF6EE] px-3.5 text-center text-lg font-bold tracking-widest"
          />
          <button
            type="submit"
            data-testid="profile-save-pin-btn"
            className="min-h-12 min-w-12 rounded-2xl bg-stone-900 px-5 py-2.5 text-sm font-bold text-white"
          >
            עדכן קוד סודי
          </button>

          {user.role === 'CHILD' && user.hasPin && (
            <button
              type="button"
              onClick={() => void handleRemovePin()}
              data-testid="profile-remove-pin-btn"
              className="min-h-12 min-w-12 rounded-2xl border border-stone-300 bg-[#FAF6EE] px-4 py-2.5 text-sm font-bold text-stone-700"
            >
              הסר קוד (כניסה מהירה)
            </button>
          )}
        </form>
      </section>
    </div>
  );
}
