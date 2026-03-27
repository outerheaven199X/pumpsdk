import { Bot, InlineKeyboard, Context, session } from "grammy";
import * as dotenv from "dotenv";
import WebSocket from "ws";
dotenv.config();

// ── Config ──────────────────────────────────────────
const token = process.env.TELEGRAM_BOT_TOKEN!;
if (!token) { console.error("TELEGRAM_BOT_TOKEN not set"); process.exit(1); }

const ALLOWED = new Set(
  (process.env.TELEGRAM_ALLOWED_USERS ?? "").split(",").map(s => s.trim()).filter(Boolean).map(Number)
);
const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const WALLET = process.env.WALLET_PUBKEY ?? "";
const SIGNING_SERVER = process.env.SIGNING_SERVER_URL ?? "http://localhost:3142";

// ── Types ───────────────────────────────────────────
interface LaunchDraft {
  step: "name" | "symbol" | "description" | "image" | "socials" | "devbuy" | "confirm" | "done";
  name?: string;
  symbol?: string;
  description?: string;
  imageFileId?: string;       // Telegram file ID if uploaded
  generateImage?: boolean;    // use AI generation
  twitter?: string;
  telegram?: string;
  website?: string;
  devBuySol?: number;
}

interface SessionData {
  sniperEnabled: boolean;
  sniperMaxMcap: number;
  sniperAutoBuy: boolean;
  sniperBuyAmount: number;
  watchlist: string[];
  alertsChat: number | null;
  launch: LaunchDraft | null;  // active launch flow
}

type BotContext = Context & { session: SessionData };

// ── Helpers ─────────────────────────────────────────
const truncAddr = (a: string) => a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
const fmtSol = (n: number) => n.toFixed(4);
const fmtUsd = (n: number) =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${n.toFixed(2)}`;
const fmtAmt = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(2);
const progressBar = (pct: number) => {
  const f = Math.round(Math.min(pct, 100) / 5);
  return "▓".repeat(f) + "░".repeat(20 - f) + ` ${pct.toFixed(1)}%`;
};

async function rpc(method: string, params: any[]): Promise<any> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const d = await res.json() as any;
  if (d.error) throw new Error(d.error.message);
  return d.result;
}

async function getSolBalance(): Promise<number> {
  return ((await rpc("getBalance", [WALLET]))?.value ?? 0) / 1e9;
}

let cachedSolPrice = 0;
let solPriceFetchedAt = 0;
async function getSolPrice(): Promise<number> {
  if (Date.now() - solPriceFetchedAt < 30_000 && cachedSolPrice > 0) return cachedSolPrice;
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd");
    cachedSolPrice = ((await r.json()) as any).solana.usd;
    solPriceFetchedAt = Date.now();
    return cachedSolPrice;
  } catch { return cachedSolPrice || 0; }
}

async function getHoldings() {
  const r = await rpc("getTokenAccountsByOwner", [
    WALLET,
    { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
    { encoding: "jsonParsed" },
  ]);
  return (r?.value ?? [])
    .map((a: any) => {
      const i = a.account.data.parsed.info;
      return { mint: i.mint as string, amount: i.tokenAmount.uiAmount as number, decimals: i.tokenAmount.decimals as number };
    })
    .filter((h: any) => h.amount > 0)
    .sort((a: any, b: any) => b.amount - a.amount);
}

async function pump(mint: string): Promise<any | null> {
  try {
    const r = await fetch(`https://frontend-api-v3.pump.fun/coins/${mint}`);
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

function extractMint(input: string): string {
  const m = input.match(/pump\.fun\/(?:coin|token)\/([A-Za-z0-9]+)/) ??
            input.match(/solscan\.io\/token\/([A-Za-z0-9]+)/);
  return m ? m[1] : input.trim();
}

// ── Bot Setup ───────────────────────────────────────
const bot = new Bot<BotContext>(token);

bot.use(session({
  initial: (): SessionData => ({
    sniperEnabled: false,
    sniperMaxMcap: 100_000,
    sniperAutoBuy: false,
    sniperBuyAmount: 0.01,
    watchlist: [],
    alertsChat: null,
    launch: null,
  }),
}));

// Whitelist
bot.use((ctx, next) => {
  if (ALLOWED.size === 0) return next();
  if (!ctx.from || !ALLOWED.has(ctx.from.id)) return;
  return next();
});

// ── Main Menu ───────────────────────────────────────
const mainMenu = () => new InlineKeyboard()
  .text("💰 Balance", "bal").text("📊 Portfolio", "port").row()
  .text("🔍 Lookup Token", "look").text("👁 Watchlist", "watch").row()
  .text("🎯 Sniper", "snipe").text("🚀 Launch Token", "launch").row()
  .text("⚙️ Settings", "settings");

