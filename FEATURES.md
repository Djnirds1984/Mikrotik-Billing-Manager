# 🚀 MikroTik Billing Manager - Complete Feature List

## Enterprise-Grade ISP Billing & Network Management System

A comprehensive, all-in-one solution designed for Internet Service Providers (ISPs), WISPs, and network operators who want to automate billing, manage customers, and control MikroTik infrastructure from a single, modern web dashboard.

---

## 💰 BILLING & PAYMENT SYSTEM

### Multi-Plan Billing Management
- **PPPoE Billing Plans** - Create customizable subscription plans with different speeds, pricing, and billing cycles (Monthly, Quarterly, Yearly)
- **DHCP Captive Portal Plans** - MAC-based billing with flexible activation periods
- **Multi-Currency Support** - Support for PHP, USD, and other currencies
- **Plan Profiles** - Link billing plans directly to MikroTik PPP profiles for automatic speed management
- **Store-Enabled Plans** - Mark plans as visible in customer-facing store for self-service purchases

### Payment Processing
- **PayMongo Integration** - Full integration with Philippines' leading payment gateway
  - Credit/Debit Card payments
  - GCash wallet payments
  - Maya wallet payments
  - GrabPay integration
  - QRPH (QR Code) payments
  - Instant payment confirmation & automatic service activation
- **Manual Payment Processing** - Accept offline payments (GCash transfers, bank deposits) with admin approval workflow
- **Automated Payment Reminders** - System automatically sends payment reminders before due dates
- **Grace Period Management** - Configurable grace periods before service suspension
- **Pro-rated Discounts** - Apply discounts for downtime or service interruptions
- **Payment Receipts** - Generate professional, branded printable receipts (standard & thermal printer formats)

### Customer Self-Service Store
- **Public-Facing Store Portal** - Customers can browse plans, login, and purchase subscriptions 24/7
- **Plan Filtering** - Filter plans by type (PPPoE/DHCP) and router
- **Session Persistence** - Secure session management across payment redirects
- **Purchase History** - Customers can view their payment history and invoices

---

## 👥 CUSTOMER MANAGEMENT

### PPPoE Customer Suite
- **Complete PPPoE Lifecycle** - Create, edit, and manage PPPoE users (secrets)
- **Customer Profiles** - Store customer information (name, account number, contact details, address)
- **Account Number System** - Unique account numbering for easy customer identification
- **Profile Management** - Manage speed limits, IP pools, and connection parameters
- **Server Management** - Configure multiple PPPoE server instances on different interfaces
- **Active Connections Monitor** - Real-time view of connected PPPoE users with traffic monitoring
- **Connection Traffic Graphs** - Live download/upload speed monitoring per user
- **Automatic Account Number Preservation** - Smart account number retention during edits
- **Customer Search & Filtering** - Quick search by username, account number, or name with highlight matching

### DHCP Captive Portal System
- **One-Click Installer** - Automatically deploys all firewall rules, scripts, and address lists
- **Client Management Dashboard** - View connected devices, distinguish between pending and active clients
- **MAC-Based Authentication** - Automatic device recognition and access control
- **Portal Page Editor** - Live HTML editor to customize the captive portal page with preview
- **Billing Integration** - Process payments and automatically set expiration dates
- **Server Management** - Configure and manage captive portal server settings

### Customer Self-Service Portal
- **Login Portal** - Customers can login to view their account status
- **Account Dashboard** - View current plan, due date, connection status
- **Payment History** - Access past invoices and payment receipts
- **Self-Service Payments** - Pay bills online via PayMongo or submit manual payment proofs
- **Repair Ticket System** - Submit and track support tickets directly from portal
- **Ticket Categories** - No Internet, Slow Connection, Intermittent, Line/Cable Issue, Other
- **Priority Levels** - Low, Normal, High, Urgent ticket prioritization
- **Session Persistence** - Stay logged in across payment gateway redirects

---

## 🤖 FACEBOOK MESSENGER BOT INTEGRATION

### Automated Customer Service Bot
- **24/7 Self-Service** - Customers manage their accounts via Facebook Messenger
- **Account Registration** - Customers link their Facebook account to their subscription
- **Bill Inquiry** - Customers type `BILL` to see current amount, due date, and days remaining
- **Status Check** - Type `STATUS` for full account information
- **Payment Options** - Type `PAY` for payment methods (Online or Manual GCash)
- **Online Payments** - Direct PayMongo checkout links via Messenger
- **Manual Payments** - Customers upload GCash payment screenshots for admin approval
- **Automatic Service Activation** - Payments automatically extend subscription

