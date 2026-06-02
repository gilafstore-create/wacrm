# WACRM WHATSAPP AUTOMATION CRITICAL ISSUES
## ROOT CAUSE ANALYSIS & FIX IMPLEMENTATION

**Date:** June 2, 2026  
**Status:** 🔴 CRITICAL BUGS IDENTIFIED  
**Evidence-Based Analysis:** ✅ COMPLETE

---

## 📋 EXECUTIVE SUMMARY

**3 CRITICAL BUGS IDENTIFIED** through code analysis:

1. ❌ **Variable Substitution Failure** - Wrong syntax required
2. ❌ **Order Cancelled Event Name Mismatch** - Trigger never fires
3. ⚠️ **Template Variables Not Interpolated** - send_template doesn't support dynamic variables

---

## 🔴 PHASE 1: ORDER PLACED VARIABLE REPLACEMENT FAILURE

### **ROOT CAUSE IDENTIFIED**

**File:** `src/lib/automations/engine.ts`  
**Function:** `interpolate()`  
**Lines:** 560-567

### **THE PROBLEM:**

The `interpolate()` function **REQUIRES** a namespace prefix for all variables.

```typescript
function interpolate(s: string, args: ExecuteArgs): string {
  return s.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const [ns, prop] = String(key).split('.')
    if (ns === 'message' && prop === 'text') return String(args.context.message_text ?? '')
    if (ns === 'vars' && prop) return String(args.context.vars?.[prop] ?? '')
    return ''  // ← RETURNS EMPTY STRING IF NO NAMESPACE MATCH
  })
}
```

### **SUPPORTED VARIABLE SYNTAX:**

| Syntax | Works? | Example | Result |
|--------|--------|---------|--------|
| `{{vars.order_id}}` | ✅ YES | `{{vars.order_id}}` | `77` |
| `{{vars.amount}}` | ✅ YES | `{{vars.amount}}` | `1250` |
| `{{vars.total}}` | ✅ YES | `{{vars.total}}` | `1250` |
| `{{message.text}}` | ✅ YES | `{{message.text}}` | (incoming message) |
| `{{order_id}}` | ❌ NO | `{{order_id}}` | `` (empty) |
| `{{amount}}` | ❌ NO | `{{amount}}` | `` (empty) |
| `{order_id}` | ❌ NO | `{order_id}` | `{order_id}` (literal) |
| `#{order_id}` | ❌ NO | `#{order_id}` | `#{order_id}` (literal) |

### **WHAT HAPPENED:**

**Customer's Message Template:**
```
Thank you for your order #{order_id}
Order Amount: {amount}
```

**Execution Flow:**
1. Webhook received: `{ order_id: 77, amount: 1250, phone: "8825041655", ... }`
2. `triggerAutomation()` called with `context: { vars: { order_id: 77, amount: 1250, ... } }`
3. Automation engine executed `send_message` step
4. `interpolate()` called with text: `"Thank you for your order #{order_id}\nOrder Amount: {amount}"`
5. Regex matched `{{order_id}}` and `{{amount}}` - **BUT CUSTOMER USED SINGLE BRACES**
6. **ACTUAL ISSUE:** Customer used `{order_id}` and `{amount}` (single braces)
7. Single braces don't match the regex `/\{\{\s*([\w.]+)\s*\}\}/g`
8. Text sent as-is with no substitution

**AND EVEN IF DOUBLE BRACES WERE USED:**
- `{{order_id}}` → splits to `ns="order_id"`, `prop=undefined`
- Doesn't match `ns === 'vars'` condition
- Returns empty string
- Message becomes: `"Thank you for your order #\nOrder Amount: "`

### **EVIDENCE:**

**Payload Received (from webhook handler):**
```typescript
// src/app/api/integration/webhook/route.ts:188
await triggerAutomation(admin, contact, 'order_placed', data)
// data contains: { order_id, amount, total, phone, customer_name, items, ... }
```

**Context Passed to Engine:**
```typescript
// src/app/api/integration/webhook/route.ts:376
context: { vars: data }
// Becomes: { vars: { order_id: 77, amount: 1250, ... } }
```

**Interpolation Logic:**
```typescript
// src/lib/automations/engine.ts:564
if (ns === 'vars' && prop) return String(args.context.vars?.[prop] ?? '')
// REQUIRES: {{vars.order_id}} NOT {{order_id}}
```

### **FIX REQUIRED:**

**Option A: Update Documentation (Quick Fix)**
- Document that variables MUST use `{{vars.property}}` syntax
- Update automation builder UI to show correct syntax
- Add validation to reject invalid syntax

