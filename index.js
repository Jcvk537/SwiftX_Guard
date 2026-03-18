const { Client, GatewayIntentBits, Partials, EmbedBuilder, PermissionFlagsBits, Events, Collection } = require(‘discord.js’);

const TOKEN = process.env.TOKEN;
const CLIENT_ID = ‘1483855827046629448’;
const LOG_CHANNEL = process.env.LOG_CHANNEL || ‘’;
const PREFIX = ‘;’;
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

var db = {
warnings:  {},
antiSpam:  {},
antiRaid:  {},
whitelisted: {},
automod:   {},
badwords:  {},
joinGate:  {},
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

function embed(title, desc, color) {
return new EmbedBuilder()
.setColor(color || ACCENT)
.setTitle(’SwiftX Guard | ’ + title)
.setDescription(desc)
.setTimestamp()
.setFooter({ text: ‘SwiftX Guard’ });
}

function sendLog(guild, emb) {
var settings = db.guildSettings[guild.id] || {};
var logId = settings.logChannel || LOG_CHANNEL;
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
var units = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
var match = str.match(/^(\d+)([smhd])$/);
if (!match) return null;
return parseInt(match[1]) * units[match[2]];
}

function formatTime(ms) {
var s = Math.floor(ms / 1000);
var m = Math.floor(s / 60);
var h = Math.floor(m / 60);
var d = Math.floor(h / 24);
if (d > 0) return d + ’d ’ + (h % 24) + ‘h’;
if (h > 0) return h + ’h ’ + (m % 60) + ‘m’;
if (m > 0) return m + ’m ’ + (s % 60) + ‘s’;
return s + ‘s’;
}

var SPAM_THRESHOLD = 5;
var SPAM_WINDOW = 3000;

function checkSpam(gid, uid, now) {
if (!db.antiSpam[gid]) db.antiSpam[gid] = {};
if (!db.antiSpam[gid][uid]) db.antiSpam[gid][uid] = { timestamps: [] };
var data = db.antiSpam[gid][uid];
data.timestamps = data.timestamps.filter(function(t) { return now - t < SPAM_WINDOW; });
data.timestamps.push(now);
return data.timestamps.length >= SPAM_THRESHOLD;
}

var RAID_THRESHOLD = 8;
var RAID_WINDOW = 10000;

function checkRaid(gid, now) {
if (!db.antiRaid[gid]) db.antiRaid[gid] = { joins: [], active: false };
var data = db.antiRaid[gid];
data.joins = data.joins.filter(function(t) { return now - t < RAID_WINDOW; });
data.joins.push(now);
if (data.joins.length >= RAID_THRESHOLD && !data.active) {
data.active = true;
setTimeout(function() { data.active = false; data.joins = []; }, 30000);
return true;
}
return data.active || false;
}

var commands = new Collection();

function cmd(name, aliases, fn) {
commands.set(name, fn);
if (aliases) {
aliases.forEach(function(a) { commands.set(a, fn); });
}
}

cmd(‘ban’, [‘b’], async function(msg, args) {
if (!hasPerm(msg.member, PermissionFlagsBits.BanMembers)) return msg.reply(‘No permission.’);
var target = msg.mentions.members.first();
if (!target) return msg.reply(‘Mention a user to ban.’);
var reason = args.slice(1).join(’ ’) || ‘No reason’;
try {
await target.ban({ reason: reason, deleteMessageSeconds: 86400 });
var e = embed(‘Member Banned’, target.user.tag + ’ was banned.\nReason: ’ + reason, DANGER);
msg.channel.send({ embeds: [e] });
sendLog(msg.guild, e);
} catch(err) { msg.reply(‘Could not ban that user.’); }
});

cmd(‘kick’, [‘k’], async function(msg, args) {
if (!hasPerm(msg.member, PermissionFlagsBits.KickMembers)) return msg.reply(‘No permission.’);
var target = msg.mentions.members.first();
if (!target) return msg.reply(‘Mention a user to kick.’);
var reason = args.slice(1).join(’ ’) || ‘No reason’;
try {
await target.kick(reason);
var e = embed(‘Member Kicked’, target.user.tag + ’ was kicked.\nReason: ’ + reason, WARN);
msg.channel.send({ embeds: [e] });
sendLog(msg.guild, e);
} catch(err) { msg.reply(‘Could not kick that user.’); }
});

cmd(‘mute’, [‘m’, ‘timeout’], async function(msg, args) {
if (!hasPerm(msg.member, PermissionFlagsBits.ModerateMembers)) return msg.reply(‘No permission.’);
var target = msg.mentions.members.first();
if (!target) return msg.reply(‘Mention a user to mute.’);
var duration = parseTime(args[1]);
if (!duration) return msg.reply(‘Invalid duration. Use: 10m, 2h, 1d’);
var reason = args.slice(2).join(’ ’) || ‘No reason’;
try {
await target.timeout(duration, reason);
var e = embed(‘Member Muted’, target.user.tag + ’ muted for ’ + formatTime(duration) + ’.\nReason: ’ + reason, WARN);
msg.channel.send({ embeds: [e] });
sendLog(msg.guild, e);
} catch(err) { msg.reply(‘Could not mute that user.’); }
});

cmd(‘unmute’, [‘um’], async function(msg, args) {
if (!hasPerm(msg.member, PermissionFlagsBits.ModerateMembers)) return msg.reply(‘No permission.’);
var target = msg.mentions.members.first();
if (!target) return msg.reply(‘Mention a user to unmute.’);
try {
await target.timeout(null);
msg.channel.send({ embeds: [embed(‘Member Unmuted’, target.user.tag + ’ has been unmuted.’, SUCCESS)] });
} catch(err) { msg.reply(‘Could not unmute that user.’); }
});

cmd(‘warn’, [‘w’], async function(msg, args) {
if (!isMod(msg.member)) return msg.reply(‘No permission.’);
var target = msg.mentions.members.first();
if (!target) return msg.reply(‘Mention a user to warn.’);
var reason = args.slice(1).join(’ ‘) || ‘No reason’;
var warns = getWarnings(msg.guild.id, target.id);
warns.push({ reason: reason, date: new Date().toISOString(), mod: msg.author.tag });
var extra = ‘’;
try {
if (warns.length === 3) {
await target.timeout(600000, ‘Auto-mute: 3 warnings’);
extra = ‘\nAuto-muted for 10 minutes (3 warnings)’;
} else if (warns.length === 5) {
await target.kick(‘Auto-kick: 5 warnings’);
extra = ‘\nAuto-kicked (5 warnings)’;
} else if (warns.length >= 7) {
await target.ban({ reason: ‘Auto-ban: 7+ warnings’, deleteMessageSeconds: 0 });
extra = ‘\nAuto-banned (7+ warnings)’;
}
} catch(err) {}
var e = embed(‘Warning Issued’, target.user.tag + ’ — Warning #’ + warns.length + ’\nReason: ’ + reason + extra, WARN);
msg.channel.send({ embeds: [e] });
sendLog(msg.guild, e);
target.send({ embeds: [embed(‘You were warned’, ’Server: ’ + msg.guild.name + ’\nReason: ’ + reason + ’\nTotal warnings: ’ + warns.length, WARN)] }).catch(function() {});
});

cmd(‘warnings’, [‘warns’], async function(msg, args) {
var target = msg.mentions.members.first() || msg.member;
var warns = getWarnings(msg.guild.id, target.id);
if (warns.length === 0) return msg.channel.send({ embeds: [embed(‘Warnings’, target.user.tag + ’ has no warnings.’, SUCCESS)] });
var list = warns.map(function(w, i) { return (i + 1) + ‘. ’ + w.reason + ’ — ’ + w.mod + ’ (’ + w.date.split(‘T’)[0] + ‘)’; }).join(’\n’);
msg.channel.send({ embeds: [embed(’Warnings — ’ + target.user.tag, list, WARN)] });
});

cmd(‘clearwarnings’, [‘cw’], async function(msg, args) {
if (!isMod(msg.member)) return msg.reply(‘No permission.’);
var target = msg.mentions.members.first();
if (!target) return msg.reply(‘Mention a user.’);
if (db.warnings[msg.guild.id]) db.warnings[msg.guild.id][target.id] = [];
msg.channel.send({ embeds: [embed(‘Warnings Cleared’, ’Cleared all warnings for ’ + target.user.tag + ‘.’, SUCCESS)] });
});

cmd(‘purge’, [‘clear’, ‘prune’], async function(msg, args) {
if (!hasPerm(msg.member, PermissionFlagsBits.ManageMessages)) return msg.reply(‘No permission.’);
var amount = parseInt(args[0]);
if (isNaN(amount) || amount < 1 || amount > 100) return msg.reply(‘Provide a number between 1 and 100.’);
try {
await msg.delete();
var fetched = await msg.channel.messages.fetch({ limit: 100 });
var targetUser = msg.mentions.users.first();
if (targetUser) fetched = fetched.filter(function(m) { return m.author.id === targetUser.id; });
var toDelete = fetched.first(amount);
await msg.channel.bulkDelete(toDelete, true);
var reply = await msg.channel.send({ embeds: [embed(‘Messages Purged’, ‘Deleted ’ + toDelete.length + ’ messages.’, SUCCESS)] });
setTimeout(function() { reply.delete().catch(function() {}); }, 3000);
} catch(err) { msg.channel.send(‘Could not delete messages (may be too old).’); }
});

cmd(‘lockdown’, [‘lock’], async function(msg, args) {
if (!hasPerm(msg.member, PermissionFlagsBits.ManageChannels)) return msg.reply(‘No permission.’);
var reason = args.join(’ ’) || ‘Emergency lockdown’;
var channels = msg.guild.channels.cache.filter(function(c) { return c.isTextBased() && !c.isThread(); });
var count = 0;
for (var pair of channels) {
try {
await pair[1].permissionOverwrites.edit(msg.guild.roles.everyone, { SendMessages: false });
count++;
} catch(err) {}
}
var e = embed(‘SERVER LOCKDOWN’, ’Server locked down.\nReason: ’ + reason + ’\nChannels locked: ’ + count + ‘\n\nUse !unlock to restore.’, DANGER);
msg.channel.send({ embeds: [e] });
sendLog(msg.guild, e);
});

cmd(‘unlock’, [], async function(msg, args) {
if (!hasPerm(msg.member, PermissionFlagsBits.ManageChannels)) return msg.reply(‘No permission.’);
var channels = msg.guild.channels.cache.filter(function(c) { return c.isTextBased() && !c.isThread(); });
var count = 0;
for (var pair of channels) {
try {
await pair[1].permissionOverwrites.edit(msg.guild.roles.everyone, { SendMessages: null });
count++;
} catch(err) {}
}
var e = embed(‘Server Unlocked’, ’Lockdown lifted. Channels unlocked: ’ + count, SUCCESS);
msg.channel.send({ embeds: [e] });
sendLog(msg.guild, e);
});

cmd(‘slowmode’, [‘slow’], async function(msg, args) {
if (!hasPerm(msg.member, PermissionFlagsBits.ManageChannels)) return msg.reply(‘No permission.’);
var val = args[0] === ‘off’ ? 0 : parseInt(args[0]);
if (isNaN(val)) return msg.reply(‘Provide seconds or “off”.’);
await msg.channel.setRateLimitPerUser(Math.min(val, 21600));
msg.channel.send({ embeds: [embed(‘Slowmode’, val === 0 ? ‘Slowmode disabled.’ : ’Slowmode set to ’ + val + ‘s.’, SUCCESS)] });
});

cmd(‘antispam’, [], async function(msg, args) {
if (!isMod(msg.member)) return msg.reply(‘No permission.’);
var state = args[0] === ‘on’;
getAutomod(msg.guild.id).spam = state;
msg.channel.send({ embeds: [embed(‘Anti-Spam’, ’Anti-spam is now ’ + (state ? ‘ON’ : ‘OFF’) + ‘.’, state ? SUCCESS : WARN)] });
});

cmd(‘antiinvite’, [‘antilink’], async function(msg, args) {
if (!isMod(msg.member)) return msg.reply(‘No permission.’);
var state = args[0] === ‘on’;
getAutomod(msg.guild.id).invites = state;
msg.channel.send({ embeds: [embed(‘Anti-Invite’, ’Invite link filter is ’ + (state ? ‘ON’ : ‘OFF’) + ‘.’, state ? SUCCESS : WARN)] });
});

cmd(‘anticaps’, [], async function(msg, args) {
if (!isMod(msg.member)) return msg.reply(‘No permission.’);
var state = args[0] === ‘on’;
getAutomod(msg.guild.id).caps = state;
msg.channel.send({ embeds: [embed(‘Anti-Caps’, ’Caps filter is ’ + (state ? ‘ON’ : ‘OFF’) + ‘.’, state ? SUCCESS : WARN)] });
});

cmd(‘badword’, [‘bw’], async function(msg, args) {
if (!isMod(msg.member)) return msg.reply(‘No permission.’);
if (!db.badwords[msg.guild.id]) db.badwords[msg.guild.id] = [];
var action = args[0];
var word = args[1] ? args[1].toLowerCase() : null;
if (action === ‘add’ && word) {
db.badwords[msg.guild.id].push(word);
getAutomod(msg.guild.id).badwords = true;
return msg.channel.send({ embeds: [embed(‘Bad Word Added’, ‘Added “’ + word + ‘” to filter.’, SUCCESS)] });
}
if (action === ‘remove’ && word) {
db.badwords[msg.guild.id] = db.badwords[msg.guild.id].filter(function(w) { return w !== word; });
return msg.channel.send({ embeds: [embed(‘Bad Word Removed’, ‘Removed “’ + word + ‘” from filter.’, SUCCESS)] });
}
if (action === ‘list’) {
var list = db.badwords[msg.guild.id];
return msg.channel.send({ embeds: [embed(‘Bad Word List’, list.length ? list.join(’, ’) : ‘No bad words added.’, ACCENT)] });
}
msg.reply(‘Usage: !badword add/remove/list [word]’);
});

cmd(‘antiraid’, [], async function(msg, args) {
if (!hasPerm(msg.member, PermissionFlagsBits.Administrator)) return msg.reply(‘Administrator only.’);
if (!db.antiRaid[msg.guild.id]) db.antiRaid[msg.guild.id] = { joins: [], active: false, enabled: false };
db.antiRaid[msg.guild.id].enabled = args[0] === ‘on’;
msg.channel.send({ embeds: [embed(‘Anti-Raid’, ’Anti-raid is ’ + (args[0] === ‘on’ ? ‘ON’ : ‘OFF’) + ‘.’, args[0] === ‘on’ ? SUCCESS : WARN)] });
});

cmd(‘whitelist’, [], async function(msg, args) {
if (!hasPerm(msg.member, PermissionFlagsBits.Administrator)) return msg.reply(‘Administrator only.’);
if (!db.whitelisted[msg.guild.id]) db.whitelisted[msg.guild.id] = [];
var target = msg.mentions.users.first();
if (!target) return msg.reply(‘Mention a user.’);
if (args[0] === ‘add’) {
if (!db.whitelisted[msg.guild.id].includes(target.id)) db.whitelisted[msg.guild.id].push(target.id);
return msg.channel.send({ embeds: [embed(‘Whitelist’, target.tag + ’ is now whitelisted from automod.’, SUCCESS)] });
}
if (args[0] === ‘remove’) {
db.whitelisted[msg.guild.id] = db.whitelisted[msg.guild.id].filter(function(id) { return id !== target.id; });
return msg.channel.send({ embeds: [embed(‘Whitelist’, target.tag + ’ removed from whitelist.’, SUCCESS)] });
}
});

cmd(‘agegate’, [‘joingate’], async function(msg, args) {
if (!hasPerm(msg.member, PermissionFlagsBits.Administrator)) return msg.reply(‘Administrator only.’);
if (!db.joinGate[msg.guild.id]) db.joinGate[msg.guild.id] = { enabled: false, minAge: 7 };
if (args[0] === ‘off’) {
db.joinGate[msg.guild.id].enabled = false;
return msg.channel.send({ embeds: [embed(‘Age Gate’, ‘Account age gate disabled.’, WARN)] });
}
var days = parseInt(args[0]);
if (isNaN(days)) return msg.reply(‘Provide number of days or “off”.’);
db.joinGate[msg.guild.id] = { enabled: true, minAge: days };
msg.channel.send({ embeds: [embed(‘Age Gate’, ‘Accounts newer than ’ + days + ’ days will be kicked.’, SUCCESS)] });
});

cmd(‘tempban’, [‘tb’], async function(msg, args) {
if (!hasPerm(msg.member, PermissionFlagsBits.BanMembers)) return msg.reply(‘No permission.’);
var target = msg.mentions.members.first();
if (!target) return msg.reply(‘Mention a user.’);
var duration = parseTime(args[1]);
if (!duration) return msg.reply(‘Invalid duration. Use: 10m, 2h, 1d’);
var reason = args.slice(2).join(’ ’) || ‘Temporary ban’;
try {
await target.ban({ reason: reason, deleteMessageSeconds: 0 });
var e = embed(‘Temp Ban’, target.user.tag + ’ temp banned for ’ + formatTime(duration) + ’.\nReason: ’ + reason, DANGER);
msg.channel.send({ embeds: [e] });
sendLog(msg.guild, e);
var guildRef = msg.guild;
var userId = target.id;
setTimeout(async function() {
try {
await guildRef.members.unban(userId, ‘Temp ban expired’);
sendLog(guildRef, embed(‘Temp Ban Expired’, ‘User ’ + userId + ’ unbanned (temp ban expired).’, SUCCESS));
} catch(err) {}
}, duration);
} catch(err) { msg.reply(‘Could not ban that user.’); }
});

cmd(‘unban’, [], async function(msg, args) {
if (!hasPerm(msg.member, PermissionFlagsBits.BanMembers)) return msg.reply(‘No permission.’);
if (!args[0]) return msg.reply(‘Provide a user ID.’);
try {
await msg.guild.members.unban(args[0]);
msg.channel.send({ embeds: [embed(‘User Unbanned’, ‘User ’ + args[0] + ’ has been unbanned.’, SUCCESS)] });
} catch(err) { msg.reply(‘Could not unban. Make sure the ID is correct.’); }
});

cmd(‘nick’, [], async function(msg, args) {
if (!hasPerm(msg.member, PermissionFlagsBits.ManageNicknames)) return msg.reply(‘No permission.’);
var target = msg.mentions.members.first();
if (!target) return msg.reply(‘Mention a user.’);
var nick = args.slice(1).join(’ ’) || null;
try {
await target.setNickname(nick);
msg.channel.send({ embeds: [embed(‘Nickname Changed’, nick ? ’Set nickname to ’ + nick + ‘.’ : ‘Reset nickname.’, SUCCESS)] });
} catch(err) { msg.reply(‘Could not change nickname.’); }
});

cmd(‘setlog’, [‘logchannel’], async function(msg, args) {
if (!hasPerm(msg.member, PermissionFlagsBits.Administrator)) return msg.reply(‘Administrator only.’);
var ch = msg.mentions.channels.first();
if (!ch) return msg.reply(‘Mention a channel.’);
if (!db.guildSettings[msg.guild.id]) db.guildSettings[msg.guild.id] = {};
db.guildSettings[msg.guild.id].logChannel = ch.id;
msg.channel.send({ embeds: [embed(‘Log Channel Set’, ’Log channel set to ’ + ch.toString() + ‘.’, SUCCESS)] });
});

cmd(‘userinfo’, [‘ui’], async function(msg, args) {
var target = msg.mentions.members.first() || msg.member;
var warns = getWarnings(msg.guild.id, target.id).length;
var roles = target.roles.cache.filter(function(r) { return r.id !== msg.guild.id; }).map(function(r) { return r.toString(); }).join(’, ’) || ‘None’;
var e = new EmbedBuilder()
.setColor(ACCENT)
.setTitle(‘SwiftX Guard | User Info’)
.setThumbnail(target.user.displayAvatarURL())
.addFields(
{ name: ‘Tag’, value: target.user.tag, inline: true },
{ name: ‘ID’, value: target.id, inline: true },
{ name: ‘Warnings’, value: String(warns), inline: true },
{ name: ‘Joined Server’, value: ‘<t:’ + Math.floor(target.joinedTimestamp / 1000) + ‘:R>’, inline: true },
{ name: ‘Account Created’, value: ‘<t:’ + Math.floor(target.user.createdTimestamp / 1000) + ‘:R>’, inline: true },
{ name: ‘Bot’, value: target.user.bot ? ‘Yes’ : ‘No’, inline: true },
{ name: ‘Roles’, value: roles.length > 1000 ? roles.slice(0, 1000) + ‘…’ : roles }
)
.setTimestamp()
.setFooter({ text: ‘SwiftX Guard’ });
msg.channel.send({ embeds: [e] });
});

cmd(‘serverinfo’, [‘si’], async function(msg, args) {
var g = msg.guild;
await g.fetch();
var bots = g.members.cache.filter(function(m) { return m.user.bot; }).size;
var humans = g.memberCount - bots;
var levels = [‘None’, ‘Low’, ‘Medium’, ‘High’, ‘Very High’];
var e = new EmbedBuilder()
.setColor(ACCENT)
.setTitle(‘SwiftX Guard | Server Info’)
.setThumbnail(g.iconURL())
.addFields(
{ name: ‘Name’, value: g.name, inline: true },
{ name: ‘Owner’, value: ‘<@’ + g.ownerId + ‘>’, inline: true },
{ name: ‘Members’, value: humans + ’ humans, ’ + bots + ’ bots’, inline: true },
{ name: ‘Channels’, value: String(g.channels.cache.size), inline: true },
{ name: ‘Roles’, value: String(g.roles.cache.size), inline: true },
{ name: ‘Boosts’, value: String(g.premiumSubscriptionCount), inline: true },
{ name: ‘Created’, value: ‘<t:’ + Math.floor(g.createdTimestamp / 1000) + ‘:R>’, inline: true },
{ name: ‘Verification’, value: levels[g.verificationLevel] || ‘Unknown’, inline: true }
)
.setTimestamp()
.setFooter({ text: ‘SwiftX Guard’ });
msg.channel.send({ embeds: [e] });
});

cmd(‘help’, [‘h’], async function(msg, args) {
var e = new EmbedBuilder()
.setColor(ACCENT)
.setTitle(‘SwiftX Guard | Commands’)
.setDescription(‘Prefix: `!`’)
.addFields(
{ name: ‘Moderation’, value: ‘`ban` `kick` `mute` `unmute` `warn` `warnings` `clearwarnings` `tempban` `unban` `purge` `nick`’ },
{ name: ‘Security’, value: ‘`lockdown` `unlock` `slowmode` `antispam` `antiinvite` `anticaps` `badword` `antiraid` `whitelist` `agegate` `setlog`’ },
{ name: ‘Info’, value: ‘`userinfo` `serverinfo` `help`’ },
{ name: ‘Auto Features’, value: ‘Anti-Spam, Anti-Raid, Bad Word Filter, Invite Blocker, Age Gate, Auto-Punish on warns, Mass Mention detection’ }
)
.setTimestamp()
.setFooter({ text: ‘SwiftX Guard’ });
msg.channel.send({ embeds: [e] });
});

client.on(Events.MessageCreate, async function(msg) {
if (msg.author.bot || !msg.guild) return;

```
var now = Date.now();
var gid = msg.guild.id;
var uid = msg.author.id;
var content = msg.content;
var automod = getAutomod(gid);
var whitelisted = db.whitelisted[gid] ? db.whitelisted[gid].includes(uid) : false;
var modUser = isMod(msg.member);

if (!whitelisted && !modUser) {
    if (automod.spam && checkSpam(gid, uid, now)) {
        msg.delete().catch(function() {});
        msg.member.timeout(30000, 'Auto-mute: spam').catch(function() {});
        var e = embed('Spam Detected', msg.author.tag + ' was auto-muted 30s for spamming.', DANGER);
        msg.channel.send({ embeds: [e] }).then(function(m) { setTimeout(function() { m.delete().catch(function() {}); }, 5000); });
        sendLog(msg.guild, e);
        return;
    }

    if (automod.invites && /discord\.gg\/\S+|discord\.com\/invite\/\S+/i.test(content)) {
        msg.delete().catch(function() {});
        msg.channel.send({ embeds: [embed('Invite Blocked', msg.author.tag + ' — No Discord invites allowed!', WARN)] })
            .then(function(m) { setTimeout(function() { m.delete().catch(function() {}); }, 4000); });
        return;
    }

    if (automod.caps && content.length >= 10) {
        var uppers = content.split('').filter(function(c) { return c >= 'A' && c <= 'Z'; }).length;
        var letters = content.split('').filter(function(c) { return /[a-zA-Z]/.test(c); }).length;
        if (letters > 0 && uppers / letters > 0.7) {
            msg.delete().catch(function() {});
            msg.channel.send({ embeds: [embed('Caps Blocked', msg.author.tag + ' — No excessive caps!', WARN)] })
                .then(function(m) { setTimeout(function() { m.delete().catch(function() {}); }, 4000); });
            return;
        }
    }

    if (automod.badwords && db.badwords[gid]) {
        var lower = content.toLowerCase();
        var found = null;
        for (var i = 0; i < db.badwords[gid].length; i++) {
            if (lower.indexOf(db.badwords[gid][i]) !== -1) { found = db.badwords[gid][i]; break; }
        }
        if (found) {
            msg.delete().catch(function() {});
            msg.channel.send({ embeds: [embed('Message Removed', msg.author.tag + ' — Message contained a filtered word.', WARN)] })
                .then(function(m) { setTimeout(function() { m.delete().catch(function() {}); }, 4000); });
            return;
        }
    }

    if (automod.massMention && msg.mentions.users.size >= automod.maxMentions) {
        msg.delete().catch(function() {});
        msg.member.timeout(60000, 'Auto-mute: mass mention').catch(function() {});
        var me = embed('Mass Mention', msg.author.tag + ' was muted for mass mentioning.', DANGER);
        msg.channel.send({ embeds: [me] }).then(function(m) { setTimeout(function() { m.delete().catch(function() {}); }, 5000); });
        sendLog(msg.guild, me);
        return;
    }
}

if (!content.startsWith(PREFIX)) return;
var args = content.slice(PREFIX.length).trim().split(/\s+/);
var cmdName = args.shift().toLowerCase();
var command = commands.get(cmdName);
if (command) {
    try { await command(msg, args); }
    catch(err) {
        console.error('Command error [' + cmdName + ']:', err);
        msg.reply('An error occurred.').catch(function() {});
    }
}
```

});

client.on(Events.GuildMemberAdd, async function(member) {
var gid = member.guild.id;
var now = Date.now();

```
var raidData = db.antiRaid[gid];
if (raidData && raidData.enabled && checkRaid(gid, now)) {
    try {
        await member.kick('Anti-raid: mass join detected');
        sendLog(member.guild, embed('RAID DETECTED', 'Kicked ' + member.user.tag + ' — mass join detected.', DANGER));
    } catch(err) {}
    return;
}

var gate = db.joinGate[gid];
if (gate && gate.enabled) {
    var ageDays = (now - member.user.createdTimestamp) / 86400000;
    if (ageDays < gate.minAge) {
        try {
            member.send({ embeds: [embed('Kicked — Account Too New',
                member.guild.name + ' requires accounts to be at least ' + gate.minAge + ' days old.\nYour account is ' + Math.floor(ageDays) + ' days old.',
                DANGER)] }).catch(function() {});
            await member.kick('Age gate: account too new');
            sendLog(member.guild, embed('Age Gate', member.user.tag + ' kicked — account is ' + Math.floor(ageDays) + ' days old (min: ' + gate.minAge + ').', WARN));
        } catch(err) {}
        return;
    }
}

sendLog(member.guild, embed('Member Joined',
    member.user.tag + ' joined\nID: ' + member.id + '\nAccount created: <t:' + Math.floor(member.user.createdTimestamp / 1000) + ':R>',
    SUCCESS));
```

});

client.on(Events.GuildMemberRemove, function(member) {
sendLog(member.guild, embed(‘Member Left’, member.user.tag + ’ left the server.\nID: ’ + member.id, WARN));
});

client.on(Events.GuildBanAdd, function(ban) {
sendLog(ban.guild, embed(‘Member Banned’, ban.user.tag + ’ was banned.\nReason: ’ + (ban.reason || ‘No reason’), DANGER));
});

client.once(Events.ClientReady, function() {
console.log(’SwiftX Guard online as ’ + client.user.tag);
client.user.setActivity(‘your server’, { type: 3 });
client.user.setStatus(‘online’);
});

client.login(TOKEN);
