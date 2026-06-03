# WACRM CRITICAL ISSUES - ROOT CAUSE INVESTIGATION
**Date:** June 3, 2026  
**Status:** 🔍 INVESTIGATION IN PROGRESS

---

## 📋 ISSUES SUMMARY

| # | Issue | Status | Severity |
|---|-------|--------|----------|
| 1 | Contact page 404 | ⚠️ USER ERROR | Low |
| 2 | Website integration delete button missing | 🔍 INVESTIGATING | Medium |
| 3 | HTTP 403 from /api/crm/customers | 🔍 INVESTIGATING | High |
| 4 | Template sync failures | 🔍 INVESTIGATING | High |
| 5 | Flow creation "Flow not found" bug | 🔍 INVESTIGATING | Critical |

---

## 🔴 ISSUE #1: Contact Page 404

### **USER REPORT:**
```
URL: https://wacrm-wbjb.onrender.com/contacts
Error: 404 - This page could not be found
```

### **ROOT CAUSE: INCORRECT URL**

**File:** `src/app/(dashboard)/dashboard/contacts/page.tsx`

**Correct URL:** `/dashboard/contacts` (NOT `/contacts`)

**Explanation:**
- Next.js App Router uses file-based routing
- File location: `src/app/(dashboard)/dashboard/contacts/page.tsx`
- Route groups `(dashboard)` are ignored in URL
- Resulting URL: `/dashboard/contacts`

### **SOLUTION:**
✅ **NO CODE CHANGE NEEDED** - User should use correct URL:
```
https://wacrm-wbjb.onrender.com/dashboard/contacts
```

### **VERIFICATION:**
The contacts page exists and is functional at the correct route.

---

## 🔴 ISSUE #2: Website Integration Delete Button Missing

### **USER REPORT:**
```
Location: Website Integration card
Issue: Delete button not visible
```

### **INVESTIGATION REQUIRED:**

**Files to check:**
1. `src/app/(dashboard)/integrations/page.tsx` - Main integrations page
2. `src/app/(dashboard)/integrations/enterprise/page.tsx` - Enterprise integrations
3. `src/components/integrations/*` - Integration card components

**Search for:**
- Website integration card rendering
- Delete button implementation
- Recent changes that may have hidden the button

**Next Steps:**
- [ ] Locate website integration card component
- [ ] Check if delete button exists in code
- [ ] Verify CSS/conditional rendering
- [ ] Check user permissions/RLS

---

## 🔴 ISSUE #3: HTTP 403 from /api/crm/customers

### **USER REPORT:**
```
Endpoint: /api/crm/customers
Error: HTTP 403 Forbidden
Context: Inside website integration
```

### **INVESTIGATION REQUIRED:**

**Possible Causes:**

1. **Endpoint doesn't exist**
   - Check if `/api/crm/customers` route exists
   - May be wrong endpoint name

2. **Authentication failure**
   - API key invalid or missing
   - HMAC signature mismatch
   - Session expired

3. **Authorization failure**
   - RLS policy blocking access
   - User lacks permissions
   - Organization mismatch

4. **CORS issue**
   - Cross-origin request blocked
   - Missing CORS headers

**Files to check:**
```
src/app/api/crm/customers/route.ts (if exists)
src/app/api/integration/webhook/route.ts (alternative endpoint)
```

**Next Steps:**
- [ ] Search for `/api/crm/customers` endpoint
- [ ] Check if it should be `/api/integration/webhook` instead
- [ ] Review authentication middleware
- [ ] Check RLS policies on contacts table
- [ ] Review API logs for exact error

---

## 🔴 ISSUE #4: Template Sync Failures

### **USER REPORT:**
```
Failed to sync:
- order_confirmation (en_US)
- gilaf_login_otp (en_US)
- hello_world (en_US)
```

### **INVESTIGATION REQUIRED:**

**Possible Causes:**

1. **Meta API authentication failure**
   - Access token expired
   - Phone number ID invalid
   - WhatsApp Business Account suspended

2. **Template not approved by Meta**
   - Templates pending review
   - Templates rejected
   - Templates deleted from Meta

3. **Network/API error**
   - Meta API rate limiting
   - Network timeout
   - Invalid API response

4. **Database sync issue**
   - Templates exist in Meta but not in DB
   - Sync logic broken
   - RLS blocking insert

**Files to check:**
```
src/app/api/whatsapp/templates/sync/route.ts
src/lib/whatsapp/meta-api.ts
src/components/whatsapp/template-sync.tsx
```

**Next Steps:**
- [ ] Check Meta API credentials
- [ ] Verify templates exist in Meta Business Manager
- [ ] Check template approval status
- [ ] Review sync endpoint logs
- [ ] Test Meta API connection manually

---

## 🔴 ISSUE #5: Flow Creation "Flow not found" Bug ⚠️ CRITICAL

### **USER REPORT:**
```
Steps to reproduce:
1. Go to Flows > New Flow > Create Blank Flow
2. App redirects to /flows/{uuid}
3. Immediately shows "Flow not found"

Expected: Flow editor should open
Actual: 404 error
```

### **ROOT CAUSE ANALYSIS:**

**Files involved:**
1. `src/app/(dashboard)/flows/page.tsx` - Flows list page
2. `src/app/(dashboard)/flows/[id]/page.tsx` - Flow editor page
3. `src/app/api/flows/[id]/route.ts` - Flow API endpoint
4. `src/components/flows/flow-editor-shell.tsx` - Editor shell

### **INVESTIGATION FINDINGS:**

