import { SendMessageBatchCommand, SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { awsCredentials } from '../config/aws';
import { env } from '../config/env';

export type EmailHeader = {
  name: string;
  value: string;
};

export type EmailJobMessage = {
  jobId: string;
  tenantId: string;
  from: string;
  to: string;
  subject: string;
  html: string;
  configurationSetName: string;
  headers?: EmailHeader[];
};

const client = new SQSClient({
  region: env.AWS_REGION,
  credentials: awsCredentials,
});

export function buildEmailJobMessage(input: Omit<EmailJobMessage, 'version'>): string {
  const payload = {
    ...input,
    job_id: input.jobId,
    tenant_id: input.tenantId,
    configuration_set_name: input.configurationSetName,
    headers: input.headers,
  };

  return JSON.stringify(payload);
}

export async function publishEmailJobMessage(body: string): Promise<string | null> {
  const command = new SendMessageCommand({
    QueueUrl: env.SQS_QUEUE_URL,
    MessageBody: body,
  });

  const response = await client.send(command);
  return response.MessageId ?? null;
}

// SQS caps a single message and a whole batch at 256 KiB. Leave headroom for
// the batch envelope.
const MAX_BATCH_BYTES = 250 * 1024;
const MAX_BATCH_ENTRIES = 10;
const BATCH_CONCURRENCY = 10;

export type BatchPublishResult = {
  published: Array<{ jobId: string; sqsMessageId: string | null }>;
  failed: Array<{ jobId: string; reason: string }>;
};

function chunkForSqs(messages: Array<{ jobId: string; body: string }>) {
  const batches: Array<Array<{ jobId: string; body: string }>> = [];
  const oversized: Array<{ jobId: string; reason: string }> = [];
  let current: Array<{ jobId: string; body: string }> = [];
  let currentBytes = 0;

  for (const message of messages) {
    const size = Buffer.byteLength(message.body, 'utf8');
    if (size > MAX_BATCH_BYTES) {
      oversized.push({ jobId: message.jobId, reason: 'Email is larger than the 250 KB queue limit' });
      continue;
    }
    if (current.length === MAX_BATCH_ENTRIES || currentBytes + size > MAX_BATCH_BYTES) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(message);
    currentBytes += size;
  }
  if (current.length > 0) batches.push(current);

  return { batches, oversized };
}

async function publishBatch(batch: Array<{ jobId: string; body: string }>): Promise<BatchPublishResult> {
  // Batch entry ids must be unique within the batch and match [A-Za-z0-9_-].
  const byEntryId = new Map(batch.map((message, index) => [`m${index}`, message.jobId]));
  try {
    const response = await client.send(
      new SendMessageBatchCommand({
        QueueUrl: env.SQS_QUEUE_URL,
        Entries: batch.map((message, index) => ({ Id: `m${index}`, MessageBody: message.body })),
      }),
    );
    return {
      published: (response.Successful ?? []).map((entry) => ({
        jobId: byEntryId.get(entry.Id ?? '') ?? '',
        sqsMessageId: entry.MessageId ?? null,
      })),
      failed: (response.Failed ?? []).map((entry) => ({
        jobId: byEntryId.get(entry.Id ?? '') ?? '',
        reason: entry.Message ?? entry.Code ?? 'Failed to publish to SQS',
      })),
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Failed to publish to SQS';
    return { published: [], failed: batch.map((message) => ({ jobId: message.jobId, reason })) };
  }
}

/**
 * Publishes many email jobs using SendMessageBatch, a few batches at a time,
 * so a 1,000-recipient send is ~100 SQS calls instead of 1,000 sequential ones.
 */
export async function publishEmailJobMessages(
  messages: Array<{ jobId: string; body: string }>,
): Promise<BatchPublishResult> {
  const { batches, oversized } = chunkForSqs(messages);
  const result: BatchPublishResult = { published: [], failed: [...oversized] };

  for (let i = 0; i < batches.length; i += BATCH_CONCURRENCY) {
    const settled = await Promise.all(batches.slice(i, i + BATCH_CONCURRENCY).map(publishBatch));
    for (const batchResult of settled) {
      result.published.push(...batchResult.published);
      result.failed.push(...batchResult.failed);
    }
  }

  return result;
}

export const __test__ = { chunkForSqs };
