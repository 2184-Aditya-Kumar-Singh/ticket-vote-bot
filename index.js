const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  REST,
  Routes,
  SlashCommandBuilder
} = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// ===== ENV CONFIG =====
const BOT_TOKEN = process.env.BOT_TOKEN;
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID; // open tickets
const CLOSED_CATEGORY_ID = process.env.CLOSED_CATEGORY_ID; // closed tickets
const VOTE_CHANNEL_ID = process.env.VOTE_CHANNEL_ID;
const WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL_ID;
const MOVE_ROLE_ID = process.env.MOVE_ROLE_ID;
// ======================

// ticketChannelId -> voteMessageId
const ticketVotes = new Map();

// ===============================
// ✅ BOT READY + REGISTER COMMAND
// ===============================
client.once(Events.ClientReady, async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const commands = [
    new SlashCommandBuilder()
      .setName("move")
      .setDescription("Move this ticket to the closed category")
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: "10" }).setToken(BOT_TOKEN);

  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    console.log("✅ Slash command /move registered");
  } catch (err) {
    console.error("❌ Slash command registration error:", err);
  }
});

// ===============================
// 👋 MEMBER JOIN → WELCOME MESSAGE
// ===============================
client.on(Events.GuildMemberAdd, async (member) => {
  try {
    const channel = await member.guild.channels.fetch(WELCOME_CHANNEL_ID);
    if (!channel) return;

    await channel.send(
`👑 **Welcome to Kingdom 3961 Migration Discord** 👑

Hello ${member},

Welcome to **3961 Migration Discord**! We’re glad to have you here as part of our migration process.

To get started, please make sure you read all migration rules, requirements, and timelines carefully.

➡️ **Head over to the Migration Info channel:**  
🔗 https://discord.com/channels/1456324256861257844/1456324257624887475

If you have any questions after reading, feel free to reach out to the leadership team.

Welcome, and we look forward to building **3961** together. 🚀✨`
    );
  } catch (err) {
    console.error("❌ Welcome message error:", err);
  }
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
    console.error("❌ Vote creation error:", err);
  }
});

// ==================================
// 🔒 TICKET MOVED → CLOSE VOTE
// ==================================
client.on(Events.ChannelUpdate, async (oldChannel, newChannel) => {
  try {
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
    console.error("❌ Vote close error:", err);
  }
});

// ===============================
// 🔧 /MOVE SLASH COMMAND
// ===============================
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "move") return;

  const member = interaction.member;
  const channel = interaction.channel;

  if (!member.roles.cache.has(MOVE_ROLE_ID)) {
    return interaction.reply({
      content: "❌ You do not have permission to use this command.",
      ephemeral: true
    });
  }

  if (!channel.name.startsWith("ticket-")) {
    return interaction.reply({
      content: "❌ This command can only be used in ticket channels.",
      ephemeral: true
    });
  }

  try {
    await channel.setParent(CLOSED_CATEGORY_ID, { lockPermissions: false });

    await interaction.reply({
      content: "✅ Ticket moved successfully.",
      ephemeral: true
    });
  } catch (err) {
    console.error("❌ Ticket move error:", err);
    interaction.reply({
      content: "❌ Failed to move ticket.",
      ephemeral: true
    });
  }
});

client.login(BOT_TOKEN);
