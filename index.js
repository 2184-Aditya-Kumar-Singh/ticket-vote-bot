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

// ================= GOOGLE SHEETS =================
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(GOOGLE_CREDS),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});
const sheets = google.sheets({ version: "v4", auth });

async function writeToSheet(data, ticketName, approver) {
  const approvedBy =
    approver.globalName ||
    approver.user.globalName ||
    approver.user.username;

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

// ================= UTIL =================
function parseTopic(topic) {
  if (!topic) return null;
  const data = {};
  topic.split("|").forEach(p => {
    const [k, v] = p.split(":").map(s => s?.trim());
    if (!v) return;
    if (k === "Name") data.name = v;
    if (k === "Power") data.power = v;
    if (k === "KP") data.kp = v;
    if (k === "VIP") data.vip = v;
  });
  return data;
}

// ================= READY =================
client.once(Events.ClientReady, async () => {
  const commands = [
    new SlashCommandBuilder().setName("fill-details").setDescription("Fill migration details"),
    new SlashCommandBuilder().setName("approve").setDescription("Approve this ticket")
  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(BOT_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });

  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ================= SLASH COMMANDS =================
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const channel = interaction.channel;

  // ---------- /fill-details ----------
  if (interaction.commandName === "fill-details") {
    if (channel.topic?.includes("FORM_COMPLETED")) {
      return interaction.reply("✅ Details already completed.");
    }

    const steps = [
      { key: "Name", q: "📝 What is your in-game name?" },
      { key: "Power", q: "⚡ What is your current power?" },
      { key: "KP", q: "⚔️ What are your total kill points?" },
      { key: "VIP", q: "👑 What is your VIP level?" }
    ];

    let index = 0;
    await interaction.reply(steps[index].q);

    const collector = channel.createMessageCollector({
      filter: m => m.author.id === interaction.user.id && !m.author.bot,
      time: 10 * 60 * 1000
    });

    collector.on("collect", async (msg) => {
      index++;

      const existing = parseTopic(channel.topic) || {};
      existing[steps[index - 1].key.toLowerCase()] = msg.content.trim();

      const topic =
        `Name:${existing.name || ""} | Power:${existing.power || ""} | KP:${existing.kp || ""} | VIP:${existing.vip || ""}`;

      await channel.setTopic(topic);

      if (index < steps.length) {
        channel.send(steps[index].q);
      } else {
        await channel.setTopic(`FORM_COMPLETED | ${topic}`);
        collector.stop();

        channel.send(
`✅ **Basic details saved successfully**

📸 Please now send screenshots of:
• Commanders
• Equipment
• Bag (resources & speedups)
• ROK profile (ID visible)

⏳ Please wait for Migration Officers to respond.`
        );
      }
    });
  }

  // ---------- /approve ----------
  if (interaction.commandName === "approve") {
    if (!interaction.member.roles.cache.has(APPROVE_ROLE_ID)) {
      return interaction.reply({ content: "❌ No permission.", ephemeral: true });
    }

    const data = parseTopic(channel.topic);
    if (!data || !channel.topic.includes("FORM_COMPLETED")) {
      return interaction.reply({ content: "❌ Form not completed.", ephemeral: true });
    }

    await writeToSheet(data, channel.name, interaction.member);
    await channel.setParent(CLOSED_CATEGORY_ID, { lockPermissions: false });

    interaction.reply({ content: "✅ Ticket approved and logged.", ephemeral: true });
  }
});

client.login(BOT_TOKEN);