bot.command("start", async (ctx) => {
  ctx.session.alertsChat = ctx.chat?.id ?? null;
  ctx.session.launch = null;
  await ctx.reply(
    `💊 *PumpSDK*\n\nWallet: \`${truncAddr(WALLET)}\`\nYour ID: \`${ctx.from?.id}\``,
    { parse_mode: "Markdown", reply_markup: mainMenu() }
  );
});

bot.command("menu", (ctx) => {
  ctx.session.launch = null;
  ctx.reply("Pick one.", { reply_markup: mainMenu() });
});

bot.callbackQuery("menu", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.launch = null;
  await ctx.editMessageText(`💊 *PumpSDK*\n\nWallet: \`${truncAddr(WALLET)}\``, {
    parse_mode: "Markdown", reply_markup: mainMenu(),
  });
});

// ── Balance ─────────────────────────────────────────
bot.callbackQuery("bal", async (ctx) => {
  await ctx.answerCallbackQuery();
  try {
    const [sol, price] = await Promise.all([getSolBalance(), getSolPrice()]);
    await ctx.editMessageText(
      `💰 *Balance*\n\nSOL: \`${fmtSol(sol)}\` (${fmtUsd(sol * price)})\nSOL/USD: \`$${price.toFixed(2)}\`\n\nWallet: \`${truncAddr(WALLET)}\``,
      { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("📊 Portfolio", "port").text("🔙 Menu", "menu") }
    );
  } catch (e: any) {
    await ctx.editMessageText(`Error: ${e.message}`, { reply_markup: new InlineKeyboard().text("🔙 Menu", "menu") });
  }
});

bot.command("balance", async (ctx) => {
  const [sol, price] = await Promise.all([getSolBalance(), getSolPrice()]);
  await ctx.reply(`💰 \`${fmtSol(sol)}\` SOL (${fmtUsd(sol * price)})`, {
    parse_mode: "Markdown",
    reply_markup: new InlineKeyboard().text("📊 Portfolio", "port").text("🔙 Menu", "menu"),
  });
});

// ── Portfolio ───────────────────────────────────────
bot.callbackQuery("port", async (ctx) => {
  await ctx.answerCallbackQuery();
  try {
    await ctx.editMessageText("_Loading portfolio…_", { parse_mode: "Markdown" });
    const [holdings, solBal, solPrice] = await Promise.all([getHoldings(), getSolBalance(), getSolPrice()]);

    let totalUsd = solBal * solPrice;
    const lines: string[] = [];

    for (const h of holdings.slice(0, 10)) {
      const d = await pump(h.mint);
      if (d) {
        const pp = d.virtual_sol_reserves && d.virtual_token_reserves
          ? (d.virtual_sol_reserves / 1e9) / (d.virtual_token_reserves / 1e6) : 0;
        const valSol = h.amount * pp;
        const valUsd = valSol * solPrice;
        totalUsd += valUsd;
        const grad = d.complete ? "🎓" : `${((d.virtual_sol_reserves / 1e9 / 85) * 100).toFixed(0)}%`;
        lines.push(`💊 *${d.name}* ($${d.symbol}) ${grad}\n   ${fmtAmt(h.amount)} → ${fmtSol(valSol)} SOL (${fmtUsd(valUsd)})`);
      } else {
        lines.push(`\`${truncAddr(h.mint)}\`: ${fmtAmt(h.amount)}`);
      }
    }

    const text = [
      `📊 *Portfolio*`,
      `💎 Total: *${fmtUsd(totalUsd)}*\n`,
      `SOL: \`${fmtSol(solBal)}\` (${fmtUsd(solBal * solPrice)})`,
      ``,
      ...lines,
      holdings.length > 10 ? `\n_+${holdings.length - 10} more_` : "",
    ].filter(Boolean).join("\n");

    await ctx.editMessageText(text, {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard().text("🔄 Refresh", "port").text("🔙 Menu", "menu"),
    });
  } catch (e: any) {
    await ctx.editMessageText(`Error: ${e.message}`, { reply_markup: new InlineKeyboard().text("🔙 Menu", "menu") });
  }
});

// ── Token Lookup ────────────────────────────────────
bot.callbackQuery("look", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(
    "🔍 *Lookup*\n\nPaste a mint address or pump.fun URL.",
    { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("🔙 Menu", "menu") }
  );
});

bot.command("price", async (ctx) => {
  const m = ctx.match?.trim();
  if (!m) return ctx.reply("Usage: /price <mint>");
  await showTokenCard(ctx, extractMint(m));
});

