/**
 * Cloud Storage wrapper for Aesthera clinical photos.
 *
 * Bucket: aesthera-photos-medspa-494718 (us-central1, uniform IAM,
 * public-access prevented). Runtime SA has roles/storage.objectAdmin.
 *
 * Path layout:
 *   tenants/{tenantId}/clients/{clientId}/{photoId}.{ext}
 *
 * Uploads use V4 signed PUT URLs (15 min TTL). Reads use V4 signed GET
 * URLs (15 min TTL). The bucket is never publicly readable.
 *
 * For HIPAA-grade encryption at rest, CMEK can be added later via
 * `gcloud storage buckets update --default-encryption-key=...`. Until
 * then we're on Google-managed keys, which is HIPAA-eligible under the
 * GCP BAA.
 */

import { Storage, type GetSignedUrlConfig } from "@google-cloud/storage";

const BUCKET_NAME =
  process.env.AESTHERA_PHOTOS_BUCKET || "aesthera-photos-medspa-494718";

let cached: Storage | null = null;
function client(): Storage {
  if (cached) return cached;
  cached = new Storage();
  return cached;
}

export function bucket() {
  return client().bucket(BUCKET_NAME);
}

const SIGNED_URL_TTL_MS = 15 * 60 * 1000;

const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
]);

function extFromContentType(ct: string): string {
  switch (ct) {
    case "image/jpeg": return "jpg";
    case "image/png": return "png";
    case "image/webp": return "webp";
    case "image/heic": return "heic";
    default: return "bin";
  }
}

export function isAllowedContentType(ct: string): boolean {
  return ALLOWED_CONTENT_TYPES.has(ct.toLowerCase());
}

export function buildPhotoPath(args: {
  tenantId: string;
  clientId: string;
  photoId: string;
  contentType: string;
}): string {
  return `tenants/${args.tenantId}/clients/${args.clientId}/${args.photoId}.${extFromContentType(args.contentType)}`;
}

export async function signedUploadUrl(args: {
  storagePath: string;
  contentType: string;
  maxBytes: number;
}): Promise<{ url: string; expires_at: string }> {
  const opts: GetSignedUrlConfig = {
    version: "v4",
    action: "write",
    expires: Date.now() + SIGNED_URL_TTL_MS,
    contentType: args.contentType,
    extensionHeaders: {
      "x-goog-content-length-range": `0,${args.maxBytes}`,
    },
  };
  const [url] = await bucket().file(args.storagePath).getSignedUrl(opts);
  return { url, expires_at: new Date(Date.now() + SIGNED_URL_TTL_MS).toISOString() };
}

export async function signedReadUrl(args: {
  storagePath: string;
  ttlMinutes?: number;
}): Promise<{ url: string; expires_at: string }> {
  const ttlMs = (args.ttlMinutes ?? 15) * 60 * 1000;
  const opts: GetSignedUrlConfig = {
    version: "v4",
    action: "read",
    expires: Date.now() + ttlMs,
  };
  const [url] = await bucket().file(args.storagePath).getSignedUrl(opts);
  return { url, expires_at: new Date(Date.now() + ttlMs).toISOString() };
}

export async function deleteObject(storagePath: string): Promise<void> {
  await bucket()
    .file(storagePath)
    .delete({ ignoreNotFound: true });
}

export async function fileExists(storagePath: string): Promise<{ exists: boolean; bytes: number }> {
  const file = bucket().file(storagePath);
  const [exists] = await file.exists();
  if (!exists) return { exists: false, bytes: 0 };
  const [meta] = await file.getMetadata();
  return { exists: true, bytes: Number(meta.size ?? 0) };
}
