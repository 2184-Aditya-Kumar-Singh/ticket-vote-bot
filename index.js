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
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers // ✅ REQUIRED FOR WELCOME
  ],
  partials: [Partials.Channel, Partials.Message]
});

// ================= ENV =================
const BOT_TOKEN = process.env.BOT_TOKEN;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_CREDS = process.env.GOOGLE_CREDS;
const APPROVE_ROLE_ID = process.env.APPROVE_ROLE_ID;
const CLOSED_CATEGORY_ID = process.env.CLOSED_CATEGORY_ID;
const REJECTED_CATEGORY_ID = process.env.REJECTED_CATEGORY_ID;
const VOTE_CHANNEL_ID = process.env.VOTE_CHANNEL_ID;
const WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL_ID;

// ================= VOTE STORAGE =================
const ticketVotes = new Map();

// ================= GOOGLE AUTH =================
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(GOOGLE_CREDS),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});
const sheets = google.sheets({ version: "v4", auth });

// ================= COLUMN MAP =================
const COLUMN = {
  TICKET_ID: "A",
  NAME: "B",
  POWER: "C",
  KP: "D",
  VIP: "E",
  STATUS: "F",
  APPROVED_BY: "G",
  APPROVED_AT: "H",
  DISCORD_USER: "I"
};

// ================= SHEET HELPERS =================
async function findRow(ticketId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: "Sheet1!A:A"
  });
  const rows = res.data.values || [];
  const idx = rows.findIndex(r => r[0] === ticketId);
  return idx === -1 ? null : idx + 1;
}

async function createRow(ticketId) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: "Sheet1!A:I",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[ticketId, "", "", "", "", "PENDING", "", "", ""]]
    }
  });
}

async function updateCell(row, col, value) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `Sheet1!${col}${row}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[value]] }
  });
}

// ================= WELCOME MESSAGE (FIXED) =================
client.on(Events.GuildMemberAdd, async (member) => {
  try {
    const channel = await member.guild.channels.fetch(WELCOME_CHANNEL_ID);
    if (!channel) return;

    await channel.send(
`👑 **Welcome to Kingdom 3961 Migration Discord** 👑

Hello ${member},
Welcome to **3961 Migration Discord**! We’re glad to have you here as part of our migration process.

📌 **Please read all migration rules, requirements, and timelines carefully.**

➡️ **Migration Info Channel:**
🔗 https://discord.com/channels/1456324256861257844/1456324257624887475

If you have any questions after reading, feel free to reach out to the leadership team.

🚀✨ **Welcome, and we look forward to building 3961 together!**`
    );
  } catch (err) {
    console.error("Welcome message failed:", err);
  }
});

// ================= READY =================
client.once(Events.ClientReady, async () => {
  const commands = [
    new SlashCommandBuilder().setName("fill-details").setDescription("Fill migration details"),
    new SlashCommandBuilder().setName("approve").setDescription("Approve this ticket"),
    new SlashCommandBuilder()
      .setName("reject")
      .setDescription("Reject this ticket")
      .addStringOption(o =>
        o.setName("reason").setDescription("Reason (optional)").setRequired(false)
      )
  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(BOT_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });

  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ================= CREATE VOTE ON TICKET =================
client.on(Events.ChannelCreate, async (channel) => {
  if (!channel.guild) return;
  if (!channel.name.startsWith("ticket-")) return;

  try {
    const voteChannel = await channel.guild.channels.fetch(VOTE_CHANNEL_ID);
    const msg = await voteChannel.send(`🗳️ **Vote for ${channel.name.toUpperCase()}**`);
    await msg.react("✅");
    await msg.react("❌");
    ticketVotes.set(channel.id, msg.id);
  } catch (e) {
    console.error("Vote creation failed:", e);
  }
});

// ================= COMMAND HANDLER =================
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const channel = interaction.channel;
  const ticketId = channel.name;

  if (interaction.commandName === "fill-details") {
    let row = await findRow(ticketId);
    if (!row) {
      await createRow(ticketId);
      row = await findRow(ticketId);
      await updateCell(row, COLUMN.DISCORD_USER, interaction.user.username);
    }

    const questions = [
      { col: COLUMN.NAME, q: "📝 What is your in-game name?" },
      { col: COLUMN.POWER, q: "⚡ What is your current power?" },
      { col: COLUMN.KP, q: "⚔️ What are your total kill points?" },
      { col: COLUMN.VIP, q: "👑 What is your VIP level?" }
    ];

    let step = 0;
    await interaction.reply(questions[step].q);

    const collector = channel.createMessageCollector({
      filter: m => m.author.id === interaction.user.id,
      time: 10 * 60 * 1000
    });

    collector.on("collect", async (msg) => {
      await updateCell(row, questions[step].col, msg.content);
      step++;
      if (step < questions.length) {
        channel.send(questions[step].q);
      } else {
        collector.stop();
        channel.send("✅ **Details saved. Please send screenshots of (Commanders, Equipments, VIP, Resources, Speedups and ROK Profile). We will review it and get back to you**");
      }
    });
  }

  if (interaction.commandName === "approve" || interaction.commandName === "reject") {
    if (!interaction.member.roles.cache.has(APPROVE_ROLE_ID)) {
      return interaction.reply({ content: "❌ No permission", ephemeral: true });
    }

    const row = await findRow(ticketId);
    if (!row) return interaction.reply({ content: "❌ Ticket not found", ephemeral: true });

    const officer =
      interaction.member.globalName ||
      interaction.user.globalName ||
      interaction.user.username;

    await closeVote(channel);
    await updateCell(row, COLUMN.STATUS, interaction.commandName === "approve" ? "APPROVED" : "REJECTED");
    await updateCell(row, COLUMN.APPROVED_BY, officer);
    await updateCell(row, COLUMN.APPROVED_AT, new Date().toLocaleString());

    await channel.setParent(
      interaction.commandName === "approve"
        ? CLOSED_CATEGORY_ID
        : REJECTED_CATEGORY_ID
    );

    interaction.reply({ content: "✅ Action completed", ephemeral: true });
  }
});

client.login(BOT_TOKEN);
