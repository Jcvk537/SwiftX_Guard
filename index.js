const { Client, GatewayIntentBits, Partials, EmbedBuilder, PermissionFlagsBits, Events, Collection } = require(‘discord.js’);

const TOKEN = process.env.TOKEN;
const LOG_CHANNEL = process.env.LOG_CHANNEL || ‘’;
const PREFIX = ‘!’;
const ACCENT = 0x0055FF;
const DANGER = 0xFF3030;
const SUCCESS = 0x00DD66;
const WARN = 0xFFAA00;

const client = new Client({
intents: [
GatewayIntentBits.Guilds,
GatewayIntentBits.GuildMembers,
GatewayIntentBits.GuildMessages,
GatewayIntentBits.GuildBans,
GatewayIntentBits.GuildModeration,
GatewayIntentBits.MessageContent
],
partials: [Partials.Channel, Partials.Message]
});

const db = {
warnings: {},
antiSpam: {},
antiRaid: {},
whitelisted: {},
automod: {},
badwords: {},
joinGate: {},
guildSettings: {}
};

function getAutomod(gid) {
if (!db.automod[gid]) {
db.automod[gid] = { spam: true, invites: false, caps: false, badwords: false, massMention: true, maxMentions: 5 };
}
return db.automod[gid];
}

function getWarnings(gid, uid) {
if (!db.warnings[gid]) db.warnings[gid] = {};
if (!db.warnings[gid][uid]) db.warnings[gid][uid] = [];
return db.warnings[gid][uid];
}

function makeEmbed(title, desc, color) {
return new EmbedBuilder()
.setColor(color || ACCENT)
.setTitle(’SwiftX Guard | ’ + title)
.setDescription(desc)
.setTimestamp()
.setFooter({ text: ‘SwiftX Guard’ });
}

function sendLog(guild, emb) {
const settings = db.guildSettings[guild.id] || {};
const logId = settings.logChannel || LOG_CHANNEL;
if (!logId) return;
guild.channels.fetch(logId).then(function(ch) {
if (ch) ch.send({ embeds: [emb] });
}).catch(function() {});
}

function isMod(member) {
return member.permissions.has(PermissionFlagsBits.ManageMessages) ||
member.permissions.has(PermissionFlagsBits.BanMembers) ||
member.permissions.has(PermissionFlagsBits.Administrator);
}

function hasPerm(member, perm) {
return member.permissions.has(perm);
}

function parseTime(str) {
if (!str) return null;
const units = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
const match = str.match(/^(\d+)([smhd])$/);
if (!match) return null;
return parseInt(match[1]) * units[match[2]];
}

function formatTime(ms) {
const s = Math.floor(ms / 1000);
const m = Math.floor(s / 60);
const h = Math.floor(m / 60);
const d = Math.floor(h / 24);
if (d > 0) return d + ’d ’ + (h % 24) + ‘h’;
if (h > 0) return h + ’h ’ + (m % 60) + ‘m’;
if (m > 0) return m + ’m ’ + (s % 60) + ‘s’;
return s + ‘s’;
}

function checkSpam(gid, uid, now) {
if (!db.antiSpam[gid]) db.antiSpam[gid] = {};
if (!db.antiSpam[gid][uid]) db.antiSpam[gid][uid] = { timestamps: [] };
const data = db.antiSpam[gid][uid];
data.timestamps = data.timestamps.filter(function(t) { return now - t < 3000; });
data.timestamps.push(now);
return data.timestamps.length >= 5;
}

function checkRaid(gid, now) {
if (!db.antiRaid[gid]) db.antiRaid[gid] = { joins: [], active: false };
const data = db.antiRaid[gid];
data.joins = data.joins.filter(function(t) { return now - t < 10000; });
data.joins.push(now);
if (data.joins.length >= 8 && !data.active) {
data.active = true;
setTimeout(function() { data.active = false; data.joins = []; }, 30000);
return true;
}
return data.active || false;
}

const commands = new Collection();

function addCmd(name, aliases, fn) {
commands.set(name, fn);
if (aliases) {
aliases.forEach(function(a) { commands.set(a, fn); });
}
}