### Automated Payment Reminders
- **3 Days Before Due** - Friendly reminder sent automatically
- **1 Day Before Due** - Urgent notice
- **On Due Date** - Final warning
- **After Due Date** - Overdue alerts
- **Bulk Reminders** - Send reminders to all customers due within specified days with one click

### Broadcast Announcements
- **Mass Messaging** - Send announcements to ALL Facebook-linked customers
- **Personalized Messages** - Use `{name}` and `{account}` placeholders for personalized communication
- **Perfect For:**
  - Network maintenance notices
  - Emergency service alerts
  - Policy updates
  - Promotions and discounts
- **Delivery Tracking** - View success/failure status for each message

### Facebook Clients Dashboard
- **Linked Accounts Overview** - View all customers registered via Facebook
- **Statistics** - Total linked accounts, overdue, due today, due in 1-3 days
- **Individual Reminders** - Send reminder to specific customer with one click
- **Bulk Operations** - Bulk reminders and broadcast messaging

---

## 📊 DASHBOARD & MONITORING

### Real-Time System Monitoring
- **System Information** - Router model, uptime, version, free disk space
- **CPU & Memory Usage** - Real-time resource utilization with progress bars
- **Panel Host Status** - Monitor the Orange Pi/server running the management system
- **PPPoE Active Connections Count** - Quick view of total connected users

### Live Interface Traffic Monitoring
- **Multi-Interface Monitoring** - Add multiple network interfaces to monitor simultaneously
- **Real-Time Traffic Graphs** - Live download/upload speed visualization
- **EMA Smoothing** - Intelligent data smoothing to eliminate false spikes
- **Interface Status Control** - Enable/disable interfaces directly from dashboard
- **Auto-Polling** - Updates every 2 seconds for real-time visibility
- **Historical Data** - Track traffic patterns over time

---

## 🔧 NETWORK MANAGEMENT

### Complete MikroTik Integration
- **Multi-Router Support** - Manage multiple MikroTik routers from single dashboard
- **REST API & Legacy API** - Compatible with RouterOS v6 and v7
- **Router Configuration** - Store and manage router credentials securely
- **Router Selection** - Switch between routers instantly from top bar

### Firewall Management
- **Filter Rules** - View, create, edit, and delete firewall filter rules
- **NAT Rules** - Manage Network Address Translation rules
- **Mangle Rules** - Configure packet marking for QoS
- **User-Friendly Interface** - Simplified rule management without WinBox

### IP Services
- **IP Routes** - Manage static and dynamic routes
- **VLAN Management** - Create and manage VLAN interfaces
- **IP Pools** - Configure IP address pools for PPPoE and DHCP
- **DHCP Servers** - Full DHCP server management
  - Create/edit/delete DHCP servers
  - Configure lease times, address pools, interfaces
  - Manage DHCP leases (view, make static, delete)
  - One-click DHCP setup wizard
- **DHCP Leases** - Monitor active and static leases

### WAN Management
- **Multi-WAN Failover** - Configure and monitor WAN failover routes
- **Route Monitoring** - Real-time WAN route status
- **Gateway Monitoring** - Track gateway reachability
- **PCC/PBR Support** - AI-assisted multi-WAN script generation

### Bridge Management
- **Bridge Interfaces** - Create and manage bridge configurations
- **Port Management** - Add/remove bridge ports

---

## 🌐 HOTSPOT MANAGEMENT

### Hotspot User Management
- **Active Users Monitor** - View all currently logged-in hotspot users
- **User Details** - Username, IP, MAC, uptime, data usage (download/upload)
- **Kick Users** - Disconnect active users with one click
- **Host Monitoring** - View all connected devices (authorized, bypassed, guest)

### Hotspot Configuration
- **Server Profiles** - Create and manage hotspot server profiles
- **User Profiles** - Configure rate limits, shared users, transparent proxy
- **Login Page Editor** - Browse router filesystem and edit hotspot login pages directly
- **Setup Assistant** - Guided wizard to create new hotspot instances (similar to WinBox)
- **SSL Certificates** - Manage SSL certificates for HTTPS hotspot

