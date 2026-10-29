const { Bot, InlineKeyboard, InputFile } = require("grammy");
const fs = require("fs");
const path = require("path");

const bot = new Bot(process.env.BOT_TOKEN);
// ... [truncated for this test] ...