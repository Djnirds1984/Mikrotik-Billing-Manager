# Panel Roles & Permissions System - Complete Documentation

## 📋 Overview

The Panel Roles system is a **Role-Based Access Control (RBAC)** implementation that manages:
1. **Panel Users** - Secondary admin/employee accounts (separate from main admin)
2. **Roles** - User roles with descriptive names (Administrator, Employee)
3. **Permissions** - Granular access control to specific features/views
4. **Role-Permission Mapping** - Which permissions each role has

---

## 🏗️ Architecture

### **Database Schema**

```sql
-- Roles table
roles (
    id TEXT PRIMARY KEY,          -- 'role_admin', 'role_employee'
    name TEXT,                    -- 'Administrator', 'Employee'
    description TEXT              -- 'Full access to all features'
)

-- Permissions table
permissions (
    id TEXT PRIMARY KEY,          -- 'perm_sidebar_dashboard'
    name TEXT,                    -- 'view:sidebar:dashboard'
    description TEXT              -- 'View Dashboard'
)

-- Role-Permission mapping (many-to-many)
role_permissions (
    role_id TEXT,                 -- Foreign key to roles.id
    permission_id TEXT,           -- Foreign key to permissions.id
    PRIMARY KEY (role_id, permission_id)
)

-- Panel users
users (
    id TEXT PRIMARY KEY,          -- 'user_1234567890_abc'
    username TEXT UNIQUE,         -- Login username
    password TEXT,                -- Bcrypt hashed
    role_id TEXT                  -- Foreign key to roles.id
)
```

---

## 🎯 Current Implementation

### **1. Default Roles**

| Role ID | Name | Description | Default Permissions |
|---------|------|-------------|---------------------|
| `role_admin` | Administrator | Full access to all features | `*:*` (wildcard - all permissions) |
| `role_employee` | Employee | Limited access | Manually assigned via UI |

### **2. Permission Naming Convention**

All permissions follow the pattern: `view:sidebar:{feature_id}`

Examples:
- `view:sidebar:dashboard` - Access to Dashboard
- `view:sidebar:pppoe` - Access to PPPoE management
- `view:sidebar:sales` - Access to Sales Reports
- `view:sidebar:panel_roles` - Access to Panel Roles page
- `*:*` - Wildcard (Administrator only)

### **3. Complete Permission List**

Currently defined permissions (from `proxy/server.js` lines 198-224):

```javascript
// Sidebar/View Permissions
perm_sidebar_dashboard        → view:sidebar:dashboard
perm_sidebar_notifications    → view:sidebar:notifications
perm_sidebar_captive_chat     → view:sidebar:captive_chat
perm_sidebar_application_form → view:sidebar:application_form
perm_sidebar_scripting        → view:sidebar:scripting
perm_sidebar_terminal         → view:sidebar:terminal
perm_sidebar_routers          → view:sidebar:routers
perm_sidebar_network          → view:sidebar:network
perm_sidebar_dhcp-portal      → view:sidebar:dhcp-portal
perm_sidebar_pppoe            → view:sidebar:pppoe
perm_sidebar_billing          → view:sidebar:billing
perm_sidebar_sales            → view:sidebar:sales
perm_sidebar_inventory        → view:sidebar:inventory
perm_sidebar_accounting       → view:sidebar:accounting
perm_sidebar_payroll          → view:sidebar:payroll
perm_sidebar_hotspot          → view:sidebar:hotspot
perm_sidebar_remote           → view:sidebar:remote
perm_sidebar_mikrotik_files   → view:sidebar:mikrotik_files
perm_sidebar_company          → view:sidebar:company
perm_sidebar_system           → view:sidebar:system
perm_sidebar_panel_roles      → view:sidebar:panel_roles
perm_sidebar_client_portal_users → view:sidebar:client_portal_users
perm_sidebar_updater          → view:sidebar:updater
perm_sidebar_logs             → view:sidebar:logs
perm_sidebar_license          → view:sidebar:license
perm_sidebar_super_admin      → view:sidebar:super_admin
```

---

## 🔄 How It Works

### **User Flow**

```
1. Admin logs in with main account
   ↓
2. Goes to "Panel Roles" page
   ↓
3. Creates Employee user (username, password, role)
   ↓
4. Employee logs in with credentials
   ↓
5. System checks role → loads permissions
   ↓
6. Sidebar filters views based on permissions
   ↓
7. Employee sees only allowed features
```

### **Permission Check Flow**

```typescript
// In AuthContext.tsx
const hasPermission = (permission: string) => {
    if (!user || !user.permissions) return false;
    
    // Admin has wildcard - always true
    if (user.permissions.includes('*:*')) return true;
    
    // Check specific permission
    return user.permissions.includes(permission);
};

// In Sidebar.tsx
const filteredNavItems = navItems.filter(item => {
    // Special cases
    if (item.id === 'super_admin' && !isSuperadmin) return false;
    if (item.id === 'panel_roles' && !isAdmin && !isSuperadmin) return false;
    
    // Check permission
    const permName = `view:sidebar:${item.id}`;
    return hasPermission(permName);
});
```

