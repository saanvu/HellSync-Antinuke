// raid.js
require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
  EmbedBuilder,
  PermissionsBitField,
  AuditLogEvent,
} = require('discord.js');

const { getGuildTrusted } = require('./trustedStore');

const PREFIX = process.env.PREFIX || 'hs!';

// ----------------- Anti-spam config -----------------
const spamWindowMs = 7000;
const spamWarnMessages = 5;
const spamMaxMessages = 7;
const spamMuteSeconds = 60;

// ----------------- Anti-nuke config -----------------
const NUKE_WINDOW_MS = 60_000; // 1 minute
const NUKE_CHANNEL_DELETE_THRESHOLD = 3;
const NUKE_ROLE_DELETE_THRESHOLD = 2;
const NUKE_BAN_THRESHOLD = 3;
const NUKE_PUNISH_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24h

// ----------------- State -----------------
const messageCounters = new Map(); // Map<guildId, Map<userId, {count, firstMessageTimestamp}>>
const antispamEnabled = new Map(); // Map<guildId, boolean>

const actionCounters = new Map(); // Map<guildId, Map<userId, {windowStart, channelDeletes, roleDeletes, bans}>>
const antinukeEnabled = new Map(); // Map<guildId, boolean>

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildModeration, // Needed for audit logs + moderation-related events
    GatewayIntentBits.MessageContent,
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.User,
    Partials.GuildMember,
    Partials.Reaction,
  ],
});

client.commands = new Collection();

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// ----------------- Logging helpers -----------------
async function getLogChannel(guild) {
  let channel = guild.channels.cache.find(
    (ch) => ch.type === 0 && ch.name === 'hellsync-logs'
  );

  if (!channel) {
    try {
      channel = await guild.channels.create({
        name: 'hellsync-logs',
        type: 0, // GuildText
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            deny: [PermissionsBitField.Flags.ViewChannel],
          },
          {
            id: guild.members.me?.id ?? client.user.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
            ],
          },
        ],
      });
    } catch (err) {
      console.error('Failed to create hellsync-logs channel:', err);
      return null;
    }
  }

  return channel;
}

async function logTimeout(guild, targetMember, reason, triggeredByAntispam = true) {
  const logChannel = await getLogChannel(guild);
  if (!logChannel) return;

  const embed = new EmbedBuilder()
    .setTitle('Member Timed Out')
    .setColor(0xff0000)
    .addFields(
      { name: 'Member', value: `${targetMember.user.tag} (${targetMember.id})`, inline: false },
      { name: 'Reason', value: reason || 'No reason provided', inline: false },
      {
        name: 'Triggered By',
        value: triggeredByAntispam ? 'Anti-spam system' : 'Anti-nuke system / command',
        inline: false,
      }
    )
    .setTimestamp();

  try {
    await logChannel.send({ embeds: [embed] });
  } catch (err) {
    console.error('Failed to send timeout log:', err);
  }
}

async function logUntimeout(guild, moderator, targetMember, reason) {
  const logChannel = await getLogChannel(guild);
  if (!logChannel) return;

  const embed = new EmbedBuilder()
    .setTitle('Member Timeout Removed')
    .setColor(0x00ff7f)
    .addFields(
      { name: 'Member', value: `${targetMember.user.tag} (${targetMember.id})`, inline: false },
      { name: 'Moderator', value: `${moderator.tag} (${moderator.id})`, inline: false },
      { name: 'Reason', value: reason || 'No reason provided', inline: false }
    )
    .setTimestamp();

  try {
    await logChannel.send({ embeds: [embed] });
  } catch (err) {
    console.error('Failed to send untimeout log:', err);
  }
}

async function logAntispamToggle(guild, moderator, newState) {
  const logChannel = await getLogChannel(guild);
  if (!logChannel) return;

  const embed = new EmbedBuilder()
    .setTitle('Antispam Setting Changed')
    .setColor(0x00aeff)
    .addFields(
      { name: 'Moderator', value: `${moderator.tag} (${moderator.id})`, inline: false },
      { name: 'New State', value: newState ? 'ON' : 'OFF', inline: false }
    )
    .setTimestamp();

  try {
    await logChannel.send({ embeds: [embed] });
  } catch (err) {
    console.error('Failed to send antispam toggle log:', err);
  }
}

async function logAntinukeToggle(guild, moderator, newState) {
  const logChannel = await getLogChannel(guild);
  if (!logChannel) return;

  const embed = new EmbedBuilder()
    .setTitle('Antinuke Setting Changed')
    .setColor(0xffb300)
    .addFields(
      { name: 'Moderator', value: `${moderator.tag} (${moderator.id})`, inline: false },
      { name: 'New State', value: newState ? 'ON' : 'OFF', inline: false }
    )
    .setTimestamp();

  try {
    await logChannel.send({ embeds: [embed] });
  } catch (err) {
    console.error('Failed to send antinuke toggle log:', err);
  }
}

