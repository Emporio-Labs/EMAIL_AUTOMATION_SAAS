# Deploying SwayamMail on one EC2 host

The API and the Go worker run in Docker on a single EC2 instance (a t3.small is
enough for low traffic), behind Caddy for HTTPS. Supabase stays hosted. The
dashboard deploys to Vercel.

```
Internet ──HTTPS──> Caddy :443 ──> api:3000 ──> Supabase
                                      │  ▲
                              SQS email-jobs │ /internal/job-status (Docker network only)
                                      ▼  │
                                    worker ──> SES ──> SNS ──> https://api.../internal/sns
```

## 1. AWS (region ap-south-1)

1. **SES**
   - Request production access (Account dashboard → Request production access).
     Until it is approved you can only send to verified addresses.
   - Verify `swayamail.in` as an identity (platform emails come from it).
   - Create a configuration set named `email-config`.
   - Add an event destination to it: type **SNS**, events **Send, Delivery,
     Bounce, Complaint, Reject**, to a new SNS topic `swayamail-ses-events`.
     The worker tags every message with `job_id` and `tenant_id`, and these
     events carry the tags back to the API.
2. **SQS**
   - Create standard queue `email-jobs-dlq`.
   - Create standard queue `email-jobs`, visibility timeout 30 s, with a
     redrive policy to `email-jobs-dlq`, maximum receives **5**.
3. **SNS**: after the API is live (step 4), add an HTTPS subscription on
   `swayamail-ses-events` to `https://api.swayamail.in/internal/sns`. The API
   confirms it automatically.
4. **IAM role for the instance** with this policy (replace `<account-id>`):

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": ["ses:SendEmail", "ses:CreateEmailIdentity", "ses:GetEmailIdentity", "ses:DeleteEmailIdentity"],
         "Resource": "*"
       },
       {
         "Effect": "Allow",
         "Action": ["sqs:SendMessage", "sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"],
         "Resource": [
           "arn:aws:sqs:ap-south-1:<account-id>:email-jobs",
           "arn:aws:sqs:ap-south-1:<account-id>:email-jobs-dlq"
         ]
       }
     ]
   }
   ```

5. **EC2**: t3.small, Amazon Linux 2023 or Ubuntu 24.04, the IAM role above
   attached, security group open on 22 (your IP only), 80 and 443. Allocate an
   Elastic IP and point an `A` record for `api.swayamail.in` at it.

## 2. Supabase

From this repo, linked to the production project:

```bash
npx supabase link --project-ref <project-ref>
npx supabase migration list      # see what production already has
npx supabase db push             # applies 0013 and 0014 (and anything missing)
```

`0013_deduplicate_and_purge_html.sql` was previously a second `0012` file. It is
written to be safe on a database that already ran the old copy, and it also
finishes the backfill if the old copy failed part-way (it errored on any
database that already had email jobs).

## 3. The server

```bash
# Docker + compose plugin (Amazon Linux 2023)
sudo dnf install -y docker git && sudo systemctl enable --now docker
sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo curl -SL https://github.com/docker/compose/releases/download/v2.29.7/docker-compose-linux-x86_64 \
  -o /usr/local/lib/docker/cli-plugins/docker-compose && sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

# 2 GB swap: builds and other apps on this box share 2 GB RAM
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

mkdir -p ~/swayamail && cd ~/swayamail
git clone https://github.com/Emporio-Labs/EMAIL_AUTOMATION_SAAS.git
git clone https://github.com/Emporio-Labs/GO_EMAIL_WORKER.git

cd EMAIL_AUTOMATION_SAAS/deploy
cp api.env.example api.env        # fill in Supabase keys, SQS URL, INTERNAL_KEY
cp worker.env.example worker.env  # same INTERNAL_KEY, queue URLs
openssl rand -hex 32              # use this for INTERNAL_KEY in both files

API_DOMAIN=api.swayamail.in sudo docker compose up -d --build
sudo docker compose logs -f
```

Check: `curl https://api.swayamail.in/health` returns `{"ok":true}`.

To update later: `git pull` in both repos, then `sudo docker compose up -d --build`.

## 4. Dashboard (Vercel)

Import the repo in Vercel with **Root Directory** `apps/dashboard` and set:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | `https://api.swayamail.in` |
| `NEXT_PUBLIC_SUPABASE_URL` | your Supabase URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | your Supabase anon key |

Point `app.swayamail.in` (or the root domain) at Vercel.

## 5. Smoke test in production

1. Sign up (add your email to `beta_users` first), add your domain, publish the
   DNS records, click Verify.
2. Add a sending address, create a production API key.
3. `POST /v1/send` with `"emailType": "transactional"` to your own inbox.
4. In Supabase, the job should go `queued` → `delivered`, and an
   `email_job_events` row of type `delivered` should appear once SNS is wired.

## Running everything locally

`scripts/local/e2e.mjs` runs 20 end-to-end checks against local Supabase
(`npx supabase start`), LocalStack SQS, `scripts/local/ses-mock.py` (LocalStack
community has no SES v2) and both services. See the header of that file.
