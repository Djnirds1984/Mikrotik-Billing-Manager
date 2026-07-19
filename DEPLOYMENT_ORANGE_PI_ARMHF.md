# Mikrotik Billing Manager — Orange Pi (armhf) Deployment Guide

This guide is specifically for deploying the Mikrotik Billing Manager on **Orange Pi** and similar **ARMv7 (armhf)** single-board computers running a Debian-based OS (Armbian, Orange Pi OS, etc.).

> **Important:** The standard NodeSource `setup_20.x` script **does not work** on `armhf` — it has dropped 32-bit ARM support. This guide uses the official precompiled ARMv7 binaries instead.

---

## Hardware Requirements

| Requirement | Minimum | Recommended |
|---|---|---|
| Board | Orange Pi (ARMv7) or similar | Orange Pi One / PC / Plus |
| RAM | 512 MB | 1 GB+ |
| Storage | 4 GB SD/eMMC | 8 GB+ (Class 10) |
| Network | Ethernet | Ethernet + Wi-Fi |
| OS | Armbian (Bullseye/Bookworm) | Armbian latest stable |

> **Note:** This guide will **not** work on ARMv6 hardware (original Raspberry Pi 1, Pi Zero W). Node.js 11.x is the last version supporting ARMv6.

---

## Step 1: Update System

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y curl wget build-essential nginx git
```

---

## Step 2: Install Node.js 20 (armhf Binary Method)

Since NodeSource has dropped `armhf` support, we install the official precompiled ARMv7 binary directly.

### 2.1 — Download the official ARMv7 binary (~1-2 min)

```bash
cd /tmp
wget https://nodejs.org/dist/v20.20.1/node-v20.20.1-linux-armv7l.tar.xz
```

> If the version above is no longer available, check https://nodejs.org/dist/latest-v20.x/ for the latest v20 release and substitute the filename.

### 2.2 — Extract and install into system path (~1 min)

```bash
sudo tar -xJf node-v20.20.1-linux-armv7l.tar.xz --strip-components=1 -C /usr/local
```

This places `node`, `npm`, and `npx` into `/usr/local/bin/` — no PATH edits needed.

### 2.3 — Verify installation

```bash
node -v    # Should show v20.20.1
npm -v     # Should show 10.x.x
```

### 2.4 — Clean up the tarball

```bash
rm /tmp/node-v20.20.1-linux-armv7l.tar.xz
```

---

## Step 3: Install PM2

PM2 keeps the application running as a background service and auto-restarts on crash/reboot.

```bash
sudo npm install -g pm2
```

---

## Step 4: Clone the Application

```bash
sudo mkdir -p /var/www/html
cd /var/www/html
sudo git clone https://github.com/Djnirds1984/Mikrotik-Billing-Manager.git
sudo chown -R $USER:$USER /var/www/html/Mikrotik-Billing-Manager
cd Mikrotik-Billing-Manager
```

---

## Step 5: Install Dependencies and Build

> **Memory tip for 1 GB boards:** The build step can consume 500 MB+ RAM. If you hit OOM errors, create a swap file first (see Appendix A).

```bash
# 1. Install proxy (UI server) dependencies
npm install --prefix proxy

# 2. Install API backend dependencies
npm install --prefix api-backend

# 3. Install root dependencies and build the frontend
npm install
npm run build
```

> On low-memory boards, use `NODE_OPTIONS=--max-old-space-size=512 npm run build` if the build runs out of memory.

---

## Step 6: Configure Environment

### 6.1 — Proxy `.env`

```bash
cp proxy/.env.example proxy/.env
nano proxy/.env
```

Set your values (database path, port, etc.). Defaults are usually fine.

### 6.2 — Gemini API Key (Optional)

Edit `env.js` for the AI Scripting feature:

```bash
nano env.js
```

Replace `"YOUR_GEMINI_API_KEY_HERE"` with your key from [Google AI Studio](https://aistudio.google.com/app/apikey).

---

## Step 7: Start with PM2

```bash
# Stop any old processes
pm2 delete all 2>/dev/null

# Start the UI server (port 3001)
pm2 start ./proxy/server.js --name mikrotik-manager

