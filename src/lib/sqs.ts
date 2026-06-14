import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
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