// ============================================================
// SwiftX Guard - Discord Security Bot
// 20+ Security Features | Free Hosting on Railway
// ============================================================

require(‘dotenv’).config();
const {
Client, GatewayIntentBits, Partials, EmbedBuilder,
PermissionFlagsBits, ActionRowBuilder, ButtonBuilder,
ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
Events, AuditLogEvent, Collection, SlashCommandBuilder,
REST, Routes
} = require(‘discord.js’);

const client = new Client({
intents: [
GatewayIntentBits.Guilds,
GatewayIntentBits.GuildMembers,
GatewayIntentBits.GuildMessages,
GatewayIntentBits.GuildMessageReactions,
GatewayIntentBits.GuildBans,
GatewayIntentBits.GuildModeration,
GatewayIntentBits.MessageContent,
GatewayIntentBits.DirectMessages,
],
partials: [Partials.Channel, Partials.Message, Partials.GuildMember]
});

// ============================================================
// CONFIG — edit these or set as environment variables
// ============================================================
const CONFIG = {
TOKEN:       process.env.TOKEN       || ‘YOUR_BOT_TOKEN_HERE’,
CLIENT_ID:   process.env.CLIENT_ID   || ‘YOUR_CLIENT_ID_HERE’,
LOG_CHANNEL: process.env.LOG_CHANNEL || ‘’,  // channel ID for logs
PREFIX:      ‘!’,
ACCENT_COLOR: 0x0055FF,
DANGER_COLOR: 0xFF3030,
SUCCESS_COLOR:0x00DD66,
WARN_COLOR:   0xFFAA00,
};

// ============================================================
// IN-MEMORY STORAGE (persists until bot restarts)
// For production, replace with a database like SQLite/MongoDB
// ============================================================
const db = {
warnings:     {},   // { guildId: { userId: [{reason, date, mod}] } }
mutedUsers:   {},   // { guildId: { userId: unmuteTimestamp } }
tempBans:     {},   // { guildId: { userId: unbanTimestamp } }
antiSpam:     {},   // { guildId: { userId: { count, lastMsg, timestamps[] } } }
antiRaid:     {},   // { guildId: { joins: [], enabled: bool } }
whitelisted:  {},   // { guildId: [userId] }
lockdowns:    {},   // { guildId: bool }
slowmodes:    {},   // { guildId: { channelId: seconds } }
verification: {},   // { guildId: { enabled, channelId, roleId } }
automod:      {},   // { guildId: { caps, links, invites, badwords } }
badwords:     {},   // { guildId: [word] }
joinGate:     {},   // { guildId: { minAge: days, enabled } }
msgLogs:      {},   // toggleable message logging
guildSettings:{},   // per-guild config
};

// Default automod settings per guild
function getAutomod(guildId) {
if (!db.automod[guildId]) {
db.automod[guildId] = {
caps: false, links: false, invites: false,
badwords: false, spam: true, massMention: true,
zalgo: false, maxMentions: 5
};
}
return db.automod[guildId];
}

function getWarnings(guildId, userId) {
if (!db.warnings[guildId]) db.warnings[guildId] = {};
if (!db.warnings[guildId][userId]) db.warnings[guildId][userId] = [];
return db.warnings[guildId][userId];
}

// ============================================================
// HELPERS
// ============================================================
function swiftEmbed(title, description, color = CONFIG.ACCENT_COLOR) {
return new EmbedBuilder()
.setColor(color)
.setTitle(`🛡️ SwiftX Guard | ${title}`)
.setDescription(description)
.setTimestamp()
.setFooter({ text: ‘SwiftX Guard • Security System’ });
}

async function sendLog(guild, embed) {
const settings = db.guildSettings[guild.id] || {};
const logId = settings.logChannel || CONFIG.LOG_CHANNEL;
if (!logId) return;
try {
const ch = await guild.channels.fetch(logId);
if (ch) ch.send({ embeds: [embed] });
} catch {}
}

function hasPerms(member, …perms) {
return perms.every(p => member.permissions.has(p));
}

function isMod(member) {
return hasPerms(member, PermissionFlagsBits.ManageMessages)
|| hasPerms(member, PermissionFlagsBits.BanMembers)
|| hasPerms(member, PermissionFlagsBits.Administrator);
}

function parseTime(str) {
// Returns milliseconds from strings like “10m”, “2h”, “1d”
const units = { s:1000, m:60000, h:3600000, d:86400000 };
const match = str.match(/^(\d+)([smhd])$/);
if (!match) return null;
return parseInt(match[1]) * units[match[2]];
}

function formatTime(ms) {
const s=Math.floor(ms/1000), m=Math.floor(s/60), h=Math.floor(m/60), d=Math.floor(h/24);
if (d>0) return `${d}d ${h%24}h`;
if (h>0) return `${h}h ${m%60}m`;
if (m>0) return `${m}m ${s%60}s`;
return `${s}s`;
}

