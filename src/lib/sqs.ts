import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { awsCredentials } from '../config/aws';
import { env } from '../config/env';

export type EmailJobMessage = {
  jobId: string;
  tenantId: string;
  from: string;
  to: string;
  subject: string;
  html: string;
};

const client = new SQSClient({
  region: env.AWS_REGION,
  credentials: awsCredentials,
});

export function buildEmailJobMessage(input: Omit<EmailJobMessage, 'version'>): string {
  return JSON.stringify(input);
}

export async function publishEmailJobMessage(body: string): Promise<string | null> {
  const command = new SendMessageCommand({
    QueueUrl: env.SQS_QUEUE_URL,
    MessageBody: body,
  });

  const response = await client.send(command);
  return response.MessageId ?? null;
}