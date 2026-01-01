const { Client, GatewayIntentBits, Partials, Events } = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// ===== CONFIG (USE ENV VARIABLES) =====
const BOT_TOKEN = process.env.BOT_TOKEN;
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID; // OPEN tickets category
const VOTE_CHANNEL_ID = process.env.VOTE_CHANNEL_ID;
// =====================================

// ticketChannelId -> voteMessageId
const ticketVotes = new Map();

client.once(Events.ClientReady, () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ===============================
// 📩 TICKET CREATED → CREATE VOTE
// ===============================
client.on(Events.ChannelCreate, async (channel) => {
  try {
    if (!channel.guild) return;
    if (channel.parentId !== TICKET_CATEGORY_ID) return;
    if (!channel.name.startsWith("ticket-")) return;

    const voteChannel = await channel.guild.channels.fetch(VOTE_CHANNEL_ID);
    if (!voteChannel) return;

    const voteMessage = await voteChannel.send(
      `🗳️ **Vote for ${channel.name.toUpperCase()}**`
    );

    await voteMessage.react("✅");
    await voteMessage.react("❌");

    ticketVotes.set(channel.id, voteMessage.id);
  } catch (err) {
    console.error("❌ Error creating vote:", err);
  }
});

// ==================================
// 🔒 TICKET CLOSED → CLOSE VOTE
// (Channel moved out of category)
// ==================================
client.on(Events.ChannelUpdate, async (oldChannel, newChannel) => {
  try {
    // Ticket moved out of open category
    if (
      oldChannel.parentId === TICKET_CATEGORY_ID &&
      newChannel.parentId !== TICKET_CATEGORY_ID
    ) {
      if (!ticketVotes.has(oldChannel.id)) return;

      const voteChannel = await newChannel.guild.channels.fetch(VOTE_CHANNEL_ID);
      if (!voteChannel) return;

      const messageId = ticketVotes.get(oldChannel.id);
      const voteMessage = await voteChannel.messages.fetch(messageId);

      const yesVotes =
        (voteMessage.reactions.cache.get("✅")?.count || 1) - 1;
      const noVotes =
        (voteMessage.reactions.cache.get("❌")?.count || 1) - 1;

      await voteMessage.edit(
        `🔒 **VOTING CLOSED — ${newChannel.name.toUpperCase()}**\n\n` +
        `✅ Yes: **${yesVotes}**\n` +
        `❌ No: **${noVotes}**`
      );

      ticketVotes.delete(oldChannel.id);
    }
  } catch (err) {
    console.error("❌ Error closing vote:", err);
  }
});

client.login(BOT_TOKEN);
