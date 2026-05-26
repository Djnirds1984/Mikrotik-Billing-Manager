# Mikrotik Billling Management by AJC - Nginx Deployment Guide

This guide details how to set up the Mikrotik Billling Management by AJC in a standard production environment, serving it from the `/var/www/html` directory using Nginx as a reverse proxy. This allows you to access the panel on the standard web port 80.

## Prerequisites

-   An Orange Pi or similar SBC running a Debian-based OS (like Armbian) with SSH access.
-   **Node.js v20.x, npm, and other essential tools.** The following steps will guide you through the installation.

### 1. Install Node.js and Essential Tools

This project requires a modern version of Node.js. The recommended way to install it on Armbian/Debian is by using the NodeSource repository.

**a. Update System Packages**

First, ensure your system's package list is up-to-date.
```bash
sudo apt update
sudo apt upgrade
```

**b. Add the NodeSource Repository**

Use `curl` to download and run the setup script for the recommended Node.js version. `curl` might not be installed, so we ensure it is.
```bash
sudo apt install -y curl
# This script adds the repository for Node.js v20.x (LTS)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
```

**c. Install Node.js, Git, Nginx, and Build Tools**

Now, install `nodejs` (which includes `npm`) along with the other required packages.
```bash
# `build-essential` is needed for some npm packages that compile from source.
# `nginx` is our reverse proxy.
# `git` is for cloning the repository.
sudo apt install -y nodejs git build-essential nginx
```

**d. Verify the Installation**

Check that Node.js and npm are installed correctly.
```bash
node -v
npm -v
```
You should see version numbers like `v20.x.x` and `10.x.x`.

### 2. Install PM2

`pm2` is a process manager that will keep the panel running as a background service. Install it globally using `npm`.
```bash
sudo npm install -g pm2
```

