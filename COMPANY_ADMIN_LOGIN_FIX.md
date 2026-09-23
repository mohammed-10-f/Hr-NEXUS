# Company Admin Login Fix

This patch keeps the existing HR Nexus architecture and D1 database.

Changes:
- Company login now matches company identifier case-insensitively.
- Company login accepts either username or employee ID, matching the existing UI wording.
- Account status/company status are handled explicitly before password verification.
- Failed-password attempts still increment the existing lock counter.
- Company-user password reset now also restores `status='active'`, clears lock state, and keeps `must_change_password=1`.
- Login redirects directly to the mandatory password-change page when the API reports `mustChangePassword`.
- Password-change completion redirects to the dashboard without requiring a manual refresh.

Important: the password itself is never stored in plaintext. Reset uses the existing PBKDF2 hashing implementation.
