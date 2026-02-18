// trustedStore.js
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'trusted.json');

function load() {
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function save(data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function getGuildTrusted(guildId) {
  const data = load();
  return data[guildId] || [];
}

function addTrusted(guildId, userId) {
  const data = load();
  if (!data[guildId]) data[guildId] = [];
  if (!data[guildId].includes(userId)) data[guildId].push(userId);
  save(data);
}

function removeTrusted(guildId, userId) {
  const data = load();
  if (!data[guildId]) return;
  data[guildId] = data[guildId].filter((id) => id !== userId);
  save(data);
}

module.exports = {
  getGuildTrusted,
  addTrusted,
  removeTrusted
};