async function showTokenCard(ctx: BotContext | Context, mint: string) {
  const d = await pump(mint);
  if (!d) return ctx.reply("Not found on Pump.fun.");

  const solPrice = await getSolPrice();
  const pp = d.virtual_sol_reserves && d.virtual_token_reserves
    ? (d.virtual_sol_reserves / 1e9) / (d.virtual_token_reserves / 1e6) : 0;
  const mcap = d.usd_market_cap ?? 0;
  const prog = d.complete ? 100 : ((d.virtual_sol_reserves / 1e9) / 85) * 100;

  await ctx.reply(
    [
      `💊 *${d.name}* ($${d.symbol})`,
      ``,
      `Price: \`${pp.toFixed(10)}\` SOL`,
      `MCap: ${fmtUsd(mcap)}`,
      `${d.complete ? "🎓 Graduated" : progressBar(prog)}`,
      ``,
      `CA: \`${mint}\``,
    ].join("\n"),
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard()
        .text("🟢 0.01", `b_${mint}_0.01`).text("🟢 0.05", `b_${mint}_0.05`).text("🟢 0.1", `b_${mint}_0.1`).row()
        .text("🔴 25%", `s_${mint}_25`).text("🔴 50%", `s_${mint}_50`).text("🔴 100%", `s_${mint}_100`).row()
        .text("👁 Watch", `w_${mint}`).text("🔄", `r_${mint}`).row()
        .url("Pump.fun", `https://pump.fun/coin/${mint}`).url("Solscan", `https://solscan.io/token/${mint}`),
    }
  );
}

// ── Buy ─────────────────────────────────────────────
bot.callbackQuery(/^b_(.+)_(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const [, mint, amt] = ctx.match!;
  const d = await pump(mint);
  const name = d ? `${d.name} ($${d.symbol})` : truncAddr(mint);

  await ctx.editMessageText(
    `🟢 *Buy ${amt} SOL*\n\nToken: ${name}\nSlippage: 10%\n\n⚠️ Opens a signing page in your browser.`,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard()
        .text("✅ Confirm", `cb_${mint}_${amt}`)
        .text("❌ Cancel", "menu"),
    }
  );
});

bot.callbackQuery(/^cb_(.+)_(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery("Building transaction…");
  const [, mint, amt] = ctx.match!;

  try {
    // Build buy tx via signing server
    const res = await fetch(`${SIGNING_SERVER}/api/trade/buy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mint, amountSol: parseFloat(amt), wallet: WALLET }),
    });

    if (res.ok) {
      const { signingUrl } = await res.json() as any;
      if (signingUrl && signingUrl.startsWith("https://")) {
        await ctx.editMessageText(
          `🟢 *Buy ${amt} SOL*\n\nTransaction ready. Tap below to sign.`,
          { parse_mode: "Markdown", reply_markup: new InlineKeyboard().url("🔐 Sign Transaction", signingUrl).row().text("🔙 Menu", "menu") }
        );
        return;
      }
    }
  } catch {}

  // Fallback: show signing server address as text
  await ctx.editMessageText(
    `🟢 *Buy ${amt} SOL of* \`${truncAddr(mint)}\`\n\n` +
    `Transaction built. Open your signing page to approve:\n\`${SIGNING_SERVER}\`\n\n` +
    `_Direct signing URLs coming soon._`,
    { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("🔙 Menu", "menu") }
  );
});

// ── Sell ─────────────────────────────────────────────
bot.callbackQuery(/^s_(.+)_(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const [, mint, pct] = ctx.match!;
  const d = await pump(mint);
  const name = d ? `${d.name} ($${d.symbol})` : truncAddr(mint);

  await ctx.editMessageText(
    `🔴 *Sell ${pct}%*\n\nToken: ${name}\nSlippage: 10%`,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard()
        .text("✅ Confirm", `cs_${mint}_${pct}`)
        .text("❌ Cancel", "menu"),
    }
  );
});

bot.callbackQuery(/^cs_(.+)_(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery("Building transaction…");
  const [, mint, pct] = ctx.match!;

  await ctx.editMessageText(
    `🔴 *Sell ${pct}% of* \`${truncAddr(mint)}\`\n\n` +
    `Open your signing page to approve:\n\`${SIGNING_SERVER}\`\n\n` +
    `_Direct signing URLs coming soon._`,
    { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("🔙 Menu", "menu") }
  );
});

// ── Refresh token ───────────────────────────────────
bot.callbackQuery(/^r_(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery("Refreshing…");
  try { await ctx.deleteMessage(); } catch {}
  await showTokenCard(ctx, ctx.match![1]);
});

// ── Watchlist ───────────────────────────────────────
bot.callbackQuery(/^w_(.+)$/, async (ctx) => {
  const mint = ctx.match![1];
  if (!ctx.session.watchlist.includes(mint)) ctx.session.watchlist.push(mint);
  await ctx.answerCallbackQuery("Added to watchlist ✓");
});

