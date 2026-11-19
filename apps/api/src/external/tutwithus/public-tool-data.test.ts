import { expect, it } from 'vitest';
import { publicToolData } from './public-tool-data.js';
it('removes private nested profile fields while retaining availability', () => {
  expect(
    publicToolData({
      data: {
        email: 'private',
        token: 'secret',
        _id: 'id',
        availability: [{ day: 'Monday', startHour: '10:00', phone: 'private' }],
      },
    }),
  ).toEqual({
    data: { availability: [{ day: 'Monday', startHour: '10:00' }] },
  });
});
