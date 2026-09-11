import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import * as Crypto from 'expo-crypto';

import { storage } from '@/lib/firebase';

export type UploadKind = 'avatars' | 'receipts' | 'scans' | 'schedules';

const ASSISTANT_FILE_TYPES: Record<string, string> = {
  csv: 'text/csv',
  ics: 'text/calendar',
  pdf: 'application/pdf',
  txt: 'text/plain',
};

function extensionFromContentType(contentType: string) {
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  return 'jpg';
}

function blobFromXmlHttpRequest(uri: string) {
  return new Promise<Blob>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', uri, true);
    xhr.responseType = 'blob';
    xhr.timeout = 30000;
    xhr.onload = () => {
      const blob = xhr.response as Blob | null;
      if (blob && blob.size > 0) resolve(blob);
      else reject(new Error(`XMLHttpRequest returned an empty image (status ${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error(`XMLHttpRequest could not open local URI: ${uri.slice(0, 80)}`));
    xhr.ontimeout = () => reject(new Error('Reading the selected image timed out.'));
    xhr.send();
  });
}

async function blobFromFetch(uri: string) {
  const response = await fetch(uri);
  // Android file:// and content:// responses can have status 0 and ok=false,
  // even when response.blob() is valid. Do not reject based on response.ok.
  const blob = await response.blob();
  if (!blob || blob.size <= 0) {
    throw new Error(`fetch() returned an empty image (status ${response.status}).`);
  }
  return blob;
}

export async function localImageUriToBlob(uri: string) {
  // Expo DocumentPicker uses a browser-owned blob: URL on web. Keep the
  // native schemes used by ImagePicker/DocumentPicker and also accept data:
  // URLs so every supported picker result reaches Firebase Storage.
  if (!uri || !/^(?:blob:|data:|(?:file|content|ph|https?):\/\/)/i.test(uri)) {
    throw new Error(`Unsupported selected-file URI: ${uri || '(empty)'}`);
  }

  const failures: string[] = [];
  try {
    const blob = await blobFromXmlHttpRequest(uri);
    console.log('[SmartScan] Local image opened with XMLHttpRequest', {size: blob.size, type: blob.type, uriScheme: uri.split(':')[0]});
    return blob;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`XHR: ${message}`);
    console.warn('[SmartScan] XMLHttpRequest URI read failed; trying fetch()', message);
  }

  try {
    const blob = await blobFromFetch(uri);
    console.log('[SmartScan] Local image opened with fetch()', {size: blob.size, type: blob.type, uriScheme: uri.split(':')[0]});
    return blob;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`fetch: ${message}`);
    console.error('[SmartScan] Both local URI readers failed', {failures, uri: uri.slice(0, 120)});
  }

  throw new Error(`Unable to read the selected file. ${failures.join(' | ')}`);
}

export async function uploadUserImage({
  contentType = 'image/jpeg',
  kind,
  uid,
  uri,
}: {
  contentType?: string;
  kind: UploadKind;
  uid: string;
  uri: string;
}) {
  console.log('[SmartScan] Preparing Firebase Storage upload', {contentType, kind, uriScheme: uri.split(':')[0]});
  const blob = await localImageUriToBlob(uri);
  const imageHashBuffer = await Crypto.digest(
    Crypto.CryptoDigestAlgorithm.SHA256,
    await blob.arrayBuffer(),
  );
  const imageHash = Array.from(new Uint8Array(imageHashBuffer), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  const extension = extensionFromContentType(contentType);
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`;
  const path = `users/${uid}/${kind}/${fileName}`;
  const storageRef = ref(storage, path);
  try {
    await uploadBytes(storageRef, blob, {contentType});
  } catch (error) {
    console.error('[SmartScan] Firebase Storage upload failed', {error, path, size: blob.size, type: blob.type});
    throw error;
  }

  return { downloadUrl: await getDownloadURL(storageRef), imageHash, path };
}

export async function uploadAssistantFile({
  contentType,
  name,
  uid,
  uri,
}: {
  contentType?: string;
  name: string;
  uid: string;
  uri: string;
}) {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  const resolvedContentType = ASSISTANT_FILE_TYPES[extension];
  if (!resolvedContentType) throw new Error('รองรับเฉพาะไฟล์ PDF, TXT, CSV และ ICS');
  if (contentType && ![resolvedContentType, 'application/octet-stream', 'text/comma-separated-values'].includes(contentType)) {
    throw new Error('ชนิดไฟล์ไม่ตรงกับนามสกุล กรุณาเลือกไฟล์ใหม่');
  }
  const blob = await localImageUriToBlob(uri);
  if (blob.size > 8 * 1024 * 1024) throw new Error('ไฟล์ต้องมีขนาดไม่เกิน 8 MB');
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`;
  const path = `users/${uid}/assistant-files/${fileName}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, blob, {contentType: resolvedContentType});
  return {contentType: resolvedContentType, path, size: blob.size};
}