// ============================================================
// ANTI-SPAM ENGINE
// ============================================================
const SPAM_THRESHOLD = 5;   // messages
const SPAM_WINDOW    = 3000; // ms

function checkSpam(guildId, userId, now) {
if (!db.antiSpam[guildId]) db.antiSpam[guildId] = {};
if (!db.antiSpam[guildId][userId]) {
db.antiSpam[guildId][userId] = { count: 0, timestamps: [] };
}
const data = db.antiSpam[guildId][userId];
data.timestamps = data.timestamps.filter(t => now - t < SPAM_WINDOW);
data.timestamps.push(now);
data.count = data.timestamps.length;
return data.count >= SPAM_THRESHOLD;
}

// ============================================================
// ANTI-RAID ENGINE
// ============================================================
const RAID_THRESHOLD = 8;   // joins
const RAID_WINDOW    = 10000; // ms

function checkRaid(guildId, now) {
if (!db.antiRaid[guildId]) db.antiRaid[guildId] = { joins: [], active: false };
const data = db.antiRaid[guildId];
data.joins = data.joins.filter(t => now - t < RAID_WINDOW);
data.joins.push(now);
if (data.joins.length >= RAID_THRESHOLD && !data.active) {
data.active = true;
setTimeout(() => { data.active = false; data.joins = []; }, 30000);
return true;
}
return data.active;
}

// ============================================================
// COMMANDS MAP
// ============================================================
const commands = new Collection();

// Helper to add a command
function cmd(name, aliases, desc, fn) {
commands.set(name, { name, aliases: aliases||[], desc, fn });
(aliases||[]).forEach(a => commands.set(a, { name, aliases, desc, fn }));
}

// ============================================================
// FEATURE 1: BAN
// ============================================================
cmd(‘ban’, [‘b’], ‘!ban <@user> [reason]’, async (msg, args) => {
if (!hasPerms(msg.member, PermissionFlagsBits.BanMembers))
return msg.reply(‘❌ You need **Ban Members** permission.’);
const target = msg.mentions.members.first();
if (!target) return msg.reply(‘❌ Mention a user to ban.’);
const reason = args.slice(1).join(’ ’) || ‘No reason provided’;
try {
await target.ban({ reason, deleteMessageSeconds: 86400 });
const embed = swiftEmbed(‘Member Banned’, `🔨 **${target.user.tag}** was banned.\n**Reason:** ${reason}`, CONFIG.DANGER_COLOR);
msg.channel.send({ embeds: [embed] });
sendLog(msg.guild, embed);
} catch { msg.reply(‘❌ Could not ban that user.’); }
});

// ============================================================
// FEATURE 2: KICK
// ============================================================
cmd(‘kick’, [‘k’], ‘!kick <@user> [reason]’, async (msg, args) => {
if (!hasPerms(msg.member, PermissionFlagsBits.KickMembers))
return msg.reply(‘❌ You need **Kick Members** permission.’);
const target = msg.mentions.members.first();
if (!target) return msg.reply(‘❌ Mention a user to kick.’);
const reason = args.slice(1).join(’ ’) || ‘No reason provided’;
try {
await target.kick(reason);
const embed = swiftEmbed(‘Member Kicked’, `👢 **${target.user.tag}** was kicked.\n**Reason:** ${reason}`, CONFIG.WARN_COLOR);
msg.channel.send({ embeds: [embed] });
sendLog(msg.guild, embed);
} catch { msg.reply(‘❌ Could not kick that user.’); }
});

// ============================================================
// FEATURE 3: MUTE (Timeout)
// ============================================================
cmd(‘mute’, [‘m’, ‘timeout’], ‘!mute <@user> <time> [reason]’, async (msg, args) => {
if (!hasPerms(msg.member, PermissionFlagsBits.ModerateMembers))
return msg.reply(‘❌ You need **Timeout Members** permission.’);
const target = msg.mentions.members.first();
if (!target) return msg.reply(‘❌ Mention a user to mute.’);
const duration = parseTime(args[1]);
if (!duration) return msg.reply(‘❌ Invalid duration. Use: 10m, 2h, 1d’);
const reason = args.slice(2).join(’ ’) || ‘No reason provided’;
try {
await target.timeout(duration, reason);
const embed = swiftEmbed(‘Member Muted’,
`🔇 **${target.user.tag}** muted for **${formatTime(duration)}**.\n**Reason:** ${reason}`, CONFIG.WARN_COLOR);
msg.channel.send({ embeds: [embed] });
sendLog(msg.guild, embed);
} catch { msg.reply(‘❌ Could not mute that user.’); }
});

// ============================================================
// FEATURE 4: UNMUTE
// ============================================================
cmd(‘unmute’, [‘um’], ‘!unmute <@user>’, async (msg, args) => {
if (!hasPerms(msg.member, PermissionFlagsBits.ModerateMembers))
return msg.reply(‘❌ You need **Timeout Members** permission.’);
const target = msg.mentions.members.first();
if (!target) return msg.reply(‘❌ Mention a user to unmute.’);
try {
await target.timeout(null);
msg.channel.send({ embeds: [swiftEmbed(‘Member Unmuted’, `🔊 **${target.user.tag}** has been unmuted.`, CONFIG.SUCCESS_COLOR)] });
} catch { msg.reply(‘❌ Could not unmute that user.’); }
});