### Vendo Integration (Piso WiFi)
- **NodeMCU Detection** - Automatically detects NodeMCU-based Piso WiFi machines
- **Embedded Management** - Manage vendo machines directly from dashboard
- **Income Tracking** - Track Piso WiFi income and reseller accounts
- **Reseller Management** - Manage Piso WiFi resellers and their accounts

---

## 🤖 AI SCRIPT ASSISTANT

### Google Gemini Integration
- **Natural Language to RouterOS** - Describe what you need in plain English, get RouterOS scripts
- **Specialized Assistants:**
  - Multi-WAN (PCC/PBR) setup scripts
  - Hotspot configuration scripts
  - Firewall rule generation
  - PPPoE setup scripts
  - And more...
- **Example Prompts** - Pre-built examples for common configurations
- **Copy to Clipboard** - One-click copy of generated scripts
- **Syntax Highlighting** - Color-coded RouterOS script display

---

## 💼 BUSINESS MANAGEMENT

### Sales & Revenue Tracking
- **Sales Records** - Track all billing transactions
- **Filterable Sales Report** - Filter by date range, customer, plan type
- **Revenue Summary** - Total sales, discounts applied, net revenue
- **Pro-rated Discounts** - Track discounts given for downtime
- **Multi-Router Sales** - View sales across all routers or per router
- **Sales Export** - Export sales data for accounting

### Accounting & Financial Management
- **Expense Tracker** - Record and categorize business expenses
- **Piso WiFi Income Manager** - Track Piso WiFi machine income
  - Daily income logging
  - Expense deduction (electricity, maintenance)
  - Net profit calculation
  - Reseller profit sharing
- **Cash Flow Analysis** - Daily, weekly, monthly financial breakdown
- **Financial Overview** - Total income, expenses, gross profit, net profit
- **All-Routers Summary** - Consolidated financial view across all routers
- **Client Invoices** - Track DHCP portal payments separately

### Inventory Management
- **Stock Tracking** - Monitor physical items (routers, antennas, cables, equipment)
- **Item Details** - Name, quantity, price, serial number
- **Low Stock Alerts** - Identify items running low
- **Inventory Updates** - Add, edit, delete inventory items
- **Serial Number Tracking** - Track equipment by serial number

### Payroll Management (Philippines-Compliant)
- **Employee Management** - Store employee information, roles, salary details
- **Salary Types** - Support for daily rate and monthly salary
- **Government Benefits Calculation:**
  - SSS (Social Security System) - 4.5% employee share, capped at ₱900/month
  - PhilHealth - 2.5% employee share, capped at ₱2,500/month
  - Pag-IBIG - 2% employee share, capped at ₱100/month
- **Daily Time Record (DTR)** - Log employee time-in/time-out
- **Hours Tracking** - Calculate hours worked per day
- **Payroll Calculation** - Automatic gross pay, deductions, net pay computation
- **Period-Based Payroll** - Calculate payroll for custom date ranges
- **Expense Integration** - Automatically record payroll as expense

---

## 🔐 SECURITY & ACCESS CONTROL

### Role-Based Access Control (RBAC)
- **Multi-User System** - Create multiple admin/employee accounts
- **Customizable Roles** - Administrator and Employee roles
- **Granular Permissions** - Control access to each feature/module
  - 25+ individual permissions for fine-grained control
  - View-level permissions (sidebar visibility)
- **Permission Management UI** - Visual permission editor with checkboxes
- **Administrator Role** - Full wildcard access to all features
- **Employee Role** - Customizable limited access for staff
- **Self-Delete Protection** - Users cannot delete their own accounts
- **Password Hashing** - Bcrypt encryption for all passwords
- **JWT Token Authentication** - Secure session management

### License System
- **Device Fingerprinting** - Hardware-based license validation
- **License Verification** - Automatic license status checking
- **Super Admin Panel** - Centralized license management
- **Unlicensed Mode** - Graceful degradation for unlicensed systems

---

## 🎨 CUSTOMIZATION & BRANDING

### Company Branding
- **Company Profile** - Set company name, address, contact number, email
- **Logo Upload** - Upload company logo (base64 storage)
- **Branded Receipts** - Company info automatically appears on all printable receipts
- **Custom Landing Page** - Branded public-facing landing page for customers
  - Customizable colors and theme
  - Company information display
  - Plan showcase
  - Inquiry form
  - Integrated AI chat widget

