# Unfollx

Chrome extension that lists the accounts you follow that don't follow you back, and lets you unfollow them.

- Uses your live Instagram session in Chrome. No database, no stored data, no dummy data.
- Unfollow one account with a click, or select several and unfollow them as a batch (20–40 s between each).

## Install
1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose this `unfollx` folder.

## Use
1. Log in at https://www.instagram.com in the same Chrome profile.
2. Click the **Unfollx** button (bottom right), then **Scan**.
3. Your network is split into three tabs:
   - **Not following back**: accounts you follow that don't follow you. Unfollow one by one, or tick them and press **Unfollow selected**. **Stop** halts a batch.
   - **Follow you back**: mutuals. Read-only, never touched.
   - **Fans**: people who follow you but you don't follow. Read-only.

## Updates
The extension checks this GitHub repo's `manifest.json` every few hours. If the version there is newer, the toolbar icon shows **NEW**, and both the toolbar popup and the Unfollx panel offer **Download update** (zip from GitHub) and **Reload extension**. Chrome doesn't let unpacked extensions replace their own files, so extract the zip over your folder, then press **Reload extension**. To release an update, bump `version` in `manifest.json` and push to `main`.

## Limits
- It relies on Instagram's internal web API, which Instagram can change without notice.
- Instagram limits how many accounts you can unfollow per day. If you see a "blocked" or "rate-limiting" message, stop and wait a day.
- Automated actions are against Instagram's terms; use it at a modest pace on your own account.