bot.callbackQuery("watch", async (ctx) => {
  await ctx.answerCallbackQuery();
  const wl = ctx.session.watchlist;

  if (!wl.length) {
    return ctx.editMessageText("👁 *Watchlist* — empty\n\nLook up a token and tap 👁 Watch.", {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard().text("🔍 Lookup", "look").text("🔙 Menu", "menu"),
    });
  }

  let text = "👁 *Watchlist*\n\n";
  const kb = new InlineKeyboard();

  for (const mint of wl.slice(0, 8)) {
    const d = await pump(mint);
    if (d) {
      const pp = d.virtual_sol_reserves && d.virtual_token_reserves
        ? (d.virtual_sol_reserves / 1e9) / (d.virtual_token_reserves / 1e6) : 0;
      text += `💊 *${d.name}* ($${d.symbol}): \`${pp.toFixed(8)}\` SOL\n`;
      kb.text(d.symbol ?? truncAddr(mint), `r_${mint}`).text("❌", `uw_${mint}`).row();
    }
  }

  kb.text("🔄 Refresh", "watch").text("🔙 Menu", "menu");
  await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: kb });
});

bot.callbackQuery(/^uw_(.+)$/, async (ctx) => {
  ctx.session.watchlist = ctx.session.watchlist.filter(m => m !== ctx.match![1]);
  await ctx.answerCallbackQuery("Removed ✓");
});

// ═══════════════════════════════════════════════════
// ── LAUNCH FLOW (conversational, all in Telegram) ──
// ═══════════════════════════════════════════════════

bot.callbackQuery("launch", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.launch = { step: "name" };
  await ctx.editMessageText(
    `🚀 *Launch a Token*\n\n` +
    `Let's create your token step by step.\n\n` +
    `*Step 1/6 — Name*\n` +
    `What's your token called?\n\n` +
    `_Type the name and send it._`,
    { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("❌ Cancel", "launch_cancel") }
  );
});

bot.callbackQuery("launch_cancel", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.launch = null;
  await ctx.editMessageText("Launch cancelled.", {
    reply_markup: new InlineKeyboard().text("🔙 Menu", "menu"),
  });
});

// ── Step 2: Symbol ──────────────────────────────────
async function askSymbol(ctx: BotContext) {
  await ctx.reply(
    `✅ Name: *${ctx.session.launch!.name}*\n\n` +
    `*Step 2/6 — Symbol*\n` +
    `What's the ticker? (e.g. DOGE, PEPE, BONK)\n\n` +
    `_Type the symbol and send it._`,
    { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("❌ Cancel", "launch_cancel") }
  );
}

// ── Step 3: Description ─────────────────────────────
async function askDescription(ctx: BotContext) {
  await ctx.reply(
    `✅ *${ctx.session.launch!.name}* ($${ctx.session.launch!.symbol})\n\n` +
    `*Step 3/6 — Description*\n` +
    `Write a short description for your token.\n\n` +
    `_Type it and send, or tap Skip._`,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard()
        .text("⏭ Skip", "launch_skip_desc")
        .text("❌ Cancel", "launch_cancel"),
    }
  );
}

bot.callbackQuery("launch_skip_desc", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.launch!.description = "";
  ctx.session.launch!.step = "image";
  await askImage(ctx);
});

// ── Step 4: Image ───────────────────────────────────
async function askImage(ctx: BotContext) {
  await ctx.reply(
    `✅ *${ctx.session.launch!.name}* ($${ctx.session.launch!.symbol})\n\n` +
    `*Step 4/6 — Image*\n` +
    `Send me an image for your token, or tap Generate to create one with AI.\n\n` +
    `_Upload a photo, or tap a button._`,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard()
        .text("🎨 Generate Image", "launch_gen_image").row()
        .text("⏭ Skip (no image)", "launch_skip_image")
        .text("❌ Cancel", "launch_cancel"),
    }
  );
}

bot.callbackQuery("launch_gen_image", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.launch!.generateImage = true;
  ctx.session.launch!.step = "socials";
  await askSocials(ctx);
});

bot.callbackQuery("launch_skip_image", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.launch!.step = "socials";
  await askSocials(ctx);
});

// ── Step 5: Socials ─────────────────────────────────
async function askSocials(ctx: BotContext) {
  const L = ctx.session.launch!;
  const imgStatus = L.imageFileId ? "📷 Uploaded" : L.generateImage ? "🎨 AI Generated" : "—";

  await ctx.reply(
    `✅ *${L.name}* ($${L.symbol})\n` +
    `Image: ${imgStatus}\n\n` +
    `*Step 5/6 — Socials* (optional)\n\n` +
    `Tap to add links or skip to dev buy.`,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard()
        .text(L.twitter ? `✅ Twitter` : "🐦 Add Twitter", "launch_social_twitter").row()
        .text(L.telegram ? `✅ Telegram` : "💬 Add Telegram", "launch_social_telegram").row()
        .text(L.website ? `✅ Website` : "🌐 Add Website", "launch_social_website").row()
        .text("⏭ Skip to Dev Buy", "launch_to_devbuy")
        .text("❌ Cancel", "launch_cancel"),
    }
  );
}