### UI Themes & Localization
- **Dark/Light Mode** - Toggle between dark and light themes
- **System Theme Detection** - Automatically follow OS theme preference
- **Multiple Color Themes** - Customize primary color scheme
- **Multi-Language Support:**
  - English
  - Filipino (Tagalog)
  - Spanish
  - Portuguese
- **Custom Currency Display** - Configure currency symbol for receipts and reports

---

## 🔌 REMOTE ACCESS & TUNNELING

### ZeroTier Integration
- **Network Management** - Create and manage ZeroTier networks
- **Node Management** - View and authorize connected nodes
- **Network Status** - Monitor ZeroTier network health

### ngrok Integration
- **Tunnel Management** - Create secure tunnels to expose local services
- **Tunnel Status** - Monitor active ngrok tunnels
- **Public URL Generation** - Get public URLs for remote access

### PiTunnel Integration
- **Remote SSH Access** - Secure remote access via PiTunnel
- **Tunnel Configuration** - Manage PiTunnel settings

### Dataplicity Integration
- **Remote Terminal** - Access router terminal remotely via Dataplicity
- **Tunnel Management** - Manage Dataplicity tunnels

### Cloudflare Tunnel
- **Cloudflare Integration** - Set up Cloudflare tunnels for secure access
- **Automatic Detection** - Detect Cloudflare environment variables

---

## 🛠️ SYSTEM ADMINISTRATION

### Terminal Access
- **Web-Based Terminal** - Full xterm.js terminal emulator
- **Router Terminal** - Access MikroTik router terminal directly from browser
- **Command History** - Terminal session history
- **Copy/Paste Support** - Easy command execution

### File Manager
- **Router File Browser** - Browse MikroTik router filesystem
- **File Editor** - Edit text-based configuration files directly
- **File Download** - Download files from router

### Database Management
- **Database Backup** - Create backups of panel configuration database
- **Database Restore** - Restore from backup files
- **Download Backups** - Export database backups for safekeeping

### System Updater
- **One-Click Updates** - Update system from Git repository
- **Automatic Backups** - Create backups before updating
- **Rollback Capability** - Rollback to previous version if update fails
- **GitHub Integration** - Pull updates from any GitHub repository
- **Branch Selection** - Choose which branch to pull from
- **Changelog Display** - View what changed before updating
- **Update Snapshots** - Manage update snapshots for rollback
- **Real-Time Update Logs** - Live streaming of update progress

### Log Viewer
- **Centralized Logs** - View logs from multiple sources
  - Router logs
  - Panel UI server logs
  - API backend server logs
  - Nginx logs
- **Real-Time Monitoring** - Live log streaming
- **Filter & Search** - Search logs for specific entries

---

## 📢 NOTIFICATIONS & ALERTS

### Telegram Notifications
- **Client Disconnected Alerts** - Get notified when PPPoE clients disconnect
- **Payment Due Reminders** - Receive alerts for customer payment due dates
- **System Alerts** - Monitor system health via Telegram
- **Configurable Alerts** - Enable/disable specific notification types

### In-App Notifications
- **Notification Center** - Centralized notification management
- **Real-Time Updates** - Live notification delivery
- **Notification History** - View past notifications

---

## 📋 COMPLIANCE & REPORTING

### NTC Compliance (Philippines)
- **RA 12234 Compliance** - Konektadong Pinoy Act framework
- **Automated Compliance Check** - Run comprehensive compliance audit
- **PDF Report Generation** - Download professional compliance reports
- **Dynamic Operator Branding** - Reports include your company branding
- **Security Audit** - Check network security configurations
- **Corporate-Grade PDF Layout** - Professional formatting for regulatory submission

---

## 🎯 REPAIR & SUPPORT TICKETS

### Ticket Management System
- **Create Tickets** - Admin and customers can create support tickets
- **Ticket Categories:**
  - No Internet
  - Slow Connection
  - Intermittent Connection
  - Line/Cable Issue
  - Other
- **Priority Levels:**
  - Low
  - Normal
  - High
  - Urgent
- **Status Tracking:**
  - Open
  - In Progress
  - Resolved
  - Closed
