import { createHmac } from 'node:crypto';
import mongoose, { Schema } from 'mongoose';

const schema = new Schema({
  key: { type: String, required: true, unique: true },
  attempts: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true },
});
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const Counter =
  mongoose.models.MemberVerificationLimit ??
  mongoose.model('MemberVerificationLimit', schema);

// Shared across browser/WhatsApp processes and calls. A DB failure fails closed.
export async function reserveMemberVerification(
  phone: string,
): Promise<boolean> {
  const secret = process.env.MEMBER_VERIFICATION_SECRET;
  if (!secret || secret.length < 32) return false;
  const window = Math.floor(Date.now() / 900_000);
  const key = createHmac('sha256', secret)
    .update(`${window}:${phone.replace(/\D/g, '')}`)
    .digest('hex');
  try {
    await Counter.init();
    const result = await Counter.findOneAndUpdate(
      { key },
      {
        $inc: { attempts: 1 },
        $setOnInsert: { expiresAt: new Date((window + 2) * 900_000) },
      },
      { upsert: true, new: true },
    ).lean<{ attempts: number }>();
    return Boolean(result && result.attempts <= 10);
  } catch {
    return false;
  }
}