// ============================================================
// FEATURE 5: WARN + AUTO-PUNISH
// ============================================================
cmd(‘warn’, [‘w’], ‘!warn <@user> <reason>’, async (msg, args) => {
if (!isMod(msg.member)) return msg.reply(‘❌ No permission.’);
const target = msg.mentions.members.first();
if (!target) return msg.reply(‘❌ Mention a user to warn.’);
const reason = args.slice(1).join(’ ’) || ‘No reason provided’;
const warns = getWarnings(msg.guild.id, target.id);
warns.push({ reason, date: new Date().toISOString(), mod: msg.author.tag });

```
let extra = '';
if (warns.length === 3) {
    await target.timeout(600000, 'Auto-mute: 3 warnings');
    extra = '\n⚠️ **Auto-muted for 10 minutes** (3 warnings reached)';
} else if (warns.length === 5) {
    await target.kick('Auto-kick: 5 warnings');
    extra = '\n⛔ **Auto-kicked** (5 warnings reached)';
} else if (warns.length >= 7) {
    await target.ban({ reason: 'Auto-ban: 7+ warnings', deleteMessageSeconds: 0 });
    extra = '\n🔨 **Auto-banned** (7+ warnings reached)';
}

const embed = swiftEmbed('Warning Issued',
    `⚠️ **${target.user.tag}** — Warning **#${warns.length}**\n**Reason:** ${reason}${extra}`, CONFIG.WARN_COLOR);
msg.channel.send({ embeds: [embed] });
sendLog(msg.guild, embed);

try { await target.send({ embeds: [swiftEmbed('You were warned', `**Server:** ${msg.guild.name}\n**Reason:** ${reason}\n**Total warnings:** ${warns.length}`, CONFIG.WARN_COLOR)] }); } catch {}
```

});

// ============================================================
// FEATURE 6: WARNINGS LIST
// ============================================================
cmd(‘warnings’, [‘warns’, ‘wl’], ‘!warnings <@user>’, async (msg, args) => {
const target = msg.mentions.members.first() || msg.member;
const warns = getWarnings(msg.guild.id, target.id);
if (warns.length === 0)
return msg.channel.send({ embeds: [swiftEmbed(‘Warnings’, `✅ **${target.user.tag}** has no warnings.`, CONFIG.SUCCESS_COLOR)] });
const list = warns.map((w,i) => `**${i+1}.** ${w.reason} — *${w.mod}* (${w.date.split('T')[0]})`).join(’\n’);
msg.channel.send({ embeds: [swiftEmbed(`Warnings — ${target.user.tag}`, list, CONFIG.WARN_COLOR)] });
});

// ============================================================
// FEATURE 7: CLEAR WARNINGS
// ============================================================
cmd(‘clearwarnings’, [‘cw’, ‘clearwarn’], ‘!clearwarnings <@user>’, async (msg, args) => {
if (!isMod(msg.member)) return msg.reply(‘❌ No permission.’);
const target = msg.mentions.members.first();
if (!target) return msg.reply(‘❌ Mention a user.’);
if (db.warnings[msg.guild.id]) db.warnings[msg.guild.id][target.id] = [];
msg.channel.send({ embeds: [swiftEmbed(‘Warnings Cleared’, `✅ Cleared all warnings for **${target.user.tag}**.`, CONFIG.SUCCESS_COLOR)] });
});

// ============================================================
// FEATURE 8: PURGE / CLEAR MESSAGES
// ============================================================
cmd(‘purge’, [‘clear’, ‘prune’], ‘!purge <amount> [@user]’, async (msg, args) => {
if (!hasPerms(msg.member, PermissionFlagsBits.ManageMessages))
return msg.reply(‘❌ You need **Manage Messages** permission.’);
const amount = parseInt(args[0]);
if (isNaN(amount) || amount < 1 || amount > 100)
return msg.reply(‘❌ Please provide a number between 1 and 100.’);
try {
await msg.delete();
const target = msg.mentions.users.first();
let fetched = await msg.channel.messages.fetch({ limit: 100 });
if (target) fetched = fetched.filter(m => m.author.id === target.id);
const toDelete = fetched.first(amount);
await msg.channel.bulkDelete(toDelete, true);
const reply = await msg.channel.send({ embeds: [swiftEmbed(‘Messages Purged’, `🗑️ Deleted **${toDelete.length}** messages.`, CONFIG.SUCCESS_COLOR)] });
setTimeout(() => reply.delete().catch(()=>{}), 3000);
} catch(e) { msg.channel.send(‘❌ Could not delete messages (may be too old).’); }
});

// ============================================================
// FEATURE 9: LOCKDOWN (lock all channels)
// ============================================================
cmd(‘lockdown’, [‘lock’], ‘!lockdown [reason]’, async (msg, args) => {
if (!hasPerms(msg.member, PermissionFlagsBits.ManageChannels))
return msg.reply(‘❌ You need **Manage Channels** permission.’);
const reason = args.join(’ ’) || ‘Emergency lockdown’;
db.lockdowns[msg.guild.id] = true;
const channels = msg.guild.channels.cache.filter(c => c.isTextBased() && !c.isThread());
let count = 0;
for (const [,ch] of channels) {
try {
await ch.permissionOverwrites.edit(msg.guild.roles.everyone, { SendMessages: false });
count++;
} catch {}
}
const embed = swiftEmbed(‘🔒 SERVER LOCKDOWN’,
`Server has been locked down.\n**Reason:** ${reason}\n**Channels locked:** ${count}\n\nUse \`!unlock` to restore access.`, CONFIG.DANGER_COLOR);
msg.channel.send({ embeds: [embed] });
sendLog(msg.guild, embed);
});

// ============================================================
// FEATURE 10: UNLOCK
// ============================================================
cmd(‘unlock’, [], ‘!unlock’, async (msg, args) => {
if (!hasPerms(msg.member, PermissionFlagsBits.ManageChannels))
return msg.reply(‘❌ You need **Manage Channels** permission.’);
db.lockdowns[msg.guild.id] = false;
const channels = msg.guild.channels.cache.filter(c => c.isTextBased() && !c.isThread());
let count = 0;
for (const [,ch] of channels) {
try {
await ch.permissionOverwrites.edit(msg.guild.roles.everyone, { SendMessages: null });
count++;
} catch {}
}
const embed = swiftEmbed(‘🔓 Server Unlocked’,
`Server lockdown has been lifted.\n**Channels unlocked:** ${count}`, CONFIG.SUCCESS_COLOR);
msg.channel.send({ embeds: [embed] });
sendLog(msg.guild, embed);
});

// ============================================================
// FEATURE 11: SLOWMODE
// ============================================================
cmd(‘slowmode’, [‘slow’, ‘sm’], ‘!slowmode <seconds|off>’, async (msg, args) => {
if (!hasPerms(msg.member, PermissionFlagsBits.ManageChannels))
return msg.reply(‘❌ You need **Manage Channels** permission.’);
const val = args[0] === ‘off’ ? 0 : parseInt(args[0]);
if (isNaN(val)) return msg.reply(‘❌ Provide seconds or “off”.’);
await msg.channel.setRateLimitPerUser(Math.min(val, 21600));
msg.channel.send({ embeds: [swiftEmbed(‘Slowmode’,
val === 0 ? ‘⏱️ Slowmode **disabled**.’ : `⏱️ Slowmode set to **${val}s**.`, CONFIG.SUCCESS_COLOR)] });
});

// ============================================================
// FEATURE 12: ANTI-SPAM (auto-detects, also togglable)
// ============================================================
cmd(‘antispam’, [‘spam’], ‘!antispam <on|off>’, async (msg, args) => {
if (!isMod(msg.member)) return msg.reply(‘❌ No permission.’);
const state = args[0] === ‘on’;
getAutomod(msg.guild.id).spam = state;
msg.channel.send({ embeds: [swiftEmbed(‘Anti-Spam’, `🚫 Anti-spam is now **${state ? 'ON' : 'OFF'}**.`, state ? CONFIG.SUCCESS_COLOR : CONFIG.WARN_COLOR)] });
});

// ============================================================
// FEATURE 13: ANTI-INVITE LINKS
// ============================================================
cmd(‘antiinvite’, [‘antilink’], ‘!antiinvite <on|off>’, async (msg, args) => {
if (!isMod(msg.member)) return msg.reply(‘❌ No permission.’);
const state = args[0] === ‘on’;
getAutomod(msg.guild.id).invites = state;
msg.channel.send({ embeds: [swiftEmbed(‘Anti-Invite’, `🔗 Discord invite link filter is **${state ? 'ON' : 'OFF'}**.`, state ? CONFIG.SUCCESS_COLOR : CONFIG.WARN_COLOR)] });
});

// ============================================================
// FEATURE 14: BAD WORD FILTER
// ============================================================
cmd(‘badword’, [‘bw’], ‘!badword <add|remove|list> [word]’, async (msg, args) => {
if (!isMod(msg.member)) return msg.reply(‘❌ No permission.’);
if (!db.badwords[msg.guild.id]) db.badwords[msg.guild.id] = [];
const action = args[0];
const word = args[1]?.toLowerCase();
if (action === ‘add’ && word) {
db.badwords[msg.guild.id].push(word);
getAutomod(msg.guild.id).badwords = true;
return msg.channel.send({ embeds: [swiftEmbed(‘Bad Word Added’, `✅ Added \`${word}` to filter.`, CONFIG.SUCCESS_COLOR)] }); } if (action === 'remove' && word) { db.badwords[msg.guild.id] = db.badwords[msg.guild.id].filter(w => w !== word); return msg.channel.send({ embeds: [swiftEmbed('Bad Word Removed', `✅ Removed `${word}` from filter.`, CONFIG.SUCCESS_COLOR)] }); } if (action === 'list') { const list = db.badwords[msg.guild.id]; return msg.channel.send({ embeds: [swiftEmbed('Bad Word List', list.length ? list.map(w => ``${w}``).join(', ') : 'No bad words added.', CONFIG.ACCENT_COLOR)] }); } msg.reply('Usage: `!badword add/remove/list [word]`’);
});

// ============================================================
// FEATURE 15: ANTI-CAPS
// ============================================================
cmd(‘anticaps’, [], ‘!anticaps <on|off> [threshold%]’, async (msg, args) => {
if (!isMod(msg.member)) return msg.reply(‘❌ No permission.’);
const state = args[0] === ‘on’;
getAutomod(msg.guild.id).caps = state;
msg.channel.send({ embeds: [swiftEmbed(‘Anti-Caps’, `🔤 Caps filter is **${state ? 'ON' : 'OFF'}**.`, state ? CONFIG.SUCCESS_COLOR : CONFIG.WARN_COLOR)] });
});

// ============================================================
// FEATURE 16: SET LOG CHANNEL
// ============================================================
cmd(‘setlog’, [‘logchannel’], ‘!setlog <#channel>’, async (msg, args) => {
if (!hasPerms(msg.member, PermissionFlagsBits.Administrator))
return msg.reply(‘❌ You need **Administrator** permission.’);
const ch = msg.mentions.channels.first();
if (!ch) return msg.reply(‘❌ Mention a channel.’);
if (!db.guildSettings[msg.guild.id]) db.guildSettings[msg.guild.id] = {};
db.guildSettings[msg.guild.id].logChannel = ch.id;
msg.channel.send({ embeds: [swiftEmbed(‘Log Channel Set’, `📋 Log channel set to ${ch}.`, CONFIG.SUCCESS_COLOR)] });
});

// ============================================================
// FEATURE 17: USERINFO
// ============================================================
cmd(‘userinfo’, [‘ui’, ‘user’], ‘!userinfo [@user]’, async (msg, args) => {
const target = msg.mentions.members.first() || msg.member;
const warns = getWarnings(msg.guild.id, target.id).length;
const roles = target.roles.cache.filter(r => r.id !== msg.guild.id)
.map(r => r.toString()).join(’, ‘) || ‘None’;
const embed = new EmbedBuilder()
.setColor(CONFIG.ACCENT_COLOR)
.setTitle(`🛡️ SwiftX Guard | User Info`)
.setThumbnail(target.user.displayAvatarURL())
.addFields(
{ name: ‘Tag’,          value: target.user.tag,                              inline: true },
{ name: ‘ID’,           value: target.id,                                    inline: true },
{ name: ‘Warnings’,     value: `${warns}`,                                   inline: true },
{ name: ‘Joined Server’,value: `<t:${Math.floor(target.joinedTimestamp/1000)}:R>`, inline: true },
{ name: ‘Account Created’,value:`<t:${Math.floor(target.user.createdTimestamp/1000)}:R>`, inline: true },
{ name: ‘Is Bot’,       value: target.user.bot ? ‘Yes’ : ‘No’,               inline: true },
{ name: ‘Roles’,        value: roles.length > 1000 ? roles.slice(0,1000)+’…’ : roles },
)
.setTimestamp()
.setFooter({ text: ‘SwiftX Guard’ });
msg.channel.send({ embeds: [embed] });
});

// ============================================================
// FEATURE 18: SERVERINFO
// ============================================================
cmd(‘serverinfo’, [‘si’, ‘server’], ‘!serverinfo’, async (msg) => {
const g = msg.guild;
await g.fetch();
const bots  = g.members.cache.filter(m => m.user.bot).size;
const humans= g.memberCount - bots;
const embed = new EmbedBuilder()
.setColor(CONFIG.ACCENT_COLOR)
.setTitle(`🛡️ SwiftX Guard | Server Info`)
.setThumbnail(g.iconURL())
.addFields(
{ name: ‘Server Name’,  value: g.name,                  inline: true },
{ name: ‘Owner’,        value: `<@${g.ownerId}>`,       inline: true },
{ name: ‘Members’,      value: `${humans} humans, ${bots} bots`, inline: true },
{ name: ‘Channels’,     value: `${g.channels.cache.size}`, inline: true },
{ name: ‘Roles’,        value: `${g.roles.cache.size}`,    inline: true },
{ name: ‘Boosts’,       value: `${g.premiumSubscriptionCount}`, inline: true },
{ name: ‘Created’,      value: `<t:${Math.floor(g.createdTimestamp/1000)}:R>`, inline: true },
{ name: ‘Verification’, value: [‘None’,‘Low’,‘Medium’,‘High’,‘Very High’][g.verificationLevel], inline: true },
)
.setTimestamp()
.setFooter({ text: ‘SwiftX Guard’ });
msg.channel.send({ embeds: [embed] });
});

// ============================================================
// FEATURE 19: ANTI-RAID (auto-detect + lockdown)
// ============================================================
cmd(‘antiraid’, [], ‘!antiraid <on|off>’, async (msg, args) => {
if (!hasPerms(msg.member, PermissionFlagsBits.Administrator))
return msg.reply(‘❌ Administrator only.’);
if (!db.antiRaid[msg.guild.id]) db.antiRaid[msg.guild.id] = { joins: [], active: false, enabled: false };
db.antiRaid[msg.guild.id].enabled = args[0] === ‘on’;
msg.channel.send({ embeds: [swiftEmbed(‘Anti-Raid’,
`🛡️ Anti-raid detection is **${args[0] === 'on' ? 'ON' : 'OFF'}**.`,
args[0]===‘on’ ? CONFIG.SUCCESS_COLOR : CONFIG.WARN_COLOR)] });
});

// ============================================================
// FEATURE 20: WHITELIST (bypass automod)
// ============================================================
cmd(‘whitelist’, [‘wl’], ‘!whitelist <add|remove> <@user>’, async (msg, args) => {
if (!hasPerms(msg.member, PermissionFlagsBits.Administrator))
return msg.reply(‘❌ Administrator only.’);
if (!db.whitelisted[msg.guild.id]) db.whitelisted[msg.guild.id] = [];
const target = msg.mentions.users.first();
if (!target) return msg.reply(‘❌ Mention a user.’);
if (args[0] === ‘add’) {
if (!db.whitelisted[msg.guild.id].includes(target.id))
db.whitelisted[msg.guild.id].push(target.id);
return msg.channel.send({ embeds: [swiftEmbed(‘Whitelist’, `✅ **${target.tag}** is now whitelisted from automod.`, CONFIG.SUCCESS_COLOR)] });
}
if (args[0] === ‘remove’) {
db.whitelisted[msg.guild.id] = db.whitelisted[msg.guild.id].filter(id => id !== target.id);
return msg.channel.send({ embeds: [swiftEmbed(‘Whitelist’, `✅ **${target.tag}** removed from whitelist.`, CONFIG.SUCCESS_COLOR)] });
}
});

// ============================================================
// FEATURE 21: JOIN AGE GATE (kick accounts newer than X days)
// ============================================================
cmd(‘agegate’, [‘joingate’], ‘!agegate <days|off>’, async (msg, args) => {
if (!hasPerms(msg.member, PermissionFlagsBits.Administrator))
return msg.reply(‘❌ Administrator only.’);
if (!db.joinGate[msg.guild.id]) db.joinGate[msg.guild.id] = { enabled: false, minAge: 7 };
if (args[0] === ‘off’) {
db.joinGate[msg.guild.id].enabled = false;
return msg.channel.send({ embeds: [swiftEmbed(‘Age Gate’, ‘✅ Account age gate **disabled**.’, CONFIG.WARN_COLOR)] });
}
const days = parseInt(args[0]);
if (isNaN(days)) return msg.reply(‘❌ Provide number of days or “off”.’);
db.joinGate[msg.guild.id] = { enabled: true, minAge: days };
msg.channel.send({ embeds: [swiftEmbed(‘Age Gate’, `✅ Accounts newer than **${days} days** will be kicked on join.`, CONFIG.SUCCESS_COLOR)] });
});

// ============================================================
// FEATURE 22: TEMBAN
// ============================================================
cmd(‘tempban’, [‘tb’], ‘!tempban <@user> <time> [reason]’, async (msg, args) => {
if (!hasPerms(msg.member, PermissionFlagsBits.BanMembers))
return msg.reply(‘❌ You need **Ban Members** permission.’);
const target = msg.mentions.members.first();
if (!target) return msg.reply(‘❌ Mention a user.’);
const duration = parseTime(args[1]);
if (!duration) return msg.reply(‘❌ Invalid duration. Use: 10m, 2h, 1d’);
const reason = args.slice(2).join(’ ’) || ‘Temporary ban’;
try {
await target.ban({ reason, deleteMessageSeconds: 0 });
const embed = swiftEmbed(‘Temp Ban’,
`⏱️ **${target.user.tag}** temp banned for **${formatTime(duration)}**.\n**Reason:** ${reason}`, CONFIG.DANGER_COLOR);
msg.channel.send({ embeds: [embed] });
sendLog(msg.guild, embed);
// Auto unban
setTimeout(async () => {
try {
await msg.guild.members.unban(target.id, ‘Temp ban expired’);
sendLog(msg.guild, swiftEmbed(‘Temp Ban Expired’, `⏱️ **${target.user.tag}** has been unbanned (temp ban expired).`, CONFIG.SUCCESS_COLOR));
} catch {}
}, duration);
} catch { msg.reply(‘❌ Could not ban that user.’); }
});

// ============================================================
// FEATURE 23: UNBAN
// ============================================================
cmd(‘unban’, [], ‘!unban <userId>’, async (msg, args) => {
if (!hasPerms(msg.member, PermissionFlagsBits.BanMembers))
return msg.reply(‘❌ You need **Ban Members** permission.’);
if (!args[0]) return msg.reply(‘❌ Provide a user ID.’);
try {
await msg.guild.members.unban(args[0]);
msg.channel.send({ embeds: [swiftEmbed(‘User Unbanned’, `✅ User \`${args[0]}` has been unbanned.`, CONFIG.SUCCESS_COLOR)] });
} catch { msg.reply(‘❌ Could not unban. Make sure the ID is correct.’); }
});

// ============================================================
// FEATURE 24: NICK (change nickname)
// ============================================================
cmd(‘nick’, [], ‘!nick <@user> [nickname|reset]’, async (msg, args) => {
if (!hasPerms(msg.member, PermissionFlagsBits.ManageNicknames))
return msg.reply(‘❌ You need **Manage Nicknames** permission.’);
const target = msg.mentions.members.first();
if (!target) return msg.reply(‘❌ Mention a user.’);
const nick = args.slice(1).join(’ ’) || null;
try {
await target.setNickname(nick);
msg.channel.send({ embeds: [swiftEmbed(‘Nickname Changed’,
nick ? `✅ Set **${target.user.tag}**'s nickname to \`${nick}`.`:`✅ Reset **${target.user.tag}**’s nickname.`, CONFIG.SUCCESS_COLOR)] });
} catch { msg.reply(‘❌ Could not change nickname.’); }
});

