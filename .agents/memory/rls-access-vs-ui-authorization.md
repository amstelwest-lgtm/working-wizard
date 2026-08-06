---
name: RLS row access is not the same as UI authorization
description: A route/RLS policy that grants read access to multiple roles does not mean every role should see every control on that route.
---
When a route or RLS policy is scoped to "anyone with access to this record" (e.g. a
`has_client_access` check covering owners, members, and serving accountants/firm-admins),
that only proves the viewer may load the page/data. It says nothing about which role-gated
actions should be visible on that page.

**Why it matters:** a shared detail route reused by multiple roles (e.g. an
accountant-facing client detail page that owners/members can also reach because RLS lets
them read their own client record) will otherwise render accountant-only controls
(approve/sign-off/edit-privileged-field buttons) to a role that can see them but whose
writes are separately blocked server-side — a real UI/security smell even if the backend
ultimately rejects the mutation.

**How to apply:** on any route reachable by more than one role, gate privileged UI
elements on an explicit client-side role check (fetch the viewer's role, e.g. from
`user_roles`) in addition to whatever RLS enforces server-side. Don't infer "safe to show
this button" from "this route didn't redirect me away".