// Social input handlers
bot.callbackQuery("launch_social_twitter", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.launch!.step = "socials"; // stay on socials, but expect twitter input
  await ctx.reply("🐦 Send your Twitter/X URL (or just the handle):");
  // We'll catch this in the text handler via a flag
  (ctx.session as any)._awaitingSocial = "twitter";
});

bot.callbackQuery("launch_social_telegram", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply("💬 Send your Telegram group link:");
  (ctx.session as any)._awaitingSocial = "telegram";
});

bot.callbackQuery("launch_social_website", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply("🌐 Send your website URL:");
  (ctx.session as any)._awaitingSocial = "website";
});

bot.callbackQuery("launch_to_devbuy", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.launch!.step = "devbuy";
  await askDevBuy(ctx);
});

// ── Step 6: Dev Buy Amount ──────────────────────────
async function askDevBuy(ctx: BotContext) {
  const L = ctx.session.launch!;
  await ctx.reply(
    `✅ *${L.name}* ($${L.symbol})\n\n` +
    `*Step 6/6 — Dev Buy*\n\n` +
    `How much SOL to buy after creating?\n` +
    `_(0 = create only, no initial buy)_`,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard()
        .text("0 SOL", "launch_devbuy_0").text("0.1 SOL", "launch_devbuy_0.1").text("0.25 SOL", "launch_devbuy_0.25").row()
        .text("0.5 SOL", "launch_devbuy_0.5").text("1.0 SOL", "launch_devbuy_1").text("2.0 SOL", "launch_devbuy_2").row()
        .text("❌ Cancel", "launch_cancel"),
    }
  );
}

// Dev buy callbacks
for (const amt of ["0", "0.1", "0.25", "0.5", "1", "2"]) {
  bot.callbackQuery(`launch_devbuy_${amt}`, async (ctx) => {
    await ctx.answerCallbackQuery();
    ctx.session.launch!.devBuySol = parseFloat(amt);
    ctx.session.launch!.step = "confirm";
    await showLaunchConfirmation(ctx);
  });
}

// ── Confirmation Card ───────────────────────────────
async function showLaunchConfirmation(ctx: BotContext) {
  const L = ctx.session.launch!;
  const imgStatus = L.imageFileId ? "📷 Uploaded" : L.generateImage ? "🎨 AI Generate" : "❌ None";
  const socials = [
    L.twitter ? `🐦 ${L.twitter}` : null,
    L.telegram ? `💬 ${L.telegram}` : null,
    L.website ? `🌐 ${L.website}` : null,
  ].filter(Boolean).join("\n") || "_none_";

  const devBuyText = L.devBuySol && L.devBuySol > 0
    ? `${L.devBuySol} SOL (separate buy tx after create)`
    : "None (create only)";

  await ctx.reply(
    [
      `🚀 *Launch Confirmation*`,
      ``,
      `*Name:* ${L.name}`,
      `*Symbol:* $${L.symbol}`,
      `*Description:* ${L.description || "_none_"}`,
      `*Image:* ${imgStatus}`,
      ``,
      `*Socials:*`,
      socials,
      ``,
      `*Dev Buy:* ${devBuyText}`,
      ``,
      `*Transaction flow:*`,
      `1️⃣ Upload metadata to IPFS`,
      `2️⃣ Create token (amount = 0)`,
      L.devBuySol && L.devBuySol > 0 ? `3️⃣ Dev buy (${L.devBuySol} SOL)` : "",
      ``,
      `⚠️ You will sign ${L.devBuySol && L.devBuySol > 0 ? "2 transactions" : "1 transaction"} in your browser wallet.`,
    ].filter(Boolean).join("\n"),
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard()
        .text("✅ Launch It", "launch_execute").row()
        .text("✏️ Edit Name", "launch_edit_name").text("✏️ Edit Symbol", "launch_edit_symbol").row()
        .text("✏️ Edit Dev Buy", "launch_edit_devbuy").row()
        .text("❌ Cancel", "launch_cancel"),
    }
  );
}

// Edit callbacks (go back to that step)
bot.callbackQuery("launch_edit_name", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.launch!.step = "name";
  await ctx.reply("*Edit Name* — type the new name:", { parse_mode: "Markdown" });
});

bot.callbackQuery("launch_edit_symbol", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.launch!.step = "symbol";
  await ctx.reply("*Edit Symbol* — type the new ticker:", { parse_mode: "Markdown" });
});