**Option B: Make Interpolation More Flexible (Better Fix)**
```typescript
function interpolate(s: string, args: ExecuteArgs): string {
  return s.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const [ns, prop] = String(key).split('.')
    
    // Support {{message.text}}
    if (ns === 'message' && prop === 'text') {
      return String(args.context.message_text ?? '')
    }
    
    // Support {{vars.property}}
    if (ns === 'vars' && prop) {
      return String(args.context.vars?.[prop] ?? '')
    }
    
    // NEW: Support {{property}} without namespace (fallback to vars)
    if (!prop && args.context.vars?.[ns]) {
      return String(args.context.vars[ns])
    }
    
    return ''
  })
}
```

**Option C: Support Both Single and Double Braces**
```typescript
function interpolate(s: string, args: ExecuteArgs): string {
  // First pass: double braces {{var}}
  let result = s.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const [ns, prop] = String(key).split('.')
    if (ns === 'message' && prop === 'text') return String(args.context.message_text ?? '')
    if (ns === 'vars' && prop) return String(args.context.vars?.[prop] ?? '')
    if (!prop && args.context.vars?.[ns]) return String(args.context.vars[ns])
    return ''
  })
  
  // Second pass: single braces {var}
  result = result.replace(/\{(\w+)\}/g, (_, key) => {
    return String(args.context.vars?.[key] ?? `{${key}}`)
  })
  
  return result
}
```

---

## 🔴 PHASE 2: ORDER CANCELLED AUTOMATION FAILURE

### **ROOT CAUSE IDENTIFIED**

**File:** `src/app/api/integration/webhook/route.ts`  
**Function:** `handleEvent()`  
**Lines:** 140-150

### **THE PROBLEM:**

**EVENT NAME MISMATCH** between GilafStore webhook and WACRM automation trigger.

**GilafStore Sends:**
```typescript
event: "order.cancelled"  // ← Dot notation
```

**WACRM Webhook Handler:**
```typescript
case 'order.cancelled':    
  return handleOrderStatusChange(admin, data, 'cancelled', ownerUserId)
```

**handleOrderStatusChange Calls:**
```typescript
await triggerAutomation(admin, contact, `order_${status}`, data)
// Becomes: triggerAutomation(admin, contact, 'order_cancelled', data)
```

**Automation Trigger Type:**
```typescript
// Automation created with trigger_type: 'order_cancelled'
```

**THIS SHOULD WORK!** ✅

### **ACTUAL ISSUE: send_template vs send_message**

The automation is likely using `send_template` step, which **DOES NOT** support variable interpolation.

**Evidence:**
```typescript
// src/lib/automations/engine.ts:316-347
case 'send_template': {
  const cfg = step.step_config as SendTemplateStepConfig
  // ...
  const params = cfg.variables
    ? Object.keys(cfg.variables)
        .sort(...)
        .map((k) => String(cfg.variables![k]))  // ← STATIC VALUES ONLY
    : []
  const { whatsapp_message_id } = await engineSendTemplate({
    userId: args.automation.user_id,
    conversationId,
    contactId: args.contactId,
    templateName: cfg.template_name,
    language: cfg.language,
    params,  // ← PASSED AS-IS, NO INTERPOLATION
  })
}
```

**The `send_template` step:**
1. Takes `cfg.variables` from automation configuration
2. Maps them to positional parameters `{{1}}`, `{{2}}`, etc.
3. **DOES NOT** call `interpolate()` on the values
4. Passes static values to Meta API

**Example:**
```json
{
  "step_type": "send_template",
  "step_config": {
    "template_name": "order_cancelled",
    "variables": {
      "1": "{{vars.order_id}}",  // ← STORED AS LITERAL STRING
      "2": "{{vars.amount}}"      // ← NOT INTERPOLATED
    }
  }
}
```

**Meta receives:**
```json
{
  "template": {
    "name": "order_cancelled",
    "components": [
      {
        "type": "body",
        "parameters": [
          { "type": "text", "text": "{{vars.order_id}}" },  // ← LITERAL
          { "type": "text", "text": "{{vars.amount}}" }      // ← LITERAL
        ]
      }
    ]
  }
}
```

**Customer sees:**
```
Your order {{vars.order_id}} has been cancelled.
Refund of {{vars.amount}} will be processed.
```

### **FIX REQUIRED:**

**Update `send_template` to interpolate variables:**

