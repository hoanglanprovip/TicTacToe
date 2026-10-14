import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { registerRoutes, ensureAdminAccount } from './routes.js';
import { attachSockets } from './socket.js';
import { broadcastRooms } from './hub.js';
import { logEvent } from './log.js';

const here = dirname(fileURLToPath(import.meta.url));
const webDist = resolve(here, '../../web/dist');

export interface BuildOptions {
  port?: number;
  host?: string;
  serveWeb?: boolean;
  quiet?: boolean;
}

export async function buildServer(options: BuildOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.quiet ? false : { level: process.env.LOG_LEVEL ?? 'info' },
    trustProxy: true,
    bodyLimit: 64 * 1024,
  });

  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 2000, timeWindow: '1 minute' });

  await ensureAdminAccount();
  logEvent('info', 'system', 'May chu dong hoan tat');
  registerRoutes(app, (code) => broadcastRooms(code));

  // Trả lỗi 429 dạng JSON thống nhất thay vì format mặc định của Fastify.
  app.setErrorHandler((error, _request, reply) => {
    if ((error as { statusCode?: number }).statusCode === 429) {
      return reply.code(429).send({ code: 'RATE_LIMITED', message: 'Bạn thao tác quá nhanh, vui lòng đợi một chút rồi thử lại.' });
    }
    app.log.error(error);
    return reply.code((error as { statusCode?: number }).statusCode ?? 500).send({ code: 'INTERNAL_ERROR', message: 'Lỗi hệ thống.' });
  });

  if (options.serveWeb !== false && existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api') || request.url.startsWith('/socket.io')) {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'Không tìm thấy.' });
      }
      return reply.sendFile('index.html');
    });
  }

  attachSockets(app.server);
  await app.listen({ port: options.port ?? 4000, host: options.host ?? '0.0.0.0' });
  return app;
}