// ============================================================
// FEATURE 25: HELP
// ============================================================
cmd(‘help’, [‘h’, ‘commands’], ‘!help’, async (msg) => {
const embed = new EmbedBuilder()
.setColor(CONFIG.ACCENT_COLOR)
.setTitle(‘🛡️ SwiftX Guard | Commands’)
.setDescription(‘Prefix: `!`’)
.addFields(
{ name: ‘🔨 Moderation’, value:
‘`ban` `kick` `mute` `unmute` `warn` `warnings` `clearwarnings`\n’ +
‘`purge` `tempban` `unban` `nick`’ },
{ name: ‘🛡️ Security’, value:
‘`lockdown` `unlock` `slowmode` `antispam` `antiinvite`\n’ +
‘`anticaps` `badword` `antiraid` `whitelist` `agegate`’ },
{ name: ‘📋 Info’, value:
‘`userinfo` `serverinfo` `setlog` `help`’ },
{ name: ‘⚙️ Auto Features (always active)’, value:
‘• Anti-Spam detection\n’ +
‘• Anti-Raid detection\n’ +
‘• Bad word filter\n’ +
‘• Discord invite blocker\n’ +
‘• Account age gate\n’ +
‘• Auto-punish on warnings (mute@3, kick@5, ban@7)’ },
)
.setFooter({ text: ‘SwiftX Guard • Security System’ })
.setTimestamp();
msg.channel.send({ embeds: [embed] });
});

