# Facebook Messenger Bot API Documentation

## Overview

The Facebook Messenger Bot integration allows PPPoE customers to register, check billing status, make payments, and receive automated notifications via Facebook Messenger. All communications use Facebook's Graph API with PSID (Page-Scoped ID) for secure 1:1 account binding.

---

## Base URL

```
https://billing.ajcvendosystem.com/api/facebook
```

---

## Authentication

All API endpoints require Bearer token authentication:

```
Authorization: Bearer <authToken>
```

---

## API Endpoints

### 1. Get All Facebook-Linked Clients

**Endpoint:** `GET /api/facebook/clients`

**Description:** Retrieve all PPPoE customers registered via Facebook Messenger.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `routerId` | string | No | Filter clients by specific router |

**Response:**
```json
[
  {
    "id": "cust_123",
    "accountNumber": "ACC-9269908544",
    "username": "pppoe_user1",
    "fullName": "Aldrin",
    "facebook_psid": "1234567890",
    "planName": "Testplan",
    "dueDate": "2026-08-07",
    "planType": "Postpaid",
    "routerId": "router_1",
    "contactNumber": "+639123456789",
    "email": "user@example.com",
    "address": "123 Main St"
  }
]
```

**Example:**
```bash
curl -X GET "https://billing.ajcvendosystem.com/api/facebook/clients" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

### 2. Send Payment Reminder to Single Client

**Endpoint:** `POST /api/facebook/clients/:id/remind`

**Description:** Send a personalized payment reminder to a specific Facebook-linked client.

**Path Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | Customer ID |

**Request Body:**
```json
{}
```

**Response:**
```json
{
  "message": "Reminder sent successfully",
  "facebook_message_id": "mid_1234567890",
  "days_until_due": -2
}
```

**Message Variants:**
- **Overdue:** Includes warning about service suspension
- **Due Today:** Urgent payment request
- **Due in 1-3 Days:** Friendly reminder
- **Upcoming:** Payment notification

**Example:**
```bash
curl -X POST "https://billing.ajcvendosystem.com/api/facebook/clients/cust_123/remind" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

### 3. Send Bulk Payment Reminders

**Endpoint:** `POST /api/facebook/clients/remind-bulk`

**Description:** Send payment reminders to all clients due within specified days.

**Request Body:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `daysBefore` | number | No | Days before due date (default: 3) |
| `routerId` | string | No | Limit to specific router |

**Example Request:**
```json
{
  "daysBefore": 3,
  "routerId": "router_1"
}
```

**Response:**
```json
{
  "message": "Reminders sent to 15 clients",
  "total": 15,
  "sent": 14,
  "failed": 1,
  "results": [
    {
      "accountNumber": "ACC-9269908544",
      "facebook_psid": "1234567890",
      "status": "sent",
      "days_until_due": 2
    },
    {
      "accountNumber": "ACC-1234567890",
      "facebook_psid": "0987654321",
      "status": "failed",
      "error": "Facebook API error"
    }
  ]
}
```

**Example:**
```bash
curl -X POST "https://billing.ajcvendosystem.com/api/facebook/clients/remind-bulk" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"daysBefore": 3}'
```

---

### 4. Send Broadcast Announcement ⭐ NEW

**Endpoint:** `POST /api/facebook/clients/broadcast`

**Description:** Send a custom announcement to ALL Facebook-linked PPPoE clients. Perfect for network maintenance notifications, system updates, or general announcements.

**Request Body:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `message` | string | Yes | Announcement message (supports placeholders) |
| `routerId` | string | No | Limit to specific router |

**Available Placeholders:**
| Placeholder | Description |
|-------------|-------------|
| `{name}` | Customer's full name |
| `{account}` | Customer's account number |

**Example Request:**
```json
{
  "message": "🔧 NETWORK MAINTENANCE NOTICE\n\nDear {name},\n\nWe will be performing scheduled maintenance on your account {account} on December 15, 2024 from 2:00 AM to 4:00 AM.\n\nService may be temporarily interrupted during this period.\n\nThank you for your patience.\n- IT Department"
}
```

**Response:**
```json
{
  "message": "Broadcast sent",
  "total": 50,
  "sent": 48,
  "failed": 2,
  "results": [
    {
      "accountNumber": "ACC-9269908544",
      "facebook_psid": "1234567890",
      "status": "sent"
    },
    {
      "accountNumber": "ACC-1234567890",
      "facebook_psid": "0987654321",
      "status": "failed",
      "error": "Invalid PSID"
    }
  ]
}
```

**Example:**
```bash
curl -X POST "https://billing.ajcvendosystem.com/api/facebook/clients/broadcast" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Dear {name}, your account {account} has a payment due soon."
  }'
```

**Use Cases:**
- 🛠️ Network maintenance notifications
- 📢 System upgrades
- ⚠️ Emergency alerts
- 🎉 Promotional messages
- 📋 Policy updates

---

## Bot Commands (Facebook Messenger)

Customers can interact with the bot using these commands:

| Command | Description |
|---------|-------------|
| `BILL` | View current bill and due date |
| `STATUS` | Check account status |
| `PAY` | Make a payment (online or manual) |
| `PAY ONLINE` | Pay via PayMongo |
| `PAY MANUAL` | Pay via GCash manual transfer |
| `REGISTER` | Link Facebook account to PPPoE account |
| `UNREGISTER` | Unlink Facebook account |
| `HELP` | Show all available commands |
| `END` | Return to main menu |

---

## Automated Features

### 1. Auto Payment Reminders

