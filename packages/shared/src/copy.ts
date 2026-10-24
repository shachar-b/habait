/**
 * Hebrew UI dictionary. Terms from SPEC §3.1 are verbatim and must not be reworded.
 * Strings with parameters are functions so callers never concatenate Hebrew by hand.
 */
export const HEBREW_COPY = {
  appTitleDefault: 'הבית שלנו',

  nav: {
    myDay: 'היום שלי',
    pool: 'קופת המשימות',
    history: 'היסטוריה',
    admin: 'ניהול הבית',
  },

  actions: {
    claim: 'לקחתי!',
    returnToPool: 'החזר לקופה',
    completePool: 'בוצע!',
    complete: 'בוצע',
    decline: 'דחה',
    undo: 'ביטול השלמה',
    switchUser: 'החלף משתמש',
    requestHelp: '+ בקש עזרה',
  },

  sections: {
    oneOffTasks: 'משימות מיוחדות',
    dailyRoutines: 'שגרה יומית',
    peerRequests: 'בקשות עזרה',
    completedToday: 'בוצעו היום',
  },

  timeWindows: {
    MORNING: 'בוקר',
    AFTERNOON: 'צהריים',
    EVENING: 'ערב',
    ALL_DAY: 'כל היום',
  },

  poolResetModes: {
    COOLDOWN: 'מחזורי עם השהיה',
    AUTO_DISABLE: 'הפעלה ידנית',
  },

  roles: { PARENT: 'הורה', CHILD: 'ילד/ה' },

  status: {
    hasOpenTasks: 'יש משימות פתוחות',
    allDone: 'הכל בוצע!',
    missed: 'לא בוצע',
    active: 'פעיל',
    inactive: 'כבוי',
  },

  starPeriods: {
    daily: 'יומי',
    weekly: 'שבועי',
    monthly: 'חודשי',
    yearly: 'שנתי',
    total: 'סה״כ',
  },

  pin: {
    enterPin: 'הזן קוד סודי',
  },

  pool: {
    wipLimitHelper: 'כבר לקחת משימה אחת — סיים אותה קודם!',
    claimedBy: (name: string) => `בטיפול של ${name}`,
    claimMinutesLeft: (minutes: number) => `נותרו ${minutes} דקות`,
    availableAgainIn: (minutes: number) => `יהיה זמין שוב בעוד ${minutes} דקות`,
  },

  greeting: (name: string) => `שלום, ${name}`,
  issuedOn: (date: string) => `נוצר ב-${date}`,
  fromRequester: (name: string) => `מאת: ${name}`,
} as const;
