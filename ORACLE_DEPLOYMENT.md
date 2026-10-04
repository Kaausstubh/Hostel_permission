# HEIMDALL — 24/7 Always-Free Oracle Cloud Deployment Guide

This guide walks you through deploying the **HEIMDALL** backend to run **24/7 forever, without sleeping, for $0/month**, using an **Oracle Cloud Always Free ARM VM (Ubuntu 22.04/24.04, Ampere A1.Flex)**.

---

## Architecture Overview

```
                      Internet
                         │
                 ┌───────▼────────┐
                 │  Vercel (App)  │ (Frontend SPA)
                 └───────┬────────┘
                         │ HTTPS / WSS
                         │
       Oracle Cloud Always Free ARM VM (Ubuntu)
┌────────────────────────────────────────────────────────┐
│                                                        │
│   Ports 80 & 443 (Public)                              │
│   ┌────────────────────────────────────────────────┐   │
│   │  Caddy Container (Auto HTTPS / Let's Encrypt)  │   │
│   └───────────────────────┬────────────────────────┘   │
│                           │ Internal Docker Network    │
│           ┌───────────────┼───────────────┐            │
│           │               │               │            │
│   ┌───────▼───────┐ ┌─────▼─────┐ ┌───────▼──────┐     │
│   │ Backend API   │ │ MongoDB 7 │ │ Redis 7      │     │
│   │ Node.js/Socket│ │ (Private) │ │ (Private)    │     │
│   └───────┬───────┘ └───────────┘ └──────────────┘     │
│           │                                            │
│   Persistent Volumes: mongo_data, redis_data, caddy    │
└────────────────────────────────────────────────────────┘
```

- **Why this replaces Render**: Render free tier instances go to sleep after 15 minutes of inactivity and take 30–60 seconds to wake up (cold start). Oracle Cloud Always Free compute instances run **continuously 24/7 without sleeping**.
- **Resources**: Up to 4 ARM OCPUs and 24 GB RAM free forever.
- **Security**: MongoDB and Redis ports are **not exposed** to the public internet; only Caddy exposes ports 80 and 443.

---

## Step 1: Create the Oracle Cloud Always Free VM