- **Admin Notes** - Add internal notes to tickets
- **Assignment** - Assign tickets to specific staff members
- **Customer Portal Integration** - Customers can submit and track tickets from their portal

---

## 🌐 PUBLIC-FACING PORTALS

### Landing Page
- **Branded Landing Page** - Customizable public homepage
- **Plan Showcase** - Display available internet plans
- **Inquiry Form** - Customer inquiry submission
- **AI Chat Widget** - Integrated AI-powered chat for customer inquiries
- **Contact Information** - Display company contact details
- **Custom Themes** - Match landing page to company branding

### Client Portal
- **Customer Login** - Secure authentication for customers
- **Account Dashboard** - View subscription details, due dates, status
- **Payment Processing** - Pay bills online or submit manual payments
- **Invoice History** - View and print past invoices
- **Repair Tickets** - Submit and track support requests
- **Connection Status** - Real-time PPPoE connection status

### Store Portal
- **Plan Browsing** - Customers can browse available plans
- **Customer Login** - Secure session management
- **Plan Purchase** - Self-service subscription purchase
- **Payment Methods** - PayMongo online or manual payment options
- **Filter by Type** - Filter plans by PPPoE or DHCP

---

## 🏗️ TECHNICAL ARCHITECTURE

### Two-Process Architecture
- **Frontend UI Server** (Port 3001) - Serves static files and user interface
- **API Backend Server** (Port 3002) - Handles all MikroTik API communication
- **Process Isolation** - API failures don't crash the UI
- **PM2 Process Management** - Production-ready process management with auto-restart

### Technology Stack
- **Frontend:**
  - React 19 with TypeScript
  - Vite build tool
  - TailwindCSS for styling
  - Chart.js & Recharts for data visualization
  - xterm.js for terminal emulation
- **Backend:**
  - Node.js with Express.js
  - SQLite database
  - JWT authentication
  - REST API architecture
- **AI Integration:**
  - Google Gemini API for script generation
- **Payment Gateway:**
  - PayMongo API integration
- **Deployment:**
  - Orange Pi / Single Board Computer optimized
  - Debian/Armbian compatible
  - Nginx reverse proxy support
  - PM2 process manager

### Performance & Reliability
- **Lazy Loading** - Components load on demand for fast initial load
- **Caching** - Intelligent caching for license status and sessions
- **Error Handling** - Graceful error handling throughout the system
- **API Timeout Protection** - Extended timeouts for large routers
- **Database Connection Pooling** - Efficient database queries
- **Responsive Design** - Works on desktop, tablet, and mobile devices

---

## 📱 MOBILE RESPONSIVE

- **Fully Responsive UI** - Optimized for all screen sizes
- **Mobile Sidebar** - Collapsible sidebar with overlay on mobile
- **Touch-Friendly Controls** - Large buttons and controls for touch screens
- **Adaptive Tables** - Horizontal scrolling tables on small screens
- **Mobile-Optimized Forms** - Easy data entry on mobile devices

---

## 🎁 BONUS FEATURES

### Application Form Generator
- **Customer Application Forms** - Generate PDF application forms
- **Document Management** - Store and manage customer applications

### Captive Chat System
- **Live Chat Widget** - Customer inquiry chat on landing page
- **Admin Reply Interface** - Respond to customer inquiries
- **Chat Thread History** - Persistent chat history with 5-second polling

### Bridge Manager
- **Bridge Configuration** - Create and manage network bridges
- **Port Assignment** - Add/remove bridge ports easily

### WAN Settings Panel
- **Multi-WAN Configuration** - Configure WAN interfaces and failover
- **Route Monitoring** - Monitor WAN route status and health

### Grace Period Management
- **Configurable Grace Periods** - Set grace periods for PPPoE and DHCP clients
- **Automatic Suspension** - Suspend service after grace period expires

---

## 🚀 DEPLOYMENT OPTIONS

### Orange Pi / Single Board Computer
- **Lightweight Design** - Optimized to run on Orange Pi and similar SBCs
- **Low Resource Usage** - Minimal CPU and memory footprint
- **Debian/Armbian Support** - Full compatibility with Debian-based OS

### Production Deployment
- **Nginx Reverse Proxy** - Standard web port 80 deployment
- **PM2 Process Manager** - Automatic restart on failure
- **Git-Based Updates** - Easy updates via git pull
- **Backup & Restore** - Full database backup and restore capability

