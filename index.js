const { Client, GatewayIntentBits, Partials, Events } = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// ===== CONFIG =====
const BOT_TOKEN = process.env.BOT_TOKEN;
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID;
const VOTE_CHANNEL_ID = process.env.VOTE_CHANNEL_ID;
// ==================

const ticketVotes = new Map(); // ticketId -> messageId

client.once(Events.ClientReady, () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// 📩 When ticket is created
client.on(Events.ChannelCreate, async (channel) => {
  if (!channel.guild) return;
  if (channel.parentId !== TICKET_CATEGORY_ID) return;
  if (!channel.name.startsWith("ticket-")) return;

  const voteChannel = await channel.guild.channels.fetch(VOTE_CHANNEL_ID);
  if (!voteChannel) return;

  const msg = await voteChannel.send(
    `🗳️ **Vote for ${channel.name.toUpperCase()}**`
  );

  await msg.react("✅");
  await msg.react("❌");

  ticketVotes.set(channel.id, msg.id);
});

// ❌ When ticket is closed (channel deleted)
client.on(Events.ChannelDelete, async (channel) => {
  if (!ticketVotes.has(channel.id)) return;

  try {
    const voteChannel = await channel.guild.channels.fetch(VOTE_CHANNEL_ID);
    const messageId = ticketVotes.get(channel.id);

    const voteMessage = await voteChannel.messages.fetch(messageId);

    const yesVotes = voteMessage.reactions.cache.get("✅")?.count - 1 || 0;
    const noVotes = voteMessage.reactions.cache.get("❌")?.count - 1 || 0;

    await voteMessage.edit(
      `🔒 **VOTING CLOSED — ${channel.name.toUpperCase()}**\n\n` +
      `✅ Yes: **${yesVotes}**\n` +
      `❌ No: **${noVotes}**`
    );

    ticketVotes.delete(channel.id);
  } catch (err) {
    console.error("❌ Error closing vote:", err);
  }
});

client.login(BOT_TOKEN);

