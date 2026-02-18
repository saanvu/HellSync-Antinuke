// index.js - Main startup file for the Discord Anti-Raid Bot
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

// ==================== CONFIGURATION ====================
const PREFIX = process.env.PREFIX || 'hs!';

// Anti-spam configuration
const SPAM_WINDOW_MS = 7000;
const SPAM_WARN_MESSAGES = 5;
const SPAM_MAX_MESSAGES = 7;
const SPAM_MUTE_SECONDS = 60;

// Anti-nuke configuration
const NUKE_WINDOW_MS = 60000; // 1 minute
const NUKE_CHANNEL_DELETE_THRESHOLD = 3;
const NUKE_ROLE_DELETE_THRESHOLD = 2;
const NUKE_BAN_THRESHOLD = 3;
const NUKE_PUNISH_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours

// ==================== STATE MANAGEMENT ====================
const messageCounters = new Map();
const antispamEnabled = new Map();
const actionCounters = new Map();
const antinukeEnabled = new Map();

// ==================== CLIENT INITIALIZATION ====================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildModeration,
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

// ==================== HELPER FUNCTIONS ====================

async function getLogChannel(guild) {
  let channel = guild.channels.cache.find(
    (ch) => ch.type === 0 && ch.name === 'hellsync-logs'
  );

  if (!channel) {
    try {
      channel = await guild.channels.create({
        name: 'hellsync-logs',
        type: 0,
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
      {
        name: 'Count',
        value: `${count} in last ${Math.floor(NUKE_WINDOW_MS / 1000)}s (threshold: ${threshold})`,
        inline: false,
      }
    )
    .setTimestamp();

  try {
    await logChannel.send({ embeds: [embed] });
  } catch (err) {
    console.error('Failed to send anti-nuke log:', err);
  }
}

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
      if (logChannel) {
        await logChannel.send(`Banned ${member.user.tag} (${member.id}) for anti-nuke: ${reason}`);
      }
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
  if (Date.now() - entry.createdTimestamp > 8000) return null;
  if (!entry.executor) return null;

  return { executor: entry.executor, entry };
}

// ==================== EVENT HANDLERS ====================

client.once('ready', () => {
  console.log(`╔═══════════════════════════════════════╗`);
  console.log(`║  Discord Anti-Raid Bot is Online!   ║`);
  console.log(`╠═══════════════════════════════════════╣`);
  console.log(`║  Bot: ${client.user.tag.padEnd(27)} ║`);
  console.log(`║  Prefix: ${PREFIX.padEnd(26)} ║`);
  console.log(`║  Servers: ${client.guilds.cache.size.toString().padEnd(25)} ║`);
  console.log(`╚═══════════════════════════════════════╝`);
});

// Anti-nuke: Channel Delete
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

// Anti-nuke: Role Delete
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

// Anti-nuke: Ban Add
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

// Message handler: Anti-spam + Commands
client.on('messageCreate', async (message) => {
  if (!message.guild || message.author.bot) return;

  const guildId = message.guild.id;
  const userId = message.author.id;

  ensureGuildDefaults(guildId);

  // Anti-spam logic
  if (antispamEnabled.get(guildId)) {
    const trustedUsers = getGuildTrusted(guildId);
    const isTrusted = trustedUsers.includes(userId);

    if (!message.content.startsWith(PREFIX) && !isTrusted) {
      let guildData = messageCounters.get(guildId);
      if (!guildData) {
        guildData = new Map();
        messageCounters.set(guildId, guildData);
      }

      const now = Date.now();
      let userData = guildData.get(userId);

      if (!userData || now - userData.firstMessageTimestamp > SPAM_WINDOW_MS) {
        userData = { count: 0, firstMessageTimestamp: now };
      }

      userData.count += 1;
      guildData.set(userId, userData);

      if (userData.count === SPAM_WARN_MESSAGES) {
        try {
          await message.reply('Please slow down, you are sending messages too quickly.');
        } catch (err) {
          console.error('Failed to send spam warning:', err);
        }
      }

      if (userData.count >= SPAM_MAX_MESSAGES) {
        guildData.set(userId, { count: 0, firstMessageTimestamp: now });
        try {
          const member = await message.guild.members.fetch(userId);
          if (member.moderatable) {
            await member.timeout(SPAM_MUTE_SECONDS * 1000, 'Automatic anti-spam timeout');
            await message.channel.send(
              `${member} has been timed out for spamming for ${SPAM_MUTE_SECONDS} seconds.`
            );
            await logTimeout(
              message.guild,
              member,
              `Automatic anti-spam timeout for ${SPAM_MUTE_SECONDS} seconds.`,
              true
            );
          }
        } catch (err) {
          console.error('Failed to timeout spammer:', err);
        }
        return;
      }
    }
  }

  // Command handler
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const cmdName = (args.shift() || '').toLowerCase();

  // Antispam toggle command
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
    await message.channel.send(`Antispam has been turned **${newState ? 'ON' : 'OFF'}** for this server.`);
    await logAntispamToggle(message.guild, message.author, newState);
    return;
  }

  // Antinuke toggle command
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
    await message.channel.send(`Antinuke has been turned **${newState ? 'ON' : 'OFF'}** for this server.`);
    await logAntinukeToggle(message.guild, message.author, newState);
    return;
  }

  // Untimeout command
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

  // External command files
  if (cmdName === 'addtrusted') return require('./addtrusted')(client, message, args);
  if (cmdName === 'removetrusted') return require('./removetrusted')(client, message, args);
  if (cmdName === 'trustedlist') return require('./trustedlist')(client, message, args);
  if (cmdName === 'config') return require('./config')(client, message, args);
});

// ==================== ERROR HANDLING ====================

client.on('error', (error) => {
  console.error('Client error:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

// ==================== LOGIN ====================

client.login(process.env.DISCORD_TOKEN).catch((err) => {
  console.error('Failed to login:', err);
  process.exit(1);
});
