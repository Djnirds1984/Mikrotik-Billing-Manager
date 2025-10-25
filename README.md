# Mikrotik Billling Management by AJC

A modern, responsive web dashboard for managing your MikroTik routers, specifically designed to be lightweight enough to run on an Orange Pi or similar single-board computer. It features a real-time monitoring dashboard and a powerful AI Script Assistant powered by the Google Gemini API.

![Screenshot of the Mikrotik Billling Management by AJC Dashboard](./screenshot.png)

## Features

-   **Dashboard & Monitoring:** Real-time system info, resource usage (CPU/Memory), and live interface traffic graphs for both the panel host and the selected MikroTik router.

-   **AI Script Assistant:** Powered by Google Gemini, generates RouterOS terminal scripts from plain English descriptions. Includes specialized assistants for Multi-WAN (PCC/PBR) and Hotspot setups.

-   **PPPoE Suite:** Full lifecycle management for PPPoE services, including:
    -   **Users (Secrets):** Create, edit, and delete PPPoE user accounts.
    -   **Profiles:** Manage speed limits and IP pools for different user tiers.
    -   **Servers:** Configure and manage PPPoE server instances on router interfaces.

-   **DHCP Captive Portal:** A complete MAC-based "activate before internet" system.
    -   **One-Click Installer:** Automatically deploys all necessary firewall rules, scripts, and address lists.
    -   **Client Management:** View connected devices, distinguish between `pending` and `active` clients, and manage their state.
    -   **Billing Integration:** Create dedicated billing plans (e.g., 30 days for $10), process payments, and automatically set expiration dates.
    -   **Portal Page Editor:** A live HTML editor to customize the page that pending users see, complete with a live preview.

-   **Hotspot Management:**
    -   Monitor active users and all connected device hosts.
    -   Full CRUD management for Hotspot Server Profiles and User Profiles.
    -   **Vendo Integration:** Automatically detects and provides an embedded management interface for NodeMCU-based "Piso WiFi" vendo machines.
    -   **Login Page Editor:** Browse the router's file system and edit Hotspot login pages directly from the UI.
    -   **Setup Assistant:** A guided wizard to create new Hotspot instances, similar to the WinBox setup tool.

-   **Billing & Sales System:**
    -   Create distinct billing plans for both PPPoE and DHCP Portal services.
    -   Process payments, apply pro-rated discounts for downtime, and automatically schedule user deactivation on expiry.
    -   Generate and print professional, branded receipts for every transaction.
    -   A filterable **Sales Report** tracks all transactions and provides a summary of revenue, sales, and discounts.

-   **Inventory & Expenses:**
    -   A simple stock and inventory manager to keep track of physical items (e.g., antennas, routers, cables).
    -   An integrated expense tracker for basic accounting and financial overview.

-   **Payroll Management:**
    -   Manage a list of employees, including their personal information, role, and salary details.
    -   Track Philippine-specific government benefits (SSS, PhilHealth, Pag-IBIG).
    -   Includes a Daily Time Record (DTR) manager to log employee work hours for accurate payroll calculation.

-   **Comprehensive Network Tools:**
    -   **Firewall:** A user-friendly interface for managing Filter, NAT, and Mangle rules.
    -   **IP Services:** Manage IP Routes, VLANs, IP Pools, and DHCP Servers.
    -   **WAN Management:** A dedicated interface for monitoring and managing WAN failover routes.

-   **Remote Access & System Administration:**
    -   **ZeroTier & Ngrok:** Integrated management for both services to easily configure secure remote access to your panel.
    -   **Panel Updater:** One-click updates from a Git repository, with automatic application backups and rollback capability.
    -   **Database Management:** Create, download, and restore backups of the panel's configuration database.
    -   **Log Viewer:** A centralized place to view logs from the router, the panel's UI and API servers, and Nginx.
    -   **File Editor:** A general-purpose tool to browse the MikroTik router's filesystem and edit text-based files.

-   **Multi-User & Security:**
    -   Features a robust role-based access control (RBAC) system.
    -   Create multiple user accounts with distinct "Administrator" or "Employee" roles.
    -   Customize permissions for roles to restrict access to sensitive features like deleting sales records.
    -   Includes a secure account recovery system using security questions.

-   **Customization:**
    -   **Company Branding:** Set your company name, logo, and contact details, which automatically appear on printable receipts.
    -   **Theming & Localization:** Switch between light/dark modes, multiple color themes, and several languages for the UI.

## Technical Architecture

To improve stability and reliability, this project uses a **two-process architecture**.