async function logNukeDetected(guild, executor, action, count, threshold) {
  const logChannel = await getLogChannel(guild);
  if (!logChannel) return;

  const embed = new EmbedBuilder()
    .setTitle('Anti-nuke Triggered')
    .setColor(0xff0000)
    .addFields(
      { name: 'Executor', value: `${executor.tag} (${executor.id})`, inline: false },
      { name: 'Action', value: action, inline: false },
      { name: 'Count', value: `${count} in last ${Math.floor(NUKE_WINDOW_MS / 1000)}s (threshold: ${threshold})`, inline: false }
    )
    .setTimestamp();

  try {
    await logChannel.send({ embeds: [embed] });
  } catch (err) {
    console.error('Failed to send anti-nuke log:', err);
  }
}

// ----------------- Anti-nuke helpers -----------------
function ensureGuildDefaults(guildId) {
  if (!antispamEnabled.has(guildId)) antispamEnabled.set(guildId, true);
  if (!antinukeEnabled.has(guildId)) antinukeEnabled.set(guildId, true);
}

function isTrustedOrOwner(guild, userId) {
  if (!userId) return true;
  if (userId === guild.ownerId) return true;
  if (userId === client.user.id) return true;

  const trustedUsers = getGuildTrusted(guild.id);
  return trustedUsers.includes(userId);
}

function bumpAction(guildId, userId, field) {
  let guildMap = actionCounters.get(guildId);
  if (!guildMap) {
    guildMap = new Map();
    actionCounters.set(guildId, guildMap);
  }

  const now = Date.now();
  let data = guildMap.get(userId);
  if (!data || now - data.windowStart > NUKE_WINDOW_MS) {
    data = { windowStart: now, channelDeletes: 0, roleDeletes: 0, bans: 0 };
  }

  data[field] += 1;
  guildMap.set(userId, data);

  return data[field];
}

async function punishExecutor(guild, executorId, reason) {
  try {
    const member = await guild.members.fetch(executorId).catch(() => null);
    if (!member) return;

    // Prefer timeout (safer than ban), fallback to ban if timeout not possible.
    if (member.moderatable) {
      await member.timeout(NUKE_PUNISH_TIMEOUT_MS, reason);
      await logTimeout(guild, member, reason, false);
      return;
    }

    const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
    const canBan = me?.permissions?.has(PermissionsBitField.Flags.BanMembers);

    if (canBan && member.bannable) {
      await member.ban({ reason });
      const logChannel = await getLogChannel(guild);
      if (logChannel) await logChannel.send(`Banned ${member.user.tag} (${member.id}) for anti-nuke: ${reason}`);
    }
  } catch (err) {
    console.error('Failed to punish executor:', err);
  }
}

async function fetchRecentExecutor(guild, auditType) {
  const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  if (!me?.permissions?.has(PermissionsBitField.Flags.ViewAuditLog)) return null;

  const logs = await guild.fetchAuditLogs({ limit: 1, type: auditType }).catch(() => null);
  const entry = logs?.entries?.first();
  if (!entry) return null;

  // Avoid matching old log entries (Discord audit log delay happens, so allow small window).
  if (Date.now() - entry.createdTimestamp > 8000) return null;

  if (!entry.executor) return null;
  return { executor: entry.executor, entry };
}

// ----------------- Anti-nuke event handlers -----------------
client.on('channelDelete', async (channel) => {
  const guild = channel.guild;
  if (!guild) return;

  ensureGuildDefaults(guild.id);
  if (!antinukeEnabled.get(guild.id)) return;

  const res = await fetchRecentExecutor(guild, AuditLogEvent.ChannelDelete);
  if (!res) return;

  const { executor } = res;
  if (isTrustedOrOwner(guild, executor.id)) return;

  const count = bumpAction(guild.id, executor.id, 'channelDeletes');
  if (count >= NUKE_CHANNEL_DELETE_THRESHOLD) {
    await logNukeDetected(guild, executor, 'CHANNEL_DELETE', count, NUKE_CHANNEL_DELETE_THRESHOLD);
    await punishExecutor(guild, executor.id, `Anti-nuke: Mass channel deletion (${count})`);
  }
});

client.on('roleDelete', async (role) => {
  const guild = role.guild;
  if (!guild) return;

  ensureGuildDefaults(guild.id);
  if (!antinukeEnabled.get(guild.id)) return;

  const res = await fetchRecentExecutor(guild, AuditLogEvent.RoleDelete);
  if (!res) return;

  const { executor } = res;
  if (isTrustedOrOwner(guild, executor.id)) return;

  const count = bumpAction(guild.id, executor.id, 'roleDeletes');
  if (count >= NUKE_ROLE_DELETE_THRESHOLD) {
    await logNukeDetected(guild, executor, 'ROLE_DELETE', count, NUKE_ROLE_DELETE_THRESHOLD);
    await punishExecutor(guild, executor.id, `Anti-nuke: Mass role deletion (${count})`);
  }
});

client.on('guildBanAdd', async (ban) => {
  const guild = ban.guild;
  if (!guild) return;

  ensureGuildDefaults(guild.id);
  if (!antinukeEnabled.get(guild.id)) return;

  const res = await fetchRecentExecutor(guild, AuditLogEvent.MemberBanAdd);
  if (!res) return;

  const { executor } = res;
  if (isTrustedOrOwner(guild, executor.id)) return;

  const count = bumpAction(guild.id, executor.id, 'bans');
  if (count >= NUKE_BAN_THRESHOLD) {
    await logNukeDetected(guild, executor, 'MEMBER_BAN_ADD', count, NUKE_BAN_THRESHOLD);
    await punishExecutor(guild, executor.id, `Anti-nuke: Mass banning (${count})`);
  }
});

