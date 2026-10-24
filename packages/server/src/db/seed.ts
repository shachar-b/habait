import { pathToFileURL } from 'node:url';
import { createDb, migrateDb, type Db } from './connection.js';
import * as schema from './schema.js';
import { createPoolTask } from '../services/pool.service.js';
import { createOneOffTask, createRoutineTemplate } from '../services/task.service.js';
import { createUser, getAppSettings, updateAppSettings } from '../services/user.service.js';

export function seedDatabase(db: Db, now: number = Date.now()): void {
  const existingUsers = db.select({ id: schema.users.id }).from(schema.users).all();
  if (existingUsers.length > 0) {
    getAppSettings(db, now);
    return;
  }

  const ima = createUser(
    db,
    {
      name: 'אִמָּא',
      avatarEmoji: '🦸‍♀️',
      avatarBgColor: 'bg-emerald-200',
      role: 'PARENT',
      pin: '1234',
      sortOrder: 1,
    },
    now,
  );

  const aba = createUser(
    db,
    {
      name: 'אַבָּא',
      avatarEmoji: '🦁',
      avatarBgColor: 'bg-sky-200',
      role: 'PARENT',
      pin: '1234',
      sortOrder: 2,
    },
    now,
  );

  const noa = createUser(
    db,
    {
      name: 'נוֹעָה',
      avatarEmoji: '🦄',
      avatarBgColor: 'bg-rose-200',
      role: 'CHILD',
      sortOrder: 3,
    },
    now,
  );

  const yuval = createUser(
    db,
    {
      name: 'יוּבַל',
      avatarEmoji: '🦖',
      avatarBgColor: 'bg-amber-200',
      role: 'CHILD',
      sortOrder: 4,
    },
    now,
  );

  updateAppSettings(
    db,
    {
      appTitle: 'הבית שלנו',
      announcementText: 'זוכרים לסדר את החדר לפני ארוחת הערב! כל הכבוד לכולם',
      announcementEmoji: '🌟',
    },
    ima.id,
    now,
  );

  const allWeek = [0, 1, 2, 3, 4, 5, 6];
  const schoolDays = [0, 1, 2, 3, 4, 5];

  // Routines for Noa
  createRoutineTemplate(
    db,
    {
      assigneeId: noa.id,
      title: 'צִחְצוּחַ שִׁינַּיִים וּשְׁטִיפַת פָּנִים',
      iconEmoji: '🪥',
      timeWindow: 'MORNING',
      daysOfWeek: allWeek,
      sortOrder: 1,
    },
    ima.id,
    now,
  );
  createRoutineTemplate(
    db,
    {
      assigneeId: noa.id,
      title: 'סִידּוּר הַמִּיטָּה',
      iconEmoji: '🛏️',
      timeWindow: 'MORNING',
      daysOfWeek: allWeek,
      sortOrder: 2,
    },
    ima.id,
    now,
  );
  createRoutineTemplate(
    db,
    {
      assigneeId: noa.id,
      title: 'הֲכָנַת שִׁיעוּרֵי בַּיִת',
      iconEmoji: '📚',
      timeWindow: 'AFTERNOON',
      daysOfWeek: schoolDays,
      sortOrder: 3,
    },
    ima.id,
    now,
  );
  createRoutineTemplate(
    db,
    {
      assigneeId: noa.id,
      title: 'סִידּוּר תִּיק לְבֵית הַסֵּפֶר',
      iconEmoji: '🎒',
      timeWindow: 'EVENING',
      daysOfWeek: allWeek,
      sortOrder: 4,
    },
    ima.id,
    now,
  );

  // Routines for Yuval
  createRoutineTemplate(
    db,
    {
      assigneeId: yuval.id,
      title: 'צִחְצוּחַ שִׁינַּיִים בַּבֹּקֶר',
      iconEmoji: '🪥',
      timeWindow: 'MORNING',
      daysOfWeek: allWeek,
      sortOrder: 1,
    },
    aba.id,
    now,
  );
  createRoutineTemplate(
    db,
    {
      assigneeId: yuval.id,
      title: 'הַאֲכָלַת הַכֶּלֶב בּוֹנוֹ',
      iconEmoji: '🐶',
      timeWindow: 'ALL_DAY',
      daysOfWeek: allWeek,
      sortOrder: 2,
    },
    aba.id,
    now,
  );
  createRoutineTemplate(
    db,
    {
      assigneeId: yuval.id,
      title: 'מִקְלַחַת וּפִּיגָ׳מָה',
      iconEmoji: '🚿',
      timeWindow: 'EVENING',
      daysOfWeek: allWeek,
      sortOrder: 3,
    },
    aba.id,
    now,
  );

  // One-off tasks
  createOneOffTask(
    db,
    {
      assigneeId: noa.id,
      title: 'סִידּוּר מַדַּף הַסְּפָרִים',
      iconEmoji: '📖',
      stars: 3,
    },
    { userId: ima.id, role: 'PARENT' },
    now,
  );
  createOneOffTask(
    db,
    {
      assigneeId: yuval.id,
      title: 'נִיקּוּי הָאוֹפַנַּיִים בֶּחָצֵר',
      iconEmoji: '🚲',
      stars: 4,
    },
    { userId: aba.id, role: 'PARENT' },
    now,
  );

  // Shared Household Pool (`קופת המשימות`)
  createPoolTask(
    db,
    {
      title: 'פִּינּוּי מֵדִיחַ הַכֵּלִים',
      iconEmoji: '🍽️',
      stars: 3,
      resetMode: 'AUTO_DISABLE',
      cooldownMinutes: 60,
      isActive: true,
    },
    ima.id,
  );
  createPoolTask(
    db,
    {
      title: 'סִידּוּר הַסָּלוֹן וְהַכָּרִיּוֹת',
      iconEmoji: '🛋️',
      stars: 2,
      resetMode: 'COOLDOWN',
      cooldownMinutes: 60,
      isActive: true,
    },
    ima.id,
  );
  createPoolTask(
    db,
    {
      title: 'הוֹצָאַת פַּח הַמִּחְזוּר',
      iconEmoji: '♻️',
      stars: 3,
      resetMode: 'COOLDOWN',
      cooldownMinutes: 120,
      isActive: true,
    },
    aba.id,
  );
  createPoolTask(
    db,
    {
      title: 'קִיפּוּל סַל כְּבִיסָה',
      iconEmoji: '🧺',
      stars: 4,
      resetMode: 'AUTO_DISABLE',
      cooldownMinutes: 60,
      isActive: true,
    },
    aba.id,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const handle = createDb();
  migrateDb(handle);
  seedDatabase(handle.db);
  handle.sqlite.close();
  console.log('Seeded habait database.');
}
