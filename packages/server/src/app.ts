import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { ZodError } from 'zod';
import {
  CreateOneOffRequestSchema,
  CreatePeerRequestSchema,
  CreatePoolTaskRequestSchema,
  CreateRoutineRequestSchema,
  CreateUserRequestSchema,
  ERROR_HTTP_STATUS,
  ExecIdParamSchema,
  HistoryQuerySchema,
  IdParamSchema,
  LoginRequestSchema,
  UpdateOneOffRequestSchema,
  UpdatePoolTaskRequestSchema,
  UpdateRoutineRequestSchema,
  UpdateSettingsRequestSchema,
  UpdateUserRequestSchema,
} from '@habait/shared';
import type { Db } from './db/connection.js';
import { DomainError, DomainValidationError } from './errors.js';
import {
  claimPoolTask,
  completePoolTask,
  createPoolTask,
  listPoolTasks,
  revertPoolExecution,
  togglePoolTaskActive,
  unclaimPoolTask,
  updatePoolTask,
  type Actor,
} from './services/pool.service.js';
import { getStarsSummaryAllUsers } from './services/star.service.js';
import {
  cancelOneOffTask,
  cancelPeerRequest,
  completeOneOffTask,
  completePeerRequest,
  completeRoutine,
  createOneOffTask,
  createPeerRequest,
  createRoutineTemplate,
  declinePeerRequest,
  getDailyHistory,
  getUserDashboard,
  listOneOffTasks,
  listRoutineTemplates,
  revertOneOffTask,
  revertPeerRequest,
  revertRoutineCompletion,
  updateOneOffTask,
  updateRoutineTemplate,
} from './services/task.service.js';
import {
  authenticateUser,
  createUser,
  getLobbyData,
  getUserById,
  listUsers,
  resolveSessionActor,
  updateAppSettings,
  updateUser,
} from './services/user.service.js';

export const SESSION_COOKIE_NAME = 'habait_session';