// ============================================================
// MESSAGE CREATE — automod + command handler
// ============================================================
client.on(Events.MessageCreate, async (msg) => {
if (msg.author.bot || !msg.guild) return;

```
const now = Date.now();
const guildId = msg.guild.id;
const userId  = msg.author.id;
const content = msg.content;
const automod = getAutomod(guildId);
const whitelisted = (db.whitelisted[guildId] || []).includes(userId);
const memberIsMod = isMod(msg.member);

// ---- AUTOMOD (skip mods and whitelisted) ----
if (!whitelisted && !memberIsMod) {

    // Anti-spam
    if (automod.spam && checkSpam(guildId, userId, now)) {
        await msg.delete().catch(()=>{});
        await msg.member.timeout(30000, 'Auto-mute: spam detected');
        const embed = swiftEmbed('Spam Detected',
            `🚫 **${msg.author.tag}** was auto-muted for 30s (spam).`, CONFIG.DANGER_COLOR);
        msg.channel.send({ embeds: [embed] }).then(m => setTimeout(()=>m.delete().catch(()=>{}),5000));
        sendLog(msg.guild, embed);
        return;
    }

    // Anti-invite
    if (automod.invites && /discord\.gg\/\S+|discord\.com\/invite\/\S+/i.test(content)) {
        await msg.delete().catch(()=>{});
        msg.channel.send({ embeds: [swiftEmbed('Invite Blocked', `🔗 **${msg.author.tag}** — No Discord invites allowed!`, CONFIG.WARN_COLOR)] })
            .then(m => setTimeout(()=>m.delete().catch(()=>{}),4000));
        return;
    }

    // Anti-caps (>70% uppercase, min 10 chars)
    if (automod.caps && content.length >= 10) {
        const uppers = content.split('').filter(c => c >= 'A' && c <= 'Z').length;
        const letters= content.split('').filter(c => c.match(/[a-zA-Z]/)).length;
        if (letters > 0 && uppers/letters > 0.7) {
            await msg.delete().catch(()=>{});
            msg.channel.send({ embeds: [swiftEmbed('Caps Blocked', `🔤 **${msg.author.tag}** — Please don't use excessive caps!`, CONFIG.WARN_COLOR)] })
                .then(m => setTimeout(()=>m.delete().catch(()=>{}),4000));
            return;
        }
    }

    // Bad word filter
    if (automod.badwords && db.badwords[guildId]) {
        const lower = content.toLowerCase();
        const found = db.badwords[guildId].find(w => lower.includes(w));
        if (found) {
            await msg.delete().catch(()=>{});
            msg.channel.send({ embeds: [swiftEmbed('Message Removed', `🤬 **${msg.author.tag}** — Your message contained a filtered word.`, CONFIG.WARN_COLOR)] })
                .then(m => setTimeout(()=>m.delete().catch(()=>{}),4000));
            return;
        }
    }

    // Mass mention
    if (automod.massMention && msg.mentions.users.size >= automod.maxMentions) {
        await msg.delete().catch(()=>{});
        await msg.member.timeout(60000, 'Auto-mute: mass mention');
        const embed = swiftEmbed('Mass Mention',
            `📢 **${msg.author.tag}** was muted for mentioning too many users.`, CONFIG.DANGER_COLOR);
        msg.channel.send({ embeds: [embed] }).then(m => setTimeout(()=>m.delete().catch(()=>{}),5000));
        sendLog(msg.guild, embed);
        return;
    }
}

