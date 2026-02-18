// removetrusted.js
const { EmbedBuilder } = require('discord.js');
const { getGuildTrusted, removeTrusted } = require('./trustedStore');

module.exports = async (client, message, args) => {
  const guildIcon = message.guild.iconURL();

  if (message.author.id !== message.guild.ownerId) {
    return message.channel.send('Only the server owner can use this command.');
  }

  const user = message.mentions.users.first();
  if (!user) {
    return message.channel.send('Mention a user to remove from the trusted list.');
  }

  const trustedUsers = getGuildTrusted(message.guild.id);
  if (!trustedUsers.includes(user.id)) {
    return message.channel.send('That user is not in the trusted list.');
  }

  removeTrusted(message.guild.id, user.id);

  const embed = new EmbedBuilder()
    .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL() })
    .setDescription(`**Removed ${user} from the trusted users.**`)
    .setFooter({ text: message.guild.name, iconURL: guildIcon });

  return message.channel.send({ embeds: [embed] });
};