bot.callbackQuery("launch_edit_devbuy", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.launch!.step = "devbuy";
  await askDevBuy(ctx);
});

// ── Execute Launch ──────────────────────────────────
bot.callbackQuery("launch_execute", async (ctx) => {
  await ctx.answerCallbackQuery("Preparing launch…");
  const L = ctx.session.launch!;

  await ctx.editMessageText(
    `⏳ *Launching ${L.name}…*\n\n` +
    `Step 1: Uploading metadata to IPFS…`,
    { parse_mode: "Markdown" }
  );

  try {
    // 1. Upload metadata to pump.fun IPFS
    //    If user uploaded an image, download it from Telegram first
    let imageBuffer: Buffer | null = null;
    if (L.imageFileId) {
      const file = await bot.api.getFile(L.imageFileId);
      const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
      const imgRes = await fetch(fileUrl);
      imageBuffer = Buffer.from(await imgRes.arrayBuffer());
    }

    // Build IPFS upload via signing server proxy (or direct to pump.fun)
    const ipfsPayload: any = {
      name: L.name,
      symbol: L.symbol,
      description: L.description || `${L.name} — launched via PumpSDK`,
      twitter: L.twitter || "",
      telegram: L.telegram || "",
      website: L.website || "",
      showName: "true",
    };

    // Try signing server IPFS proxy first
    let metadataUri: string | null = null;
    try {
      const ipfsRes = await fetch(`${SIGNING_SERVER}/api/launch/ipfs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...ipfsPayload,
          generateImage: L.generateImage ?? false,
          imageBase64: imageBuffer ? imageBuffer.toString("base64") : null,
        }),
      });
      if (ipfsRes.ok) {
        const ipfsData = await ipfsRes.json() as any;
        metadataUri = ipfsData.metadataUri;
      }
    } catch {}

    if (!metadataUri) {
      await ctx.editMessageText(
        `❌ *IPFS upload failed*\n\n` +
        `The signing server couldn't upload metadata.\n` +
        `Make sure the signing server is running at:\n\`${SIGNING_SERVER}\``,
        { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("🔄 Retry", "launch_execute").text("🔙 Menu", "menu") }
      );
      return;
    }

    await ctx.editMessageText(
      `⏳ *Launching ${L.name}…*\n\n` +
      `✅ Metadata uploaded\n` +
      `Step 2: Building create transaction…`,
      { parse_mode: "Markdown" }
    );

    // 2. Build create session via signing server
    const createRes = await fetch(`${SIGNING_SERVER}/api/launch/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: L.name,
        symbol: L.symbol,
        metadataUri,
        devBuySol: L.devBuySol ?? 0,
        wallet: WALLET,
      }),
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      throw new Error(`Signing server error: ${createRes.status} — ${errText}`);
    }

    const { signingUrl, sessionId, mintAddress } = await createRes.json() as any;

    ctx.session.launch!.step = "done";

    const signingKb = new InlineKeyboard();

    // Only use .url() if it's https
    if (signingUrl && signingUrl.startsWith("https://")) {
      signingKb.url("🔐 Open Signing Page", signingUrl).row();
    }

    signingKb
      .url("👀 View on Pump.fun", `https://pump.fun/coin/${mintAddress}`).row()
      .text("🔙 Menu", "menu");

    const signingText = signingUrl && signingUrl.startsWith("https://")
      ? `Tap below to open the signing page.`
      : `Open your signing page to approve:\n\`${signingUrl || SIGNING_SERVER}\``;

    await ctx.editMessageText(
      [
        `✅ *${L.name}* ($${L.symbol}) ready to launch!`,
        ``,
        `Mint: \`${mintAddress}\``,
        L.devBuySol && L.devBuySol > 0 ? `Dev Buy: ${L.devBuySol} SOL` : `Dev Buy: none`,
        ``,
        signingText,
        ``,
        `You'll sign ${L.devBuySol && L.devBuySol > 0 ? "2 transactions" : "1 transaction"}:`,
        `1️⃣ Create token (amount = 0)`,
        L.devBuySol && L.devBuySol > 0 ? `2️⃣ Buy ${L.devBuySol} SOL` : "",
      ].filter(Boolean).join("\n"),
      { parse_mode: "Markdown", reply_markup: signingKb }
    );

  } catch (e: any) {
    await ctx.editMessageText(
      `❌ *Launch failed*\n\n\`${e.message}\``,
      { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("🔄 Retry", "launch_execute").text("🔙 Menu", "menu") }
    );
  }
});

// ═══════════════════════════════════════════════════
// ── TEXT + PHOTO HANDLER (launch flow + lookups) ───
// ═══════════════════════════════════════════════════

// Photo handler (for launch image upload)
bot.on("message:photo", async (ctx) => {
  const L = ctx.session.launch;
  if (!L || L.step !== "image") return;

  // Get the largest photo
  const photos = ctx.message.photo;
  const largest = photos[photos.length - 1];
  L.imageFileId = largest.file_id;
  L.step = "socials";
  await ctx.reply("📷 Image received!");
  await askSocials(ctx);
});

// Text handler (multi-purpose)
bot.on("message:text", async (ctx) => {
  const text = ctx.message.text.trim();
  if (text.startsWith("/")) return; // don't intercept commands

  const L = ctx.session.launch;

  // ── Handle social input awaiting ──
  const awaitingSocial = (ctx.session as any)._awaitingSocial;
  if (L && awaitingSocial) {
    if (awaitingSocial === "twitter") L.twitter = text;
    else if (awaitingSocial === "telegram") L.telegram = text;
    else if (awaitingSocial === "website") L.website = text;
    (ctx.session as any)._awaitingSocial = null;
    await ctx.reply(`✅ Saved!`);
    await askSocials(ctx);
    return;
  }

  // ── Handle launch flow steps ──
  if (L) {
    switch (L.step) {
      case "name":
        if (text.length > 32) return ctx.reply("Name too long (max 32 chars). Try again.");
        L.name = text;
        L.step = "symbol";
        await askSymbol(ctx);
        return;

      case "symbol":
        const sym = text.toUpperCase().replace(/[^A-Z0-9]/g, "");
        if (sym.length > 10) return ctx.reply("Symbol too long (max 10 chars). Try again.");
        if (sym.length === 0) return ctx.reply("Symbol must have at least 1 letter. Try again.");
        L.symbol = sym;
        L.step = "description";
        await askDescription(ctx);
        return;

      case "description":
        if (text.length > 256) return ctx.reply("Description too long (max 256 chars). Try again.");
        L.description = text;
        L.step = "image";
        await askImage(ctx);
        return;

      default:
        break; // fall through to token lookup
    }
  }

  // ── Token lookup (auto-detect mint addresses) ──
  const mint = extractMint(text);
  if (mint.length >= 32 && mint.length <= 44 && /^[A-Za-z0-9]+$/.test(mint)) {
    await showTokenCard(ctx, mint);
  }
});

// ═══════════════════════════════════════════════════
// ── SNIPER ────────────────────────────────────────
// ═══════════════════════════════════════════════════

bot.callbackQuery("snipe", async (ctx) => {
  await ctx.answerCallbackQuery();
  await renderSniper(ctx);
});

async function renderSniper(ctx: BotContext) {
  const s = ctx.session;
  const on = s.sniperEnabled;
  const ab = s.sniperAutoBuy ? `🟢 ${s.sniperBuyAmount} SOL` : "🔴 Off";

  await ctx.editMessageText(
    [
      `🎯 *Sniper*`,
      ``,
      `Status: ${on ? "🟢 Active" : "🔴 Off"}`,
      `Max MCap: ${fmtUsd(s.sniperMaxMcap)}`,
      `Auto-Buy: ${ab}`,
      ``,
      `Watches PumpPortal for new launches.`,
      `Alerts you with instant buy buttons.`,
    ].join("\n"),
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard()
        .text(on ? "⏹ Stop" : "▶️ Start", "sn_toggle").row()
        .text("◀ MCap", "sn_mc_dn").text(fmtUsd(s.sniperMaxMcap), "sn_noop").text("MCap ▶", "sn_mc_up").row()
        .text(s.sniperAutoBuy ? "Auto-Buy: ON" : "Auto-Buy: OFF", "sn_ab").row()
        .text("◀", "sn_amt_dn").text(`${s.sniperBuyAmount} SOL`, "sn_noop").text("▶", "sn_amt_up").row()
        .text("🔙 Menu", "menu"),
    }
  );
}