export type BuildAppOptions = {
  db: Db;
  now?: () => number;
  webDistPath?: string;
};

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { db, now = () => Date.now(), webDistPath } = options;

  function readActor(req: FastifyRequest): Actor | null {
    const cookieToken = req.cookies[SESSION_COOKIE_NAME];
    const authHeader = req.headers.authorization;
    const bearerToken =
      typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : undefined;
    const token = cookieToken ?? bearerToken;
    if (!token) return null;
    return resolveSessionActor(db, token);
  }

  function requireAuth(req: FastifyRequest): Actor {
    const actor = readActor(req);
    if (!actor) {
      throw new DomainError('UNAUTHENTICATED', 'יש להתחבר תחילה');
    }
    return actor;
  }

  function requireParent(req: FastifyRequest): Actor {
    const actor = requireAuth(req);
    if (actor.role !== 'PARENT') {
      throw new DomainError('FORBIDDEN', 'גישה להורים בלבד');
    }
    return actor;
  }

  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(fastifyCookie);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof DomainError) {
      return reply.status(err.statusCode).send({
        error: { code: err.code, message: err.message, details: err.details },
      });
    }
    if (err instanceof ZodError || (err as { validation?: unknown }).validation) {
      return reply.status(ERROR_HTTP_STATUS.VALIDATION_ERROR).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: err instanceof Error ? err.message : 'Invalid request payload',
        },
      });
    }
    return reply.status(ERROR_HTTP_STATUS.INTERNAL_ERROR).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: err instanceof Error ? err.message : 'Internal server error',
      },
    });
  });

  const api = app.withTypeProvider<ZodTypeProvider>();

  // ---------------------------------------------------------------------------
  // Lobby & Auth
  // ---------------------------------------------------------------------------
  api.get('/api/v1/lobby', async () => {
    return getLobbyData(db, now());
  });

  api.post(
    '/api/v1/auth/login',
    { schema: { body: LoginRequestSchema } },
    async (req, reply) => {
      const { user, token } = authenticateUser(db, req.body, now());
      reply.setCookie(SESSION_COOKIE_NAME, token, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 30,
      });
      return { user };
    },
  );

  api.post('/api/v1/auth/logout', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    return { ok: true };
  });

  api.get('/api/v1/auth/me', async (req) => {
    const actor = readActor(req);
    if (!actor) return { user: null };
    try {
      return { user: getUserById(db, actor.userId) };
    } catch {
      return { user: null };
    }
  });

  // ---------------------------------------------------------------------------
  // User Workspace Dashboard (`היום שלי`)
  // ---------------------------------------------------------------------------
  api.get(
    '/api/v1/users/:id/dashboard',
    { schema: { params: IdParamSchema } },
    async (req) => {
      return getUserDashboard(db, req.params.id, now());
    },
  );

  // ---------------------------------------------------------------------------
  // Routines (`שגרה יומית`)
  // ---------------------------------------------------------------------------
  api.post(
    '/api/v1/routines/:id/complete',
    { schema: { params: IdParamSchema } },
    async (req) => {
      const actor = requireAuth(req);
      return completeRoutine(db, req.params.id, actor, now());
    },
  );

  api.post(
    '/api/v1/routines/:id/revert',
    { schema: { params: IdParamSchema } },
    async (req) => {
      const actor = requireAuth(req);
      return revertRoutineCompletion(db, req.params.id, actor, now());
    },
  );

  // ---------------------------------------------------------------------------
  // One-Off Tasks (`משימות מיוחדות`)
  // ---------------------------------------------------------------------------
  api.post(
    '/api/v1/one-offs/:id/complete',
    { schema: { params: IdParamSchema } },
    async (req) => {
      const actor = requireAuth(req);
      return completeOneOffTask(db, req.params.id, actor, now());
    },
  );

  api.post(
    '/api/v1/one-offs/:id/revert',
    { schema: { params: IdParamSchema } },
    async (req) => {
      const actor = requireAuth(req);
      return revertOneOffTask(db, req.params.id, actor, now());
    },
  );

  // ---------------------------------------------------------------------------
  // Shared Household Pool (`קופת המשימות`)
  // ---------------------------------------------------------------------------
  api.get('/api/v1/pool', async () => {
    return { tasks: listPoolTasks(db, { includeInactive: false }, now()) };
  });

  api.post(
    '/api/v1/pool/:id/claim',
    { schema: { params: IdParamSchema } },
    async (req) => {
      const actor = requireAuth(req);
      return { task: claimPoolTask(db, req.params.id, actor.userId, now()) };
    },
  );

  api.post(
    '/api/v1/pool/:id/unclaim',
    { schema: { params: IdParamSchema } },
    async (req) => {
      const actor = requireAuth(req);
      return { task: unclaimPoolTask(db, req.params.id, actor, now()) };
    },
  );

  api.post(
    '/api/v1/pool/:id/complete',
    { schema: { params: IdParamSchema } },
    async (req) => {
      const actor = requireAuth(req);
      return completePoolTask(db, req.params.id, actor.userId, now());
    },
  );

  api.post(
    '/api/v1/pool/executions/:execId/revert',
    { schema: { params: ExecIdParamSchema } },
    async (req) => {
      const actor = requireAuth(req);
      return revertPoolExecution(db, req.params.execId, actor, now());
    },
  );

  // ---------------------------------------------------------------------------
  // Peer-to-Peer Help Requests (`בקשות עזרה`)
  // ---------------------------------------------------------------------------
  api.post(
    '/api/v1/peer-requests',
    { schema: { body: CreatePeerRequestSchema } },
    async (req, reply) => {
      const actor = requireAuth(req);
      const request = createPeerRequest(db, req.body, actor.userId, now());
      return reply.status(201).send({ request });
    },
  );

  api.post(
    '/api/v1/peer-requests/:id/complete',
    { schema: { params: IdParamSchema } },
    async (req) => {
      const actor = requireAuth(req);
      return { request: completePeerRequest(db, req.params.id, actor, now()) };
    },
  );

  api.post(
    '/api/v1/peer-requests/:id/decline',
    { schema: { params: IdParamSchema } },
    async (req) => {
      const actor = requireAuth(req);
      return { request: declinePeerRequest(db, req.params.id, actor, now()) };
    },
  );

  api.post(
    '/api/v1/peer-requests/:id/cancel',
    { schema: { params: IdParamSchema } },
    async (req) => {
      const actor = requireAuth(req);
      return { request: cancelPeerRequest(db, req.params.id, actor, now()) };
    },
  );

  api.post(
    '/api/v1/peer-requests/:id/revert',
    { schema: { params: IdParamSchema } },
    async (req) => {
      const actor = requireAuth(req);
      return revertPeerRequest(db, req.params.id, actor, now());
    },
  );

  // ---------------------------------------------------------------------------
  // Stars & History (`היסטוריה`)
  // ---------------------------------------------------------------------------
  api.get('/api/v1/stars/summary', async () => {
    return getStarsSummaryAllUsers(db, now());
  });

  api.get(
    '/api/v1/history',
    { schema: { querystring: HistoryQuerySchema } },
    async (req) => {
      return getDailyHistory(db, req.query.date);
    },
  );

  // ---------------------------------------------------------------------------
  // Parent Admin Routes (`/api/v1/admin/*`) — Parent Session Guard
  // ---------------------------------------------------------------------------
  api.patch(
    '/api/v1/admin/settings',
    { schema: { body: UpdateSettingsRequestSchema } },
    async (req) => {
      const parent = requireParent(req);
      const settings = updateAppSettings(db, req.body, parent.userId, now());
      return { settings };
    },
  );

  api.get('/api/v1/admin/users', async (req) => {
    requireParent(req);
    return { users: listUsers(db) };
  });

  api.post(
    '/api/v1/admin/users',
    { schema: { body: CreateUserRequestSchema } },
    async (req, reply) => {
      requireParent(req);
      const user = createUser(db, req.body, now());
      return reply.status(201).send({ user });
    },
  );

  api.patch(
    '/api/v1/admin/users/:id',
    { schema: { params: IdParamSchema, body: UpdateUserRequestSchema } },
    async (req) => {
      requireParent(req);
      return { user: updateUser(db, req.params.id, req.body) };
    },
  );

  api.get('/api/v1/admin/routines', async (req) => {
    requireParent(req);
    return { routines: listRoutineTemplates(db) };
  });

  api.post(
    '/api/v1/admin/routines',
    { schema: { body: CreateRoutineRequestSchema } },
    async (req, reply) => {
      const parent = requireParent(req);
      const routine = createRoutineTemplate(db, req.body, parent.userId, now());
      return reply.status(201).send({ routine });
    },
  );

  api.patch(
    '/api/v1/admin/routines/:id',
    { schema: { params: IdParamSchema, body: UpdateRoutineRequestSchema } },
    async (req) => {
      requireParent(req);
      return { routine: updateRoutineTemplate(db, req.params.id, req.body) };
    },
  );

  api.get('/api/v1/admin/one-offs', async (req) => {
    requireParent(req);
    return { tasks: listOneOffTasks(db) };
  });

  api.post(
    '/api/v1/admin/one-offs',
    { schema: { body: CreateOneOffRequestSchema } },
    async (req, reply) => {
      const parent = requireParent(req);
      const task = createOneOffTask(db, req.body, parent, now());
      return reply.status(201).send({ task });
    },
  );

  api.patch(
    '/api/v1/admin/one-offs/:id',
    { schema: { params: IdParamSchema, body: UpdateOneOffRequestSchema } },
    async (req) => {
      requireParent(req);
      return { task: updateOneOffTask(db, req.params.id, req.body) };
    },
  );

  api.post(
    '/api/v1/admin/one-offs/:id/cancel',
    { schema: { params: IdParamSchema } },
    async (req) => {
      const parent = requireParent(req);
      return { task: cancelOneOffTask(db, req.params.id, parent, now()) };
    },
  );

  api.get('/api/v1/admin/pool', async (req) => {
    requireParent(req);
    return { tasks: listPoolTasks(db, { includeInactive: true }, now()) };
  });

  api.post(
    '/api/v1/admin/pool',
    { schema: { body: CreatePoolTaskRequestSchema } },
    async (req, reply) => {
      const parent = requireParent(req);
      const task = createPoolTask(db, req.body, parent.userId);
      return reply.status(201).send({ task });
    },
  );

  api.patch(
    '/api/v1/admin/pool/:id',
    { schema: { params: IdParamSchema, body: UpdatePoolTaskRequestSchema } },
    async (req) => {
      requireParent(req);
      return { task: updatePoolTask(db, req.params.id, req.body, now()) };
    },
  );

  api.patch(
    '/api/v1/admin/pool/:id/toggle-active',
    { schema: { params: IdParamSchema } },
    async (req) => {
      requireParent(req);
      return { task: togglePoolTaskActive(db, req.params.id, now()) };
    },
  );

  // ---------------------------------------------------------------------------
  // Single-Origin Static SPA Serving (Production / E2E)
  // ---------------------------------------------------------------------------
  if (webDistPath && existsSync(join(webDistPath, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: webDistPath,
      prefix: '/',
      wildcard: false,
    });

    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.url} not found` },
        });
      }
      return reply.sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((req, reply) => {
      if (!req.url.startsWith('/api/')) {
        throw new DomainValidationError('SPA bundle not built');
      }
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.url} not found` },
      });
    });
  }

  return app;
}