---

## 🎨 UI Components

### **PanelRoles.tsx** - Two Main Sections

#### **Section 1: Panel Users Management**
```
┌─────────────────────────────────────────────────┐
│ Panel Users                                     │
├─────────────────────────────────────────────────┤
│ Add User Form:                                  │
│ [Username____] [Password____] [Role ▼] [Add]   │
├─────────────────────────────────────────────────┤
│ Username        Role          Actions           │
│ john_doe        Administrator  [🗑️ Delete]      │
│ jane_smith      Employee       [🗑️ Delete]      │
└─────────────────────────────────────────────────┘
```

**Features:**
- Add new panel user (username, password, role selection)
- Delete existing users (cannot delete yourself)
- View user list with role badges

#### **Section 2: Role Permissions**
```
┌─────────────────────────────────────────────────┐
│ Role Permissions                                │
├─────────────────────────────────────────────────┤
│ Administrator                                   │
│ Full access to all panel features.              │
│ [Locked - no edit button]                       │
│                                                 │
│ Employee                                        │
│ Limited access for day-to-day operations.       │
│                            [✏️ Edit Permissions] │
└─────────────────────────────────────────────────┘
```

**Features:**
- View all roles with descriptions
- Edit permissions for non-admin roles (click ✏️)
- Administrator role is locked (always has `*:*`)

#### **Permissions Modal** (when editing a role)
```
┌─────────────────────────────────────────────────┐
│ Edit Permissions for "Employee"                 │
├─────────────────────────────────────────────────┤
│ ☐ view:sidebar:dashboard                        │
│   View Dashboard                                │
│                                                 │
│ ☑ view:sidebar:pppoe                            │
│   View PPPoE management                         │
│                                                 │
│ ☑ view:sidebar:sales                            │
│   View Sales Reports                            │
│                                                 │
│ ☐ view:sidebar:panel_roles                      │
│   View Panel Roles                              │
│                                                 │
│         [Cancel]        [Save Permissions]      │
└─────────────────────────────────────────────────┘
```

**Features:**
- Checkbox list of all available permissions
- Toggle permissions on/off
- Save updates role_permissions table
- On save: verifies token to refresh user session

---

## 🔌 API Endpoints

### **All routes require authentication** (`protect` middleware)

| Method | Endpoint | Description | Body |
|--------|----------|-------------|------|
| GET | `/api/roles` | Get all roles | - |
| GET | `/api/permissions` | Get all permissions | - |
| GET | `/api/panel-users` | Get all panel users | - |
| POST | `/api/panel-users` | Create new panel user | `{username, password, role_id}` |
| DELETE | `/api/panel-users/:id` | Delete panel user | - |
| GET | `/api/roles/:roleId/permissions` | Get role's permissions | - |
| PUT | `/api/roles/:roleId/permissions` | Update role permissions | `{permissionIds: [...]}` |

---

## 🔐 Security Features

### **1. Password Hashing**
```javascript
const hashedPassword = await bcrypt.hash(password, 10);
```

### **2. JWT Token with Permissions**
```javascript
const token = jwt.sign({
    id: userId,
    username,
    role: { name: 'Employee' },
    permissions: ['view:sidebar:pppoe', 'view:sidebar:sales']
}, SECRET_KEY);
```

### **3. Self-Delete Protection**
```javascript
if (req.user.id === userId) {
    return res.status(403).json({ 
        message: 'You cannot delete your own account.' 
    });
}
```

### **4. Admin-Only Panel Roles Access**
```typescript
// Sidebar.tsx line 106
if (item.id === 'panel_roles' && !isAdmin && !isSuperadmin) return false;
```

---

## 📊 Current Issues & Limitations

### **❌ Problems:**

1. **No Action-Level Permissions**
   - Current: Only controls VIEW access (sidebar visibility)
   - Missing: Cannot control CREATE, UPDATE, DELETE actions
   - Example: Employee can view PPPoE but cannot be prevented from deleting users

2. **Hardcoded Admin Check**
   ```typescript
   // Panel Roles page only visible to admins
   if (item.id === 'panel_roles' && !isAdmin && !isSuperadmin) return false;
   ```
   - This bypasses the permission system
   - Should use `view:sidebar:panel_roles` permission instead

3. **No Permission Groups**
   - All permissions are flat list
   - Hard to manage (25+ checkboxes)
   - Should group by feature (e.g., "PPPoE", "Sales", "Billing")

4. **No Audit Trail**
   - No logging of who changed permissions
   - No history of permission modifications

5. **Employee Role Starts Empty**
   - New employee has NO permissions by default
   - Admin must manually enable each permission
   - Should have sensible defaults (e.g., dashboard, pppoe view)

6. **No Bulk Operations**
   - Cannot "Select All" permissions
   - Cannot copy permissions from one role to another
   - Cannot create custom roles (only Administrator/Employee)

7. **Permission Name Confusion**
   - Uses both `perm_sidebar_*` IDs and `view:sidebar:*` names
   - Redundant naming scheme
   - Could be simplified

---

## 💡 Recommended Improvements

### **Phase 1: UI/UX Enhancements**