addCmd(‘ban’, [‘b’], async function(msg, args) {
if (!hasPerm(msg.member, PermissionFlagsBits.BanMembers)) return msg.reply(‘No permission.’);
const target = msg.mentions.members.first();
if (!target) return msg.reply(‘Mention a user to ban.’);
const reason = args.slice(1).join(’ ’) || ‘No reason’;
try {
await target.ban({ reason: reason, deleteMessageSeconds: 86400 });
const e = makeEmbed(‘Member Banned’, target.user.tag + ’ was banned. Reason: ’ + reason, DANGER);
msg.channel.send({ embeds: [e] });
sendLog(msg.guild, e);
} catch(err) { msg.reply(‘Could not ban that user.’); }
});

addCmd(‘kick’, [‘k’], async function(msg, args) {
if (!hasPerm(msg.member, PermissionFlagsBits.KickMembers)) return msg.reply(‘No permission.’);
const target = msg.mentions.members.first();
if (!target) return msg.reply(‘Mention a user to kick.’);
const reason = args.slice(1).join(’ ’) || ‘No reason’;
try {
await target.kick(reason);
const e = makeEmbed(‘Member Kicked’, target.user.tag + ’ was kicked. Reason: ’ + reason, WARN);
msg.channel.send({ embeds: [e] });
sendLog(msg.guild, e);
} catch(err) { msg.reply(‘Could not kick that user.’); }
});

addCmd(‘mute’, [‘m’, ‘timeout’], async function(msg, args) {
if (!hasPerm(msg.member, PermissionFlagsBits.ModerateMembers)) return msg.reply(‘No permission.’);
const target = msg.mentions.members.first();
if (!target) return msg.reply(‘Mention a user to mute.’);
const duration = parseTime(args[1]);
if (!duration) return msg.reply(‘Invalid duration. Example: 10m, 2h, 1d’);
const reason = args.slice(2).join(’ ’) || ‘No reason’;
try {
await target.timeout(duration, reason);
const e = makeEmbed(‘Member Muted’, target.user.tag + ’ muted for ’ + formatTime(duration) + ’. Reason: ’ + reason, WARN);
msg.channel.send({ embeds: [e] });
sendLog(msg.guild, e);
} catch(err) { msg.reply(‘Could not mute that user.’); }
});

addCmd(‘unmute’, [‘um’], async function(msg, args) {
if (!hasPerm(msg.member, PermissionFlagsBits.ModerateMembers)) return msg.reply(‘No permission.’);
const target = msg.mentions.members.first();
if (!target) return msg.reply(‘Mention a user to unmute.’);
try {
await target.timeout(null);
msg.channel.send({ embeds: [makeEmbed(‘Unmuted’, target.user.tag + ’ has been unmuted.’, SUCCESS)] });
} catch(err) { msg.reply(‘Could not unmute.’); }
});

