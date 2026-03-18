# 🛡️ SwiftX Guard — Setup Guide

## Step 1 — Create the Bot on Discord

1. Go to **https://discord.com/developers/applications**
1. Click **“New Application”** → name it **SwiftX Guard**
1. Go to the **Bot** tab → click **“Add Bot”** → confirm
1. Under **“Privileged Gateway Intents”** turn ON:
- ✅ Server Members Intent
- ✅ Message Content Intent
1. Copy your **Token** (click “Reset Token”) — save it, you’ll need it
1. Go to **OAuth2 → URL Generator**:
- Scopes: ✅ `bot`
- Bot Permissions: ✅ `Administrator` (easiest) OR select manually:
  - Manage Server, Ban Members, Kick Members, Manage Messages,
    Moderate Members, Manage Channels, Manage Nicknames, View Audit Log
1. Copy the generated URL → open it → add the bot to your server

-----

## Step 2 — Host for FREE on Railway

Railway gives you **500 hours/month free** — enough for a bot running 24/7.

1. Go to **https://railway.app** → Sign up with GitHub (free)
1. Click **“New Project”** → **“Deploy from GitHub repo”**
1. Upload this folder to a **new GitHub repository** (github.com → New repo → upload files)
1. Railway will detect it automatically
1. Go to your project → **Variables** tab → add:
   
   ```
   TOKEN = your_bot_token_here
   CLIENT_ID = your_client_id_here
   LOG_CHANNEL = your_log_channel_id_here (optional)
   ```
1. Click **Deploy** — the bot will be online in ~30 seconds ✅

That’s it. Railway keeps it running 24/7 for free.

-----

## Step 3 — First Setup in Discord

Once the bot is in your server:

```
!setlog #mod-logs        → Set the moderation log channel
!antiraid on             → Enable anti-raid protection
!antispam on             → Enable anti-spam
!antiinvite on           → Block Discord invite links
!agegate 7               → Kick accounts newer than 7 days
```

-----

## All Commands

|Command                        |Description                                 |
|-------------------------------|--------------------------------------------|
|`!ban @user [reason]`          |Ban a member                                |
|`!kick @user [reason]`         |Kick a member                               |
|`!mute @user 10m [reason]`     |Timeout a member                            |
|`!unmute @user`                |Remove timeout                              |
|`!warn @user reason`           |Warn a member (auto-punishes at 3/5/7 warns)|
|`!warnings @user`              |See warnings for a user                     |
|`!clearwarnings @user`         |Clear all warnings                          |
|`!tempban @user 1d [reason]`   |Temp ban (auto-unbans)                      |
|`!unban <userId>`              |Unban a user                                |
|`!purge 50`                    |Delete messages                             |
|`!lockdown [reason]`           |Lock ALL channels                           |
|`!unlock`                      |Unlock all channels                         |
|`!slowmode 5`                  |Set slowmode in seconds                     |
|`!antispam on/off`             |Toggle spam filter                          |
|`!antiinvite on/off`           |Toggle invite link filter                   |
|`!anticaps on/off`             |Toggle caps filter                          |
|`!badword add/remove/list word`|Manage bad word filter                      |
|`!antiraid on/off`             |Toggle raid detection                       |
|`!whitelist add/remove @user`  |Whitelist users from automod                |
|`!agegate 7`                   |Kick accounts newer than N days             |
|`!nick @user nickname`         |Change nickname                             |
|`!userinfo @user`              |Show user info + warnings                   |
|`!serverinfo`                  |Show server stats                           |
|`!setlog #channel`             |Set mod log channel                         |
|`!help`                        |Show all commands                           |

-----

## Auto Features (always active)

- 🚫 **Anti-Spam** — auto-mutes for 30s if spamming
- 🚨 **Anti-Raid** — auto-kicks if 8+ joins in 10 seconds
- 🤬 **Bad Word Filter** — deletes messages with filtered words
- 🔗 **Invite Blocker** — removes Discord invite links
- 📅 **Age Gate** — kicks new accounts below minimum age
- ⚠️ **Auto-Punish** — mute@3 warns, kick@5, ban@7
- 📢 **Mass Mention** — auto-mutes for pinging too many users
- 📋 **Join/Leave Logs** — logs every member join and leave
- 🔨 **Ban Logs** — logs every ban

-----

## Bot Info

- **Name:** SwiftX Guard
- **Prefix:** `!`
- **Description:** The ultimate security bot for your Discord server. Powered by SwiftX.
- **Status:** Watching your server 🛡️