1. **Permission Groups**
   ```
   ☑ PPPoE Management
     ☑ view:sidebar:pppoe
     ☐ action:pppoe:delete
     ☐ action:pppoe:create
   
   ☑ Sales Reports
     ☑ view:sidebar:sales
     ☑ action:sales:delete
     ☐ action:sales:export
   ```

2. **Quick Presets**
   - "Read-Only Employee" - View only, no deletions
   - "Sales Staff" - Sales + PPPoE view
   - "Technician" - PPPoE + Routers + Terminal
   - "Full Employee" - All except admin features

3. **Permission Search/Filter**
   - Search box to find permissions quickly
   - Filter by category

### **Phase 2: Action-Level Permissions**

Add new permission types:
```javascript
// CRUD permissions per feature
'action:pppoe:create'     // Can create PPPoE users
'action:pppoe:update'     // Can edit PPPoE users
'action:pppoe:delete'     // Can delete PPPoE users
'action:sales:delete'     // Can delete sales records
'action:sales:export'     // Can export sales data
'action:billing:update'   // Can modify billing plans
```

### **Phase 3: Advanced Features**

1. **Custom Roles**
   - Create unlimited roles (not just Admin/Employee)
   - Role templates

2. **Permission Inheritance**
   ```
   Manager Role
   └─ Inherits: Employee permissions
   └─ Adds: Delete permissions, Reports
   ```

3. **Time-Based Access**
   - Employee can only access during work hours
   - Temporary access grants

4. **Audit Logging**
   - Track permission changes
   - Track user logins
   - Track failed access attempts

5. **Permission Testing**
   - "Preview as Employee" button
   - See what a role can access

---

## 🚀 Quick Start Guide

### **For Administrators:**

1. **Add an Employee:**
   - Go to Panel Roles page
   - Enter username & password
   - Select "Employee" role
   - Click "Add User"

2. **Set Employee Permissions:**
   - Scroll to "Role Permissions"
   - Click ✏️ next to "Employee"
   - Check the features they can access
   - Click "Save Permissions"

3. **Employee Login:**
   - Employee uses username/password
   - Sees only permitted features in sidebar
   - Cannot access Panel Roles page

### **For Employees:**

1. **Login:**
   - Use credentials provided by admin
   - See limited sidebar

2. **Access:**
   - Only views with permissions are visible
   - Cannot access admin features

---

## 📝 Example Scenarios

### **Scenario 1: Sales Staff Employee**

**Permissions to Enable:**
- ✅ view:sidebar:dashboard
- ✅ view:sidebar:pppoe (view client info)
- ✅ view:sidebar:sales (view/add sales)
- ✅ view:sidebar:billing (view plans)

**Result:**
- Employee sees: Dashboard, PPPoE, Sales, Billing
- Employee cannot: Delete users, access settings, view panel roles

### **Scenario 2: Network Technician**

**Permissions to Enable:**
- ✅ view:sidebar:dashboard
- ✅ view:sidebar:pppoe (full access)
- ✅ view:sidebar:routers
- ✅ view:sidebar:network
- ✅ view:sidebar:terminal

**Result:**
- Employee sees: Dashboard, PPPoE, Routers, Network, Terminal
- Cannot: Access sales, billing, settings

---

## 🔧 Technical Details

### **File Locations:**

| Component | File Path | Purpose |
|-----------|-----------|---------|
| UI Component | `components/PanelRoles.tsx` | Frontend management interface |
| Auth Context | `contexts/AuthContext.tsx` | Permission checking logic |
| Sidebar Filter | `components/Sidebar.tsx` | Filter menu items by permissions |
| API Routes | `proxy/server.js` (lines 5160-5180) | Backend API endpoints |
| Database Init | `proxy/server.js` (lines 177-224) | Schema & seed data |
| Auth Routes | `proxy/server.js` (lines 698-722) | Login/register with permissions |

### **Key Functions:**

```typescript
// Check permission (AuthContext.tsx:185)
hasPermission(permission: string): boolean

// Filter sidebar items (Sidebar.tsx:99-110)
filteredNavItems = navItems.filter(item => {
    const permName = `view:sidebar:${item.id}`;
    return hasPermission(permName);
});

// Load permissions on login (proxy/server.js:646-659)
const perms = await db.all(`
    SELECT p.name 
    FROM permissions p
    JOIN role_permissions rp ON p.id = rp.permission_id
    WHERE rp.role_id = ?
`, user.roleId);
```

---

## 🎯 Summary

**Current State:**
- ✅ Basic RBAC working
- ✅ View-level permissions functional
- ✅ Admin/Employee roles established
- ✅ Sidebar filtering by permissions

**Needs Improvement:**
- ❌ No action-level permissions (create/update/delete)
- ❌ Hardcoded admin checks bypass permission system
- ❌ No permission grouping or search
- ❌ No custom roles (only 2 hardcoded)
- ❌ Employee starts with zero permissions
- ❌ No audit trail or logging

**Recommendation:**
Start with Phase 1 (UI improvements) to make the system more usable, then add action-level permissions in Phase 2 for granular control.