bot.callbackQuery("sn_toggle", async (ctx) => {
  ctx.session.sniperEnabled = !ctx.session.sniperEnabled;
  if (ctx.session.sniperEnabled) {
    ctx.session.alertsChat = ctx.chat?.id ?? null;
    startSniper(ctx);
  } else {
    stopSniper();
  }
  await ctx.answerCallbackQuery(ctx.session.sniperEnabled ? "Sniper ON" : "Sniper OFF");
  await renderSniper(ctx);
});

bot.callbackQuery("sn_ab", async (ctx) => {
  ctx.session.sniperAutoBuy = !ctx.session.sniperAutoBuy;
  await ctx.answerCallbackQuery(ctx.session.sniperAutoBuy ? "Auto-buy ON" : "Auto-buy OFF");
  await renderSniper(ctx);
});

const BUY_AMTS = [0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1.0];
const MCAP_LIMITS = [10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000];

bot.callbackQuery("sn_amt_up", async (ctx) => {
  const i = BUY_AMTS.indexOf(ctx.session.sniperBuyAmount);
  if (i < BUY_AMTS.length - 1) ctx.session.sniperBuyAmount = BUY_AMTS[i + 1];
  await ctx.answerCallbackQuery(`${ctx.session.sniperBuyAmount} SOL`);
  await renderSniper(ctx);
});

