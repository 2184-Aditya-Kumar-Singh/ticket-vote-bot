const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  REST,
  Routes,
  SlashCommandBuilder
} = require("discord.js");
const { google } = require("googleapis");

// ================= CLIENT =================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// ================= ENV =================
const BOT_TOKEN = process.env.BOT_TOKEN;
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID;
const CLOSED_CATEGORY_ID = process.env.CLOSED_CATEGORY_ID;
const VOTE_CHANNEL_ID = process.env.VOTE_CHANNEL_ID;
const WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL_ID;
const APPROVE_ROLE_ID = process.env.MOVE_ROLE_ID;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_CREDS = process.env.GOOGLE_CREDS;

// ================= STORAGE =================
const ticketVotes = new Map(); // ticketChannelId -> voteMessageId
const ticketData = new Map();  // ticketChannelId -> details

// ================= GOOGLE SHEETS =================
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(GOOGLE_CREDS),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});
const sheets = google.sheets({ version: "v4", auth });

async function writeToSheet(data, ticketName, approvedBy) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: "Sheet1!A:G",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        data.name,
        data.power,
        data.kp,
        data.vip,
        ticketName,
        approvedBy,
        new Date().toLocaleString()
      ]]
    }
  });
}

// ================= READY + COMMANDS =================
client.once(Events.ClientReady, async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const commands = [
    new SlashCommandBuilder()
      .setName("fill-details")
      .setDescription("Fill migration details for this ticket"),
    new SlashCommandBuilder()
      .setName("approve")
      .setDescription("Approve this ticket and close voting")
  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(BOT_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });

  console.log("✅ Slash commands registered");
});

// ================= WELCOME =================
client.on(Events.GuildMemberAdd, async (member) => {
  try {
    const ch = await member.guild.channels.fetch(WELCOME_CHANNEL_ID);
    if (!ch) return;

    await ch.send(
`👑 **Welcome to Kingdom 3961 Migration Discord** 👑

Hello ${member},
Please read all migration rules and timelines carefully.

🔗 https://discord.com/channels/1456324256861257844/1456324257624887475

We look forward to building **3961** together. 🚀✨`
    );
  } catch (e) {
    console.error("Welcome error:", e);
  }
});

// ================= TICKET CREATED =================
client.on(Events.ChannelCreate, async (channel) => {
  try {
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
  } catch (e) {
    console.error("Vote create error:", e);
  }
});

// ================= CLOSE VOTE =================
async function closeVote(channel) {
  if (!ticketVotes.has(channel.id)) return;

  const voteChannel = await channel.guild.channels.fetch(VOTE_CHANNEL_ID);
  const msgId = ticketVotes.get(channel.id);
  const voteMsg = await voteChannel.messages.fetch(msgId);

  const yes = (voteMsg.reactions.cache.get("✅")?.count || 1) - 1;
  const no = (voteMsg.reactions.cache.get("❌")?.count || 1) - 1;

  await voteMsg.edit(
    `🔒 **VOTING CLOSED — ${channel.name.toUpperCase()}**\n\n` +
    `✅ Yes: **${yes}**\n` +
    `❌ No: **${no}**`
  );

  ticketVotes.delete(channel.id);
}

// ================= SLASH COMMANDS =================
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const channel = interaction.channel;

  // ---------- /fill-details ----------
  if (interaction.commandName === "fill-details") {
    if (!channel.name.startsWith("ticket-")) {
      return interaction.reply("❌ Use this command inside a ticket.");
    }

    const questions = [
      { key: "name", q: "📝 **What is your in-game name?**" },
      { key: "power", q: "⚡ **What is your current power?**" },
      { key: "kp", q: "⚔️ **What are your total kill points?**" },
      { key: "vip", q: "👑 **What is your VIP level?**" }
    ];

    const answers = {};
    let step = 0;

    await interaction.reply(questions[step].q);

    const filter = m =>
      m.author.id === interaction.user.id && !m.author.bot;

    const collector = channel.createMessageCollector({
      filter,
      time: 10 * 60 * 1000
    });

    collector.on("collect", async (msg) => {
      answers[questions[step].key] = msg.content.trim();
      step++;

      if (step < questions.length) {
        await channel.send(questions[step].q);
      } else {
        ticketData.set(channel.id, answers);
        collector.stop();

        await channel.send(
`✅ **Basic details saved successfully**

📸 **Now please send screenshots of:**
• Commanders  
• Equipment  
• Bag (resources & speedups)  
• ROK profile (ID visible)

⏳ **After sending these, please wait for Migration Officers to respond.**`
        );
      }
    });

    collector.on("end", (_, reason) => {
      if (reason === "time") {
        channel.send("❌ Time expired. Please run `/fill-details` again.");
      }
    });
  }

  // ---------- /approve ----------
  if (interaction.commandName === "approve") {
    if (!interaction.member.roles.cache.has(APPROVE_ROLE_ID)) {
      return interaction.reply({ content: "❌ You do not have permission.", ephemeral: true });
    }

    if (!channel.name.startsWith("ticket-")) {
      return interaction.reply({ content: "❌ Not a ticket channel.", ephemeral: true });
    }

    const data = ticketData.get(channel.id);
    if (!data || !data.name || !data.power || !data.kp || !data.vip) {
      return interaction.reply({
        content: "❌ Ticket details are incomplete. User must finish `/fill-details`.",
        ephemeral: true
      });
    }

    try {
      await closeVote(channel);
      await writeToSheet(data, channel.name, interaction.user.tag);
      await channel.setParent(CLOSED_CATEGORY_ID, { lockPermissions: false });

      await interaction.reply({
        content: "✅ Ticket approved and logged to sheet.",
        ephemeral: true
      });
    } catch (e) {
      console.error("Approve error:", e);
      interaction.reply({ content: "❌ Approval failed.", ephemeral: true });
    }
  }
});

// ================= BACKUP CLOSE =================
client.on(Events.ChannelUpdate, async (oldC, newC) => {
  if (
    oldC.parentId === TICKET_CATEGORY_ID &&
    newC.parentId !== TICKET_CATEGORY_ID
  ) {
    await closeVote(newC);
  }
});

// ================= LOGIN =================
client.login(BOT_TOKEN);
