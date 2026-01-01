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
    GatewayIntentBits.GuildMessages
  ],
  partials: [Partials.Channel]
});

// ================= ENV =================
const BOT_TOKEN = process.env.BOT_TOKEN;
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID;
const CLOSED_CATEGORY_ID = process.env.CLOSED_CATEGORY_ID;
const APPROVE_ROLE_ID = process.env.MOVE_ROLE_ID;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_CREDS = process.env.GOOGLE_CREDS;

// ================= GOOGLE SHEETS =================
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(GOOGLE_CREDS),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});
const sheets = google.sheets({ version: "v4", auth });

// ================= HELPERS =================
async function appendTicketRow(ticketId, discordUser) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: "Sheet1!A:I",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        ticketId,
        "", "", "", "",
        "PENDING",
        "",
        "",
        discordUser
      ]]
    }
  });
}

async function updateTicketField(ticketId, columnIndex, value) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: "Sheet1!A:A"
  });

  const rowIndex = res.data.values.findIndex(
    r => r[0] === ticketId
  );

  if (rowIndex === -1) return;

  const rowNumber = rowIndex + 1;
  const columnLetter = String.fromCharCode(65 + columnIndex);

  await sheets.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `Sheet1!${columnLetter}${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[value]] }
  });
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

// ================= TICKET CREATED =================
client.on(Events.ChannelCreate, async (channel) => {
  if (channel.parentId !== TICKET_CATEGORY_ID) return;
  if (!channel.name.startsWith("ticket-")) return;

  await appendTicketRow(
    channel.name,
    channel.guild.members.cache.get(channel.creatorId)?.user.username || "Unknown"
  );
});

// ================= SLASH COMMANDS =================
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const channel = interaction.channel;

  // ---------- /fill-details ----------
  if (interaction.commandName === "fill-details") {
    const questions = [
      { col: 1, q: "📝 What is your in-game name?" },
      { col: 2, q: "⚡ What is your current power?" },
      { col: 3, q: "⚔️ What are your total kill points?" },
      { col: 4, q: "👑 What is your VIP level?" }
    ];

    let step = 0;
    await interaction.reply(questions[step].q);

    const collector = channel.createMessageCollector({
      filter: m => m.author.id === interaction.user.id,
      time: 10 * 60 * 1000
    });

    collector.on("collect", async (msg) => {
      await updateTicketField(channel.name, questions[step].col, msg.content);
      step++;

      if (step < questions.length) {
        channel.send(questions[step].q);
      } else {
        collector.stop();
        channel.send(
`✅ **Details saved**

📸 Please send screenshots of commanders, equipment, bag & profile.
⏳ Wait for migration officers to respond.`
        );
      }
    });
  }

  // ---------- /approve ----------
  if (interaction.commandName === "approve") {
    if (!interaction.member.roles.cache.has(APPROVE_ROLE_ID)) {
      return interaction.reply({ content: "❌ No permission", ephemeral: true });
    }

    await updateTicketField(channel.name, 5, "APPROVED");
    await updateTicketField(channel.name, 6,
      interaction.member.globalName ||
      interaction.user.username
    );
    await updateTicketField(channel.name, 7,
      new Date().toLocaleString()
    );

    await channel.setParent(CLOSED_CATEGORY_ID);
    interaction.reply({ content: "✅ Ticket approved", ephemeral: true });
  }
});

client.login(BOT_TOKEN);
