import * as Crypto from 'expo-crypto';

import {noteLock} from '@/services/firestore';

/**
 * The PIN that guards locked notes.
 *
 * One PIN per user rather than one per note, the way Apple Notes works: a note
 * document only carries `locked: true`, and the secret lives once in
 * `users/{uid}/settings/noteLock`.
 *
 * Only a salted SHA-256 digest is ever stored or transmitted. `expo-crypto`
 * has a real web implementation backed by WebCrypto, so hashing is byte-for-byte
 * identical on Android and in the browser -- which matters, because a PIN set on
 * one platform has to verify on the other.
 *
 * This is deliberately *not* `expo-secure-store`: that has a web build, but on
 * web it is ordinary browser storage rather than a secure enclave, so the two
 * platforms would have quietly different security properties.
 *
 * Honest scope: this protects notes from someone browsing the app on an
 * unlocked device. It is not end-to-end encryption -- the note body is still
 * stored in plaintext in Firestore, readable by the account owner and by the
 * rules that already govern it. Locking hides a note behind a prompt; it does
 * not make it unreadable to someone with database access.
 */

const MIN_PIN_LENGTH = 4;
const MAX_PIN_LENGTH = 32;

export type NoteLockState = {
  biometricEnabled: boolean;
  configured: boolean;
  hint: string;
};

function newSalt() {
  // 16 bytes as hex, comfortably inside the rules' 16..128 character bound.
  return [...Crypto.getRandomBytes(16)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function digest(pin: string, salt: string) {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${pin}`, {
    encoding: Crypto.CryptoEncoding.HEX,
  });
}

export function pinProblem(pin: string) {
  const trimmed = pin.trim();
  if (trimmed.length < MIN_PIN_LENGTH) return `ตั้งรหัสอย่างน้อย ${MIN_PIN_LENGTH} ตัว`;
  if (trimmed.length > MAX_PIN_LENGTH) return `รหัสยาวได้ไม่เกิน ${MAX_PIN_LENGTH} ตัว`;
  return '';
}

export async function getNoteLockState(uid: string): Promise<NoteLockState> {
  const record = await noteLock.get(uid);
  return {
    biometricEnabled: Boolean(record?.biometricEnabled),
    configured: Boolean(record?.hash),
    hint: typeof record?.hint === 'string' ? record.hint : '',
  };
}

export async function setNotePin(uid: string, pin: string, hint = '') {
  const problem = pinProblem(pin);
  if (problem) throw new Error(problem);
  const salt = newSalt();
  const hash = await digest(pin.trim(), salt);
  await noteLock.set(uid, {hash, salt, ...(hint.trim() ? {hint: hint.trim()} : {})});
}

/** Verifies a PIN against the stored digest. Never returns the digest itself. */
export async function verifyNotePin(uid: string, pin: string) {
  const record = await noteLock.get(uid);
  if (!record?.hash || !record.salt) return false;
  return (await digest(pin.trim(), record.salt)) === record.hash;
}

/**
 * Removes the PIN. The caller must have verified it first -- this function
 * deliberately does not re-check, so the "change PIN" and "forgot PIN" flows
 * can decide their own policy.
 */
export async function clearNotePin(uid: string) {
  await noteLock.clear(uid);
}

export async function setBiometricEnabled(uid: string, enabled: boolean) {
  const record = await noteLock.get(uid);
  if (!record?.hash || !record.salt) throw new Error('ตั้งรหัสผ่านก่อนเปิดสแกนลายนิ้วมือ');
  await noteLock.set(uid, {
    biometricEnabled: enabled,
    hash: record.hash,
    salt: record.salt,
    ...(record.hint ? {hint: record.hint} : {}),
  });
}
