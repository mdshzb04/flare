import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function endpoint() {
  return process.env.S3_ENDPOINT || "http://127.0.0.1:9000";
}

export const bucket = process.env.S3_BUCKET || "flare";

export const s3 = new S3Client({
  region: "us-east-1",
  endpoint: endpoint(),
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || "flareflare",
    secretAccessKey: process.env.S3_SECRET_KEY || "flareflare",
  },
});

export function publicUrl(key: string) {
  const base = process.env.S3_PUBLIC_URL || `${endpoint()}/${bucket}`;
  return `${base.replace(/\/$/, "")}/${key}`;
}

export async function ensureBucket() {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    try {
      await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    } catch {
      // race / already exists
    }
  }
}

export async function putObject(key: string, body: Buffer | Uint8Array, contentType: string) {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
  return publicUrl(key);
}

export async function presignPut(key: string, contentType: string) {
  const cmd = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType });
  return getSignedUrl(s3, cmd, { expiresIn: 600 });
}

export async function getObjectBytes(key: string) {
  const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const bytes = await out.Body?.transformToByteArray();
  if (!bytes) throw new Error("empty object");
  return Buffer.from(bytes);
}