#### **Flow Editor Page Logic:**
```typescript
// src/app/(dashboard)/flows/[id]/page.tsx:32-63
useEffect(() => {
  if (!params.id) return;
  let cancelled = false;
  (async () => {
    try {
      const res = await fetch(`/api/flows/${params.id}`);
      if (res.status === 404) {
        if (!cancelled) setNotFound(true);  // ← SHOWS "Flow not found"
        return;
      }
      // ...
    }
  })();
}, [params.id]);
```

#### **API Endpoint Logic:**
```typescript
// src/app/api/flows/[id]/route.ts:39-46
const { data: flow } = await supabase
  .from('flows')
  .select('id')
  .eq('id', flowId)
  .maybeSingle()
if (!flow) {
  return { ok: false, status: 404, body: { error: 'Not found' } }  // ← RETURNS 404
}
```

### **POSSIBLE ROOT CAUSES:**

1. **Flow not inserted into database**
   - Create button doesn't call insert
   - Insert fails silently
   - Transaction rollback

2. **Timing issue (race condition)**
   - Redirect happens before insert completes
   - Database replication lag
   - Cache not updated

3. **RLS policy blocking SELECT**
   - Flow inserted but user can't read it
   - organization_id mismatch
   - user_id not set correctly

4. **Wrong UUID used**
   - Frontend generates UUID
   - Backend generates different UUID
   - Redirect uses wrong ID

### **INVESTIGATION TASKS:**

**1. Find Create Flow Button Handler**
```bash
# Search for flow creation logic
grep -r "Create.*Flow\|createFlow\|new.*flow" src/app/(dashboard)/flows/
grep -r "flows.*insert\|insert.*flow" src/
```

**2. Check flows table schema**
```sql
-- Need to verify:
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'flows'
ORDER BY ordinal_position;
```

**3. Check RLS policies**
```sql
-- Verify INSERT and SELECT policies
SELECT * FROM pg_policies WHERE tablename = 'flows';
```

**4. Check flow creation API**
```bash
# Search for POST /api/flows endpoint
find src/app/api -name "route.ts" | xargs grep -l "POST"
```

### **EXPECTED FLOW:**

```
User clicks "Create Blank Flow"
  ↓
Frontend calls POST /api/flows
  ↓
Backend inserts into flows table
  {
    id: uuid,
    user_id: current_user_id,
    organization_id: current_org_id,
    name: "Untitled Flow",
    trigger_type: null,
    is_active: false
  }
  ↓
Backend returns { id: uuid }
  ↓
Frontend redirects to /flows/{uuid}
  ↓
Flow editor fetches GET /api/flows/{uuid}
  ↓
Flow found → Editor loads
```

### **ACTUAL FLOW (BROKEN):**

```
User clicks "Create Blank Flow"
  ↓
??? (Unknown what happens)
  ↓
Frontend redirects to /flows/{uuid}
  ↓
Flow editor fetches GET /api/flows/{uuid}
  ↓
404 Not Found → "Flow not found" error
```

### **DEBUGGING STEPS:**

1. **Add console logging to create button:**
```typescript
console.log('Creating flow...');
const response = await fetch('/api/flows', { method: 'POST', ... });
console.log('Flow created:', response);
const { id } = await response.json();
console.log('Redirecting to:', id);
router.push(`/flows/${id}`);
```

2. **Add logging to API endpoint:**
```typescript
console.log('INSERT flow:', { user_id, organization_id, name });
const { data, error } = await supabase.from('flows').insert(...);
console.log('INSERT result:', { data, error });
```

3. **Check browser network tab:**
- Verify POST /api/flows is called
- Check response status and body
- Verify redirect URL matches inserted ID

4. **Check Supabase logs:**
- Look for INSERT errors
- Check RLS policy violations
- Verify organization_id is set

---

## 🔧 NEXT STEPS

### **Immediate Actions:**

1. **Issue #1 (Contacts 404):**
   - ✅ Inform user of correct URL: `/dashboard/contacts`

2. **Issue #2 (Delete button):**
   - [ ] Search for integration card component
   - [ ] Verify delete button exists
   - [ ] Check if hidden by CSS or conditional

3. **Issue #3 (HTTP 403):**
   - [ ] Search for `/api/crm/customers` endpoint
   - [ ] Check if endpoint exists or if wrong URL
   - [ ] Review authentication logic

4. **Issue #4 (Template sync):**
   - [ ] Check Meta API credentials
   - [ ] Verify template approval status
   - [ ] Test sync endpoint manually

5. **Issue #5 (Flow creation):** ⚠️ **PRIORITY**
   - [ ] Find create flow button handler
   - [ ] Trace flow creation API call
   - [ ] Add debug logging
   - [ ] Check database schema
   - [ ] Verify RLS policies

### **Files to Search:**

```bash
# Issue #2: Delete button
find src -name "*.tsx" | xargs grep -l "integration.*delete\|delete.*integration"

# Issue #3: CRM customers endpoint
find src/app/api -name "route.ts" | xargs grep -l "crm.*customer\|customer.*crm"

# Issue #4: Template sync
find src -name "*.ts" -o -name "*.tsx" | xargs grep -l "template.*sync\|sync.*template"

# Issue #5: Flow creation
find src -name "*.tsx" | xargs grep -l "create.*flow\|new.*flow"
find src/app/api -name "route.ts" | xargs grep -l "POST.*flow"
```

---

## 📊 PRIORITY ORDER

1. **🔴 CRITICAL:** Issue #5 - Flow creation bug (blocks core feature)
2. **🟠 HIGH:** Issue #3 - HTTP 403 (integration broken)
3. **🟠 HIGH:** Issue #4 - Template sync (WhatsApp broken)
4. **🟡 MEDIUM:** Issue #2 - Delete button (UX issue)
5. **🟢 LOW:** Issue #1 - Contacts 404 (user error)

---

**Status:** Investigation document created  
**Next:** Search codebase for specific files and implement fixes