addCmd(‘warn’, [‘w’], async function(msg, args) {
if (!isMod(msg.member)) return msg.reply(‘No permission.’);
const target = msg.mentions.members.first();
if (!target) return msg.reply(‘Mention a user to warn.’);
const reason = args.slice(1).join(’ ‘) || ‘No reason’;
const warns = getWarnings(msg.guild.id, target.id);
warns.push({ reason: reason, date: new Date().toISOString(), mod: msg.author.tag });
let extra = ‘’;
try {
if (warns.length === 3) { await target.timeout(600000, ‘3 warnings’); extra = ’ | Auto-muted 10min’; }
else if (warns.length === 5) { await target.kick(‘5 warnings’); extra = ’ | Auto-kicked’; }
else if (warns.length >= 7) { await target.ban({ reason: ‘7 warnings’, deleteMessageSeconds: 0 }); extra = ’ | Auto-banned’; }
} catch(err) {}
const e = makeEmbed(‘Warning’, target.user.tag + ’ - Warning #’ + warns.length + ’. Reason: ’ + reason + extra, WARN);
msg.channel.send({ embeds: [e] });
sendLog(msg.guild, e);
target.send({ embeds: [makeEmbed(‘You were warned’, ’Server: ’ + msg.guild.name + ’ | Reason: ’ + reason + ’ | Total: ’ + warns.length, WARN)] }).catch(function() {});
});

addCmd(‘warnings’, [‘warns’], async function(msg, args) {
const target = msg.mentions.members.first() || msg.member;
const warns = getWarnings(msg.guild.id, target.id);
if (warns.length === 0) return msg.channel.send({ embeds: [makeEmbed(‘Warnings’, target.user.tag + ’ has no warnings.’, SUCCESS)] });
const list = warns.map(function(w, i) { return (i + 1) + ‘. ’ + w.reason + ’ by ’ + w.mod; }).join(’\n’);
msg.channel.send({ embeds: [makeEmbed(’Warnings - ’ + target.user.tag, list, WARN)] });
});

addCmd(‘clearwarnings’, [‘cw’], async function(msg, args) {
if (!isMod(msg.member)) return msg.reply(‘No permission.’);
const target = msg.mentions.members.first();
if (!target) return msg.reply(‘Mention a user.’);
if (db.warnings[msg.guild.id]) db.warnings[msg.guild.id][target.id] = [];
msg.channel.send({ embeds: [makeEmbed(‘Cleared’, ’Warnings cleared for ’ + target.user.tag, SUCCESS)] });
});

addCmd(‘purge’, [‘clear’], async function(msg, args) {
if (!hasPerm(msg.member, PermissionFlagsBits.ManageMessages)) return msg.reply(‘No permission.’);
const amount = parseInt(args[0]);
if (isNaN(amount) || amount < 1 || amount > 100) return msg.reply(‘Provide a number 1-100.’);
try {
await msg.delete();
const fetched = await msg.channel.messages.fetch({ limit: 100 });
const toDelete = fetched.first(amount);
await msg.channel.bulkDelete(toDelete, true);
const r = await msg.channel.send({ embeds: [makeEmbed(‘Purged’, ‘Deleted ’ + toDelete.length + ’ messages.’, SUCCESS)] });
setTimeout(function() { r.delete().catch(function() {}); }, 3000);
} catch(err) { msg.channel.send(‘Could not delete (messages may be too old).’); }
});

addCmd(‘lockdown’, [‘lock’], async function(msg, args) {
if (!hasPerm(msg.member, PermissionFlagsBits.ManageChannels)) return msg.reply(‘No permission.’);
const reason = args.join(’ ’) || ‘Emergency lockdown’;
let count = 0;
const channels = msg.guild.channels.cache.filter(function(c) { return c.isTextBased() && !c.isThread(); });
for (const pair of channels) {
try { await pair[1].permissionOverwrites.edit(msg.guild.roles.everyone, { SendMessages: false }); count++; } catch(err) {}
}
const e = makeEmbed(‘LOCKDOWN’, ’Server locked. Reason: ’ + reason + ’ | Channels: ’ + count + ‘. Use !unlock to restore.’, DANGER);
msg.channel.send({ embeds: [e] });
sendLog(msg.guild, e);
});

addCmd(‘unlock’, [], async function(msg, args) {
if (!hasPerm(msg.member, PermissionFlagsBits.ManageChannels)) return msg.reply(‘No permission.’);
let count = 0;
const channels = msg.guild.channels.cache.filter(function(c) { return c.isTextBased() && !c.isThread(); });
for (const pair of channels) {
try { await pair[1].permissionOverwrites.edit(msg.guild.roles.everyone, { SendMessages: null }); count++; } catch(err) {}
}
const e = makeEmbed(‘Unlocked’, ’Lockdown lifted. Channels: ’ + count, SUCCESS);
msg.channel.send({ embeds: [e] });
sendLog(msg.guild, e);
});

addCmd(‘slowmode’, [‘slow’], async function(msg, args) {
if (!hasPerm(msg.member, PermissionFlagsBits.ManageChannels)) return msg.reply(‘No permission.’);
const val = args[0] === ‘off’ ? 0 : parseInt(args[0]);
if (isNaN(val)) return msg.reply(‘Provide seconds or off.’);
await msg.channel.setRateLimitPerUser(Math.min(val, 21600));
msg.channel.send({ embeds: [makeEmbed(‘Slowmode’, val === 0 ? ‘Disabled.’ : ’Set to ’ + val + ‘s.’, SUCCESS)] });
});

addCmd(‘antispam’, [], async function(msg, args) {
if (!isMod(msg.member)) return msg.reply(‘No permission.’);
getAutomod(msg.guild.id).spam = args[0] === ‘on’;
msg.channel.send({ embeds: [makeEmbed(‘Anti-Spam’, ’Anti-spam is ’ + args[0] + ‘.’, args[0] === ‘on’ ? SUCCESS : WARN)] });
});

addCmd(‘antiinvite’, [‘antilink’], async function(msg, args) {
if (!isMod(msg.member)) return msg.reply(‘No permission.’);
getAutomod(msg.guild.id).invites = args[0] === ‘on’;
msg.channel.send({ embeds: [makeEmbed(‘Anti-Invite’, ’Invite filter is ’ + args[0] + ‘.’, args[0] === ‘on’ ? SUCCESS : WARN)] });
});

addCmd(‘anticaps’, [], async function(msg, args) {
if (!isMod(msg.member)) return msg.reply(‘No permission.’);
getAutomod(msg.guild.id).caps = args[0] === ‘on’;
msg.channel.send({ embeds: [makeEmbed(‘Anti-Caps’, ’Caps filter is ’ + args[0] + ‘.’, args[0] === ‘on’ ? SUCCESS : WARN)] });
});

addCmd(‘badword’, [‘bw’], async function(msg, args) {
if (!isMod(msg.member)) return msg.reply(‘No permission.’);
if (!db.badwords[msg.guild.id]) db.badwords[msg.guild.id] = [];
const action = args[0];
const word = args[1] ? args[1].toLowerCase() : null;
if (action === ‘add’ && word) {
db.badwords[msg.guild.id].push(word);
getAutomod(msg.guild.id).badwords = true;
return msg.channel.send({ embeds: [makeEmbed(‘Bad Word Added’, ’Added: ’ + word, SUCCESS)] });
}
if (action === ‘remove’ && word) {
db.badwords[msg.guild.id] = db.badwords[msg.guild.id].filter(function(w) { return w !== word; });
return msg.channel.send({ embeds: [makeEmbed(‘Bad Word Removed’, ‘Removed: ’ + word, SUCCESS)] });
}
if (action === ‘list’) {
const list = db.badwords[msg.guild.id];
return msg.channel.send({ embeds: [makeEmbed(‘Bad Words’, list.length ? list.join(’, ’) : ‘None.’, ACCENT)] });
}
msg.reply(‘Usage: !badword add/remove/list [word]’);
});

addCmd(‘antiraid’, [], async function(msg, args) {
if (!hasPerm(msg.member, PermissionFlagsBits.Administrator)) return msg.reply(‘Admin only.’);
if (!db.antiRaid[msg.guild.id]) db.antiRaid[msg.guild.id] = { joins: [], active: false, enabled: false };
db.antiRaid[msg.guild.id].enabled = args[0] === ‘on’;
msg.channel.send({ embeds: [makeEmbed(‘Anti-Raid’, ’Anti-raid is ’ + args[0] + ‘.’, args[0] === ‘on’ ? SUCCESS : WARN)] });
});

addCmd(‘whitelist’, [], async function(msg, args) {
if (!hasPerm(msg.member, PermissionFlagsBits.Administrator)) return msg.reply(‘Admin only.’);
if (!db.whitelisted[msg.guild.id]) db.whitelisted[msg.guild.id] = [];
const target = msg.mentions.users.first();
if (!target) return msg.reply(‘Mention a user.’);
if (args[0] === ‘add’) {
if (!db.whitelisted[msg.guild.id].includes(target.id)) db.whitelisted[msg.guild.id].push(target.id);
return msg.channel.send({ embeds: [makeEmbed(‘Whitelisted’, target.tag + ’ added to whitelist.’, SUCCESS)] });
}
if (args[0] === ‘remove’) {
db.whitelisted[msg.guild.id] = db.whitelisted[msg.guild.id].filter(function(id) { return id !== target.id; });
return msg.channel.send({ embeds: [makeEmbed(‘Whitelist’, target.tag + ’ removed from whitelist.’, SUCCESS)] });
}
});

addCmd(‘agegate’, [], async function(msg, args) {
if (!hasPerm(msg.member, PermissionFlagsBits.Administrator)) return msg.reply(‘Admin only.’);
if (!db.joinGate[msg.guild.id]) db.joinGate[msg.guild.id] = { enabled: false, minAge: 7 };
if (args[0] === ‘off’) {
db.joinGate[msg.guild.id].enabled = false;
return msg.channel.send({ embeds: [makeEmbed(‘Age Gate’, ‘Disabled.’, WARN)] });
}
const days = parseInt(args[0]);
if (isNaN(days)) return msg.reply(‘Provide days or off.’);
db.joinGate[msg.guild.id] = { enabled: true, minAge: days };
msg.channel.send({ embeds: [makeEmbed(‘Age Gate’, ‘Accounts newer than ’ + days + ’ days will be kicked.’, SUCCESS)] });
});

addCmd(‘tempban’, [‘tb’], async function(msg, args) {
if (!hasPerm(msg.member, PermissionFlagsBits.BanMembers)) return msg.reply(‘No permission.’);
const target = msg.mentions.members.first();
if (!target) return msg.reply(‘Mention a user.’);
const duration = parseTime(args[1]);
if (!duration) return msg.reply(‘Invalid duration. Example: 10m, 2h, 1d’);
const reason = args.slice(2).join(’ ’) || ‘Temp ban’;
try {
await target.ban({ reason: reason, deleteMessageSeconds: 0 });
const e = makeEmbed(‘Temp Ban’, target.user.tag + ’ banned for ’ + formatTime(duration) + ’. Reason: ’ + reason, DANGER);
msg.channel.send({ embeds: [e] });
sendLog(msg.guild, e);
const gRef = msg.guild;
const uid = target.id;
setTimeout(async function() {
try { await gRef.members.unban(uid, ‘Temp ban expired’); } catch(err) {}
}, duration);
} catch(err) { msg.reply(‘Could not ban.’); }
});

addCmd(‘unban’, [], async function(msg, args) {
if (!hasPerm(msg.member, PermissionFlagsBits.BanMembers)) return msg.reply(‘No permission.’);
if (!args[0]) return msg.reply(‘Provide a user ID.’);
try {
await msg.guild.members.unban(args[0]);
msg.channel.send({ embeds: [makeEmbed(‘Unbanned’, ‘User ’ + args[0] + ’ unbanned.’, SUCCESS)] });
} catch(err) { msg.reply(‘Could not unban.’); }
});

addCmd(‘nick’, [], async function(msg, args) {
if (!hasPerm(msg.member, PermissionFlagsBits.ManageNicknames)) return msg.reply(‘No permission.’);
const target = msg.mentions.members.first();
if (!target) return msg.reply(‘Mention a user.’);
const nick = args.slice(1).join(’ ’) || null;
try {
await target.setNickname(nick);
msg.channel.send({ embeds: [makeEmbed(‘Nickname’, nick ? ’Set to ’ + nick : ‘Reset.’, SUCCESS)] });
} catch(err) { msg.reply(‘Could not change nickname.’); }
});

addCmd(‘setlog’, [], async function(msg, args) {
if (!hasPerm(msg.member, PermissionFlagsBits.Administrator)) return msg.reply(‘Admin only.’);
const ch = msg.mentions.channels.first();
if (!ch) return msg.reply(‘Mention a channel.’);
if (!db.guildSettings[msg.guild.id]) db.guildSettings[msg.guild.id] = {};
db.guildSettings[msg.guild.id].logChannel = ch.id;
msg.channel.send({ embeds: [makeEmbed(‘Log Channel’, ’Set to ’ + ch.toString(), SUCCESS)] });
});

addCmd(‘userinfo’, [‘ui’], async function(msg, args) {
const target = msg.mentions.members.first() || msg.member;
const warns = getWarnings(msg.guild.id, target.id).length;
const roles = target.roles.cache.filter(function(r) { return r.id !== msg.guild.id; }).map(function(r) { return r.toString(); }).join(’, ’) || ‘None’;
const e = new EmbedBuilder()
.setColor(ACCENT)
.setTitle(‘SwiftX Guard | User Info’)
.setThumbnail(target.user.displayAvatarURL())
.addFields(
{ name: ‘Tag’, value: target.user.tag, inline: true },
{ name: ‘ID’, value: target.id, inline: true },
{ name: ‘Warnings’, value: String(warns), inline: true },
{ name: ‘Joined’, value: ‘<t:’ + Math.floor(target.joinedTimestamp / 1000) + ‘:R>’, inline: true },
{ name: ‘Created’, value: ‘<t:’ + Math.floor(target.user.createdTimestamp / 1000) + ‘:R>’, inline: true },
{ name: ‘Bot’, value: target.user.bot ? ‘Yes’ : ‘No’, inline: true },
{ name: ‘Roles’, value: roles.length > 900 ? roles.slice(0, 900) + ‘…’ : roles }
)
.setTimestamp().setFooter({ text: ‘SwiftX Guard’ });
msg.channel.send({ embeds: [e] });
});

addCmd(‘serverinfo’, [‘si’], async function(msg, args) {
const g = msg.guild;
await g.fetch();
const bots = g.members.cache.filter(function(m) { return m.user.bot; }).size;
const e = new EmbedBuilder()
.setColor(ACCENT)
.setTitle(‘SwiftX Guard | Server Info’)
.setThumbnail(g.iconURL())
.addFields(
{ name: ‘Name’, value: g.name, inline: true },
{ name: ‘Owner’, value: ‘<@’ + g.ownerId + ‘>’, inline: true },
{ name: ‘Members’, value: (g.memberCount - bots) + ’ humans, ’ + bots + ’ bots’, inline: true },
{ name: ‘Channels’, value: String(g.channels.cache.size), inline: true },
{ name: ‘Roles’, value: String(g.roles.cache.size), inline: true },
{ name: ‘Created’, value: ‘<t:’ + Math.floor(g.createdTimestamp / 1000) + ‘:R>’, inline: true }
)
.setTimestamp().setFooter({ text: ‘SwiftX Guard’ });
msg.channel.send({ embeds: [e] });
});

addCmd(‘help’, [‘h’], async function(msg, args) {
const e = new EmbedBuilder()
.setColor(ACCENT)
.setTitle(‘SwiftX Guard | Commands’)
.setDescription(‘Prefix: !’)
.addFields(
{ name: ‘Moderation’, value: ‘ban, kick, mute, unmute, warn, warnings, clearwarnings, tempban, unban, purge, nick’ },
{ name: ‘Security’, value: ‘lockdown, unlock, slowmode, antispam, antiinvite, anticaps, badword, antiraid, whitelist, agegate, setlog’ },
{ name: ‘Info’, value: ‘userinfo, serverinfo, help’ },
{ name: ‘Auto’, value: ‘Anti-Spam, Anti-Raid, Bad Word Filter, Invite Blocker, Age Gate, Auto-Punish on warns’ }
)
.setTimestamp().setFooter({ text: ‘SwiftX Guard’ });
msg.channel.send({ embeds: [e] });
});

client.on(Events.MessageCreate, async function(msg) {
if (msg.author.bot || !msg.guild) return;
const now = Date.now();
const gid = msg.guild.id;
const uid = msg.author.id;
const content = msg.content;
const automod = getAutomod(gid);
const whitelisted = db.whitelisted[gid] ? db.whitelisted[gid].includes(uid) : false;
const modUser = isMod(msg.member);

```
if (!whitelisted && !modUser) {
    if (automod.spam && checkSpam(gid, uid, now)) {
        msg.delete().catch(function() {});
        msg.member.timeout(30000, 'Spam').catch(function() {});
        const e = makeEmbed('Spam', msg.author.tag + ' auto-muted 30s for spam.', DANGER);
        msg.channel.send({ embeds: [e] }).then(function(m) { setTimeout(function() { m.delete().catch(function() {}); }, 5000); });
        sendLog(msg.guild, e);
        return;
    }
    if (automod.invites && /discord\.gg\/\S+|discord\.com\/invite\/\S+/i.test(content)) {
        msg.delete().catch(function() {});
        msg.channel.send({ embeds: [makeEmbed('Invite Blocked', msg.author.tag + ' - No invites!', WARN)] })
            .then(function(m) { setTimeout(function() { m.delete().catch(function() {}); }, 4000); });
        return;
    }
    if (automod.caps && content.length >= 10) {
        const up = content.split('').filter(function(c) { return c >= 'A' && c <= 'Z'; }).length;
        const lt = content.split('').filter(function(c) { return /[a-zA-Z]/.test(c); }).length;
        if (lt > 0 && up / lt > 0.7) {
            msg.delete().catch(function() {});
            msg.channel.send({ embeds: [makeEmbed('Caps', msg.author.tag + ' - No excessive caps!', WARN)] })
                .then(function(m) { setTimeout(function() { m.delete().catch(function() {}); }, 4000); });
            return;
        }
    }
    if (automod.badwords && db.badwords[gid]) {
        const lower = content.toLowerCase();
        let found = null;
        for (let i = 0; i < db.badwords[gid].length; i++) {
            if (lower.indexOf(db.badwords[gid][i]) !== -1) { found = db.badwords[gid][i]; break; }
        }
        if (found) {
            msg.delete().catch(function() {});
            msg.channel.send({ embeds: [makeEmbed('Filtered', msg.author.tag + ' - Message removed.', WARN)] })
                .then(function(m) { setTimeout(function() { m.delete().catch(function() {}); }, 4000); });
            return;
        }
    }
    if (automod.massMention && msg.mentions.users.size >= automod.maxMentions) {
        msg.delete().catch(function() {});
        msg.member.timeout(60000, 'Mass mention').catch(function() {});
        const e = makeEmbed('Mass Mention', msg.author.tag + ' muted for mass mentioning.', DANGER);
        msg.channel.send({ embeds: [e] }).then(function(m) { setTimeout(function() { m.delete().catch(function() {}); }, 5000); });
        sendLog(msg.guild, e);
        return;
    }
}

if (!content.startsWith(PREFIX)) return;
const args = content.slice(PREFIX.length).trim().split(/\s+/);
const cmdName = args.shift().toLowerCase();
const command = commands.get(cmdName);
if (command) {
    try { await command(msg, args); }
    catch(err) {
        console.error('Error [' + cmdName + ']:', err);
        msg.reply('An error occurred.').catch(function() {});
    }
}
```

});

client.on(Events.GuildMemberAdd, async function(member) {
const gid = member.guild.id;
const now = Date.now();
const raidData = db.antiRaid[gid];
if (raidData && raidData.enabled && checkRaid(gid, now)) {
try {
await member.kick(‘Anti-raid’);
sendLog(member.guild, makeEmbed(‘RAID’, ‘Kicked ’ + member.user.tag + ’ - mass join.’, DANGER));
} catch(err) {}
return;
}
const gate = db.joinGate[gid];
if (gate && gate.enabled) {
const ageDays = (now - member.user.createdTimestamp) / 86400000;
if (ageDays < gate.minAge) {
try {
member.send({ embeds: [makeEmbed(‘Kicked’, member.guild.name + ’ requires accounts ’ + gate.minAge + ’ days old. Yours: ’ + Math.floor(ageDays) + ’ days.’, DANGER)] }).catch(function() {});
await member.kick(‘Account too new’);
sendLog(member.guild, makeEmbed(‘Age Gate’, member.user.tag + ’ kicked - ’ + Math.floor(ageDays) + ’ days old.’, WARN));
} catch(err) {}
return;
}
}
sendLog(member.guild, makeEmbed(‘Member Joined’, member.user.tag + ’ joined. ID: ’ + member.id, SUCCESS));
});

client.on(Events.GuildMemberRemove, function(member) {
sendLog(member.guild, makeEmbed(‘Member Left’, member.user.tag + ’ left. ID: ’ + member.id, WARN));
});

client.on(Events.GuildBanAdd, function(ban) {
sendLog(ban.guild, makeEmbed(‘Banned’, ban.user.tag + ’ was banned. Reason: ’ + (ban.reason || ‘None’), DANGER));
});

client.once(Events.ClientReady, function() {
console.log(’SwiftX Guard online as ’ + client.user.tag);
client.user.setActivity(‘your server’, { type: 3 });
client.user.setStatus(‘online’);
});

client.login(TOKEN);