import { useEffect, useState } from 'react';
import { HEBREW_COPY, type LobbyProfile } from '@habait/shared';
import { api, ClientApiError } from '../api.js';

type PinModalProps = {
  profile: LobbyProfile;
  onSuccess: () => void;
  onCancel: () => void;
};

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

export function PinModal({ profile, onSuccess, onCancel }: PinModalProps) {
  const [pin, setPin] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [shaking, setShaking] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const triggerError = (msg: string) => {
    setErrorMsg(msg);
    setShaking(true);
    setPin('');
    setTimeout(() => setShaking(false), 320);
  };

  const submitPin = async (code: string) => {
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await api.login({ userId: profile.id, pin: code });
      onSuccess();
    } catch (err) {
      const msg = err instanceof ClientApiError ? err.message : 'קוד סודי שגוי';
      triggerError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const appendDigit = (d: string) => {
    if (submitting || pin.length >= 4) return;
    setErrorMsg(null);
    const next = `${pin}${d}`;
    setPin(next);
    if (next.length === 4) {
      void submitPin(next);
    }
  };

  const backspace = () => {
    if (submitting || pin.length === 0) return;
    setErrorMsg(null);
    setPin(pin.slice(0, -1));
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      } else if (e.key === 'Backspace') {
        backspace();
      } else if (/^\d$/.test(e.key)) {
        appendDigit(e.key);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/50 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label={HEBREW_COPY.pin.enterPin}
      data-testid="pin-modal"
    >
      <div
        className={`animate-modal-enter w-full max-w-sm rounded-3xl border border-stone-200 bg-[#FAF6EE] p-6 shadow-2xl ${
          shaking ? 'animate-pin-shake' : ''
        }`}
      >
        <div className="flex flex-col items-center text-center">
          <div
            className={`mb-3 flex h-20 w-20 items-center justify-center rounded-2xl text-5xl shadow-inner ${profile.avatarBgColor}`}
          >
            {profile.avatarEmoji}
          </div>
          <h2 className="text-2xl font-bold text-stone-900">{profile.name}</h2>
          <p className="mt-1 text-base font-medium text-stone-600">{HEBREW_COPY.pin.enterPin}</p>

          {/* 4 PIN indicator dots (LTR order so 1st digit fills from start) */}
          <div className="my-5 flex items-center justify-center gap-4" dir="ltr">
            {[0, 1, 2, 3].map((idx) => {
              const filled = idx < pin.length;
              return (
                <div
                  key={idx}
                  data-testid={`pin-dot-${idx}`}
                  className={`h-4 w-4 rounded-full border-2 transition-transform duration-150 ${
                    filled
                      ? 'scale-110 border-amber-600 bg-amber-500'
                      : 'border-stone-400 bg-white'
                  }`}
                />
              );
            })}
          </div>

          {errorMsg && (
            <p
              className="mb-3 rounded-xl bg-rose-100 px-3 py-1.5 text-sm font-medium text-rose-800"
              role="alert"
              data-testid="pin-error"
            >
              {errorMsg}
            </p>
          )}

          {/* Numeric keypad */}
          <div className="grid w-full grid-cols-3 gap-3" dir="ltr">
            {DIGITS.map((d) => (
              <button
                key={d}
                type="button"
                disabled={submitting}
                onClick={() => appendDigit(d)}
                data-testid={`pin-key-${d}`}
                className="flex min-h-14 min-w-14 items-center justify-center rounded-2xl border border-stone-200 bg-white text-2xl font-bold text-stone-900 shadow-xs active:bg-amber-50"
              >
                {d}
              </button>
            ))}
            <button
              type="button"
              onClick={onCancel}
              data-testid="pin-cancel"
              className="flex min-h-14 min-w-14 items-center justify-center rounded-2xl border border-stone-200 bg-stone-100 text-sm font-bold text-stone-700"
            >
              ביטול
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => appendDigit('0')}
              data-testid="pin-key-0"
              className="flex min-h-14 min-w-14 items-center justify-center rounded-2xl border border-stone-200 bg-white text-2xl font-bold text-stone-900 shadow-xs active:bg-amber-50"
            >
              0
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={backspace}
              aria-label="מחיקה"
              data-testid="pin-backspace"
              className="flex min-h-14 min-w-14 items-center justify-center rounded-2xl border border-stone-200 bg-stone-100 text-xl font-bold text-stone-700"
            >
              ⌫
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
