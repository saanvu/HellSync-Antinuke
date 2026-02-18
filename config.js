// config.js
const { EmbedBuilder } = require('discord.js');

module.exports = async (client, message, args) => {
  const guildIcon = message.guild.iconURL();

  const embed = new EmbedBuilder()
    .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL() })
    .setDescription('**Config system is not yet migrated from quick.db.**')
    .addFields(
      { name: 'Role Create Limits', value: 'Not configured', inline: true },
      { name: 'Role Delete Limits', value: 'Not configured', inline: true },
      { name: 'Action Logs Channel', value: 'Not configured', inline: true }
    )
    .setFooter({ text: message.guild.name, iconURL: guildIcon });

  return message.channel.send({ embeds: [embed] });
};