1. Log in to your [Oracle Cloud Console](https://cloud.oracle.com/).
2. In the navigation menu (top left), go to **Compute** → **Instances**.
3. Click **Create Instance**.
4. Configure the instance:
   - **Name**: `heimdall-backend`
   - **Compartment**: Select your default compartment.
   - **Placement**: Default availability domain (marked *Always Free Eligible*).
   - **Image and Shape**:
     - Click **Change Image**: Select **Canonical Ubuntu** (22.04 or 24.04 Minimal/Standard).
     - Click **Change Shape**:
       - Select **Ampere (ARM Processor)**.
       - Choose **VM.Standard.A1.Flex** (Always Free Eligible).
       - Allocate **2 OCPUs** and **12 GB memory** (or up to 4 OCPUs and 24 GB).
   - **Networking**:
     - Virtual Cloud Network (VCN): Choose **Create new virtual cloud network** (or choose your existing VCN).
     - Subnet: **Create new public subnet**.
     - **Assign a public IPv4 address**: Ensure **Yes** is selected.
   - **Add SSH Keys**:
     - Select **Generate a key pair for me** and click **Save private key** (downloads a `.key` file), OR select **Upload public key files** if you have an existing SSH key (`~/.ssh/id_rsa.pub`).
   - **Boot Volume**: Default (50 GB or up to 200 GB Always Free).
5. Click **Create**.
6. Wait 1–2 minutes for the status to turn green (**RUNNING**).
7. Copy the **Public IP Address** (e.g., `129.153.xx.xx`).

---

## Step 2: Open Ports 80 & 443 in Oracle Security List

Oracle Cloud blocks all inbound web traffic at the cloud firewall level by default.

1. In the Oracle Console, go to **Compute** → **Instances** → Click `heimdall-backend`.
2. Under **Instance Information** → **Primary VNIC**, click on the **Subnet** link.
3. Click on the **Default Security List for `<your-vcn>`**.
4. In the left sidebar under Resources, click **Ingress Rules**.
5. Click **Add Ingress Rules** and add two rules:

   **Rule 1 (HTTP & HTTPS):**
   - **Source Type**: `CIDR`
   - **Source CIDR**: `0.0.0.0/0`
   - **IP Protocol**: `TCP`
   - **Destination Port Range**: `80,443`
   - **Description**: `Allow HTTP and HTTPS for Caddy`

   **Rule 2 (HTTP/3 QUIC - Optional but recommended):**
   - **Source Type**: `CIDR`
   - **Source CIDR**: `0.0.0.0/0`
   - **IP Protocol**: `UDP`
   - **Destination Port Range**: `443`
   - **Description**: `Allow HTTP/3 UDP`

6. Click **Add Ingress Rules**.

---

## Step 3: Open Ports 80 & 443 in Ubuntu iptables Firewall

> ⚠️ **CRITICAL ORACLE GOTCHA**:
> Oracle's Ubuntu OS images ship with pre-installed `iptables` rules that drop all incoming traffic on ports 80 and 443 even if the Oracle Cloud Security List permits it! You must open them inside Ubuntu.

1. Connect to your instance via SSH:
   ```bash
   chmod 400 /path/to/ssh-key.key
   ssh -i /path/to/ssh-key.key ubuntu@<YOUR_VM_PUBLIC_IP>
   ```

2. Run the following commands to open ports 80 and 443 in iptables:
   ```bash
   # Insert ACCEPT rules ahead of the default REJECT rule in iptables
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
   sudo iptables -I INPUT 6 -m state --state NEW -p udp --dport 443 -j ACCEPT

   # Make iptables rules persistent across reboots
   sudo apt-get update && sudo apt-get install -y iptables-persistent netfilter-persistent
   sudo netfilter-persistent save
   sudo netfilter-persistent reload
   ```

---

## Step 4: Point Your Domain to the VM

1. Log into your domain registrar or DNS provider (Cloudflare, Namecheap, GoDaddy, etc.).
2. Create an **A Record** pointing your backend subdomain to the Oracle VM Public IP:
   - **Type**: `A`
   - **Name**: `api` (creates `api.YOURDOMAIN.com`)
   - **Value / IPv4**: `<YOUR_VM_PUBLIC_IP>`
   - **TTL**: Auto or 300 seconds
   - *(If using Cloudflare: Set Proxy Status to "DNS Only" initially so Caddy can obtain the Let's Encrypt certificate directly, or set SSL/TLS encryption mode to "Full / Strict").*

---

## Step 5: Install Docker and Docker Compose on the VM

Run the official Docker convenience script for Ubuntu ARM64:

```bash
# Update Ubuntu packages
sudo apt update && sudo apt upgrade -y

# Install Docker engine
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Allow the 'ubuntu' user to run docker without sudo
sudo usermod -aG docker ubuntu

# Apply group changes without logging out
newgrp docker

# Verify installation
docker --version
docker compose version
```

---

## Step 6: Clone Repository & Configure Environment

1. Clone your project repository:
   ```bash
   git clone <YOUR_GIT_REPOSITORY_URL>
   cd HEMDALL/Hostel_permission
   ```

2. Create the production environment file from the template:
   ```bash
   cp backend/.env.production.example backend/.env
   ```

3. Edit `backend/.env` using `nano`:
   ```bash
   nano backend/.env
   ```
   Fill in your configuration:
   - `MONGODB_URI=mongodb://mongo:27017/heimdall` *(keep as-is)*
   - `REDIS_URL=redis://redis:6379` *(keep as-is)*
   - `FRONTEND_URL=https://your-app.vercel.app` *(your real Vercel frontend URL)*
   - `VERCEL_URL=your-app.vercel.app` *(frontend domain without protocol)*
   - `PUBLIC_BACKEND_URL=https://api.YOURDOMAIN.com` *(your real backend domain)*
   - `API_DOMAIN=api.YOURDOMAIN.com` *(your real backend domain)*
   - Generate cryptographically secure keys:
     ```bash
     node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
     ```
     Paste the generated strings into `JWT_SECRET`, `QR_SECRET`, and `SESSION_SECRET`.
   - Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
   - Press `Ctrl+O` then `Enter` to save, and `Ctrl+X` to exit.

4. Update `Caddyfile` with your domain:
   ```bash
   nano Caddyfile
   ```
   Replace `api.YOURDOMAIN.com` with your real domain (e.g., `api.mycampus.com`):
   ```caddy
   api.mycampus.com {
       reverse_proxy backend:5000 {
           header_up Host {host}
           header_up X-Real-IP {remote_host}
           header_up X-Forwarded-For {remote_host}
           header_up X-Forwarded-Proto {scheme}
       }
       encode gzip zstd
       log {
           output stdout
           format console
       }
   }
   ```
   *(Or keep `{$API_DOMAIN:api.YOURDOMAIN.com}` if you defined `API_DOMAIN` in `backend/.env`).*

5. Update your Google Cloud Console OAuth redirect:
   - Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
   - In your OAuth 2.0 Web Client, add the authorized redirect URI:
     `https://api.YOURDOMAIN.com/api/auth/google/callback`

---

## Step 7: Run Docker Compose

Launch the production stack:

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

### Check Container Status
```bash
docker compose -f docker-compose.prod.yml ps
```
You should see all 4 containers in `running` (or `healthy`) status:
- `heimdall-mongo`
- `heimdall-redis`
- `heimdall-backend`
- `heimdall-caddy`

### View Realtime Logs
```bash
# View all logs
docker compose -f docker-compose.prod.yml logs -f

# View backend logs specifically
docker compose -f docker-compose.prod.yml logs -f backend

# View Caddy SSL/proxy logs
docker compose -f docker-compose.prod.yml logs -f caddy
```

---

## Step 8: Seed the Database

Pre-seed the initial warden and security accounts:

```bash
docker compose -f docker-compose.prod.yml exec backend node seed.js
```

---

## Step 9: Verify Health & WebSockets

1. Test health check locally on the VM:
   ```bash
   curl http://localhost:5000/health
   ```
   Output should be:
   ```json
   {"status":"ok","requestId":"...","timestamp":"...","version":"2.0.0","service":"HEIMDALL Smart Campus API","uptime":...}
   ```

2. Test HTTPS endpoint publicly from your local machine:
   ```bash
   curl -I https://api.YOURDOMAIN.com/health
   ```
   Should return `HTTP/2 200` with valid Let's Encrypt SSL certificate!

---

## Step 10: Setup Daily Automated Backups

The project includes an automated backup script at `scripts/backup.sh` that takes a compressed `mongodump` of the database and rotates backups, keeping the last 7 days.

1. Ensure the script is executable:
   ```bash
   chmod +x scripts/backup.sh
   ```

2. Test the backup script manually:
   ```bash
   ./scripts/backup.sh
   ```
   Verify that a `.archive.gz` file is created in `backups/mongodb/`.

3. Install the daily crontab job:
   ```bash
   crontab -e
   ```
   Append the following line at the end (runs daily at 3:00 AM UTC):
   ```cron
   0 3 * * * /home/ubuntu/HEMDALL/Hostel_permission/scripts/backup.sh >> /var/log/heimdall_backup.log 2>&1
   ```

---

## Step 11: Set VITE_API_URL in Vercel & Deploy Frontend

1. Go to your [Vercel Dashboard](https://vercel.com/).
2. Select your frontend project.
3. Navigate to **Settings** → **Environment Variables**.
4. Add or update:
   - **Key**: `VITE_API_URL`
   - **Value**: `https://api.YOURDOMAIN.com/api`
   - **Environments**: Check *Production*, *Preview*, and *Development*.
5. Redeploy your frontend:
   - Go to **Deployments** → Click `...` on your latest deployment → **Redeploy**.
   - Or push a commit to your main branch.

---

## Useful Maintenance Commands

| Action | Command |
|---|---|
| View container status | `docker compose -f docker-compose.prod.yml ps` |
| View container resource usage (CPU/RAM) | `docker stats` |
| Restart backend service | `docker compose -f docker-compose.prod.yml restart backend` |
| Rebuild backend after code change | `git pull && docker compose -f docker-compose.prod.yml up -d --build backend` |
| View live logs | `docker compose -f docker-compose.prod.yml logs -f backend` |
| Stop all services | `docker compose -f docker-compose.prod.yml down` |
| Restore a MongoDB backup | `docker exec -i heimdall-mongo mongorestore --db heimdall --archive --gzip < backups/mongodb/heimdall_YYYY-MM-DD.archive.gz` |
| View backup log | `tail -n 50 /var/log/heimdall_backup.log` |