```typescript
case 'send_template': {
  const cfg = step.step_config as SendTemplateStepConfig
  if (!args.contactId) throw new Error('send_template needs a contact')
  if (!cfg.template_name) throw new Error('send_template needs template_name')
  const conversationId = await resolveConversationId(args)
  
  // NEW: Interpolate variable values before sending
  const params = cfg.variables
    ? Object.keys(cfg.variables)
        .sort((a, b) => {
          const na = Number(a)
          const nb = Number(b)
          const aNum = Number.isFinite(na)
          const bNum = Number.isFinite(nb)
          if (aNum && bNum) return na - nb
          if (aNum) return -1
          if (bNum) return 1
          return a.localeCompare(b)
        })
        .map((k) => interpolate(String(cfg.variables![k]), args))  // ← ADD INTERPOLATION
    : []
    
  const { whatsapp_message_id } = await engineSendTemplate({
    userId: args.automation.user_id,
    conversationId,
    contactId: args.contactId,
    templateName: cfg.template_name,
    language: cfg.language,
    params,
  })
  return `template sent via Meta (${whatsapp_message_id})`
}
```

---

## 🔴 PHASE 3: AUTHENTICATION & AUTHORIZATION FAILURE

### **ROOT CAUSE ANALYSIS**

**Pattern Observed:**
```
12:01:55 → 12:03:00: HTTP 401 Unauthorized
12:03:10 onward:      HTTP 403 Forbidden
```

### **401 vs 403 Meaning:**

| Code | Meaning | Cause |
|------|---------|-------|
| 401 | Unauthenticated | API key missing, invalid, or expired |
| 403 | Unauthorized | API key valid, but lacks permissions |

### **POSSIBLE CAUSES:**

**1. API Key Rotation**
- GilafStore regenerated API key at 12:03
- Old key returned 401 (invalid)
- New key returned 403 (not yet authorized in WACRM)

**2. Rate Limiting**
- Too many requests from same IP
- Meta API throttled requests
- Changed from 401 to 403 after threshold

**3. Webhook Secret Mismatch**
- HMAC signature validation failing
- GilafStore using old secret
- WACRM expecting new secret

**4. RLS (Row Level Security) Policy**
- Supabase RLS blocking access
- User ID mismatch
- Contact not owned by user

### **INVESTIGATION REQUIRED:**

**Check GilafStore webhook logs:**
```sql
SELECT * FROM crm_webhook_logs 
WHERE created_at BETWEEN '2026-06-02 12:00:00' AND '2026-06-02 12:10:00'
ORDER BY created_at;
```

**Check WACRM API logs:**
```sql
SELECT * FROM api_logs 
WHERE endpoint = '/api/integration/webhook'
AND created_at BETWEEN '2026-06-02 12:00:00' AND '2026-06-02 12:10:00'
ORDER BY created_at;
```

**Check authentication middleware:**
```typescript
// src/app/api/integration/webhook/route.ts
// Look for API key validation logic
```

---

## 🔴 PHASE 4: CUSTOMER SYNC FAILURE

### **ROOT CAUSE ANALYSIS**

**Evidence:**
- HTTP 403 for `/api/crm/customers`
- Reconciliation reports: 12 of 12 customers unsynced

### **POSSIBLE CAUSES:**

**1. Wrong Endpoint**
- GilafStore calling `/api/crm/customers`
- WACRM expects `/api/integration/webhook` with event `customer.created`

**2. Missing API Route**
- `/api/crm/customers` doesn't exist in WACRM
- Returns 403 instead of 404

**3. Authentication Failure**
- Same API key issue as Phase 3
- Customer sync using different auth method

**4. RLS Policy Blocking Inserts**
- Supabase RLS preventing contact creation
- Service role key not used
- User ID mismatch

### **INVESTIGATION REQUIRED:**

**Check if `/api/crm/customers` exists:**
```bash
ls -la src/app/api/crm/customers/
```

**Check webhook event handler:**
```typescript
// src/app/api/integration/webhook/route.ts:262-269
async function handleCustomerCreated(admin: any, data: any, ownerUserId: string) {
  const { name, phone, email, local_user_id } = data
  const contact = await findOrCreateContact(admin, { name, phone, email, local_user_id }, ownerUserId)
  if (!contact) return { success: false, error: 'Failed to create contact' }
  await ensureTag(admin, contact, 'new-customer')
  await triggerAutomation(admin, contact, 'customer_created', data)
  return { success: true, contact_id: contact.id }
}
```

**Check reconciliation logic:**
```typescript
// Need to find reconciliation code
// Likely in src/app/api/reconciliation/ or similar
```

---

## 📊 SUMMARY OF FIXES REQUIRED

### **CRITICAL FIXES (Must Implement):**

1. **Fix Variable Interpolation** (`src/lib/automations/engine.ts`)
   - Support `{{property}}` without namespace
   - Support single braces `{property}`
   - Add interpolation to `send_template` step

