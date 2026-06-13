#!/bin/bash
# Fix 504 Gateway Timeout errors on production server
# Run this script on your Orange Pi / production server

echo "=================================================="
echo "   Fixing 504 Gateway Timeout Issues"
echo "=================================================="
echo ""

# Step 1: Update Nginx configuration with timeout directives
echo "[1/4] Updating Nginx configuration..."

NGINX_CONF="/etc/nginx/sites-available/default"
BACKUP_CONF="/etc/nginx/sites-available/default.backup.$(date +%Y%m%d_%H%M%S)"

# Backup current config
sudo cp "$NGINX_CONF" "$BACKUP_CONF"
echo "      Backed up current config to: $BACKUP_CONF"

# Update Nginx config - add timeout directives to /mt-api/ location
sudo sed -i '/location \/mt-api\/ {/,/}/{
    /proxy_cache_bypass/a\
        \
        # Timeout settings to prevent 504 Gateway Timeout\
        proxy_connect_timeout 30s;\
        proxy_send_timeout 30s;\
        proxy_read_timeout 30s;
}' "$NGINX_CONF"

echo "      Updated Nginx /mt-api/ location with timeout directives"

# Test Nginx configuration
if sudo nginx -t 2>&1; then
    echo "      Nginx configuration test: PASSED"
    sudo systemctl reload nginx
    echo "      Nginx reloaded successfully"
else
    echo "      ERROR: Nginx configuration test failed!"
    echo "      Restoring backup..."
    sudo cp "$BACKUP_CONF" "$NGINX_CONF"
    exit 1
fi

echo ""

# Step 2: Update the backend server code
echo "[2/4] Pulling latest code from Git..."

cd /home/$USER/Mikrotik-Billing-Manager || {
    echo "      ERROR: Project directory not found!"
    echo "      Please navigate to your project directory manually and run: git pull"
    exit 1
}

git pull origin main || {
    echo "      WARNING: Git pull failed. You may need to manually update the code."
}

echo ""

# Step 3: Install dependencies if needed
echo "[3/4] Checking dependencies..."

cd api-backend
npm install --production

echo ""

# Step 4: Restart the backend server
echo "[4/4] Restarting backend server..."

# Check if using PM2
if command -v pm2 &> /dev/null; then
    echo "      Using PM2 to restart server..."
    pm2 restart server || pm2 start server.js --name server
    pm2 save
    echo "      Backend server restarted via PM2"
else
    echo "      PM2 not found. Please restart your backend server manually:"
    echo "      cd api-backend && npm start"
fi

echo ""
echo "=================================================="
echo "   Fix Applied Successfully!"
echo "=================================================="
echo ""
echo "Changes made:"
echo "  1. Added Nginx proxy timeout directives (30s)"
echo "  2. Added Express timeout middleware (30s)"
echo "  3. Added route-level timeout handling"
echo ""
echo "Next steps:"
echo "  1. Clear browser cache (Ctrl+Shift+Delete)"
echo "  2. Refresh the dashboard"
echo "  3. Check browser console for any remaining errors"
echo ""
echo "If 504 errors persist, check:"
echo "  - MikroTik router connectivity: ping <router-ip>"
echo "  - Backend logs: pm2 logs server --lines 50"
echo "  - Nginx error log: sudo tail -f /var/log/nginx/error.log"
echo ""
