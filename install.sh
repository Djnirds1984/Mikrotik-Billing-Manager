#!/bin/bash
# Mikrotik Billing Manager Deployment Script

set -e # Exit on error

echo "=================================================="
echo "   Mikrotik Billing Manager - Installation"
echo "=================================================="

# 1. Install System Dependencies
echo "[1/5] Installing system dependencies..."
if command -v apt-get &> /dev/null; then
    sudo apt-get update
    sudo apt-get install -y curl git build-essential nginx unzip
    
    # Install Node.js 20.x
    if ! command -v node &> /dev/null; then
        echo "      Installing Node.js 20.x..."
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
        sudo apt-get install -y nodejs
    else
        echo "      Node.js is already installed."
    fi
else
    echo "Warning: apt-get not found. Ensure Node.js (v20+), Nginx, and PM2 are installed manually."
fi

# Install PM2 global
if ! command -v pm2 &> /dev/null; then
    echo "      Installing PM2..."
    sudo npm install -g pm2
else
    echo "      PM2 is already installed."
fi

# 2. Setup Directory Permissions
TARGET_DIR="/var/www/html/Mikrotik-Billing-Manager"
CURRENT_USER=$(whoami)
echo "[2/5] Setting up permissions for $TARGET_DIR..."
if [ -d "$TARGET_DIR" ]; then
    sudo chown -R $CURRENT_USER:$CURRENT_USER "$TARGET_DIR"
else
    echo "      Target directory does not exist yet. It will be populated by the upload script."
fi

# 3. Install App Dependencies
echo "[3/5] Installing application dependencies..."
# Ensure we are in the right directory
if [ "$PWD" != "$TARGET_DIR" ]; then
    echo "      Changing directory to $TARGET_DIR"
    cd "$TARGET_DIR"
fi

# Install Proxy dependencies
echo "      Installing Proxy dependencies..."
npm install --prefix proxy

# Install API Backend dependencies
echo "      Installing API Backend dependencies..."
npm install --prefix api-backend

# Install Root dependencies (including vite for the middleware)
echo "      Installing Root dependencies..."
npm install

# 4. Configure PM2
echo "[4/5] Configuring PM2..."
pm2 delete mikrotik-manager 2>/dev/null || true
pm2 delete mikrotik-api-backend 2>/dev/null || true

# Start services
echo "      Starting Proxy Server (UI)..."
pm2 start ./proxy/server.js --name mikrotik-manager

echo "      Starting API Backend..."
pm2 start ./api-backend/server.js --name mikrotik-api-backend

pm2 save
# Generate startup script and execute it (requires sudo)
# We use 'pm2 startup' output to detect init system, but running it directly might need user interaction or sudo.
# We'll try to execute the command it suggests if running as root, or warn user.
if [ "$EUID" -eq 0 ]; then
    pm2 startup | tail -n 1 | bash || true
else
    echo "      To enable PM2 startup on boot, run: sudo env PATH=\$PATH:\$HOME/bin pm2 startup systemd -u $CURRENT_USER --hp $HOME"
fi

# 5. Configure Nginx
echo "[5/5] Configuring Nginx..."
NGINX_CONF="/etc/nginx/sites-available/mikrotik-manager"

# Create config file (needs sudo)
sudo bash -c "cat > $NGINX_CONF" <<EOF
server {
    listen 80;
    server_name _; # Default handler
    client_max_body_size 10m;

    # Main application UI and its APIs (port 3001)
    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        
        # Add Standard Proxy Headers
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        # WebSockets/Keep-Alive Headers
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_cache_bypass \$http_upgrade;
    }

    # MikroTik API Backend (port 3002)
    location /mt-api/ {
        proxy_pass http://localhost:3002/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_cache_bypass \$http_upgrade;
    }

    # WebSocket for the Terminal (port 3002)
    location /ws/ {
        proxy_pass http://localhost:3002/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
EOF

# Enable site
echo "      Enabling Nginx site..."
sudo ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/
# Remove default if exists
if [ -f /etc/nginx/sites-enabled/default ]; then
    sudo rm -f /etc/nginx/sites-enabled/default
fi

# Test and restart Nginx
if sudo nginx -t; then
    sudo systemctl restart nginx
    echo "      Nginx restarted successfully."
else
    echo "Error: Nginx configuration test failed."
    exit 1
fi

echo ""
echo "=================================================="
echo "   Deployment Complete!"
echo "   Access your panel at http://<YOUR_SERVER_IP>"
echo "=================================================="