1.  **Frontend UI Server (`mikrotik-manager`):** This is a lightweight Node.js/Express server. Its primary job is to serve the static frontend files (HTML, CSS, JavaScript) that make up the user interface. It runs on port **3001**.
2.  **API Backend Server (`mikrotik-api-backend`):** This is a separate, dedicated Node.js/Express server that acts as a proxy to the official **MikroTik REST API**. It handles all communication with your routers. This separation means that if an API request fails, it will not crash the user interface. It runs on port **3002**.

This two-process model provides a robust separation of concerns, ensuring the application remains stable and responsive.

---

## Deployment Guide (Orange Pi / Debian)

This is the recommended way to run the panel in a production environment in your user's home directory.

### 1. Prerequisites

-   An Orange Pi or similar SBC running a Debian-based OS (like Armbian) with SSH access.
-   **Node.js v20.x or newer.**
-   **Essential Tools:** `git`, `pm2`, and `build-essential`.
    ```bash
    sudo apt-get update
    sudo apt-get install -y git build-essential
    sudo npm install -g pm2
    ```
-   **(Optional) Gemini API Key**: For the "AI Scripting" feature to work, you need a Google Gemini API key.
    1.  Get your key from [Google AI Studio](https://aistudio.google.com/app/apikey).
    2.  Open the `env.js` file and replace `"YOUR_GEMINI_API_KEY_HERE"` with your actual key.

### 2. MikroTik Router Configuration

-   **Enable API:** This panel supports both the modern **REST API** (RouterOS v7+) and the **legacy API** (RouterOS v6).
    -   **REST API (v7+):** Enable the `www` or `www-ssl` service. The default port for `www` is 80 and for `www-ssl` is 443.
    -   **Legacy API (v6):** Enable the `api` or `api-ssl` service. The default port for `api` is 8728 and for `api-ssl` is 8729.
    -   It is recommended to create a dedicated user group with appropriate permissions for the API user.

-   **Enable ZeroTier Package (Optional):** For the ZeroTier Management feature to work, ensure the `zerotier` package is installed and enabled on your router.
    ```routeros
    /zerotier set enabled=yes
    ```

### 3. Installation & Startup

1.  **Clone the Repository:**
    ```bash
    git clone https://github.com/Djnirds1984/Mikrotik-Billing-Manager.git
    cd Mikrotik-Billing-Manager
    ```

2.  **Install Dependencies:**
    Run these commands from the project's **root directory** to install packages for both servers.
    ```bash
    # Install for UI Server (proxy)
    npm install --prefix proxy
   
    # Install for API Backend Server
    npm install --prefix api-backend
    ```

3.  **Start with PM2:**
    These commands start both servers as persistent, named processes.
    ```bash
    # First, stop and delete any old running processes to ensure a clean start.
    # This only removes apps from PM2's list, it does NOT delete your files.
    pm2 delete all

    # Start the UI server (port 3001)
    pm2 start ./proxy/server.js --name mikrotik-manager

    # Start the API backend (port 3002)
    pm2 start ./api-backend/server.js --name mikrotik-api-backend
    ```

4.  **Save the Process List:**
    This ensures `pm2` will automatically restart your applications on server reboot.
    ```bash
    pm2 save
    ```

5.  **Access the Panel:**
    Open your browser and navigate to `http://<your_orange_pi_ip>:3001`.

---

## Advanced Deployment with Nginx

For a more robust setup, you can run the panel on the standard web port 80 using Nginx as a reverse proxy. This is the recommended method for a production server.

**[See the full Nginx Deployment Guide here](./DEPLOYMENT_GUIDE.md)**

---

## Updating the Panel

You can update the panel directly from the "Updater" page in the UI. If you need to update manually via the command line:

1.  **Navigate to the project directory:**
    ```bash
    cd /path/to/Mikrotik-Billing-Manager
    ```
2.  **Pull the latest changes:**
    ```bash
    git pull
    ```
3.  **Re-install dependencies** in case they have changed:
    ```bash
    npm install --prefix proxy
    npm install --prefix api-backend
    ```
4.  **Restart the servers** to apply the updates:
    ```bash
    pm2 restart all
    ```

---

## Troubleshooting

### API Requests are Failing

If you can see the UI but data from the router isn't loading, it's likely an issue with the API backend server.

-   **Check the logs:** Run `pm2 logs mikrotik-api-backend`. Look for connection errors or crashes.
-   **Verify Router Config:** In the "Routers" page, double-check that the IP address, username, password, and **port** for your router are correct.
-   **Firewall:** Ensure your router's firewall is not blocking access to the API port from the Orange Pi's IP address.

### AI Features Not Working

If you get an error about an "Invalid API Key", ensure you have correctly pasted your Google Gemini API key into the `env.js` file and have saved the changes. You may need to restart the `mikrotik-manager` process (`pm2 restart mikrotik-manager`) for the change to take effect.