// ----------------- messageCreate (anti-spam + commands) -----------------
client.on('messageCreate', async (message) => {
  if (!message.guild || message.author.bot) return;

  const guildId = message.guild.id;
  const userId = message.author.id;

  ensureGuildDefaults(guildId);

  // ----------------- BASIC ANTISPAM -----------------
  if (antispamEnabled.get(guildId)) {
    const trustedUsers = getGuildTrusted(guildId);
    const isTrusted = trustedUsers.includes(userId);

    // Only anti-spam normal messages (not commands) and skip trusted.
    if (!message.content.startsWith(PREFIX) && !isTrusted) {
      let guildData = messageCounters.get(guildId);
      if (!guildData) {
        guildData = new Map();
        messageCounters.set(guildId, guildData);
      }

      const now = Date.now();
      let userData = guildData.get(userId);

      if (!userData || now - userData.firstMessageTimestamp > spamWindowMs) {
        userData = { count: 0, firstMessageTimestamp: now };
      }

      userData.count += 1;
      guildData.set(userId, userData);

      if (userData.count === spamWarnMessages) {
        try {
          await message.reply('Please slow down, you are sending messages too quickly.');
        } catch (err) {
          console.error('Failed to send spam warning:', err);
        }
      }

      if (userData.count >= spamMaxMessages) {
        guildData.set(userId, { count: 0, firstMessageTimestamp: now });

        try {
          const member = await message.guild.members.fetch(userId);
          if (member.moderatable) {
            await member.timeout(spamMuteSeconds * 1000, 'Automatic anti-spam timeout');
            await message.channel.send(
              `${member} has been timed out for spamming for ${spamMuteSeconds} seconds.`
            );
            await logTimeout(
              message.guild,
              member,
              `Automatic anti-spam timeout for ${spamMuteSeconds} seconds.`,
              true
            );
          }
        } catch (err) {
          console.error('Failed to timeout spammer:', err);
        }
      }
    }
  }

  // ----------------- PREFIX COMMANDS -----------------
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const cmdName = (args.shift() || '').toLowerCase();

  // antispam on/off (server owner only)
  if (cmdName === 'antispam') {
    if (message.author.id !== message.guild.ownerId) {
      return message.channel.send('Only the server owner can toggle antispam.');
    }

    const option = (args[0] || '').toLowerCase();
    if (option !== 'on' && option !== 'off') {
      return message.channel.send('Usage: `antispam on` or `antispam off`');
    }

    const newState = option === 'on';
    antispamEnabled.set(guildId, newState);

    await message.channel.send(
      `Antispam has been turned **${newState ? 'ON' : 'OFF'}** for this server.`
    );
    await logAntispamToggle(message.guild, message.author, newState);
    return;
  }

  // antinuke on/off (server owner only)
  if (cmdName === 'antinuke') {
    if (message.author.id !== message.guild.ownerId) {
      return message.channel.send('Only the server owner can toggle antinuke.');
    }

    const option = (args[0] || '').toLowerCase();
    if (option !== 'on' && option !== 'off') {
      return message.channel.send('Usage: `antinuke on` or `antinuke off`');
    }

    const newState = option === 'on';
    antinukeEnabled.set(guildId, newState);

    await message.channel.send(
      `Antinuke has been turned **${newState ? 'ON' : 'OFF'}** for this server.`
    );
    await logAntinukeToggle(message.guild, message.author, newState);
    return;
  }

  // untimeout command: hs!untimeout @user [reason...]
  if (cmdName === 'untimeout') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
      return message.channel.send('You need the **Moderate Members** permission to untimeout users.');
    }

    const targetUser = message.mentions.users.first();
    if (!targetUser) {
      return message.channel.send('Mention a user to remove their timeout. Usage: `untimeout @user [reason]`');
    }

    const reason = args.slice(1).join(' ') || 'No reason provided';

    try {
      const member = await message.guild.members.fetch(targetUser.id);
      await member.timeout(null, `Timeout removed: ${reason}`);
      await message.channel.send(`Removed timeout for ${member.user.tag}.`);
      await logUntimeout(message.guild, message.author, member, reason);
    } catch (err) {
      console.error('Failed to untimeout member:', err);
      return message.channel.send('Failed to remove timeout. Check my permissions and try again.');
    }
    return;
  }

  if (cmdName === 'addtrusted') return require('./addtrusted')(client, message, args);
  if (cmdName === 'removetrusted') return require('./removetrusted')(client, message, args);
  if (cmdName === 'trustedlist') return require('./trustedlist')(client, message, args);
  if (cmdName === 'config') return require('./config')(client, message, args);
});

// NOTE: Your old file used DISCORD_TOKEN; keep it consistent with your .env. [file:4]
client.login(process.env.DISCORD_TOKEN);