// ---- COMMAND HANDLER ----
if (!content.startsWith(CONFIG.PREFIX)) return;
const args = content.slice(CONFIG.PREFIX.length).trim().split(/\s+/);
const cmdName = args.shift().toLowerCase();
const command = commands.get(cmdName);
if (command) {
    try { await command.fn(msg, args); }
    catch(e) {
        console.error(`Command error [${cmdName}]:`, e);
        msg.reply('❌ An error occurred while running that command.').catch(()=>{});
    }
}
```

});

// ============================================================
// GUILD MEMBER ADD — anti-raid + age gate + welcome log
// ============================================================
client.on(Events.GuildMemberAdd, async (member) => {
const guildId = member.guild.id;
const now = Date.now();

```
// Anti-raid
const raidData = db.antiRaid[guildId];
if (raidData?.enabled && checkRaid(guildId, now)) {
    try {
        await member.kick('Anti-raid: too many joins detected');
        const embed = swiftEmbed('🚨 RAID DETECTED',
            `Kicked **${member.user.tag}** — Mass join detected.\nServer is under potential raid attack!`, CONFIG.DANGER_COLOR);
        sendLog(member.guild, embed);
    } catch {}
    return;
}

// Account age gate
const gate = db.joinGate[guildId];
if (gate?.enabled) {
    const ageMs = now - member.user.createdTimestamp;
    const ageDays = ageMs / 86400000;
    if (ageDays < gate.minAge) {
        try {
            await member.send({ embeds: [swiftEmbed('Kicked — Account Too New',
                `**${member.guild.name}** requires your account to be at least **${gate.minAge} days old**.\nYour account is **${Math.floor(ageDays)} days old**.\nPlease come back later.`, CONFIG.DANGER_COLOR)] }).catch(()=>{});
            await member.kick(`Account age gate: account is ${Math.floor(ageDays)} days old`);
            sendLog(member.guild, swiftEmbed('Age Gate',
                `👤 **${member.user.tag}** kicked — account is only **${Math.floor(ageDays)} days old** (min: ${gate.minAge}).`, CONFIG.WARN_COLOR));
        } catch {}
        return;
    }
}

