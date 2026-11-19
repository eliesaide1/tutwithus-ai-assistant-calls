import { Writable } from 'node:stream';
import express, { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../../lib/logger.js';
import { requestContext } from './request-context.js';

describe('requestContext', () => {
  it('keeps the original path in completion logs after mounted routers run', async () => {
    const lines: string[] = [];
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const logger = createLogger(
      { level: 'info', service: 'request-context-test' },
      destination,
    );
    const app = express();
    const authRouter = Router();
    authRouter.post('/login', (_request, response) => {
      response.sendStatus(200);
    });
    app.use(requestContext(logger));
    app.use('/api/v1/admin/auth', authRouter);

    await request(app).post('/api/v1/admin/auth/login').expect(200);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/ \| INFO \| HTTP request started \| /);
    expect(lines[0]).toContain('"path":"/api/v1/admin/auth/login"');
    expect(lines[1]).toMatch(/ \| INFO \| HTTP request completed \| /);
    expect(lines[1]).toContain('"path":"/api/v1/admin/auth/login"');
    expect(lines[1]).toContain('"statusCode":200');
  });
});
