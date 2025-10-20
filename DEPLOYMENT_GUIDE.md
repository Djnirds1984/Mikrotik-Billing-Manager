# MikroTik Manager - Nginx Deployment Guide

This guide details how to set up the MikroTik Orange Pi Manager in a standard production environment, serving it from the `/var/www/html` directory using Nginx as a reverse proxy. This allows you to access the panel on the standard web port 80.

## Prerequisites

-   An Orange Pi or similar SBC running a Debian-based OS (like Armbian) with SSH access.
-   **Node.js v20.x or newer.**
-   **Essential Tools:** `git`, `pm2`, `nginx`, and `build-essential`.
    ```bash
    sudo apt-get update
    sudo apt-get install -y git build-essential nginx
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
    Change the ownership of the directory to your current user. This is **crucial** as it allows you to clone the repository and run `npm install` without needing `sudo` for every command.
    ```bash
    # Replace $USER with your actual username if it's not detected correctly
    sudo chown -R $USER:$USER /var/www/html
    ```

## Step 2: Clone and Install the Application

1.  **Navigate and Clone:**
    ```bash
    cd /var/www/html
    git clone https://github.com/Djnirds1984/Mikrotik-Billing-Manager.git
    cd Mikrotik-Billing-Manager
    ```
    Your project will now be located at `/var/www/html/Mikrotik-Billing-Manager`.

2.  **Install Dependencies:**
    Run these commands from the project's **root directory** (`/var/www/html/Mikrotik-Billing-Manager`).
    ```bash
    # Install for UI Server (proxy)
    npm install --prefix proxy
   
    # Install for API Backend Server
    npm install --prefix api-backend
    ```

3.  **Configure Gemini API Key:**
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

1.  **Create a New Nginx Configuration File:**
    ```bash
    sudo nano /etc/nginx/sites-available/mikrotik-panel
    ```

2.  **Paste the Following Configuration:**
    This configuration tells Nginx how to route traffic for the main app, the API, and the WebSocket terminal. It includes important headers to ensure the application works correctly behind a proxy.

    ```nginx
    server {
        listen 80;
        server_name 192.168.200.13; # IMPORTANT: Replace with your server's IP or domain name

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
            proxy_pass http://localhost:3002; # <-- No trailing slash here
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_cache_bypass $http_upgrade;
        }

        # WebSocket for the Terminal (port 3002)
        location /ws/ {
            proxy_pass http://localhost:3002; # <-- No trailing slash here
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
        }
    }
    ```
    Save and exit the file (`Ctrl+X`, then `Y`, then `Enter`).

3.  **Enable the Site and Restart Nginx:**
    This is a crucial three-step verification process.

    ```bash
    # 1. Remove the default Nginx config to prevent conflicts.
    sudo rm /etc/nginx/sites-enabled/default

    # 2. Create a symbolic link to enable your new site configuration.
    sudo ln -s /etc/nginx/sites-available/mikrotik-panel /etc/nginx/sites-enabled/

    # 3. Test configuration syntax and logic.
    sudo nginx -t

    # 4. Restart Nginx to apply the new configuration.
    sudo systemctl restart nginx

    # 5. Verify that Nginx is now listening on port 80.
    # The output of this command MUST show 'nginx' listening on ':::80' or '0.0.0.0:80'.
    sudo ss -tulpn | grep :80
    ```

4.  **Restart PM2 Applications:**
    The final step is to restart your backend applications so they recognize and use the new proxy headers you configured in Nginx.
    ```bash
    pm2 restart all
    ```

## Step 5: Access Your Panel

You can now access your application directly by navigating to your Orange Pi's IP address in your browser:

`http://<your_orange_pi_ip>`
(e.g., `http://192.168.200.13`)
