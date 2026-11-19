import { pingDb } from './connect.js';

export const mongoReadinessCheck = {
  name: 'mongodb',
  check: pingDb,
};