# Start the API backend (port 3002)
pm2 start ./api-backend/server.js --name mikrotik-api-backend

# Save process list for auto-restart on reboot
pm2 save

# Set up PM2 to start on boot
pm2 startup
```

Verify both processes are running:

```bash
pm2 status
```

You should see both `mikrotik-manager` and `mikrotik-api-backend` with status `online`.

---

## Step 8: Configure Nginx Reverse Proxy

### 8.1 — Edit the default site config

```bash
sudo nano /etc/nginx/sites-available/default
```

Replace the **entire contents** with:

```nginx
server {
    listen 80;
    server_name _;  # Replace with your IP or domain for production
    client_max_body_size 10m;

    # PayMongo Webhook — MUST be before location /
    location /api/paymongo-webhook {
        proxy_pass http://localhost:3001/api/paymongo-webhook;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Paymongo-Signature $http_x_paymongo_signature;
        proxy_buffering off;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Main application UI and its APIs (port 3001)
    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_cache_bypass $http_upgrade;
    }

    # MikroTik API Backend (port 3002)
    location /mt-api/ {
        proxy_pass http://localhost:3002/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_cache_bypass $http_upgrade;
    }

    # WebSocket for Terminal (port 3002)
    location /ws/ {
        proxy_pass http://localhost:3002/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### 8.2 — Enable site and restart Nginx

```bash
sudo ln -s /etc/nginx/sites-available/default /etc/nginx/sites-enabled/ 2>/dev/null
sudo nginx -t          # Verify syntax
sudo systemctl restart nginx
sudo ss -tulpn | grep :80   # Confirm Nginx is listening on port 80
```

### 8.3 — Restart PM2 apps to pick up proxy headers

```bash
pm2 restart all
```

---

## Step 9: Configure PayMongo Payment Gateway

After Nginx is running, configure PayMongo credentials in the admin panel:

1. Log in to the admin panel
2. Go to **System Settings > PayMongo** tab
3. Enter your **Public Key**, **Secret Key**, **Webhook URL**, and **Webhook Secret**
4. Enable PayMongo and click **Save Settings**
5. Click **Re-register Webhook** to register your webhook URL with PayMongo

> Webhook URL format: `https://yourdomain.com/api/paymongo-webhook` (must be HTTPS in production)

---

## Step 10: ZeroTier (Optional — Remote Access)

```bash
curl -s https://install.zerotier.com | sudo bash
sudo zerotier-cli join <YOUR_NETWORK_ID>
```

---

## Step 11: Access Your Panel

Open your browser and navigate to:

```
http://<your_orange_pi_ip>
```

(e.g., `http://192.168.1.10`)

---

## Appendix A: Create Swap File (Low-Memory Boards)

If your Orange Pi has ≤ 1 GB RAM, create a 1 GB swap file to prevent OOM during build:

```bash
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Make it permanent
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Verify:

```bash
free -h
```

---

## Appendix B: Updating the Application

```bash
cd /var/www/html/Mikrotik-Billing-Manager
git pull origin main
npm install --prefix proxy
npm install --prefix api-backend
npm install
npm run build
pm2 restart all
```

---

## Appendix C: Useful PM2 Commands

| Command | Description |
|---|---|
| `pm2 status` | Show all process statuses |
| `pm2 logs mikrotik-manager` | View live UI server logs |
| `pm2 logs mikrotik-api-backend` | View API backend logs |
| `pm2 restart all` | Restart all processes |
| `pm2 stop all` | Stop all processes |
| `pm2 monit` | Real-time resource monitor |

---

## Troubleshooting

| Issue | Solution |
|---|---|
| `node: command not found` | Re-run the tar extract step; ensure `/usr/local/bin` is in your PATH |
| Build OOM / killed | Create swap file (Appendix A), or set `NODE_OPTIONS=--max-old-space-size=512` |
| `npm install` fails on `better-sqlite3` | Ensure `build-essential` and `python3` are installed: `sudo apt install -y python3` |
| Nginx 502 Bad Gateway | Check `pm2 status` — both services must be `online` |
| WebSocket terminal not working | Verify Nginx has `Upgrade` and `Connection "upgrade"` headers in `/ws/` location |