-   **Gemini API Key (Optional)**: For the "AI Scripting" feature, get a key from [Google AI Studio](https://aistudio.google.com/app/apikey).

## Step 1: Prepare the Directory

1.  **Create the Directory:**
    The `/var/www/html` directory may already exist. This command ensures it's created if it's missing.
    ```bash
    sudo mkdir -p /var/www/html
    ```

2.  **Set Permissions:**
    Ensure the web root directory is owned by the `root` user, which is a common security practice.
    ```bash
    sudo chown -R root:root /var/www/html
    ```

## Step 2: Clone and Install the Application

1.  **Navigate and Clone as Root:**
    Clone the repository into the web root directory. You will need `sudo` because the directory is owned by root.
    ```bash
    cd /var/www/html
    sudo git clone https://github.com/Djnirds1984/Mikrotik-Billing-Manager.git
    ```

2.  **Set Project Directory Permissions:**
    Change the ownership of the newly cloned project directory to your current user. This is **crucial** as it allows you to manage the application (install dependencies, run PM2) without needing `sudo` for every command.
    ```bash
    # Replace $USER with your actual username if it's not detected correctly
    sudo chown -R root:root /var/www/html/Mikrotik-Billing-Manager
    ```

3.  **Navigate into Project Directory:**
    ```bash
    cd Mikrotik-Billing-Manager
    ```

Install Dependencies and Build:
Run these commands from the project's root directory (/var/www/html/Mikrotik-Billing-Manager).

# 1. Install dependencies for UI Server (proxy)
npm install --prefix proxy

# 2. Install dependencies for API Backend Server
npm install --prefix api-backend

# 3. Install root dependencies and perform the build step
npm install --verbose
npm run build


5.  **Configure Gemini API Key:**
    Edit the `env.js` file and paste your Gemini API key.
    ```bash
    nano env.js
    ```
    Replace `"YOUR_GEMINI_API_KEY_HERE"` with your key, then save and exit (`Ctrl+X`, then `Y`, then `Enter`).

## Step 3: Start the Application with PM2

These commands will run your application as a background service.

1.  **Start Both Servers:**
    ```bash
    # Ensure any old versions are stopped
    pm2 delete all

    # Start the UI server (runs on localhost:3001)
    pm2 start ./proxy/server.js --name mikrotik-manager

    # Start the API backend (runs on localhost:3002)
    pm2 start ./api-backend/server.js --name mikrotik-api-backend
    ```

2.  **Save the Process List:**
    This ensures `pm2` automatically restarts the apps on server reboot.
    ```bash
    pm2 save
    ```

## Step 4: Configure Nginx as a Reverse Proxy

Nginx will listen on the public port 80 and forward traffic to the correct Node.js server.

1.  **Edit the Default Configuration File:**
    Instead of creating a new file, edit the `default` Nginx configuration file.
    ```bash
    sudo nano /etc/nginx/sites-available/default
    ```

2.  **Paste the Following Configuration:**
    Ensure the **entire contents** of the file are replaced with this structure. This configuration routes traffic for the main app, the API, and the WebSocket terminal, and includes important headers to ensure the application works correctly behind a proxy.

    ```nginx
    server {
        listen 80;
        server_name 127.0.0.1; # IMPORTANT: Replace with your server's IP or domain name
        client_max_body_size 10m; # Allow larger file uploads for logos, etc.

        # Main application UI and its APIs (port 3001)
        location / {
            proxy_pass http://localhost:3001;
            proxy_http_version 1.1;
            
            # Add Standard Proxy Headers
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            
            # WebSockets/Keep-Alive Headers
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_cache_bypass $http_upgrade;
        }

        # MikroTik API Backend (port 3002)
        location /mt-api/ {
            proxy_pass http://localhost:3002/; # <-- Trailing slash is important!
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_cache_bypass $http_upgrade;
        }

        # WebSocket for the Terminal (port 3002)
        location /ws/ {
            proxy_pass http://localhost:3002/; # <-- Trailing slash is important!
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
        }
    }
    ```
    Save and exit the file (`Ctrl+X`, then `Y`, then `Enter`).

**IMPORTANT: If you are using PayMongo payment gateway, you MUST add the webhook proxy configuration below.**

3.  **Enable the Site and Restart Nginx:**
    This is a crucial three-step verification process.

    ```bash
    # 1. Ensure the site configuration is enabled by creating a symbolic link.
    # If this command says "File exists", that is okay and you can ignore it.
    sudo ln -s /etc/nginx/sites-available/default /etc/nginx/sites-enabled/

    # 2. Test configuration syntax and logic.
    sudo nginx -t

    # 3. Restart Nginx to apply the new configuration.
    sudo systemctl restart nginx

    # 4. Verify that Nginx is now listening on port 80.
    # The output of this command MUST show 'nginx' listening on ':::80' or '0.0.0.0:80'.
    sudo ss -tulpn | grep :80
    ```

4.  **Restart PM2 Applications:**
    The final step is to restart your backend applications so they recognize and use the new proxy headers you configured in Nginx.
    ```bash
    pm2 restart all
    ```
5. cd /var/www/html/Mikrotik-Billing-Manager

6. # Ensure any old versions are stopped
   pm2 delete all

   # Start the UI server (runs on localhost:3001)
   pm2 start ./proxy/server.js --name mikrotik-manager

   # Start the API backend (runs on localhost:3002)
   pm2 start ./api-backend/server.js --name mikrotik-api-backend

7. pm2 startup

8.#ZEROTIER ACTIVATION
   curl -s https://install.zerotier.com | sudo bash

## Step 5: Configure PayMongo Payment Gateway (Optional)

If you want to accept online payments through PayMongo, follow these steps:

### 5.1: Get PayMongo API Credentials

1. **Create a PayMongo Account**: Sign up at [PayMongo](https://www.paymongo.com/)
2. **Get API Keys**: 
   - Log in to your PayMongo dashboard
   - Go to **Settings** > **Developers** > **API Keys**
   - You will need:
     - **Secret Key** (starts with `sk_test_` for test mode or `sk_live_` for live mode)
     - **Publishable Key** (starts with `pk_test_` or `pk_live_`)

### 5.2: Configure PayMongo in the Application

1. **Access System Settings**: Log in to your Mikrotik Billing Manager as admin
2. **Navigate to Settings**: Go to **System Settings** > **PayMongo** tab
3. **Enter PayMongo Credentials**:
   - **Public Key**: Paste your publishable key (e.g., `pk_test_xxxxx`)
   - **Secret Key**: Paste your secret key (e.g., `sk_test_xxxxx`)
   - **Webhook URL**: Enter the full public URL where PayMongo will send payment events
     - Format: `https://yourdomain.com/api/paymongo-webhook`
     - Example: `https://billing.yourisp.com/api/paymongo-webhook`
   - **Webhook Secret**: This will be auto-generated when you register the webhook
   - **Pass Convenience Fee to Customer**: Toggle ON if you want customers to pay the PayMongo processing fee (recommended)

4. **Enable PayMongo**: Check the "Enable PayMongo" checkbox
5. **Save Settings**: Click "Save Settings" at the bottom

### 5.3: Register PayMongo Webhook

1. **Click "Check Status"**: In the Webhook Diagnostics section, click this button to verify your configuration
2. **Click "Re-register Webhook"**: This will register your webhook URL with PayMongo's API
3. **Verify Webhook Status**: You should see your webhook listed with status "enabled"

### 5.4: Configure Nginx for PayMongo Webhooks

**CRITICAL**: PayMongo webhooks require special Nginx configuration to forward the signature header. Without this, payment processing will fail silently.

1. **Edit Nginx Configuration**:
   ```bash
   sudo nano /etc/nginx/sites-available/default
   ```

2. **Add PayMongo Webhook Location Block**: Add this block **BEFORE** the main `location /` block:

   ```nginx
   # PayMongo Webhook (MUST be before location /)
   location /api/paymongo-webhook {
       proxy_pass http://localhost:3001/api/paymongo-webhook;
       proxy_http_version 1.1;
       
       # Standard Proxy Headers
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
       
       # CRITICAL: Forward PayMongo signature header
       proxy_set_header X-Paymongo-Signature $http_x_paymongo_signature;
       
       # Disable buffering for webhook reliability
       proxy_buffering off;
       
       # Timeout settings for webhook processing
       proxy_connect_timeout 60s;
       proxy_send_timeout 60s;
       proxy_read_timeout 60s;
   }
   ```

3. **Complete Nginx Configuration Example** (with PayMongo):

   ```nginx
   server {
       listen 80;
       server_name yourdomain.com; # Replace with your actual domain or IP
       client_max_body_size 10m;

       # PayMongo Webhook - MUST be before location /
       location /api/paymongo-webhook {
           proxy_pass http://localhost:3001/api/paymongo-webhook;
           proxy_http_version 1.1;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           
           # CRITICAL: Forward PayMongo signature header
           proxy_set_header X-Paymongo-Signature $http_x_paymongo_signature;
           proxy_buffering off;
           
           proxy_connect_timeout 60s;
           proxy_send_timeout 60s;
           proxy_read_timeout 60s;
       }

       # Main application UI (port 3001)
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

4. **Test and Restart Nginx**:
   ```bash
   sudo nginx -t
   sudo systemctl restart nginx
   ```

5. **Verify Nginx is Listening**:
   ```bash
   sudo ss -tulpn | grep :80
   ```

### 5.5: Test PayMongo Integration

1. **Test Webhook Endpoint**: Open your browser and visit:
   ```
   https://yourdomain.com/api/paymongo-webhook-ping
   ```
   You should see: `{"status":"ok","message":"Webhook endpoint is reachable"}`

2. **Make a Test Payment**:
   - Go to **PPPoE** or **DHCP** section
   - Select a client with a billing plan
   - Click "Pay Now" or similar payment button
   - Complete a test payment using PayMongo's test card numbers

3. **Verify Webhook Logs**:
   ```bash
   pm2 logs mikrotik-manager --lines 100
   ```
   Look for `[PayMongo Webhook]` log entries showing successful payment processing.

### 5.6: PayMongo Webhook Troubleshooting

**Problem**: Webhook not receiving payments
- **Check Nginx Configuration**: Ensure `proxy_set_header X-Paymongo-Signature` is present
- **Check Webhook URL**: Must be publicly accessible (not localhost)
- **Check Logs**: `pm2 logs mikrotik-manager` for `[PayMongo Webhook]` entries
- **Test Connectivity**: Visit `/api/paymongo-webhook-ping` to verify endpoint is reachable

**Problem**: Signature verification failed
- **Nginx Header Forwarding**: The `X-Paymongo-Signature` header MUST be forwarded (see step 5.4)
- **Webhook Secret**: Ensure it matches what's stored in PayMongo dashboard
- **Check Logs**: Look for `[PayMongo Webhook] STAGE 2` entries in PM2 logs

**Problem**: Payments processed but subscription not activated
- **Check Webhook Status**: In System Settings > PayMongo, click "Check Status"
- **Verify Events**: Webhook must have `checkout_session.payment.paid` event enabled
- **Database Logs**: Check PM2 logs for database update errors

### 5.7: Switching from Test to Live Mode

1. **Get Live API Keys** from PayMongo dashboard
2. **Update Settings**: Go to System Settings > PayMongo
3. **Replace Keys**: 
   - Change `pk_test_` to `pk_live_`
   - Change `sk_test_` to `sk_live_`
4. **Re-register Webhook**: Click "Re-register Webhook" button
5. **Update Webhook URL**: Ensure it uses HTTPS in production
6. **Test with Real Payment**: Make a small test payment with real card

## Step 6: Access Your Panel

You can now access your application directly by navigating to your Orange Pi's IP address in your browser:

`http://<your_orange_pi_ip>`
(e.g., `http://192.168.1.10`)

**If PayMongo is configured**: Ensure your webhook URL uses HTTPS for production (use Let's Encrypt or Cloudflare SSL).
