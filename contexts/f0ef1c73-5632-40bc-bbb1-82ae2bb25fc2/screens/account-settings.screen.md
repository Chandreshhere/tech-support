# My Account Settings Screen

- Accessed via User Settings → "My Account" (first item in the sidebar)

## Account Info Card (top section)
- User banner image (if set) at the top
- User avatar (large, circular) overlapping the banner
- Username + discriminator displayed
- "Edit User Profile" button

## Account Details Section
- **Display Name**: shows current name, "Edit" button on the right
- **Username**: shows current username, "Edit" button on the right
- **Email**: shows current email (partially masked), "Edit" button on the right
- **Phone Number**: shows current phone or "Add", "Edit" button on the right

## Password & Authentication Section
- "Change Password" button
  - Opens modal with: current password field, new password field, confirm new password field
- Two-Factor Authentication: "Enable" or "Disable" button
- "View Backup Codes" link (if 2FA is enabled)

## Account Removal Section (bottom)
- "Disable Account" button (outlined)
- "Delete Account" button (red)

## Email Change Flow (triggered by clicking "Edit" next to Email)

Changing the email address triggers a two-step verification flow. Both steps appear as overlay modals on top of the My Account page.

### Step 1 — "Verify email address" modal
**When you see this:** A modal with a hand-holding-envelope illustration, title "Verify email address", text like "We'll need to verify your old email address, <email>, in order to change it." Two buttons: **Cancel** and **Send Verification Code**.

**What to do:** Click **"Send Verification Code"**. This sends a code to the OLD email address. NO user input is needed here — just click the button and wait. Do NOT pause for user input at this step.

### Step 2 — "Enter code" modal
**When you see this:** A modal with the same illustration, title "Enter code", text "Check your email: we sent you a verification code. Enter it here to verify you're really you." A **Verification Code** text field (empty, focused), a "Didn't receive a code or it expired? Resend it." link, and a **Next** button.

**What to do:** PAUSE the task with `action: "pause"`, `reason: "otp"`, and message: "A verification code was sent to your old email address. Please check your inbox, enter the 6-digit code in the focused field, and click 'Next'." The user must type the code themselves — the agent cannot retrieve email.

### Step 3 — After code entry
After the user enters the code and clicks **Next**, Discord shows the new email input field. Type the new email address there and confirm.
