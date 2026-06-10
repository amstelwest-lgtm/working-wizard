---
name: user_roles table schema
description: Correct column names for the user_roles Supabase table
---

The `user_roles` table has `role` as the column name, NOT `app_role`.

```
user_roles: {
  id: string
  user_id: string
  role: "accountant" | "firm_admin" | "client_owner" | "client_member"
  created_at: string
}
```

**Why:** TypeScript error `SelectQueryError<"column 'app_role' does not exist">` was the clue — the Supabase enum is named `app_role` but the column in `user_roles` is named `role`.

**How to apply:** Always query `.select("role")` not `.select("app_role")` on `user_roles`.
