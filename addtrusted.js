// addtrusted.js
const { EmbedBuilder } = require('discord.js');
const { getGuildTrusted, addTrusted } = require('./trustedStore');

module.exports = async (client, message, args) => {
  const guildIcon = message.guild.iconURL();

  if (message.author.id !== message.guild.ownerId) {
    return message.channel.send('Only the server owner can use this command.');
  }

  const user = message.mentions.users.first();
  if (!user) {
    const embed = new EmbedBuilder()
      .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL() })
      .setDescription('**Mention a user to add to the trusted list.**')
      .setFooter({ text: message.guild.name, iconURL: guildIcon });

    return message.channel.send({ embeds: [embed] });
  }

  const trustedUsers = getGuildTrusted(message.guild.id);
  if (trustedUsers.includes(user.id)) {
    return message.channel.send('This user is already in the trusted list.');
  }

  addTrusted(message.guild.id, user.id);

  const embed = new EmbedBuilder()
    .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL() })
    .setDescription(`**Added ${user} to the trusted list.**`)
    .setFooter({ text: message.guild.name, iconURL: guildIcon });

  return message.channel.send({ embeds: [embed] });
};
