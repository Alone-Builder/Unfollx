# Unfollx

Chrome extension that lists the accounts you follow that don't follow you back, and lets you unfollow them.

- Uses your live Instagram session in Chrome. No database and no dummy data. The only things kept in the browser are your speed choice, the per-account follow counter and the cached latest-version number.
- Unfollow one account with a click, or select several and unfollow them as a batch.
- **Bulk follow**: copy the followers/following of any other account.
- **Speed**: Fast (random 0.9-2.7 s between actions, about 3 minutes per 100) or Safe (20-40 s).

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

## Bulk follow
1. Open another account's profile on instagram.com, switch the panel to **Bulk follow**.
2. Choose **Followers** or **Following**, press **Load** (up to 300 users), tick the accounts, press **Follow selected**.
3. Each logged-in account may follow **100 accounts per rolling 24 hours**, counted separately per account. Once an account hits 100, following stops for that account; log in with another account and it starts from 0. Accounts you already follow (after a Scan) are skipped.

## Updates
The extension checks this GitHub repo's `manifest.json` every few hours. If the version there is newer, the toolbar icon shows **NEW**, and both the toolbar popup and the Unfollx panel offer **Download update** (zip from GitHub) and **Reload extension**. Chrome doesn't let unpacked extensions replace their own files, so extract the zip over your folder, then press **Reload extension**. To release an update, bump `version` in `manifest.json` and push to `main`.

## Limits
- It relies on Instagram's internal web API, which Instagram can change without notice.
- Instagram limits how many accounts you can unfollow per day. If you see a "blocked" or "rate-limiting" message, stop and wait a day.
- Automated actions are against Instagram's terms; use it at a modest pace on your own account.