bot.callbackQuery("sn_amt_dn", async (ctx) => {
  const i = BUY_AMTS.indexOf(ctx.session.sniperBuyAmount);
  if (i > 0) ctx.session.sniperBuyAmount = BUY_AMTS[i - 1];
  await ctx.answerCallbackQuery(`${ctx.session.sniperBuyAmount} SOL`);
  await renderSniper(ctx);
});

bot.callbackQuery("sn_mc_up", async (ctx) => {
  const i = MCAP_LIMITS.indexOf(ctx.session.sniperMaxMcap);
  ctx.session.sniperMaxMcap = MCAP_LIMITS[Math.min(i + 1, MCAP_LIMITS.length - 1)];
  await ctx.answerCallbackQuery(fmtUsd(ctx.session.sniperMaxMcap));
  await renderSniper(ctx);
});

bot.callbackQuery("sn_mc_dn", async (ctx) => {
  const i = MCAP_LIMITS.indexOf(ctx.session.sniperMaxMcap);
  ctx.session.sniperMaxMcap = MCAP_LIMITS[Math.max(i - 1, 0)];
  await ctx.answerCallbackQuery(fmtUsd(ctx.session.sniperMaxMcap));
  await renderSniper(ctx);
});

bot.callbackQuery("sn_noop", (ctx) => ctx.answerCallbackQuery());

// ── Sniper WebSocket ────────────────────────────────
let sniperWs: WebSocket | null = null;
let sniperCtx: BotContext | null = null;

function startSniper(ctx: BotContext) {
  stopSniper();
  sniperCtx = ctx;

  console.log("🎯 Sniper connecting…");
  const ws = new WebSocket("wss://pumpportal.fun/api/data");
  sniperWs = ws;

  ws.on("open", () => {
    console.log("🎯 Sniper connected");
    ws.send(JSON.stringify({ method: "subscribeNewToken" }));
  });

  ws.on("message", async (raw: Buffer) => {
    try {
      const d = JSON.parse(raw.toString());
      if (!d.mint || !d.name) return;

      const chatId = sniperCtx?.session.alertsChat;
      if (!chatId) return;

      const mcap = d.usd_market_cap ?? 0;
      if (mcap > (sniperCtx?.session.sniperMaxMcap ?? 1e6)) return;

      await bot.api.sendMessage(chatId,
        `🆕 *New Token*\n\n💊 *${d.name}* ($${d.symbol ?? "???"})\nCA: \`${d.mint}\``,
        {
          parse_mode: "Markdown",
          reply_markup: new InlineKeyboard()
            .text("🟢 0.01", `b_${d.mint}_0.01`).text("🟢 0.05", `b_${d.mint}_0.05`).text("🟢 0.1", `b_${d.mint}_0.1`).row()
            .text("🔍 Details", `r_${d.mint}`).text("👁 Watch", `w_${d.mint}`).row()
            .url("Pump.fun", `https://pump.fun/coin/${d.mint}`),
        }
      );
    } catch {}
  });

  ws.on("close", () => {
    console.log("🎯 WS closed");
    if (sniperCtx?.session.sniperEnabled) {
      setTimeout(() => { if (sniperCtx?.session.sniperEnabled) startSniper(sniperCtx); }, 3000);
    }
  });

  ws.on("error", (e) => console.error("🎯 WS error:", e.message));
}

function stopSniper() {
  if (sniperWs) { sniperWs.removeAllListeners(); sniperWs.close(); sniperWs = null; }
  console.log("🎯 Sniper stopped");
}

// ── Settings ────────────────────────────────────────
bot.callbackQuery("settings", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(
    [
      `⚙️ *Settings*`,
      ``,
      `Wallet: \`${WALLET}\``,
      `RPC: \`${RPC_URL.replace(/api-key=.*/, "api-key=***")}\``,
      `Server: \`${SIGNING_SERVER}\``,
      `TG ID: \`${ctx.from?.id}\``,
      `Watchlist: ${ctx.session.watchlist.length} tokens`,
      `Sniper: ${ctx.session.sniperEnabled ? "🟢" : "🔴"}`,
    ].join("\n"),
    { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("🔙 Menu", "menu") }
  );
});

// ── Error + Start ───────────────────────────────────
bot.catch((err) => console.error("Bot error:", err.message ?? err));

bot.start({ onStart: () => console.log("✅ PumpSDK Telegram bot started") });

process.on("SIGINT", () => { stopSniper(); bot.stop(); process.exit(0); });
