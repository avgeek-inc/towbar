---
title: "Team access"
description: "Set up Admin, Member and Viewer access, invitations, personal keys, MFA, and transactional email."
---

Towbar v2 has one team per installation. The person completing setup becomes an Admin. Team Settings is available to Admins; My Settings is available to every signed-in user.

## Roles

| Capability                                                                   | Admin | Member | Viewer         |
| ---------------------------------------------------------------------------- | ----- | ------ | -------------- |
| Read operational inventory, deployment history, monitoring and redacted logs | Yes   | Yes    | Yes            |
| Manage repositories and sync inventory                                       | Yes   | Yes    | No             |
| Update declared secret values and shared-secret references                   | Yes   | Yes    | No             |
| Configure Scout Agent and alert rules                                        | Yes   | Yes    | No             |
| Deploy, operate workloads, prepare servers, back up or restore               | Yes   | No     | No             |
| Authorize GitHub/GitLab connections and manage SSH keys                      | Yes   | No     | No             |
| Reveal stored workload secrets after recent authentication                   | Yes   | No     | No             |
| Manage members, invitations, team settings and team API keys                 | Yes   | No     | No             |
| Secure own account and manage own personal API keys                          | Yes   | Yes    | Read-only keys |

Members manage repository configuration and inventory. Syncing as a Member and changing branch mappings pauses runtime automation. An Admin reviews the synchronized mapping under the repository's Auto-deploy settings before enabling deployment, preview and scheduled-backup automation. Removing a repository connection does not authorize runtime cleanup.

Secrets can be changed without revealing their existing values. Members can preserve masked values or replace them and can use shared references; they cannot reveal or export stored secrets. Viewers do not see secret-management pages.

For step-by-step dashboard instructions, see [Team settings](/docs/team-settings), [Personal settings](/docs/personal-settings), and [SSH keys](/docs/ssh-keys).

## Add people

Under **Manage → Team Settings → Members**, choose **Create invite**, enter the recipient's email and select Admin, Member or Viewer. Invitations expire after seven days. Copying a link does not bypass mailbox verification: a new recipient requests a one-time email code before creating their account and password. Existing accounts sign in with the invited email and accept without changing their password.

Resend creates a replacement invitation. Revoking an invitation or demoting/removing its inviting Admin invalidates pending invitations and cancels their queued mail. Opening a link for preview does not consume it. Delivery status means SMTP acceptance, not confirmed inbox delivery.

For an installation without working SMTP, **Add user** creates an account with a temporary password. Share the password through a separate secure channel. The person must replace it before accessing the dashboard or creating keys. Towbar never emails that password and does not mark an admin-provisioned email as verified.

There must always be at least one active Admin. Removing a member revokes their sessions and personal keys. Operational history and audit attribution remain. Rejoining does not reactivate old keys.

## Personal and team keys

Open **My Settings → API Keys** for your own keys. Admins manage team keys under **Team Settings → API Keys**, and stored SSH keys under **Team Settings → SSH keys**. The MCP Guide is in My Settings; the REST reference is on this documentation site.

- Personal keys are constrained by their saved grants and the owner's current role. Demotion immediately narrows their stored permissions. Promotion does not restore removed grants; create a replacement key when broader access is needed.
- Team keys represent the team and survive the creator leaving. All Admins can view and revoke them.
- Choose Read-only or Edit. Only Admins can include administrative permissions with Edit. Viewers are limited to Read-only. Stored credential reveal and account/key creation are never API or MCP operations.
- Keys expire after 90 days by default. Only Admins can choose no expiry. Copy the token when creating it: Towbar cannot show it again. Replace with an overlapping key, verify the consumer, then revoke the old key.

Queued operations retain their requesting identity and permissions. Towbar rechecks authority before starting effects; a role change or revoked key can prevent pending work. Work already performed cannot be undone by key revocation. Automatic GitHub and maintenance work uses narrow system authority and current repository/environment controls.

## Account security

Under **My Settings**, use Profile for your display name, Email & Password for sign-in details, Sessions for active sessions, and **Two-factor Auth** for authenticator apps, recovery codes, and passkeys. Store recovery codes separately; each code is single-use. Admins should enable MFA.

Passwords require 15–1,024 characters. Password managers and paste are supported. Password creation checks the Have I Been Pwned corpus using only a five-character SHA-1 prefix, padded responses and a five-second deadline; the full password and hash are not sent. Corpus outages fail the change with a retry message. The offline escape hatch `TOWBAR_PASSWORD_BREACH_CHECK=false` disables that check explicitly; keep it enabled for internet-connected deployments.

Forgot password sends a short-lived, single-use link when SMTP is configured. Responses do not disclose whether an email exists. A successful reset revokes sessions and requires normal sign-in. Use the [local recovery command](/docs/self-hosting/account-recovery) if email or the authenticator is unavailable.

## Transactional email

Configure SMTP in `TOWBAR_NOTIFICATION_CONFIG_JSON` and restart the API. Port 465 usually uses implicit TLS; a submission port such as 587 uses STARTTLS. Towbar requires encrypted delivery and validates the server certificate. The SMTP hostname must resolve to public addresses; private network relays are not supported by this transport.

Use a verified sender domain and apply the SMTP provider's SPF, DKIM and DMARC instructions. Test the SMTP configuration and an invitation with a mailbox you control before relying on password recovery. Notification category recipients control deployment/incident mail; account and team messages always use their server-selected recipients and are independent of those categories. The subject prefix is fixed to `[Towbar]`.

Mail requests are committed with team changes in an encrypted outbox. Temporal receives only the outbox ID. Workers retry bounded transient failures and recover abandoned leases. Invitation/reset material is removed after delivery, expiry or cancellation. SMTP can accept a message before a connection fails, so an ambiguous retry can produce duplicate mail. Do not interpret a Sent status as a delivery guarantee.

### Email changes and passkeys

Profile contains your display name. Email & Password has separate email and password forms. Request a confirmation link for the new email; the current sign-in address stays active until confirmation. Links expire after one hour, work once, and are invalidated by a replacement request or cancellation. Confirmation signs out all browser sessions and sends a security notice to the old address. Configure the SMTP runtime provider to deliver these messages.

Authenticator setup opens the QR code directly after a recent sign-in. Activation requires a valid code. Replacing recovery codes or disabling the authenticator requires a current code and is rate-limited. Sensitive account changes require authentication within the last ten minutes; older sessions use the shared confirmation dialog.

Passkeys use WebAuthn with device verification required, such as a PIN or biometric check. Register, rename, and remove them under **My Settings → Two-factor Auth**, and use them as a second factor after signing in with your email and password. If both an authenticator and a passkey are configured, users can choose either method. Set `TOWBAR_APP_BASE_URL` to the stable HTTPS origin users visit: this determines the WebAuthn relying-party domain. Localhost is supported for development. Changing that domain requires registering new passkeys. A password reset does not bypass a configured second factor.

Team Settings opens General first, followed by Members and API Keys. Admins can edit member names and roles, add users with a temporary password, and confirm before resending or revoking an invitation. User email changes are verified through the user's Email & Password page.