**Schedule:** Daily at 9:00 AM

**Behavior:**
- Automatically scans all Facebook-linked clients
- Sends reminders to clients due within 3 days
- Messages are personalized based on urgency:
  - Overdue: Warning about suspension
  - Due today: Urgent payment request
  - 1-3 days: Friendly reminder

**Implementation:**
```javascript
// server.js - Line 7366
startFacebookReminderScheduler()
```

### 2. Account Linking

**Process:**
1. Customer sends `REGISTER` + account number
2. Bot validates account exists
3. Checks for existing Facebook bindings (1:1 policy)
4. Links `facebook_psid` to customer record
5. Sends confirmation with account details

**Security:**
- Strict 1:1 binding (one Facebook account = one PPPoE account)
- Automatic unlinking if re-registering to different account
- PSID uniqueness enforcement

---

## Database Schema

### Customers Table

```sql
CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE,
  routerId TEXT,
  fullName TEXT,
  address TEXT,
  contactNumber TEXT,
  email TEXT,
  accountNumber TEXT,
  gps TEXT,
  applicationId TEXT,
  dueDate TEXT,
  planName TEXT,
  planType TEXT,
  password TEXT,
  facebook_psid TEXT  -- Facebook Page-Scoped ID
);
```

---

## Error Handling

### Common Errors

| HTTP Status | Error Message | Description |
|-------------|---------------|-------------|
| 400 | `Message is required` | Empty broadcast message |
| 400 | `Facebook Messenger not configured` | Missing Facebook settings |
| 404 | `Customer not found or not linked to Facebook` | Invalid customer ID |
| 404 | `No Facebook-linked clients found` | No recipients for broadcast |
| 500 | `SQLITE_ERROR: ...` | Database error |

### Facebook API Errors

| Error Code | Description |
|------------|-------------|
| 2018001 | Invalid PSID |
| 100 | Recipient not found |
| 400 | Messaging type required |

---

## Configuration

### Facebook Settings

Store in `settings` table (id=1):

```json
{
  "facebookSettings": {
    "enabled": true,
    "pageAccessToken": "EAABwzLixnjYBO...",
    "verifyToken": "your_verify_token",
    "appId": "1234567890",
    "appSecret": "abc123...",
    "routerId": "router_1"
  }
}
```

### Environment Variables

```env
FACEBOOK_PAGE_ACCESS_TOKEN=EAABwzLixnjYBO...
FACEBOOK_VERIFY_TOKEN=your_verify_token
```

---

## Best Practices

### 1. Message Formatting
- Use emojis for visual hierarchy
- Keep messages under 640 characters
- Include clear call-to-action
- Add account-specific details

### 2. Broadcast Timing
- Avoid late night hours (10 PM - 7 AM)
- Send maintenance notices 24-48 hours in advance
- Test with small group first

### 3. Error Recovery
- Monitor failed sends in response
- Retry failed messages manually
- Log all broadcast results

### 4. Rate Limiting
- Facebook API: 200 messages/second per page
- Implement delays between sends for large broadcasts
- Monitor response times

---

## Testing

### Test Broadcast with Single Client

```bash
# First, get client ID
curl -X GET "https://billing.ajcvendosystem.com/api/facebook/clients" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Send reminder to specific client
curl -X POST "https://billing.ajcvendosystem.com/api/facebook/clients/CLIENT_ID/remind" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Monitor Logs

```bash
pm2 logs mikrotik-manager --lines 50 | grep -i "facebook"
```

**Expected Log Output:**
```
[Facebook Broadcast] Sending announcement to all clients...
[Facebook Broadcast] Found 50 clients to notify
[Facebook Broadcast] ✓ Sent to ACC-9269908544 (Aldrin)
[Facebook Broadcast] ✗ Failed for ACC-1234567890: Invalid PSID
[Facebook Broadcast] Complete: 48 sent, 2 failed out of 50 total
```

---

## Security Considerations

1. **PSID Privacy**: Facebook PSIDs are page-scoped and cannot be used across different pages
2. **Authentication**: All admin endpoints require valid auth token
3. **Rate Limiting**: Implement delays to avoid Facebook API rate limits
4. **Message Validation**: Sanitize broadcast messages before sending
5. **Logging**: All sends are logged with results for auditing

---

## Troubleshooting

### Issue: Broadcast sends 0 messages

**Check:**
```bash
# Verify Facebook settings
sqlite3 database.sqlite "SELECT facebookSettings FROM settings WHERE id=1;"

# Check if clients have facebook_psid
sqlite3 database.sqlite "SELECT COUNT(*) FROM customers WHERE facebook_psid IS NOT NULL;"
```

### Issue: Messages fail with "Invalid PSID"

**Cause:** Facebook account unlinked or PSID expired

**Fix:**
- Ask customer to re-register via Messenger
- Check Facebook page access token validity

### Issue: Auto-reminders not sending

**Check:**
```bash
# Verify scheduler is running
pm2 logs mikrotik-manager | grep "Facebook Reminders"

# Check next scheduled run
# Should show: "[Facebook Reminders] First run in X hours"
```

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2024-12-01 | Initial Facebook Bot integration |
| 1.1.0 | 2024-12-08 | Added broadcast announcement feature |
| 1.1.1 | 2024-12-08 | Added placeholder personalization ({name}, {account}) |

---

## Support

For issues or questions:
- Check logs: `pm2 logs mikrotik-manager`
- Verify Facebook settings in admin panel
- Test with single client before broadcast
- Monitor Facebook Page inbox for delivery reports
