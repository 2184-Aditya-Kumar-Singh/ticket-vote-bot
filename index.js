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
    GatewayIntentBits.MessageContent // ✅ REQUIRED
  ],
  partials: [Partials.Channel, Partials.Message]
});


// ================= ENV =================
const BOT_TOKEN = process.env.BOT_TOKEN;
const CLOSED_CATEGORY_ID = process.env.CLOSED_CATEGORY_ID;
const APPROVE_ROLE_ID = process.env.MOVE_ROLE_ID;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_CREDS = process.env.GOOGLE_CREDS;

// ================= GOOGLE AUTH =================
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(GOOGLE_CREDS),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});
const sheets = google.sheets({ version: "v4", auth });

// ================= COLUMN MAP (SAFE) =================
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
  const index = rows.findIndex(r => r[0] === ticketId);
  return index === -1 ? null : index + 1;
}

async function createRow(ticketId) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: "Sheet1!A:I",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        ticketId,
        "", "", "", "",
        "PENDING",
        "", "",
        "" // Discord User will be set explicitly
      ]]
    }
  });
}


async function updateCell(row, column, value) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `Sheet1!${column}${row}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[value]]
    }
  });
}

// ================= READY =================
client.once(Events.ClientReady, async () => {
  const commands = [
    new SlashCommandBuilder()
      .setName("fill-details")
      .setDescription("Fill migration details"),
    new SlashCommandBuilder()
      .setName("approve")
      .setDescription("Approve this ticket")
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: "10" }).setToken(BOT_TOKEN);
  await rest.put(
    Routes.applicationCommands(client.user.id),
    { body: commands }
  );

  console.log(`✅ Bot ready as ${client.user.tag}`);
});

// ================= COMMAND HANDLER =================
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const channel = interaction.channel;
  const ticketId = channel.name;

  // ---------- /fill-details ----------
  if (interaction.commandName === "fill-details") {
    let row = await findRow(ticketId);

    if (!row) {
  await createRow(ticketId);
  row = await findRow(ticketId);

  await updateCell(
    row,
    COLUMN.DISCORD_USER,
    interaction.user.username
  );
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
      // ✅ SAVE EXACT TEXT (spaces, words, numbers — everything)
      await updateCell(row, questions[step].col, msg.content);

      step++;

      if (step < questions.length) {
        channel.send(questions[step].q);
      } else {
        collector.stop();
        channel.send(
`✅ **Details saved successfully**

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
      return interaction.reply({
        content: "❌ You do not have permission.",
        ephemeral: true
      });
    }

    const row = await findRow(ticketId);
    if (!row) {
      return interaction.reply({
        content: "❌ Ticket data not found.",
        ephemeral: true
      });
    }

    const approverName =
      interaction.member.globalName ||
      interaction.user.globalName ||
      interaction.user.username;

    await updateCell(row, COLUMN.STATUS, "APPROVED");
    await updateCell(row, COLUMN.APPROVED_BY, approverName);
    await updateCell(row, COLUMN.APPROVED_AT, new Date().toLocaleString());

    await channel.setParent(CLOSED_CATEGORY_ID);
    interaction.reply({
      content: "✅ Ticket approved and logged.",
      ephemeral: true
    });
  }
});

// ================= LOGIN =================
client.login(BOT_TOKEN);
