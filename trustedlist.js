// trustedlist.js
const { EmbedBuilder } = require('discord.js');
const { getGuildTrusted } = require('./trustedStore');

module.exports = async (client, message, args) => {
  const guildIcon = message.guild.iconURL();

  const trustedUsers = getGuildTrusted(message.guild.id);

  const embed = new EmbedBuilder()
    .setThumbnail(guildIcon)
    .setFooter({ text: message.author.username, iconURL: message.author.displayAvatarURL() });

  if (!trustedUsers.length) {
    embed.setDescription('**No trusted users configured for this server.**');
  } else {
    const lines = trustedUsers.map((id) => `<@${id}>`);
    embed.addFields({
      name: '**Trusted List**',
      value: lines.join('\n')
    });
  }

  return message.channel.send({ embeds: [embed] });
};