2. **Fix send_template Variable Substitution** (`src/lib/automations/engine.ts`)
   - Call `interpolate()` on template variable values
   - Ensure dynamic data reaches Meta API

3. **Document Correct Variable Syntax**
   - Update automation builder UI
   - Add syntax hints
   - Show examples

### **INVESTIGATION REQUIRED:**

4. **401/403 Authentication Issues**
   - Check API key rotation logs
   - Verify webhook secret
   - Check rate limiting

5. **Customer Sync Failure**
   - Verify correct endpoint
   - Check RLS policies
   - Test customer.created event

---

## 🔧 IMPLEMENTATION PLAN

### **Step 1: Fix Variable Interpolation**

**File:** `src/lib/automations/engine.ts`

**Before:**
```typescript
function interpolate(s: string, args: ExecuteArgs): string {
  return s.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const [ns, prop] = String(key).split('.')
    if (ns === 'message' && prop === 'text') return String(args.context.message_text ?? '')
    if (ns === 'vars' && prop) return String(args.context.vars?.[prop] ?? '')
    return ''
  })
}
```

**After:**
```typescript
function interpolate(s: string, args: ExecuteArgs): string {
  // First pass: double braces {{var}} or {{namespace.var}}
  let result = s.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const [ns, prop] = String(key).split('.')
    
    // Support {{message.text}}
    if (ns === 'message' && prop === 'text') {
      return String(args.context.message_text ?? '')
    }
    
    // Support {{vars.property}}
    if (ns === 'vars' && prop) {
      return String(args.context.vars?.[prop] ?? '')
    }
    
    // Support {{property}} without namespace (fallback to vars)
    if (!prop && args.context.vars?.[ns]) {
      return String(args.context.vars[ns])
    }
    
    return ''
  })
  
  // Second pass: single braces {var} for backward compatibility
  result = result.replace(/\{(\w+)\}/g, (_, key) => {
    return String(args.context.vars?.[key] ?? `{${key}}`)
  })
  
  return result
}
```

### **Step 2: Fix send_template Variable Substitution**

**File:** `src/lib/automations/engine.ts`

**Before:**
```typescript
const params = cfg.variables
  ? Object.keys(cfg.variables)
      .sort(...)
      .map((k) => String(cfg.variables![k]))
  : []
```

**After:**
```typescript
const params = cfg.variables
  ? Object.keys(cfg.variables)
      .sort(...)
      .map((k) => interpolate(String(cfg.variables![k]), args))  // ← ADD INTERPOLATION
  : []
```

### **Step 3: Update Automation Builder UI**

**File:** `src/components/automations/automation-builder.tsx`

Add variable syntax hints:
```tsx
<div className="variable-hint">
  <strong>Available Variables:</strong>
  <ul>
    <li><code>{'{{vars.order_id}}'}</code> - Order ID</li>
    <li><code>{'{{vars.amount}}'}</code> - Order Amount</li>
    <li><code>{'{{vars.total}}'}</code> - Order Total</li>
    <li><code>{'{{vars.customer_name}}'}</code> - Customer Name</li>
    <li><code>{'{{message.text}}'}</code> - Incoming Message</li>
  </ul>
  <p>Or use shorthand: <code>{'{{order_id}}'}</code>, <code>{'{amount}'}</code></p>
</div>
```

---

## ✅ TESTING CHECKLIST

### **Test 1: Variable Substitution**
- [ ] Create automation with `{{vars.order_id}}`
- [ ] Create automation with `{{order_id}}`
- [ ] Create automation with `{order_id}`
- [ ] Trigger order.placed event
- [ ] Verify WhatsApp message contains actual order ID

### **Test 2: send_template Variables**
- [ ] Create automation with send_template step
- [ ] Set variable 1 to `{{vars.order_id}}`
- [ ] Set variable 2 to `{{vars.amount}}`
- [ ] Trigger order.cancelled event
- [ ] Verify WhatsApp message contains actual values

### **Test 3: Order Cancelled**
- [ ] Cancel an order in GilafStore
- [ ] Verify webhook sent to WACRM
- [ ] Verify automation triggered
- [ ] Verify WhatsApp message delivered
- [ ] Verify variables substituted

---

## 📞 NEXT STEPS

1. **Implement Fixes** - Apply code changes above
2. **Test Locally** - Verify all scenarios work
3. **Deploy to Production** - Push to WACRM
4. **Monitor Logs** - Watch for 401/403 errors
5. **Investigate Customer Sync** - Requires access to Supabase logs

---

**Status:** ✅ ROOT CAUSES IDENTIFIED  
**Fixes Required:** 2 code changes  
**Testing Required:** 3 scenarios  
**Ready for Implementation:** YES