### Cloud Deployment
- **Vercel Deployment** - Frontend deployment support
- **Ngrok Tunnels** - Temporary public access
- **ZeroTier Networks** - Secure VPN-based remote access
- **Cloudflare Tunnel** - Enterprise-grade secure access

---

## 📊 SCALABILITY

- **Multi-Router Support** - Manage unlimited MikroTik routers
- **Multi-User Access** - Create unlimited admin/employee accounts
- **Large Database Support** - Handles thousands of customers
- **High-Traffic Capable** - Optimized for busy ISP operations
- **Modular Architecture** - Easy to extend and customize

---

## 🛡️ SECURITY FEATURES

- **Password Hashing** - Bcrypt encryption for all passwords
- **JWT Authentication** - Secure token-based sessions
- **Role-Based Access Control** - Granular permission management
- **License Validation** - Hardware-fingerprinted licensing
- **Secure API Communication** - Protected API endpoints
- **Session Management** - Secure client portal sessions
- **Payment Security** - PCI-DSS compliant PayMongo integration

---

## 📞 SUPPORT & DOCUMENTATION

- **Built-In Help System** - Context-sensitive help for each module
- **Comprehensive Documentation** - Complete setup and usage guides
- **API Documentation** - Full API endpoint documentation
- **Customer Guides** - Ready-to-use customer onboarding materials
- **Update Logs** - Detailed changelogs for every update

---

## 💼 BUSINESS VALUE

### Time Savings
- **Automated Billing** - Eliminate manual billing processes
- **Self-Service Portal** - Reduce customer service calls by 70%
- **Payment Reminders** - Automate payment follow-ups
- **AI Script Generation** - Save hours on router configuration

### Revenue Protection
- **Faster Collections** - 30% reduction in overdue accounts
- **Automatic Suspension** - Suspend non-paying customers automatically
- **Payment Tracking** - Never miss a payment
- **Receipt Generation** - Professional receipts build trust

### Operational Efficiency
- **Centralized Management** - All routers, customers, billing in one place
- **Real-Time Monitoring** - Instant visibility into network status
- **Employee Access Control** - Safe delegation to staff
- **Compliance Reporting** - Meet regulatory requirements easily

### Customer Satisfaction
- **24/7 Self-Service** - Customers manage accounts anytime
- **Multiple Payment Options** - Pay online, GCash, manual
- **Transparent Billing** - Professional receipts and invoices
- **Fast Support** - Ticket system for issue tracking

---

## 🎯 IDEAL FOR

- Small to Medium Internet Service Providers (ISPs)
- Wireless ISPs (WISPs)
- Community Networks
- Piso WiFi Operators
- Building/Compound Internet Providers
- School/Office Network Administrators
- IT Service Providers managing multiple sites

---

## 📈 TYPICAL RESULTS

**After 30 Days of Use:**
- 60-80% reduction in manual billing time
- 40% decrease in customer service calls
- 30% faster payment collection
- 90% improvement in payment tracking accuracy
- Significant reduction in overdue accounts

---

## 🏆 WHAT MAKES US DIFFERENT

✅ **All-in-One Solution** - No need for multiple disconnected tools  
✅ **MikroTik Native** - Deep integration with RouterOS  
✅ **Automated Everything** - Billing, reminders, suspensions, activations  
✅ **Customer Self-Service** - 24/7 portal and Facebook bot  
✅ **Payment Gateway Ready** - PayMongo integration out of the box  
✅ **AI-Powered** - Smart script generation with Google Gemini  
✅ **Mobile Friendly** - Manage your ISP from anywhere  
✅ **Affordable** - Runs on low-cost Orange Pi hardware  
✅ **Professional** - Corporate-grade reports and receipts  
✅ **Scalable** - Grow from 10 to 10,000+ customers  

---

## 📞 GET STARTED TODAY

Transform your ISP business with the most comprehensive MikroTik billing and management system available.

**Contact us for:**
- Live demo
- Pricing information
- Custom deployment
- Training and onboarding
- Ongoing support

---

*This feature list is accurate as of the current version. Features are continuously added and improved based on customer feedback.*

**© 2024-2026 MikroTik Billing Manager by AJC**