// Log new join
sendLog(member.guild, swiftEmbed('Member Joined',
    `👋 **${member.user.tag}** joined\n🆔 ID: \`${member.id}\`\n📅 Account created: <t:${Math.floor(member.user.createdTimestamp/1000)}:R>`,
    CONFIG.SUCCESS_COLOR));
```

});

// ============================================================
// GUILD MEMBER REMOVE — log
// ============================================================
client.on(Events.GuildMemberRemove, async (member) => {
sendLog(member.guild, swiftEmbed(‘Member Left’,
`🚪 **${member.user.tag}** left the server.\n🆔 ID: \`${member.id}``, CONFIG.WARN_COLOR));
});

// ============================================================
// GUILD BAN ADD — log
// ============================================================
client.on(Events.GuildBanAdd, async (ban) => {
sendLog(ban.guild, swiftEmbed(‘Member Banned’,
`🔨 **${ban.user.tag}** was banned.\n**Reason:** ${ban.reason || 'No reason'}`, CONFIG.DANGER_COLOR));
});

// ============================================================
// READY
// ============================================================
client.once(Events.ClientReady, () => {
console.log(`✅ SwiftX Guard is online as ${client.user.tag}`);
client.user.setActivity(‘your server 🛡️’, { type: 3 }); // Watching
client.user.setStatus(‘online’);
});

// ============================================================
// LOGIN
// ============================================================
client.login(CONFIG.TOKEN);