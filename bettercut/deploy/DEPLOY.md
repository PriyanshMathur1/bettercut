# Deploying BetterCut Cloud for free

One server runs everything: the website, the API, the job worker and the renderer. Sign-in is with Google
only, through Supabase. Cost: $0 a month on Oracle Cloud's Always Free tier.

What you need to create yourself (accounts, card check, terms): about 25 minutes. Everything after that is
four commands on the server.

## 1. Accounts (you)

### a. Oracle Cloud server
1. Sign up at https://www.oracle.com/cloud/free/ (needs a card for identity; Always Free resources are not charged).
2. Compute > Instances > Create instance:
   - Image: **Ubuntu 24.04**. Shape: **Ampere, VM.Standard.A1.Flex**, 2 OCPU / 12 GB (the Always Free size).
   - If it says "out of capacity", try another availability domain or try again later.
   - Boot volume: 100 GB or more (up to 200 GB is free).
   - Add your SSH public key. Note the **public IP**.
3. Open the web ports: Networking > your VCN > Security List > add **ingress** rules for TCP **80** and **443**
   from `0.0.0.0/0`.

Your site address is the IP with dashes plus `.sslip.io`, for example `140-238-1-2.sslip.io`. It needs no
domain purchase and gets a free HTTPS certificate. (Use your own domain instead if you have one: point an A
record at the IP.)

### b. Supabase project (sign-in only)
1. Create a project at https://supabase.com (free plan).
2. Project Settings > API: copy the **Project URL** and the **anon public key**.
3. Authentication > URL Configuration: set **Site URL** to `https://<your site address>` and add the same
   address under **Redirect URLs**.
4. Authentication > Sign In / Providers: turn **Email off**, turn **Google on** (it needs the client ID and
   secret from the next step; this page also shows the **callback URL** you need there).

### c. Google sign-in
1. https://console.cloud.google.com > create a project > APIs & Services > OAuth consent screen: External,
   app name "BetterCut", your email. Publish it (otherwise only test users you list can sign in).
2. Credentials > Create credentials > OAuth client ID > Web application.
   - Authorized redirect URI: the Supabase **callback URL** from step b.4
     (`https://<project>.supabase.co/auth/v1/callback`).
3. Paste the client ID and secret into Supabase's Google provider and save.

## 2. Server setup (four commands)

SSH in (`ssh ubuntu@<public ip>`), then:

```bash
curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker $USER && newgrp docker
```
```bash
sudo iptables -I INPUT 6 -p tcp -m multiport --dports 80,443 -j ACCEPT && sudo netfilter-persistent save
```
Copy the code to the server (from your computer, in the BetterCut folder):
```bash
rsync -az --exclude .venv --exclude node_modules --exclude '.git' requirements.txt bettercut composer ubuntu@<public ip>:bettercut-app/
```
On the server:
```bash
cd bettercut-app/bettercut/deploy && cp .env.example .env && nano .env
```
Fill in `SITE_ADDRESS`, `PUBLIC_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `BETTERCUT_SECRET`
(`openssl rand -base64 32`). For a private beta, list the allowed emails in `ALLOWED_EMAILS`. Then:
```bash
docker compose up -d --build
```
The first build takes 15-25 minutes on the free server (it downloads the speech models into the image).
Open `https://<your site address>` and sign in with Google.

## 3. Day to day
- Logs: `docker compose logs -f app`
- Update: rsync the code again, then `docker compose up -d --build`
- Back up: the `data` volume holds the database, media and the generated secret.
  `docker run --rm -v deploy_data:/data -v $PWD:/out alpine tar czf /out/bettercut-backup.tgz -C /data .`
- Oracle reclaims Always Free servers that sit idle for a week. A daily cron ping is enough:
  `(crontab -l; echo "0 */6 * * * curl -fsS https://<your site address>/api/health >/dev/null") | crontab -`

## Limits on the free server
- 2 CPU cores: roughly 1-2 minutes to cut a 45-second reel, 3-5 minutes to render it. Jobs run one at a time
  and people see their place in line.
- No speaker cutout (`ALLOW_CUTOUT=0`): it needs a GPU to be usable.
- Each user brings their own AI model key (Settings > AI model). You pay nothing for AI edits.
- Remotion is free for individuals and teams of up to 3. A company of 4 or more needs a Remotion licence.

## Later
- Move media to Cloudflare R2 (10 GB free, free downloads): set `STORAGE=s3` and the `S3_*` values.
- Move the database to Postgres (Supabase gives 500 MB free): set `DATABASE_URL`.
- Bigger server: the same image runs on any arm64 or amd64 machine.

## Connector: edit from Claude or ChatGPT with no API key

Each user can create a personal connector link in **Settings > Connect your AI** (`https://<site>/mcp/<token>`).
They add it as a custom connector (MCP, Streamable HTTP) in their AI app and edit reels by chatting, on their
normal subscription. Edits show up live in the open editor and each one is an Undo step.

- The link is the credential: anyone holding it can edit that user's reels. Users can replace it or turn it off.
- Hosted AI apps (Claude.ai, ChatGPT) can only reach a public HTTPS site, so this needs the deployed server.
- Running locally (`python -m bettercut cloud`), apps on the same computer can use `http://localhost:<port>/mcp`
  with no token, e.g. `claude mcp add --transport http bettercut http://localhost:4795/mcp`.
